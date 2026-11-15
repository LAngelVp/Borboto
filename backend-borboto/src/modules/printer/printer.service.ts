// backend-borboto/src/modules/printer/printer.service.ts

import { pool } from '../../db.ts';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { print } from 'pdf-to-printer';

import {
  type DatosEmpresaTicket,
  generarTemplateProduccion,
  generarTemplateCobro,
  generarTemplatePrecuenta,
  type DatosPrecuenta,
  type DatosComandaProduccion,
  type DatosTicketCobro,
  type ItemComandaImpresion,
  type AnchoPapel,
  type TipoCorte,
} from './templates/ticket-templates.ts';

interface ImpresoraConfigurada {
  id?: number;
  nombre: string;
  destino: string;
  tipo: string;
  ip_o_puerto: string;
  puerto_tcp: number;
  activa: boolean;
  ancho_papel?: AnchoPapel;
  es_termica?: boolean;
  corte_tipo?: TipoCorte;
}

export interface WindowsPrinterInfo {
  name: string;
  deviceId: string;
  driverName?: string;
  portName?: string;
  isDefault: boolean;
  isNetwork: boolean;
  isUsb: boolean;
  isVirtual: boolean;
  isOffline: boolean;
}

export interface ElectronPendingPrintJob {
  tipo: 'USB';
  itemIds?: number[];
  envioId?: number;
  printerName: string;
  contenido: string;
  titulo: string;
  anchoPapel?: AnchoPapel;
  esTermica?: boolean;
  corteTipo?: TipoCorte;
}

interface UsbRawPrintPayload {
  printerName: string;
  contenido: string;
  anchoPapel?: AnchoPapel;
  corteTipo?: TipoCorte;
}

export class PrecuentaError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
  }
}

