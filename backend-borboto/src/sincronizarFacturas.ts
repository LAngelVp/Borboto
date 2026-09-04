// backend-borboto/src/sincronizarFacturas.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pool } from './db';
import * as FacturapiModule from 'facturapi';

// Helper to safely instantiate Facturapi avoiding CJS/ESM bundling issues
function obtenerInstanciaFacturapi(apiKey: string) {
  let FacturapiClass = (FacturapiModule as any).default || FacturapiModule;
  if (typeof FacturapiClass !== 'function' && FacturapiClass && typeof (FacturapiClass as any).default === 'function') {
    FacturapiClass = (FacturapiClass as any).default;
  }
  return new FacturapiClass(apiKey);
}

interface LicensePayload {
  cliente: string;
  hardware_id: string;
  vencimiento: string;
}

/**
 * Reads and decodes the local active borboto license file to grab the vencimiento date.
 */
export function obtenerVencimientoLicencia(): string | null {
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
          if (payload.vencimiento) {
            console.log(`🔑 [SincronizarFacturas] Licencia activa encontrada para el cliente "${payload.cliente}" con vencimiento: ${payload.vencimiento}`);
            return payload.vencimiento;
          }
        }
      }
    }
  } catch (err: any) {
    console.error('⚠️ [SincronizarFacturas] Error al leer archivo de licencia:', err.message);
  }
  return null;
}

/**
 * Service function that connects with Facturapi and updates local 'facturas' table
 * based on invoices made inside the active license timeframe.
 */
