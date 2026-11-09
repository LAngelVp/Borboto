// backend-borboto/src/services/reporteFacturas.service.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { pool } from '../db';

interface LicensePayload {
  cliente: string;
  hardware_id: string;
  vencimiento: string;
}

/**
 * Safely reads and decodes the local borboto license file to extract details.
 */
function obtenerPayloadLicencia(): LicensePayload | null {
  try {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const possiblePaths = [
      path.join(appData, 'Borboto POS', 'borboto_license.lic'),
      path.join(appData, 'borboto-pos', 'borboto_license.lic'),
      path.join(appData, 'borboto', 'borboto_license.lic'),
      path.join(appData, 'Borboto', 'borboto_license.lic'),
      path.join(os.homedir(), 'borboto_license.lic'),
      path.join(process.cwd(), 'borboto_license.lic'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const keyString = fs.readFileSync(p, 'utf8').trim();
        const [payloadBase64] = keyString.split('.');
        if (payloadBase64) {
          const payload: LicensePayload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
          return payload;
        }
      }
    }
  } catch (err: any) {
    // Silently ignore license file issues in this context
  }
  return null;
}

/**
 * Obtains the Hardware ID of the machine, with several safe fallback layers.
 */
export function obtenerHardwareId(): string {
  if (process.env.HARDWARE_ID) {
    return process.env.HARDWARE_ID.trim();
  }

  try {
    const lic = obtenerPayloadLicencia();
    if (lic && lic.hardware_id) {
      return lic.hardware_id.trim();
    }
  } catch {}

  try {
    if (process.platform === 'win32') {
      const stdout = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const uuid = (lines[1] ?? '').trim();
        if (uuid && uuid !== '00000000-0000-0000-0000-000000000000') {
          return uuid;
        }
      }
    }
  } catch (e) {}

  const fallbackRaw = `${process.env.COMPUTERNAME || 'PC'}-${process.env.USERNAME || 'USER'}`;
  return crypto.createHash('md5').update(fallbackRaw).digest('hex').toUpperCase();
}

/**
 * Retrieves the business or client name, checking multiple sources in hierarchical order.
 */
export async function obtenerNombreCliente(): Promise<string> {
  if (process.env.NOMBRE_NEGOCIO) {
    return process.env.NOMBRE_NEGOCIO.trim();
  }

  try {
    const lic = obtenerPayloadLicencia();
    if (lic && lic.cliente) {
      return lic.cliente.trim();
    }
  } catch {}

  try {
    const configRes = await pool.query('SELECT razon_social FROM configuracion_facturacion ORDER BY id LIMIT 1');
    if (configRes.rows.length > 0 && configRes.rows[0].razon_social) {
      return configRes.rows[0].razon_social.trim();
    }
  } catch {}

  return 'Borboto POS Client';
}

/**
 * 1. obtenerConteoFacturasLocales():
 * Counts the total entries existing inside the 'facturas' table in PostgreSQL.
 */
export async function obtenerConteoFacturasLocales(): Promise<number> {
  try {
    const res = await pool.query('SELECT COUNT(*)::int AS count FROM facturas');
    return res.rows[0]?.count ?? 0;
  } catch (err: any) {
    console.error('❌ [ReporteSheets] Error al consultar conteo de facturas locales:', err.message);
    throw err;
  }
}

/**
 * 2. enviarConteoAGoogleSheets():
 * Gathers local count, hardware_id, client name, and submits a GET request to the sheets webhook.
 * Handles timeouts and any internet connection errors silently as requested.
 */
export async function enviarConteoAGoogleSheets(): Promise<{ success: boolean; url: string; status: number; data: any; error?: string }> {
  const resultObj = {
    success: false,
    url: '',
    status: 0,
    data: null as any,
    error: undefined as string | undefined
  };
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let tokenSecreto = '';

  try {
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || 'https://script.google.com/macros/s/AKfycbwYP1-gaPlkLAJhqPKSPdO7DVeuK0ypEVapU8xWF5CscnPYRBSLlS75vze2DMLdA6pQdA/exec';
    const TOKEN = process.env.GOOGLE_SHEET_TOKEN;
    if (!TOKEN) throw new Error('GOOGLE_SHEET_TOKEN no configurado');
    tokenSecreto = TOKEN;

    const totalFacturas = await obtenerConteoFacturasLocales();
    const hardwareId = obtenerHardwareId();
    const nombreCliente = await obtenerNombreCliente();

    const url = `${GOOGLE_SHEET_URL}?token=${TOKEN}&hardware_id=${hardwareId}&cliente=${encodeURIComponent(nombreCliente)}&total_facturas=${totalFacturas}`;
    const urlPublica = new URL(url);
    urlPublica.searchParams.set('token', '***');
    resultObj.url = urlPublica.toString();

    console.log('📡 Enviando conteo a Google Sheets:', resultObj.url);

    const controller = new AbortController();
    const signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), 10000); // 10s maximum timeout

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      },
      redirect: "follow", // Sigue las redirecciones 302 automáticamente en Node/Bun
      signal
    });

    resultObj.status = res.status;

    const responseText = (await res.text()).replaceAll(tokenSecreto, '***');
    let responseData: any = responseText;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      // No era JSON, se mantiene como texto
    }
    resultObj.data = responseData;

    console.log('✅ Respuesta de Sheets:', res.status);

    if (res.ok) {
      resultObj.success = true;
      if (responseData && (responseData.status === 'ok' || responseData.status === 'success')) {
        console.log('✅ Exito de Sheets');
      }
    } else {
      console.warn(`⚠️ [ReporteSheets] Respuesta HTTP fallida de Sheets: ${res.status} ${res.statusText}`);
    }
  } catch (err: any) {
    resultObj.error = tokenSecreto ? String(err.message || err).replaceAll(tokenSecreto, '***') : 'Error al consultar o enviar reporte';
    // Silently capture errors in console without throwing/crashing the process or disturbing the active flow
    console.warn('Reporte Sheets fallido');
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  return resultObj;
}