export class PrinterService {
  static async confirmarItemsImpresos(itemIds: number[], envioId?: number): Promise<{ ok: true }> {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 2000 ||
        itemIds.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
      throw new PrecuentaError('IDs de items invalidos', 400);
    }
    const ids = [...new Set(itemIds)];
    await pool.query(`UPDATE comanda_items
      SET estado_impresion = 'CONFIRMADO', impreso = TRUE, impreso_en = COALESCE(impreso_en, NOW())
      WHERE id = ANY($1::int[]) AND estado_impresion IN ('ENVIADO', 'PENDIENTE', 'ERROR')`, [ids]);
    await this.actualizarEnviosDeItems(ids, envioId);
    return { ok: true };
  }

  static async marcarItemsErrorImpresion(
    itemIds: number[],
    envioId?: number,
    mensaje?: string,
  ): Promise<{ ok: true }> {
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 2000 ||
        itemIds.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
      throw new PrecuentaError('IDs de items invalidos', 400);
    }
    const ids = [...new Set(itemIds)];
    await pool.query(`UPDATE comanda_items
      SET estado_impresion = 'ERROR', impresion_intentos = impresion_intentos + 1
      WHERE id = ANY($1::int[]) AND estado_impresion IN ('ENVIADO', 'PENDIENTE')`, [ids]);
    const envios = await this.enviosDeItems(ids, envioId);
    for (const id of envios) {
      await pool.query(`UPDATE comanda_envios SET estado = 'ERROR', error = COALESCE($2, error) WHERE id = $1`, [
        id,
        mensaje || 'No se pudo confirmar la impresión',
      ]);
    }
    return { ok: true };
  }

  private static async enviosDeItems(itemIds: number[], envioId?: number): Promise<number[]> {
    if (envioId && Number.isInteger(envioId)) return [envioId];
    if (itemIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT DISTINCT envio_id FROM comanda_items WHERE id = ANY($1::int[]) AND envio_id IS NOT NULL`,
      [itemIds],
    );
    return rows.map(row => Number(row.envio_id)).filter(id => Number.isInteger(id) && id > 0);
  }

  private static async actualizarEnviosDeItems(itemIds: number[], envioId?: number): Promise<void> {
    const envios = await this.enviosDeItems(itemIds, envioId);
    for (const id of envios) await this.recalcularEstadoEnvio(id);
  }

  static async recalcularEstadoEnvio(envioId: number): Promise<void> {
    await pool.query(
      `UPDATE comanda_envios e SET
         estado = CASE
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion = 'ERROR') THEN 'ERROR'
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion = 'PENDIENTE') THEN 'PENDIENTE'
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion = 'ENVIADO') THEN 'ENVIADO'
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion IN ('CONFIRMADO', 'SIMULADO')) THEN 'CONFIRMADO'
           ELSE e.estado
         END,
         confirmado_en = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM comanda_items ci
             WHERE ci.envio_id = e.id AND ci.estado_impresion IN ('PENDIENTE', 'ENVIADO', 'ERROR')
           ) THEN COALESCE(e.confirmado_en, NOW())
           ELSE e.confirmado_en
         END
       WHERE e.id = $1`,
      [envioId],
    );
  }

  private static async recalcularEstadoEnvioConCliente(client: any, envioId: number): Promise<void> {
    await client.query(
      `UPDATE comanda_envios e SET
         estado = CASE
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion = 'ERROR') THEN 'ERROR'
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion = 'PENDIENTE') THEN 'PENDIENTE'
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion = 'ENVIADO') THEN 'ENVIADO'
           WHEN EXISTS (SELECT 1 FROM comanda_items ci WHERE ci.envio_id = e.id AND ci.estado_impresion IN ('CONFIRMADO', 'SIMULADO')) THEN 'CONFIRMADO'
           ELSE e.estado
         END,
         confirmado_en = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM comanda_items ci
             WHERE ci.envio_id = e.id AND ci.estado_impresion IN ('PENDIENTE', 'ENVIADO', 'ERROR')
           ) THEN COALESCE(e.confirmado_en, NOW())
           ELSE e.confirmado_en
         END
       WHERE e.id = $1`,
      [envioId],
    );
  }

  static async imprimirPrecuenta(comandaId: number): Promise<{
    ok: true;
    comandaId: number;
    ticketTexto: string | null;
    impresionesPendientes: ElectronPendingPrintJob[];
  }> {
    const comandaRes = await pool.query(
      `SELECT c.id, m.numero AS mesa, c.tipo_origen, c.folio_origen,
              COALESCE(z.nombre, c.tipo_origen) AS zona, u.nombre AS atendido_por,
              TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI') AS fecha
       FROM comandas c LEFT JOIN mesas m ON m.id = c.mesa_id
       LEFT JOIN zonas z ON z.id = m.zona_id JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.id = $1 AND c.estado = 'ABIERTA'`,
      [comandaId],
    );
    if (!comandaRes.rows[0]) throw new PrecuentaError('Comanda abierta no encontrada', 404);
    const itemsRes = await pool.query(
      `SELECT ci.cantidad, p.nombre, ci.precio_unitario, ci.subtotal
       FROM comanda_items ci JOIN productos p ON p.id = ci.producto_id
       WHERE ci.comanda_id = $1 ORDER BY ci.id`,
      [comandaId],
    );
    if (!itemsRes.rows.length) throw new PrecuentaError('La comanda no tiene items para generar precuenta', 400);
    const items: ItemComandaImpresion[] = itemsRes.rows.map((item) => ({
      cantidad: Number(item.cantidad), nombre: item.nombre,
      precio_unitario: Number(item.precio_unitario), subtotal: Number(item.subtotal),
    }));
    const comanda = comandaRes.rows[0];
    const datos: DatosPrecuenta = {
      folioComanda: comandaId, mesa: comanda.mesa, tipoOrigen: comanda.tipo_origen,
      folioOrigen: comanda.folio_origen, zona: comanda.zona,
      atendidoPor: comanda.atendido_por, fecha: comanda.fecha,
      items, total: Math.round(items.reduce((total, item) => total + Number(item.subtotal), 0) * 100) / 100,
      datosEmpresa: await this.obtenerDatosEmpresaTicket(),
    };
    const impresoras = await this.obtenerImpresorasPorDestino('CAJA');
    const textos: string[] = [];
    const impresionesPendientes: ElectronPendingPrintJob[] = [];
    if (!impresoras.length) textos.push(generarTemplatePrecuenta(datos));
    for (const impresora of impresoras) {
      const contenido = generarTemplatePrecuenta(datos, impresora.ancho_papel || '80mm');
      if (impresora.tipo === 'USB') {
        impresionesPendientes.push(this.crearTrabajoElectron(impresora, contenido, 'Precuenta'));
      } else {
        const fallback = await this.enviarDirectoAImpresora(impresora, contenido);
        if (fallback) textos.push(fallback);
      }
    }
    return { ok: true, comandaId, ticketTexto: textos.join('\n\n') || null, impresionesPendientes };
  }

  private static readonly VIRTUAL_PRINTER_PATTERNS = [
    'microsoft print to pdf',
    'microsoft xps document writer',
    'fax',
    'onenote',
    'pdf',
    'xps',
  ];

  private static async execCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(command, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }

  private static escapePowerShell(value: string): string {
    return value.replace(/'/g, "''");
  }

  private static normalizarTexto(value: string): string {
    return value.trim().toLowerCase();
  }

  private static crearTrabajoElectron(
    impresora: ImpresoraConfigurada,
    contenido: string,
    titulo: string,
  ): ElectronPendingPrintJob {
    return {
      tipo: 'USB',
      printerName: impresora.ip_o_puerto,
      contenido,
      titulo,
      anchoPapel: impresora.ancho_papel || '80mm',
      esTermica: impresora.es_termica === true,
      corteTipo: impresora.corte_tipo || 'NINGUNO',
    };
  }

  private static async obtenerDatosEmpresaTicket(): Promise<DatosEmpresaTicket> {
    const negocioRes = await pool.query(
      'SELECT nombre, rfc, telefono, direccion, email, mensaje_recibo FROM datos_negocio WHERE id = 1 LIMIT 1',
    );
    const facturacionRes = await pool.query(
      'SELECT razon_social, rfc_emisor, regimen_fiscal, codigo_postal FROM configuracion_facturacion WHERE id = 1 LIMIT 1',
    );

    const negocio = negocioRes.rows[0] || {};
    const facturacion = facturacionRes.rows[0] || {};

    return {
      nombre: negocio.nombre || facturacion.razon_social || 'BORBOTO POS',
      razonSocial: facturacion.razon_social || undefined,
      rfc: negocio.rfc || facturacion.rfc_emisor || undefined,
      direccion: negocio.direccion || undefined,
      telefono: negocio.telefono || undefined,
      email: negocio.email || undefined,
      regimenFiscal: facturacion.regimen_fiscal || undefined,
      codigoPostal: facturacion.codigo_postal || undefined,
      mensajeRecibo: negocio.mensaje_recibo || undefined,
    };
  }

  private static inferirTipoCola(printer: {
    name: string;
    deviceId: string;
    driverName?: string;
    portName?: string;
    workOffline?: boolean;
    network?: boolean;
    default?: boolean;
  }): WindowsPrinterInfo {
    const portName = printer.portName || '';
    const driverName = printer.driverName || '';
    const name = printer.name || printer.deviceId || '';
    const normalizedName = this.normalizarTexto(name);
    const normalizedDriver = this.normalizarTexto(driverName);
    const normalizedPort = this.normalizarTexto(portName);
    const isUsb = normalizedPort.startsWith('usb') || normalizedPort.includes('dot4');
    const isNetwork =
      Boolean(printer.network) ||
      normalizedPort.startsWith('tcp') ||
      normalizedPort.startsWith('ip_') ||
      normalizedPort.startsWith('wsd');
    const isVirtual = this.VIRTUAL_PRINTER_PATTERNS.some(
      (pattern) => normalizedName.includes(pattern) || normalizedDriver.includes(pattern),
    );

    return {
      name,
      deviceId: printer.deviceId || name,
      driverName: driverName || undefined,
      portName: portName || undefined,
      isDefault: Boolean(printer.default),
      isNetwork,
      isUsb,
      isVirtual,
      isOffline: Boolean(printer.workOffline),
    };
  }

  static async obtenerImpresorasWindows(): Promise<WindowsPrinterInfo[]> {
    if (process.platform !== 'win32') {
      return [];
    }

    const psCommand = [
      'powershell -NoProfile -ExecutionPolicy Bypass -Command',
      '"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
      '$printers = Get-CimInstance Win32_Printer | Select-Object Name,DeviceID,DriverName,PortName,WorkOffline,Network,Default;',
      '$printers | ConvertTo-Json -Depth 3 -Compress"',
    ].join(' ');

    const { stdout } = await this.execCommand(psCommand);
    const raw = stdout.trim();
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const printers = Array.isArray(parsed) ? parsed : [parsed];
    return printers
      .map((printer) => this.inferirTipoCola(printer))
      .sort((left, right) => left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }));
  }

  static async resolverImpresoraWindows(
    impresora: Pick<ImpresoraConfigurada, 'nombre' | 'ip_o_puerto' | 'tipo'>,
  ): Promise<WindowsPrinterInfo | null> {
    if (process.platform !== 'win32' || impresora.tipo !== 'USB') {
      return null;
    }

    const impresoras = await this.obtenerImpresorasWindows();
    const buscados = [impresora.ip_o_puerto, impresora.nombre]
      .map((value) => this.normalizarTexto(value || ''))
      .filter(Boolean);

    const exacta = impresoras.find((item) =>
      buscados.some(
        (value) =>
          value === this.normalizarTexto(item.name) ||
          value === this.normalizarTexto(item.deviceId),
      ),
    );
    if (exacta) {
      return exacta;
    }

    return (
      impresoras.find((item) =>
        buscados.some(
          (value) =>
            this.normalizarTexto(item.name).includes(value) ||
            this.normalizarTexto(item.deviceId).includes(value),
        ),
      ) || null
    );
  }

  private static construirBufferTermico(
    contenido: string,
    anchoPapel: AnchoPapel = '80mm',
    corteTipo: TipoCorte = 'NINGUNO',
  ): Buffer {
    const initialize = Buffer.from([0x1b, 0x40]);
    const lineSpacing = Buffer.from([0x1b, 0x33, 0x00]);
    const text = Buffer.from(contenido.replace(/\r?\n/g, '\r\n'), 'latin1');
    // Refuerzo físico para térmicas: después de las líneas en blanco del template,
    // este feed adicional fuerza expulsión visible de papel aun sin corte automático.
    const feed = Buffer.from(
      anchoPapel === '58mm' ? [0x0a, 0x0a, 0x0a, 0x0a, 0x0a] : [0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a],
    );
    const cut =
      corteTipo === 'TOTAL'
        ? Buffer.from([0x1d, 0x56, 0x41, 0x10])
        : corteTipo === 'PARCIAL'
          ? Buffer.from([0x1d, 0x56, 0x01])
          : Buffer.alloc(0);
    return Buffer.concat([initialize, lineSpacing, Buffer.from([0x0a]), text, feed, cut]);
  }

  private static async imprimirUsbWindowsRaw(
    nombreCola: string,
    contenido: string,
    anchoPapel: AnchoPapel = '80mm',
    corteTipo: TipoCorte = 'NINGUNO',
  ): Promise<void> {
    const rawPath = path.join(process.cwd(), `temp_ticket_${Date.now()}.bin`);
    fs.writeFileSync(rawPath, this.construirBufferTermico(contenido, anchoPapel, corteTipo));

    try {
      const escapedPath = this.escapePowerShell(rawPath);
      const escapedPrinter = this.escapePowerShell(nombreCola);
      const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$printerName = '${escapedPrinter}';$filePath = '${escapedPath}';$source = @\"
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName = \"RAW Ticket\";
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile = null;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType = \"RAW\";
  }
  [DllImport(\"winspool.Drv\", EntryPoint = \"OpenPrinterW\", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport(\"winspool.Drv\", SetLastError = true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport(\"winspool.Drv\", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);
  [DllImport(\"winspool.Drv\", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport(\"winspool.Drv\", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport(\"winspool.Drv\", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport(\"winspool.Drv\", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static void SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) throw new InvalidOperationException(\"No se pudo abrir la cola de impresión.\");
    try {
      var doc = new DOCINFOA();
      if (!StartDocPrinter(hPrinter, 1, doc)) throw new InvalidOperationException(\"No se pudo iniciar el documento RAW.\");
      try {
        if (!StartPagePrinter(hPrinter)) throw new InvalidOperationException(\"No se pudo iniciar la página RAW.\");
        try {
          IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
            int written;
            if (!WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written) || written != bytes.Length) {
              throw new InvalidOperationException(\"No se pudo escribir todo el contenido en la cola RAW.\");
            }
          } finally { Marshal.FreeCoTaskMem(unmanagedBytes); }
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
\"@;Add-Type -TypeDefinition $source -Language CSharp;$bytes = [System.IO.File]::ReadAllBytes($filePath);[RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes);"`;

      await this.execCommand(psCommand);
    } finally {
      if (fs.existsSync(rawPath)) {
        fs.unlinkSync(rawPath);
      }
    }
  }

  static async validarImpresoraUsbConfigurada(
    nombreImpresora: string,
  ): Promise<{ ok: boolean; motivo?: string; printer?: WindowsPrinterInfo }> {
    if (process.platform !== 'win32') {
      return { ok: true };
    }

    const printer = await this.resolverImpresoraWindows({
      nombre: nombreImpresora,
      ip_o_puerto: nombreImpresora,
      tipo: 'USB',
    });
    if (!printer) {
      return {
        ok: false,
        motivo: `La impresora USB "${nombreImpresora}" no existe en Windows. Verifica el nombre exacto de la cola.`,
      };
    }

    if (printer.isVirtual) {
      return {
        ok: false,
        motivo: `La impresora "${printer.name}" es virtual. Selecciona una impresora térmica real instalada en Windows.`,
        printer,
      };
    }

    return { ok: true, printer };
  }

  // ─── ENVÍO DINÁMICO CONSULTANDO LA BASE DE DATOS POR DESTINO ─────────────
  static async enviarDirectoAImpresora(
    impresora: ImpresoraConfigurada,
    contenido: string,
  ): Promise<string | null> {
    if (!impresora.activa) {
      console.log(`⚠️ Impresora "${impresora.nombre}" (${impresora.destino}) está desactivada.`);
      return null;
    }

    // 1. MODO RED (TCP/IP directo a comanderas térmicas de Cocina / Barra)
    if (impresora.tipo === 'RED') {
      return new Promise((resolve) => {
        const client = new net.Socket();
        const puerto = impresora.puerto_tcp || 9100;

        client.setTimeout(3000);

        client.connect(puerto, impresora.ip_o_puerto, () => {
          const bufferSalida =
            impresora.es_termica === true
              ? this.construirBufferTermico(
                  contenido,
                  impresora.ancho_papel || '80mm',
                  impresora.corte_tipo || 'NINGUNO',
                )
              : Buffer.from(contenido, 'utf8');

          client.write(bufferSalida, () => {
            client.end();
            resolve(null);
          });
        });

        client.on('error', (err) => {
          console.error(`❌ Error de conexión TCP/IP con ${impresora.nombre}:`, err.message);
          client.destroy();
          resolve(contenido);
        });

        client.on('timeout', () => {
          console.error(`⏰ Timeout conectando a impresora de red ${impresora.nombre}`);
          client.destroy();
          resolve(contenido);
        });
      });
    }

    // 2. MODO USB / SISTEMA OPERATIVO (Impresora física en Máquina Madre)
    if (impresora.tipo === 'USB') {
      try {
        const resuelta = await this.resolverImpresoraWindows(impresora);
        if (!resuelta) {
          throw new Error(
            `No se encontró en Windows la cola configurada para "${impresora.nombre}" usando "${impresora.ip_o_puerto}".`,
          );
        }

        if (process.platform === 'win32') {
          await this.imprimirUsbWindowsRaw(
            resuelta.name,
            contenido,
            impresora.ancho_papel || '80mm',
            impresora.corte_tipo || 'NINGUNO',
          );
        } else {
          const tempPath = path.join(process.cwd(), `temp_ticket_${Date.now()}.txt`);
          fs.writeFileSync(tempPath, contenido, 'utf8');

          await print(tempPath, {
            printer: impresora.ip_o_puerto,
          });

          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        }

        return null;
      } catch (err: any) {
        console.error(`❌ Error al imprimir en USB local (${impresora.nombre}):`, err.message);
        return contenido;
      }
    }

    // 3. MODO SIMULACIÓN
    if (impresora.tipo === 'SIMULACION') {
      console.log(`\n==================================================`);
      console.log(`🖨️ [IMPRESORA ${impresora.destino} - SIMULADOR: ${impresora.nombre}]`);
      console.log(`==================================================`);
      console.log(contenido);
      console.log(`==================================================\n`);
      return contenido;
    }

    return null;
  }

  // ─── HELPER: OBTENER TODAS LAS IMPRESORAS ACTIVAS POR DESTINO ─────────────────
  private static async obtenerImpresorasPorDestino(destino: 'COCINA' | 'BARRA' | 'CAJA') {
    const { rows } = await pool.query(
      `SELECT * FROM impresoras WHERE destino = $1 AND activa = TRUE`,
      [destino],
    );
    return rows;
  }

  static async obtenerImpresoraPorId(id: number): Promise<ImpresoraConfigurada | null> {
    const { rows } = await pool.query('SELECT * FROM impresoras WHERE id = $1 LIMIT 1', [id]);
    return rows[0] || null;
  }

  static async generarTicketPrueba(impresora: ImpresoraConfigurada): Promise<string> {
    const datosEmpresa = await this.obtenerDatosEmpresaTicket();
    const separador =
      impresora.ancho_papel === '58mm'
        ? '------------------------------'
        : '------------------------------------------';
    return [
      '',
      datosEmpresa.nombre || 'BORBOTO POS',
      datosEmpresa.razonSocial || '',
      datosEmpresa.rfc ? `RFC: ${datosEmpresa.rfc}` : '',
      datosEmpresa.telefono || '',
      datosEmpresa.email || '',
      'PRUEBA DE IMPRESION',
      separador,
      `Impresora: ${impresora.nombre}`,
      `Tipo: ${impresora.tipo}`,
      `Destino: ${impresora.destino}`,
      `Cola/IP: ${impresora.ip_o_puerto}`,
      `Fecha: ${new Date().toLocaleString('es-MX')}`,
      separador,
      '0123456789',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz',
      separador,
      'Si ves este ticket, la ruta de impresion funciona.',
      datosEmpresa.mensajeRecibo || '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  static async probarImpresora(
    id: number,
  ): Promise<{ ok: boolean; mensaje: string; ticketTexto?: string }> {
    const impresora = await this.obtenerImpresoraPorId(id);
    if (!impresora) {
      return { ok: false, mensaje: 'Impresora no encontrada.' };
    }

    if (impresora.tipo === 'USB') {
      return {
        ok: false,
        mensaje:
          'Las impresoras USB se prueban desde Electron en el frontend para evitar dependencias de PowerShell en Windows.',
      };
    }

    const ticketPrueba = await this.generarTicketPrueba(impresora);
    const fallback = await this.enviarDirectoAImpresora(impresora, ticketPrueba);

    if (fallback) {
      return {
        ok: false,
        mensaje: `La prueba de impresión no se pudo despachar automáticamente a "${impresora.nombre}". Revisa la configuración de la cola o el acceso a la impresora.`,
        ticketTexto: fallback,
      };
    }

    return { ok: true, mensaje: `Prueba de impresión enviada a "${impresora.nombre}".` };
  }

  static async imprimirUsbRaw(
    payload: UsbRawPrintPayload,
  ): Promise<{ ok: boolean; mensaje?: string }> {
    if (process.platform !== 'win32') {
      return { ok: false, mensaje: 'La impresión RAW USB solo está disponible en Windows.' };
    }

    await this.imprimirUsbWindowsRaw(
      payload.printerName,
      payload.contenido,
      payload.anchoPapel || '80mm',
      payload.corteTipo || 'NINGUNO',
    );

    return { ok: true };
  }

  // ─── 1. PROCESAR IMPRESIÓN DE COMANDAS DE PRODUCCIÓN (COCINA Y BARRA) ───────
  static async imprimirComandaProduccion(
    comandaId: number,
    opciones: { itemIds?: number[]; envioId?: number } = {},
  ): Promise<{
    ok: boolean;
    procesados: number;
    ticketTexto?: string;
    impresionesPendientes?: ElectronPendingPrintJob[];
  }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const comandaRes = await client.query(
        `
        SELECT
          c.id AS folio_comanda,
          m.numero AS mesa,
          c.tipo_origen AS tipo_origen,
          c.folio_origen AS folio_origen,
          COALESCE(z.nombre, c.tipo_origen, 'Sin Zona') AS zona,
          u.nombre AS atendido_por,
          TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI') AS fecha
        FROM comandas c
        LEFT JOIN mesas m ON c.mesa_id = m.id
        LEFT JOIN zonas z ON m.zona_id = z.id
        JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.id = $1
      `,
        [comandaId],
      );

      if (comandaRes.rows.length === 0) {
        throw new Error(`Comanda #${comandaId} no encontrada.`);
      }

      const infoComanda = comandaRes.rows[0];
      const itemIdsLote = Array.isArray(opciones.itemIds)
        ? [...new Set(opciones.itemIds.filter(id => Number.isInteger(id) && id > 0))]
        : [];

      const filtroLote = itemIdsLote.length > 0 ? 'AND ci.id = ANY($2::int[])' : '';
      const params: any[] = itemIdsLote.length > 0 ? [comandaId, itemIdsLote] : [comandaId];

      const itemsRes = await client.query(
        `
        SELECT
          ci.id,
          ci.cantidad,
          p.nombre,
          ci.notas,
          cat.destino_impresion
        FROM comanda_items ci
        JOIN productos p ON ci.producto_id = p.id
        JOIN categorias cat ON p.categoria_id = cat.id
        WHERE ci.comanda_id = $1
          AND ci.estado_impresion IN ('PENDIENTE', 'ERROR')
          AND cat.destino_impresion IN ('COCINA', 'BARRA')
          ${filtroLote}
        FOR UPDATE OF ci SKIP LOCKED
      `,
        params,
      );

      if (itemsRes.rows.length === 0) {
        if (opciones.envioId) await this.recalcularEstadoEnvioConCliente(client, opciones.envioId);
        await client.query('COMMIT');
        return { ok: true, procesados: 0 };
      }

      const itemsCocina: ItemComandaImpresion[] = [];
      const itemsBarra: ItemComandaImpresion[] = [];
      const destinosConfirmados = new Set<string>();
      const destinosSimulados = new Set<string>();
      const destinosEnviados = new Set<string>();
      const destinosError = new Set<string>();

      itemsRes.rows.forEach((row: any) => {
        const item: ItemComandaImpresion = {
          cantidad: row.cantidad,
          nombre: row.nombre,
          notas: row.notas,
        };

        if (row.destino_impresion === 'BARRA') {
          itemsBarra.push(item);
        } else if (row.destino_impresion === 'COCINA') {
          itemsCocina.push(item);
        }
      });

      const idsPorDestino = (destino: string) =>
        itemsRes.rows.filter((row: any) => row.destino_impresion === destino).map((row: any) => row.id);

      let textoTicketsAcumulado = '';
      const impresionesPendientes: ElectronPendingPrintJob[] = [];

      const procesarDestino = async (
        destino: 'COCINA' | 'BARRA',
        items: ItemComandaImpresion[],
        datos: DatosComandaProduccion,
      ) => {
        if (items.length === 0) return;
        const impresoras = await this.obtenerImpresorasPorDestino(destino);

        for (const imp of impresoras) {
          const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
          const ticketText = generarTemplateProduccion(datos, destino, anchoConfigurado);
          const itemIds = idsPorDestino(destino);

          if (imp.tipo === 'USB') {
            impresionesPendientes.push({
              ...this.crearTrabajoElectron(imp, ticketText, `Comanda ${destino}`),
              itemIds,
              envioId: opciones.envioId,
            });
            destinosEnviados.add(destino);
            continue;
          }

          const resText = await this.enviarDirectoAImpresora(imp, ticketText);
          if (imp.tipo === 'SIMULACION') {
            if (resText) textoTicketsAcumulado += resText + '\n\n';
            destinosSimulados.add(destino);
          } else if (imp.tipo === 'RED') {
            if (resText === null) destinosConfirmados.add(destino);
            else {
              textoTicketsAcumulado += resText + '\n\n';
              destinosError.add(destino);
            }
          } else if (resText) {
            textoTicketsAcumulado += resText + '\n\n';
          }
        }

        if (impresoras.length === 0) {
          textoTicketsAcumulado += generarTemplateProduccion(datos, destino, '80mm');
        }
      };

      if (itemsCocina.length > 0) {
        await procesarDestino('COCINA', itemsCocina, {
          folioComanda: infoComanda.folio_comanda,
          mesa: infoComanda.mesa,
          tipoOrigen: infoComanda.tipo_origen,
          folioOrigen: infoComanda.folio_origen,
          zona: infoComanda.zona,
          atendidoPor: infoComanda.atendido_por,
          fecha: infoComanda.fecha,
          items: itemsCocina,
        });
      }

      if (itemsBarra.length > 0) {
        await procesarDestino('BARRA', itemsBarra, {
          folioComanda: infoComanda.folio_comanda,
          mesa: infoComanda.mesa,
          tipoOrigen: infoComanda.tipo_origen,
          folioOrigen: infoComanda.folio_origen,
          zona: infoComanda.zona,
          atendidoPor: infoComanda.atendido_por,
          fecha: infoComanda.fecha,
          items: itemsBarra,
        });
      }

      const idsConfirmados: number[] = [];
      const idsSimulados: number[] = [];
      const idsEnviados: number[] = [];
      const idsError: number[] = [];

      for (const row of itemsRes.rows as any[]) {
        if (destinosConfirmados.has(row.destino_impresion)) idsConfirmados.push(row.id);
        else if (destinosSimulados.has(row.destino_impresion)) idsSimulados.push(row.id);
        else if (destinosEnviados.has(row.destino_impresion)) idsEnviados.push(row.id);
        else if (destinosError.has(row.destino_impresion)) idsError.push(row.id);
      }

      if (idsConfirmados.length > 0) {
        await client.query(
          `UPDATE comanda_items
           SET estado_impresion = 'CONFIRMADO', impreso = TRUE, impreso_en = NOW()
           WHERE id = ANY($1::int[])`,
          [idsConfirmados],
        );
      }
      if (idsSimulados.length > 0) {
        await client.query(
          `UPDATE comanda_items
           SET estado_impresion = 'SIMULADO', impreso = TRUE, impreso_en = NOW()
           WHERE id = ANY($1::int[])`,
          [idsSimulados],
        );
      }
      if (idsEnviados.length > 0) {
        await client.query(
          `UPDATE comanda_items
           SET estado_impresion = 'ENVIADO', impresion_intentos = impresion_intentos + 1
           WHERE id = ANY($1::int[])`,
          [idsEnviados],
        );
      }
      if (idsError.length > 0) {
        await client.query(
          `UPDATE comanda_items
           SET estado_impresion = 'ERROR', impresion_intentos = impresion_intentos + 1
           WHERE id = ANY($1::int[])`,
          [idsError],
        );
      }

      if (opciones.envioId) await this.recalcularEstadoEnvioConCliente(client, opciones.envioId);

      await client.query('COMMIT');
      return {
        ok: true,
        procesados: idsConfirmados.length + idsSimulados.length,
        ticketTexto: textoTicketsAcumulado.trim() || undefined,
        impresionesPendientes: impresionesPendientes.length > 0 ? impresionesPendientes : undefined,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error procesando impresión de producción:', error.message);
      return { ok: false, procesados: 0 };
    } finally {
      client.release();
    }
  }

  // ─── 2. PROCESAR IMPRESIÓN DEL TICKET DE COBRO (CAJA / MOSTRADOR) ─────────────
  static async imprimirTicketCobro(
    pagoId: number,
  ): Promise<
    | { ticketTexto?: string | null; impresionesPendientes?: ElectronPendingPrintJob[] }
    | string
    | null
  > {
    try {
      const impresorasCaja = await this.obtenerImpresorasPorDestino('CAJA');

      const pagoRes = await pool.query(
        `
        SELECT
          p.id AS pago_id,
          c.id AS folio_comanda,
          m.numero AS mesa,
          c.tipo_origen AS tipo_origen,
          c.folio_origen AS folio_origen,
          COALESCE(z.nombre, c.tipo_origen, 'Sin Zona') AS zona,
          cl.nombre AS cliente_nombre,
          u.nombre AS atendido_por,
          TO_CHAR(p.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
          p.metodo_pago,
          p.total_cuenta,
          p.descuento, p.dividir_cuenta, p.partes_iguales,
          p.monto_recibido,
          p.cambio,
          ta.codigo_ticket,
          ta.url_autofactura
        FROM pagos p
        JOIN comandas c ON p.comanda_id = c.id
        LEFT JOIN mesas m ON c.mesa_id = m.id
        LEFT JOIN zonas z ON m.zona_id = z.id
        JOIN usuarios u ON p.usuario_id = u.id
        LEFT JOIN clientes cl ON c.cliente_id = cl.id
        LEFT JOIN tickets_autofactura ta ON ta.pago_id = p.id
        WHERE p.id = $1
      `,
        [pagoId],
      );

      if (pagoRes.rows.length === 0) {
        throw new PrecuentaError('Pago no encontrado', 404);
      }

      const infoPago = pagoRes.rows[0];

      const itemsRes = await pool.query(
        `
        SELECT
          ci.cantidad,
          p.nombre,
          ci.precio_unitario,
          ci.subtotal,
          ci.notas
        FROM comanda_items ci
        JOIN productos p ON ci.producto_id = p.id
        WHERE ci.comanda_id = $1
      `,
        [infoPago.folio_comanda],
      );

      const items: ItemComandaImpresion[] = itemsRes.rows.map((row) => ({
        cantidad: row.cantidad,
        nombre: row.nombre,
        precio_unitario: parseFloat(row.precio_unitario),
        subtotal: parseFloat(row.subtotal),
        notas: row.notas,
      }));

      const datosEmpresa = await this.obtenerDatosEmpresaTicket();

      const datosCobro: DatosTicketCobro = {
        folioComanda: infoPago.folio_comanda,
        pagoId: infoPago.pago_id,
        mesa: infoPago.mesa,
        tipoOrigen: infoPago.tipo_origen,
        folioOrigen: infoPago.folio_origen,
        zona: infoPago.zona,
        clienteNombre: infoPago.cliente_nombre,
        atendidoPor: infoPago.atendido_por,
        fecha: infoPago.fecha,
        metodoPago: infoPago.metodo_pago,
        totalCuenta: parseFloat(infoPago.total_cuenta),
        subtotal: items.reduce((total, item) => total + Number(item.subtotal ?? 0), 0),
        descuento: Number(infoPago.descuento ?? 0),
        dividirCuenta: infoPago.dividir_cuenta === true,
        partesIguales: Number(infoPago.partes_iguales ?? 1),
        montoRecibido: parseFloat(infoPago.monto_recibido),
        cambio: parseFloat(infoPago.cambio),
        items,
        codigoAutofactura: infoPago.codigo_ticket || undefined,
        urlAutofactura: infoPago.url_autofactura || undefined,
        datosEmpresa,
      };

      let ticketSimuladoGenerado: string | null = null;
      const impresionesPendientes: ElectronPendingPrintJob[] = [];

      if (impresorasCaja.length === 0) {
        console.log(
          '⚠️ No hay impresoras configuradas o activas para CAJA. Generando simulación de ticket por defecto.',
        );
        ticketSimuladoGenerado = generarTemplateCobro(datosCobro, '80mm');
      } else {
        for (const imp of impresorasCaja) {
          const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
          const ticketText = generarTemplateCobro(datosCobro, anchoConfigurado);

          if (imp.tipo === 'USB') {
            impresionesPendientes.push(
              this.crearTrabajoElectron(imp, ticketText, 'Ticket de Cobro'),
            );
            continue;
          }

          const resSimulacion = await this.enviarDirectoAImpresora(imp, ticketText);
          if (resSimulacion) {
            ticketSimuladoGenerado = resSimulacion;
          }
        }
      }

      return {
        ticketTexto: ticketSimuladoGenerado,
        impresionesPendientes: impresionesPendientes.length > 0 ? impresionesPendientes : undefined,
      };
    } catch (error: any) {
      if (error instanceof PrecuentaError) throw error;
      console.error('Error procesando ticket de cobro:', error.message);
      return null;
    }
  }
}