export async function realizarSincronizacionFacturas(): Promise<{ ok: boolean; total: number; error?: string }> {
  try {
    // 1. Obtener apiKey fiscal activa
    const configRes = await pool.query(`SELECT api_key_test, api_key_live, modo_produccion FROM configuracion_facturacion WHERE id = 1`);
    if (configRes.rows.length === 0) {
      return { ok: false, total: 0, error: 'No se ha configurado la facturación en el sistema' };
    }

    const { api_key_test, api_key_live, modo_produccion } = configRes.rows[0];
    const apiKeyActiva = modo_produccion ? api_key_live : api_key_test;

    if (!apiKeyActiva) {
      return { ok: false, total: 0, error: 'API Key de Facturapi no configurada para el modo activo' };
    }

    // 2. Determinar timming y límites de la licencia
    const vencimiento = obtenerVencimientoLicencia();
    let fechaFin = new Date();
    // Valor inicial: 1 año completo por defecto para la ventana de sincronización
    let fechaInicioValue = new Date();
    fechaInicioValue.setFullYear(fechaInicioValue.getFullYear() - 1);

    if (vencimiento) {
      const vencDate = new Date(vencimiento + 'T23:59:59');
      if (vencDate < fechaFin) {
        fechaFin = vencDate;
      }
      const startRange = new Date(vencDate);
      startRange.setFullYear(startRange.getFullYear() - 1); // 1 año hacia atrás del vencimiento
      fechaInicioValue = startRange;
    }

    console.log(`🔄 [SincronizarFacturas] Iniciando sincronización. Periodo de licencia: [${fechaInicioValue.toISOString().split('T')[0]} - ${fechaFin.toISOString().split('T')[0]}]`);

    // 3. Consultar listado de facturas en Facturapi paginado
    const facturapi = obtenerInstanciaFacturapi(apiKeyActiva.trim());
    let currentPage = 1;
    let hasMore = true;
    let totalSincronizadas = 0;

    while (hasMore) {
      const response = await facturapi.invoices.list({
        page: currentPage,
        limit: 50,
      });

      const invoices = response.data;
      if (!invoices || invoices.length === 0) {
        hasMore = false;
        break;
      }

      for (const invoice of invoices) {
        const invoiceDate = new Date(invoice.created_at);

        // Omitir si la factura está fuera del periodo de la licencia contratada
        if (invoiceDate < fechaInicioValue || invoiceDate > fechaFin) {
          continue;
        }

        // Buscar tickets de autofactura locales asociados
        let receiptId: string | null = null;
        if (typeof invoice.receipt === 'string') {
          receiptId = invoice.receipt;
        } else if (invoice.receipt && typeof invoice.receipt === 'object') {
          receiptId = (invoice.receipt as any).id || (invoice.receipt as any)._id;
        }

        // Requisito 4: Extrae el ID del recibo desde invoice.receipt o invoice.items[0]?.receipt
        if (!receiptId) {
          receiptId = invoice.receipt || (invoice.items && (invoice.items as any)[0]?.receipt);
        }

        if (!receiptId && invoice.metadata) {
          receiptId = (invoice.metadata as any).receipt || (invoice.metadata as any).receipt_id || (invoice.metadata as any).receiptId;
        }

        let ticketId: number | null = null;

        // Requisito 4: Si se encuentra receiptId, consulta en tickets_autofactura
        if (receiptId) {
          const tRes = await pool.query('SELECT id FROM tickets_autofactura WHERE facturapi_receipt_id = $1 LIMIT 1', [receiptId]);
          if (tRes.rows.length > 0) {
            ticketId = tRes.rows[0].id;
          }
        }

        // Requisito 4 (Fallback): Si receiptId no trae resultados (o no existió), busca por coincidencia de monto y estado PENDIENTE
        if (!ticketId) {
          const invoiceTotal = invoice.total || 0;
          const tRes = await pool.query(
            "SELECT id FROM tickets_autofactura WHERE total = $1 AND estado = 'PENDIENTE' ORDER BY id DESC LIMIT 1",
            [invoiceTotal]
          );
          if (tRes.rows.length > 0) {
            ticketId = tRes.rows[0].id;
          }
        }

        // Fallback secundario de respaldo por external_id
        if (!ticketId) {
          const extId = (invoice as any).external_id;
          if (extId) {
            ticketId = parseInt(extId, 10);
            if (isNaN(ticketId)) {
              ticketId = null;
            }
          }
        }

        // Fallback terciario multivectorial por metadatos o códigos en tickets_autofactura
        if (!ticketId) {
          const queryConditions: string[] = [];
          const queryParams: any[] = [];

          const possibleTicketCodes = new Set<string>();
          const invExternalId = (invoice as any).external_id;
          const invFolio = (invoice as any).folio;

          if (invExternalId) possibleTicketCodes.add(String(invExternalId));
          if (invFolio) possibleTicketCodes.add(String(invFolio));

          if (invoice.metadata) {
            const m = invoice.metadata as any;
            if (m.codigo_ticket) possibleTicketCodes.add(String(m.codigo_ticket));
            if (m.codigo) possibleTicketCodes.add(String(m.codigo));
            if (m.folio) possibleTicketCodes.add(String(m.folio));
            if (m.ticket_code) possibleTicketCodes.add(String(m.ticket_code));
            if (m.key) possibleTicketCodes.add(String(m.key));
            if (m.external_id) possibleTicketCodes.add(String(m.external_id));
          }

          const possiblePagoIds = new Set<number>();
          if (invExternalId && !isNaN(Number(invExternalId))) {
            possiblePagoIds.add(Number(invExternalId));
          }
          if (invoice.metadata) {
            const m = invoice.metadata as any;
            if (m.pago_id && !isNaN(Number(m.pago_id))) possiblePagoIds.add(Number(m.pago_id));
            if (m.pagoId && !isNaN(Number(m.pagoId))) possiblePagoIds.add(Number(m.pagoId));
            if (m.payment_id && !isNaN(Number(m.payment_id))) possiblePagoIds.add(Number(m.payment_id));
          }

          if (possibleTicketCodes.size > 0) {
            queryParams.push(Array.from(possibleTicketCodes));
            queryConditions.push(`codigo_ticket = ANY($${queryParams.length})`);
          }

          if (possiblePagoIds.size > 0) {
            queryParams.push(Array.from(possiblePagoIds));
            queryConditions.push(`pago_id = ANY($${queryParams.length})`);
          }

          if (queryConditions.length > 0) {
            const selectQuery = `SELECT id FROM tickets_autofactura WHERE ${queryConditions.join(' OR ')} LIMIT 1`;
            const tRes = await pool.query(selectQuery, queryParams);
            if (tRes.rows.length > 0) {
              ticketId = tRes.rows[0].id;
            }
          }
        }

        // Preparar UUID alterno por si está en borrador o falla la lectura del SAT
        const uuidSat = invoice.uuid || `DRAFT_${invoice.id}`;

        // Obtener datos del receptor resolviendo la estructura de Facturapi v2 de forma segura
        const zipReceptor = invoice.customer?.address?.zip || invoice.customer?.zip || '00000';
        const regimenReceptor = invoice.customer?.tax_system || '616';

        // Requisito 3: Construcción de URLs descargables utilizando el Dashboard público de Facturapi
        const orgId = invoice.organization || process.env.FACTURAPI_ORGANIZATION_ID || 'default';
        const url_pdf = `https://dashboard.facturapi.io/downloads/organization/${orgId}/invoices/${invoice.id}/pdf`;
        const url_xml = `https://dashboard.facturapi.io/downloads/organization/${orgId}/invoices/${invoice.id}/xml`;

        // Requisito 2: Cambiar la cláusula de restricción única a ON CONFLICT (uuid_sat)
        const queryUpsert = `
          INSERT INTO facturas (
            ticket_id,
            facturapi_invoice_id,
            uuid_sat,
            rfc_receptor,
            razon_social_receptor,
            regimen_fiscal_receptor,
            codigo_postal_receptor,
            uso_cfdi,
            total,
            estado,
            url_pdf,
            url_xml,
            fecha_timbrado
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (uuid_sat) DO UPDATE SET
            ticket_id = COALESCE(EXCLUDED.ticket_id, facturas.ticket_id),
            facturapi_invoice_id = EXCLUDED.facturapi_invoice_id,
            rfc_receptor = EXCLUDED.rfc_receptor,
            razon_social_receptor = EXCLUDED.razon_social_receptor,
            regimen_fiscal_receptor = EXCLUDED.regimen_fiscal_receptor,
            codigo_postal_receptor = EXCLUDED.codigo_postal_receptor,
            uso_cfdi = EXCLUDED.uso_cfdi,
            total = EXCLUDED.total,
            estado = EXCLUDED.estado,
            url_pdf = EXCLUDED.url_pdf,
            url_xml = EXCLUDED.url_xml,
            fecha_timbrado = EXCLUDED.fecha_timbrado
          RETURNING id;
        `;

        // Requisito 5: Pasar la variable ticketId de forma íntegra a la consulta
        await pool.query(queryUpsert, [
          ticketId,
          invoice.id,
          uuidSat,
          invoice.customer?.tax_id || 'XAXX010101000',
          invoice.customer?.legal_name || 'PUBLICO EN GENERAL',
          regimenReceptor,
          zipReceptor,
          invoice.use || 'S01',
          invoice.total || 0.00,
          invoice.status || 'active',
          url_pdf,
          url_xml,
          invoiceDate
        ]);

        // Requisito 1 y 5: Sincronizar el estado del ticket con tickets_autofactura usando el enum ('TIMBRADA' o 'CANCELADA')
        if (ticketId) {
          const nuevoEstadoTicket = invoice.status === 'canceled' ? 'CANCELADA' : 'TIMBRADA';
          await pool.query('UPDATE tickets_autofactura SET estado = $1 WHERE id = $2', [nuevoEstadoTicket, ticketId]);
        }

        totalSincronizadas++;
      }

      // Detener si alcanzamos el final de la paginación de Facturapi
      if (currentPage >= response.total_pages) {
        hasMore = false;
      } else {
        currentPage++;
      }
    }

    console.log(`✅ [SincronizarFacturas] Sincronización finalizada con éxito. ${totalSincronizadas} facturas procesadas/actualizadas.`);
    return { ok: true, total: totalSincronizadas };
  } catch (err: any) {
    console.error('❌ [SincronizarFacturas] Error en proceso de sincronización:', err.message);
    return { ok: false, total: 0, error: err.message };
  }
}
