import { pool } from '../db';

export interface SolicitudRecibo {
  payment_form: string;
  items: unknown[];
}

interface Receipt {
  id: string;
  key: string;
  self_invoice_url: string;
  external_id?: string;
  total?: number | string;
  created_at?: string;
}

export interface ProveedorRecibos {
  receipts: {
    list(params: { q: string; page: number; limit: number }): Promise<{ data: Receipt[]; total_pages?: number }>;
    create(params: SolicitudRecibo & { external_id: string }): Promise<Receipt>;
  };
}

export class ReciboFiscalError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503) { super(message); }
}

async function buscarRecibo(proveedor: ProveedorRecibos, pagoId: number): Promise<Receipt | undefined> {
  for (let page = 1; page <= 100; page++) {
    const response = await proveedor.receipts.list({ q: String(pagoId), page, limit: 100 });
    if (!Array.isArray(response.data)) throw new ReciboFiscalError('Busqueda fiscal no disponible', 503);
    const receipt = response.data.find(item => item.external_id === String(pagoId));
    if (receipt) return receipt;
    const pages = Math.max(1, Number(response.total_pages ?? 1));
    if (!Number.isInteger(pages)) throw new ReciboFiscalError('Paginacion fiscal invalida', 503);
    if (page >= pages) return undefined;
  }
  throw new ReciboFiscalError('Busqueda fiscal incompleta; reintente conciliacion', 503);
}

