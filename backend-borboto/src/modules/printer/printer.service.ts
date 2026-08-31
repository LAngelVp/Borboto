// backend-borboto/src/modules/printer/printer.service.ts

import { pool } from '../../db.ts';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { print } from 'pdf-to-printer';

import {
  generarTemplateProduccion,
  generarTemplateCobro,
  type DatosComandaProduccion,
  type DatosTicketCobro,
  type ItemComandaImpresion,
  type AnchoPapel
} from './templates/ticket-templates.ts';

export class PrinterService {

  // ─── ENVÍO DINÁMICO CONSULTANDO LA BASE DE DATOS POR DESTINO ─────────────
  static async enviarDirectoAImpresora(
    impresora: { nombre: string; destino: string; tipo: string; ip_o_puerto: string; puerto_tcp: number; activa: boolean; ancho_papel?: AnchoPapel },
    contenido: string
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
          console.log(`🚀 Enviando comanda TCP/IP a ${impresora.nombre} (${impresora.ip_o_puerto}:${puerto})`);
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
        console.log(`🖨️ Despachando ticket a impresora USB del SO: "${impresora.ip_o_puerto}"`);

        const tempPath = path.join(process.cwd(), `temp_ticket_${Date.now()}.txt`);
        fs.writeFileSync(tempPath, contenido, 'utf8');

        await print(tempPath, {
          printer: impresora.ip_o_puerto
        });

        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

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
      [destino]
    );
    return rows;
  }

  // ─── 1. PROCESAR IMPRESIÓN DE COMANDAS DE PRODUCCIÓN (COCINA Y BARRA) ───────
  static async imprimirComandaProduccion(comandaId: number): Promise<{ ok: boolean; procesados: number; ticketTexto?: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const comandaRes = await client.query(`
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
      `, [comandaId]);

      if (comandaRes.rows.length === 0) {
        throw new Error(`Comanda #${comandaId} no encontrada.`);
      }

      const infoComanda = comandaRes.rows[0];

      const itemsRes = await client.query(`
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
      `, [comandaId]);

      if (itemsRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: true, procesados: 0 };
      }

      const itemsCocina: ItemComandaImpresion[] = [];
      const itemsBarra: ItemComandaImpresion[] = [];
      const itemIdsAActualizar: number[] = [];

      itemsRes.rows.forEach(row => {
        itemIdsAActualizar.push(row.id);

        const item: ItemComandaImpresion = {
          cantidad: row.cantidad,
          nombre: row.nombre,
          notas: row.notas
        };

        if (row.destino_impresion === 'BARRA') {
          itemsBarra.push(item);
        } else if (row.destino_impresion === 'COCINA') {
          itemsCocina.push(item);
        }
      });

      let textoTicketsAcumulado = '';

      if (itemsCocina.length > 0) {
        const impresorasCocina = await this.obtenerImpresorasPorDestino('COCINA');
        const datosCocina: DatosComandaProduccion = {
          folioComanda: infoComanda.folio_comanda,
          mesa: infoComanda.mesa,
          zona: infoComanda.zona,
          atendidoPor: infoComanda.atendido_por,
          fecha: infoComanda.fecha,
          items: itemsCocina
        };

        for (const imp of impresorasCocina) {
          const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
          const ticketText = generarTemplateProduccion(datosCocina, 'COCINA', anchoConfigurado);
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
          items: itemsBarra
        };

        for (const imp of impresorasBarra) {
          const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
          const ticketText = generarTemplateProduccion(datosBarra, 'BARRA', anchoConfigurado);
          const resText = await this.enviarDirectoAImpresora(imp, ticketText);
          if (resText) textoTicketsAcumulado += resText + '\n\n';
        }
      }

      await client.query(`
        UPDATE comanda_items
        SET impreso = TRUE, impreso_en = NOW()
        WHERE id = ANY($1::int[])
      `, [itemIdsAActualizar]);

      await client.query('COMMIT');
      return {
        ok: true,
        procesados: itemIdsAActualizar.length,
        ticketTexto: textoTicketsAcumulado.trim() || undefined
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
  static async imprimirTicketCobro(pagoId: number): Promise<string | null> {
    try {
      const impresorasCaja = await this.obtenerImpresorasPorDestino('CAJA');
      if (impresorasCaja.length === 0) {
        console.log('⚠️ No hay impresoras configuradas o activas para CAJA.');
        return null;
      }

      const pagoRes = await pool.query(`
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
          p.cambio
        FROM pagos p
        JOIN comandas c ON p.comanda_id = c.id
        JOIN mesas m ON c.mesa_id = m.id
        JOIN zonas z ON m.zona_id = z.id
        JOIN usuarios u ON p.usuario_id = u.id
        LEFT JOIN clientes cl ON c.cliente_id = cl.id
        WHERE p.id = $1
      `, [pagoId]);

      if (pagoRes.rows.length === 0) {
        throw new Error(`Pago #${pagoId} no encontrado.`);
      }

      const infoPago = pagoRes.rows[0];

      const itemsRes = await pool.query(`
        SELECT
          ci.cantidad,
          p.nombre,
          ci.precio_unitario,
          ci.subtotal,
          ci.notas
        FROM comanda_items ci
        JOIN productos p ON ci.producto_id = p.id
        WHERE ci.comanda_id = $1
      `, [infoPago.folio_comanda]);

      const items: ItemComandaImpresion[] = itemsRes.rows.map(row => ({
        cantidad: row.cantidad,
        nombre: row.nombre,
        precio_unitario: parseFloat(row.precio_unitario),
        subtotal: parseFloat(row.subtotal),
        notas: row.notas
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
        items
      };

      let ticketSimuladoGenerado: string | null = null;

      for (const imp of impresorasCaja) {
        const anchoConfigurado: AnchoPapel = imp.ancho_papel || '80mm';
        const ticketText = generarTemplateCobro(datosCobro, anchoConfigurado);
        const resSimulacion = await this.enviarDirectoAImpresora(imp, ticketText);
        if (resSimulacion) {
          ticketSimuladoGenerado = resSimulacion;
        }
      }

      return ticketSimuladoGenerado;

    } catch (error: any) {
      console.error('Error procesando ticket de cobro:', error.message);
      return null;
    }
  }
}