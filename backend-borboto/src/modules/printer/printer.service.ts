// backend-borboto/src/modules/printer/printer.service.ts

import { pool } from '../../db.ts';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { print } from 'pdf-to-printer';

import {
  generarTemplateProduccion,
  generarTemplateCobro,
  type DatosComandaProduccion,
  type DatosTicketCobro,
  type ItemComandaImpresion,
  type AnchoPapel,
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
  printerName: string;
  contenido: string;
  titulo: string;
  anchoPapel?: AnchoPapel;
}

export class PrinterService {
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
  ): Buffer {
    const initialize = Buffer.from([0x1b, 0x40]);
    const lineSpacing = Buffer.from([0x1b, 0x33, 0x00]);
    const text = Buffer.from(contenido.replace(/\r?\n/g, '\r\n'), 'latin1');
    const feed = Buffer.from(anchoPapel === '58mm' ? [0x0a, 0x0a, 0x0a] : [0x0a, 0x0a, 0x0a, 0x0a]);
    const cut = Buffer.from([0x1d, 0x56, 0x00]);
    return Buffer.concat([initialize, lineSpacing, text, feed, cut]);
  }

  private static async imprimirUsbWindowsRaw(
    nombreCola: string,
    contenido: string,
    anchoPapel: AnchoPapel = '80mm',
  ): Promise<void> {
    const rawPath = path.join(process.cwd(), `temp_ticket_${Date.now()}.bin`);
    fs.writeFileSync(rawPath, this.construirBufferTermico(contenido, anchoPapel));

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
          console.log(
            `🚀 Enviando comanda TCP/IP a ${impresora.nombre} (${impresora.ip_o_puerto}:${puerto})`,
          );
          client.write(contenido, 'utf8', () => {
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

        console.log(
          `🖨️ Despachando ticket USB a cola Windows: "${resuelta.name}" (driver: ${resuelta.driverName || 'N/D'}, puerto: ${resuelta.portName || 'N/D'})`,
        );

        if (process.platform === 'win32') {
          await this.imprimirUsbWindowsRaw(
            resuelta.name,
            contenido,
            impresora.ancho_papel || '80mm',
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
    const separador =
      impresora.ancho_papel === '58mm'
        ? '------------------------------'
        : '------------------------------------------';
    return [
      'BORBOTO POS',
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
      '',
    ].join('\n');
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

  // ─── 1. PROCESAR IMPRESIÓN DE COMANDAS DE PRODUCCIÓN (COCINA Y BARRA) ───────
  static async imprimirComandaProduccion(
    comandaId: number,
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
          z.nombre AS zona,
          u.nombre AS atendido_por,
          TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI') AS fecha
        FROM comandas c
        JOIN mesas m ON c.mesa_id = m.id
        JOIN zonas z ON m.zona_id = z.id
        JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.id = $1
      `,
        [comandaId],
      );

      if (comandaRes.rows.length === 0) {
        throw new Error(`Comanda #${comandaId} no encontrada.`);
      }

      const infoComanda = comandaRes.rows[0];

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
        WHERE ci.comanda_id = $1 AND ci.impreso = FALSE
      `,
        [comandaId],
      );

      if (itemsRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: true, procesados: 0 };
      }

      const itemsCocina: ItemComandaImpresion[] = [];
      const itemsBarra: ItemComandaImpresion[] = [];
      const itemIdsAActualizar: number[] = [];

      itemsRes.rows.forEach((row) => {
        itemIdsAActualizar.push(row.id);

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

      let textoTicketsAcumulado = '';
      const impresionesPendientes: ElectronPendingPrintJob[] = [];

      if (itemsCocina.length > 0) {
        const impresorasCocina = await this.obtenerImpresorasPorDestino('COCINA');
        const datosCocina: DatosComandaProduccion = {
          folioComanda: infoComanda.folio_comanda,
          mesa: infoComanda.mesa,
          zona: infoComanda.zona,
          atendidoPor: infoComanda.atendido_por,
          fecha: infoComanda.fecha,
          items: itemsCocina,
        };

        for (const imp of impresorasCocina) {
          const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
          const ticketText = generarTemplateProduccion(datosCocina, 'COCINA', anchoConfigurado);

          if (imp.tipo === 'USB') {
            impresionesPendientes.push(
              this.crearTrabajoElectron(imp, ticketText, 'Comanda Cocina'),
            );
            continue;
          }

          const resText = await this.enviarDirectoAImpresora(imp, ticketText);
          if (resText) textoTicketsAcumulado += resText + '\n\n';
        }
      }

      if (itemsBarra.length > 0) {
        const impresorasBarra = await this.obtenerImpresorasPorDestino('BARRA');
        const datosBarra: DatosComandaProduccion = {
          folioComanda: infoComanda.folio_comanda,
          mesa: infoComanda.mesa,
          zona: infoComanda.zona,
          atendidoPor: infoComanda.atendido_por,
          fecha: infoComanda.fecha,
          items: itemsBarra,
        };

        for (const imp of impresorasBarra) {
          const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
          const ticketText = generarTemplateProduccion(datosBarra, 'BARRA', anchoConfigurado);

          if (imp.tipo === 'USB') {
            impresionesPendientes.push(this.crearTrabajoElectron(imp, ticketText, 'Comanda Barra'));
            continue;
          }

          const resText = await this.enviarDirectoAImpresora(imp, ticketText);
          if (resText) textoTicketsAcumulado += resText + '\n\n';
        }
      }

      await client.query(
        `
        UPDATE comanda_items
        SET impreso = TRUE, impreso_en = NOW()
        WHERE id = ANY($1::int[])
      `,
        [itemIdsAActualizar],
      );

      await client.query('COMMIT');
      return {
        ok: true,
        procesados: itemIdsAActualizar.length,
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
          z.nombre AS zona,
          cl.nombre AS cliente_nombre,
          u.nombre AS atendido_por,
          TO_CHAR(p.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
          p.metodo_pago,
          p.total_cuenta,
          p.monto_recibido,
          p.cambio,
          ta.codigo_ticket,
          ta.url_autofactura
        FROM pagos p
        JOIN comandas c ON p.comanda_id = c.id
        JOIN mesas m ON c.mesa_id = m.id
        JOIN zonas z ON m.zona_id = z.id
        JOIN usuarios u ON p.usuario_id = u.id
        LEFT JOIN clientes cl ON c.cliente_id = cl.id
        LEFT JOIN tickets_autofactura ta ON ta.pago_id = p.id
        WHERE p.id = $1
      `,
        [pagoId],
      );

      if (pagoRes.rows.length === 0) {
        throw new Error(`Pago #${pagoId} no encontrado.`);
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

      const datosCobro: DatosTicketCobro = {
        folioComanda: infoPago.folio_comanda,
        pagoId: infoPago.pago_id,
        mesa: infoPago.mesa,
        zona: infoPago.zona,
        clienteNombre: infoPago.cliente_nombre,
        atendidoPor: infoPago.atendido_por,
        fecha: infoPago.fecha,
        metodoPago: infoPago.metodo_pago,
        totalCuenta: parseFloat(infoPago.total_cuenta),
        montoRecibido: parseFloat(infoPago.monto_recibido),
        cambio: parseFloat(infoPago.cambio),
        items,
        codigoAutofactura: infoPago.codigo_ticket || undefined,
        urlAutofactura: infoPago.url_autofactura || undefined,
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
      console.error('Error procesando ticket de cobro:', error.message);
      return null;
    }
  }
}