export async function emitirORecuperarRecibo(pagoId: number, proveedor: ProveedorRecibos, solicitud?: SolicitudRecibo, diasVigencia = 7) {
  if (!Number.isInteger(pagoId) || pagoId <= 0 || pagoId > 2147483647) throw new ReciboFiscalError('ID de pago invalido', 400);
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    await client.query('SELECT pg_advisory_lock($1::int, $2::int)', [9017, pagoId]);
    locked = true;
    const local = await client.query<{ codigo_ticket: string; url_autofactura: string; fecha_expiracion: Date }>(
      'SELECT codigo_ticket, url_autofactura, fecha_expiracion FROM tickets_autofactura WHERE pago_id = $1', [pagoId],
    );
    if (local.rows[0]) {
      await client.query("UPDATE intentos_autofactura SET estado = 'CONFIRMADO', error_generico = NULL, actualizado_en = NOW() WHERE pago_id = $1", [pagoId]);
      return { codigo: local.rows[0].codigo_ticket, url: local.rows[0].url_autofactura, expiracion: local.rows[0].fecha_expiracion };
    }
    const pagoRes = await client.query<{ total_cuenta: string | number; metodo_pago: string }>('SELECT total_cuenta, metodo_pago FROM pagos WHERE id = $1', [pagoId]);
    const pago = pagoRes.rows[0];
    if (!pago) throw new ReciboFiscalError('Pago no encontrado', 404);
    const total = Number(pago.total_cuenta);
    if (!Number.isFinite(total) || total < 0) throw new ReciboFiscalError('Total de pago invalido', 409);
    const dias = Number.isFinite(diasVigencia) && diasVigencia > 0 ? diasVigencia : 7;
    const request = solicitud ?? {
      payment_form: pago.metodo_pago === 'TARJETA' ? '04' : pago.metodo_pago === 'TRANSFERENCIA' ? '03' : '01',
      items: [{ quantity: 1, product: { description: 'CONSUMO DE ALIMENTOS Y BEBIDAS', product_key: '90101501', unit_key: 'E48', price: total, tax_included: true } }],
    };
    await client.query(`INSERT INTO intentos_autofactura (pago_id, solicitud, fecha_expiracion)
      VALUES ($1, $2::jsonb, $3) ON CONFLICT (pago_id) DO NOTHING`,
    [pagoId, JSON.stringify(request), new Date(Date.now() + dias * 86400000).toISOString()]);
    const intentoRes = await client.query<{ estado: string; solicitud: SolicitudRecibo; fecha_expiracion: Date }>(
      'SELECT estado, solicitud, fecha_expiracion FROM intentos_autofactura WHERE pago_id = $1', [pagoId],
    );
    const intento = intentoRes.rows[0];
    if (!intento) throw new ReciboFiscalError('No se pudo registrar el intento fiscal', 503);
    let receipt = await buscarRecibo(proveedor, pagoId);
    if (!receipt) {
      if (intento.estado !== 'PENDIENTE') throw new ReciboFiscalError('Emision previa sin confirmar; reintente conciliacion sin crear otro recibo', 409);
      await client.query("UPDATE intentos_autofactura SET estado = 'EMITIENDO', actualizado_en = NOW() WHERE pago_id = $1", [pagoId]);
      receipt = await proveedor.receipts.create({ ...intento.solicitud, external_id: String(pagoId) });
    }
    await client.query("UPDATE intentos_autofactura SET estado = 'RECONCILIAR', facturapi_receipt_id = $2, actualizado_en = NOW() WHERE pago_id = $1", [pagoId, receipt.id || null]);
    if (!receipt.id || !receipt.key || !receipt.self_invoice_url ||
        (receipt.external_id !== undefined && receipt.external_id !== String(pagoId)) ||
        (receipt.total !== undefined && Math.round(Number(receipt.total) * 100) !== Math.round(total * 100))) {
      throw new ReciboFiscalError('Recibo remoto invalido o incompatible con el pago', 409);
    }
    const created = receipt.created_at ? new Date(receipt.created_at).getTime() : NaN;
    const expiracion = new Date(Number.isFinite(created)
      ? Math.min(new Date(intento.fecha_expiracion).getTime(), created + dias * 86400000)
      : new Date(intento.fecha_expiracion).getTime());
    const persisted = await client.query<{ pago_id: number; codigo_ticket: string; url_autofactura: string; fecha_expiracion: Date }>(`
      INSERT INTO tickets_autofactura (pago_id, facturapi_receipt_id, codigo_ticket, url_autofactura, total, fecha_expiracion)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (facturapi_receipt_id) DO UPDATE SET
        codigo_ticket = EXCLUDED.codigo_ticket, url_autofactura = EXCLUDED.url_autofactura,
        fecha_expiracion = LEAST(tickets_autofactura.fecha_expiracion, EXCLUDED.fecha_expiracion)
      WHERE tickets_autofactura.pago_id = EXCLUDED.pago_id
      RETURNING pago_id, codigo_ticket, url_autofactura, fecha_expiracion`,
    [pagoId, receipt.id, receipt.key, receipt.self_invoice_url, total, expiracion.toISOString()]);
    const ticket = persisted.rows[0];
    if (!ticket) throw new ReciboFiscalError('El recibo ya esta vinculado a otro pago', 409);
    await client.query("UPDATE intentos_autofactura SET estado = 'CONFIRMADO', error_generico = NULL, actualizado_en = NOW() WHERE pago_id = $1", [pagoId]);
    return { codigo: ticket.codigo_ticket, url: ticket.url_autofactura, expiracion: ticket.fecha_expiracion };
  } catch (error: unknown) {
    if (!locked) releaseError = error instanceof Error ? error : new Error(String(error));
    if (locked) {
      try {
        await client.query(`UPDATE intentos_autofactura SET
          estado = CASE WHEN estado = 'PENDIENTE' THEN 'PENDIENTE' ELSE 'RECONCILIAR' END,
          error_generico = 'Operacion fiscal pendiente de conciliacion', actualizado_en = NOW() WHERE pago_id = $1`, [pagoId]);
      } catch {}
    }
    if (error instanceof ReciboFiscalError) throw error;
    throw new ReciboFiscalError('Autofactura pendiente; reintente conciliacion por pago', 503);
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [9017, pagoId]); }
      catch (error: unknown) { releaseError = error instanceof Error ? error : new Error(String(error)); }
    }
    client.release(releaseError);
  }
}

export async function reconciliarRecibosPendientes(proveedor: ProveedorRecibos, diasVigencia = 7) {
  const { rows } = await pool.query<{ pago_id: number }>("SELECT pago_id FROM intentos_autofactura WHERE estado <> 'CONFIRMADO' ORDER BY actualizado_en LIMIT 50");
  let recuperados = 0;
  let pendientes = 0;
  for (const intento of rows) {
    try { await emitirORecuperarRecibo(intento.pago_id, proveedor, undefined, diasVigencia); recuperados++; }
    catch { pendientes++; }
  }
  return { recuperados, pendientes };
}