import type { Express, RequestHandler, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { verificarSesion } from '../session';

type Datos = Record<string, unknown>;
export interface Insumo extends Datos {
  id: number; nombre: string; stock_actual: number | string; stock_minimo: number | string;
  factor_paquete: number | string; permite_paquetes: boolean; activo: boolean;
}
const salidas = ['SALIDA_COCINA', 'SALIDA_ALMACEN', 'SALIDA_BARRA', 'MERMA'];
const tipos = [...salidas, 'ENTRADA_COMPRA', 'REINVENTARIO_AJUSTE'];
const categorias = ['ALMACEN', 'COCINA', 'BARRA', 'EMPAQUES', 'LIMPIEZA'];
const unidades = ['PIEZA', 'BOTELLA', 'LITRO', 'KG', 'BOLSA', 'LATA'];
class InventarioError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Datos = {}) { super(message); }
}
function exigir(condition: unknown, mensaje = 'Captura invalida'): asserts condition {
  if (!condition) throw new InventarioError(400, mensaje);
}
function numero(value: unknown, positivo = false, maximo = 9999999999.99): number {
  exigir(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximo && (!positivo || value > 0));
  exigir(Math.abs(value * 100 - Math.round(value * 100)) < 0.0001, 'Use como maximo dos decimales');
  return Math.round(value * 100);
}
function texto(value: unknown, maximo: number, obligatorio = false): string | null {
  exigir(value == null || typeof value === 'string');
  const result = typeof value === 'string' ? value.trim() : '';
  exigir(result.length <= maximo && (!obligatorio || result.length > 0));
  return result || null;
}
function objeto(value: unknown): Datos {
  exigir(value && typeof value === 'object' && !Array.isArray(value));
  return value as Datos;
}
function idValido(value: unknown): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  exigir(typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647);
  return id;
}
export function enriquecerInsumo(insumo: Insumo) {
  const stock = Number(insumo.stock_actual), minimo = Number(insumo.stock_minimo), factor = Number(insumo.factor_paquete);
  const stockCent = Math.round(stock * 100), factorCent = Math.round(factor * 100);
  return { ...insumo, stock_actual: stock, stock_minimo: minimo, factor_paquete: factor, costo_unitario: Number(insumo['costo_unitario'] ?? 0),
    estado_guardia: stock === 0 ? 'SIN_STOCK' : stock <= minimo ? 'BAJO_GUARDIA' : minimo > 0 && stock <= minimo * 1.25 ? 'PRECAUCION' : 'OK',
    desglose_paquetes: insumo.permite_paquetes && factor > 1 ? { paquetesCompletos: Math.floor(stockCent / factorCent), unidadesSueltas: (stockCent % factorCent) / 100 } : null,
    faltante_sugerido: stock <= minimo ? Math.round((minimo - stock) * 100) / 100 : 0 };
}
function conversion(insumo: Insumo, modo: unknown, cantidad: unknown) {
  exigir(modo === 'UNIDAD' || modo === 'PAQUETE', 'Modo de captura invalido');
  exigir(modo !== 'PAQUETE' || insumo.permite_paquetes, 'El insumo no permite paquetes');
  const capturada = numero(cantidad, true);
  const factor = modo === 'PAQUETE' ? Math.round(Number(insumo.factor_paquete) * 100) : 100;
  exigir(Number.isSafeInteger(capturada * factor) && capturada * factor % 100 === 0, 'Conversion fuera de precision');
  const delta = capturada * factor / 100;
  exigir(delta <= 999999999999, 'Cantidad fuera de rango');
  return { capturada: capturada / 100, factor: factor / 100, delta };
}
function configuracion(body: Datos) {
  const nombre = texto(body['nombre'], 120, true), codigo = texto(body['codigo'], 40);
  const categoria = body['categoria_almacen'] ?? 'ALMACEN', unidad = body['unidad_base'] ?? 'PIEZA';
  exigir(categorias.includes(String(categoria)) && unidades.includes(String(unidad)));
  const paquetes = body['permite_paquetes'] ?? false, activo = body['activo'] ?? true;
  exigir(typeof paquetes === 'boolean' && typeof activo === 'boolean');
  return [codigo, nombre, categoria, unidad, paquetes, texto(body['nombre_paquete'] ?? 'CAJA', 30, true),
    numero(body['factor_paquete'] ?? 1, true, 99999999.99) / 100,
    numero(body['stock_minimo'] ?? 0) / 100, numero(body['costo_unitario'] ?? 0, false, 99999999.99) / 100,
    texto(body['ubicacion'], 80), activo];
}
function responder(error: unknown, res: Response) {
  if (error instanceof InventarioError) return res.status(error.status).json({ error: error.message, ...error.extra });
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return res.status(409).json({ error: 'Codigo ya registrado' });
  return res.status(500).json({ error: 'No se pudo completar la operacion de inventario' });
}
export function registrarInventario(app: Express, pool: Pool, emitirCambioGlobal: (evento: string) => void) {
  const requireAuth: RequestHandler = async (req, res, next) => {
    const session = verificarSesion((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!session) { res.status(401).json({ error: 'Sesion requerida o expirada' }); return; }
    try {
      const { rows } = await pool.query('SELECT id, nombre, rol, activo FROM usuarios WHERE id = $1', [session.id]);
      const usuario = rows[0];
      if (!usuario?.activo || usuario.rol !== session.rol) { res.status(401).json({ error: 'Sesion invalida' }); return; }
      res.locals['inventarioUsuario'] = usuario;
      next();
    } catch { res.status(503).json({ error: 'No se pudo verificar la sesion' }); }
  };
  const requireRoles = (...roles: string[]): RequestHandler => (_req, res, next) => {
    if (!roles.includes(res.locals['inventarioUsuario'].rol)) { res.status(403).json({ error: 'Permisos insuficientes' }); return; }
    next();
  };
  const lectura = requireRoles('ADMIN', 'CAJERO', 'COCINERO', 'MESERO');
  const admin = requireRoles('ADMIN');
  const ruta = '/api/inventario';
  async function transaccion<T>(res: Response, tarea: (client: PoolClient) => Promise<T>, status = 200) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await tarea(client);
      await client.query('COMMIT');
      emitirCambioGlobal('actualizar_inventario');
      res.status(status).json(result);
    } catch (error) {
      if (client) { try { await client.query('ROLLBACK'); } catch { client.release(true); client = undefined; } }
      responder(error, res);
    } finally { client?.release(); }
  }
  async function movimiento(client: PoolClient, res: Response, insumo: Insumo, tipo: string, modo: string, cantidad: number, factor: number, delta: number, notas: string | null) {
    const anterior = Math.round(Number(insumo.stock_actual) * 100);
    const saldo = anterior + delta;
    exigir(saldo >= 0 && saldo <= 999999999999, 'Stock fuera de rango');
    await client.query('UPDATE inventario_insumos SET stock_actual = $1, actualizado_en = NOW() WHERE id = $2', [saldo / 100, insumo.id]);
    const usuario = res.locals['inventarioUsuario'];
    await client.query(`INSERT INTO inventario_movimientos (insumo_id,tipo_movimiento,modo_captura,cantidad_capturada,factor_aplicado,delta_unidad_base,stock_anterior,stock_resultante,motivo_notas,usuario_id,usuario_nombre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [insumo.id, tipo, modo, cantidad, factor, delta / 100, anterior / 100, saldo / 100, notas, usuario.id, usuario.nombre]);
    insumo.stock_actual = saldo / 100;
  }
  async function bloquear(client: PoolClient, ids: number[]) {
    const { rows } = await client.query<Insumo>('SELECT * FROM inventario_insumos WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE', [ids]);
    if (rows.length !== ids.length || rows.some(insumo => !insumo.activo)) throw new InventarioError(404, 'Insumo no encontrado o inactivo');
    return rows;
  }
  app.get(`${ruta}/insumos`, requireAuth, lectura, async (req, res) => {
    try {
      const todos = req.query['incluirInactivos'] === 'true';
      if (todos && res.locals['inventarioUsuario'].rol !== 'ADMIN') throw new InventarioError(403, 'Permisos insuficientes');
      const { rows } = await pool.query<Insumo>('SELECT * FROM inventario_insumos WHERE ($1::boolean OR activo = TRUE) ORDER BY nombre, id', [todos]);
      res.json(rows.map(enriquecerInsumo));
    } catch (error) { responder(error, res); }
  });
  app.get(`${ruta}/resumen-alertas`, requireAuth, lectura, async (_req, res) => {
    try {
      const { rows } = await pool.query<Insumo>('SELECT * FROM inventario_insumos WHERE activo = TRUE ORDER BY nombre, id');
      const items = rows.map(enriquecerInsumo);
      res.json({ totalInsumos: items.length, sinStock: items.filter(item => item.estado_guardia === 'SIN_STOCK').length,
        bajoGuardia: items.filter(item => item.estado_guardia === 'BAJO_GUARDIA').length,
        enPrecaucion: items.filter(item => item.estado_guardia === 'PRECAUCION').length,
        itemsCriticos: items.filter(item => item.stock_actual <= item.stock_minimo) });
    } catch (error) { responder(error, res); }
  });
  app.post(`${ruta}/salidas-lote`, requireAuth, requireRoles('ADMIN', 'CAJERO', 'COCINERO'), async (req, res) => {
    try {
      const body = objeto(req.body);
      exigir(salidas.includes(String(body['origen'])));
      const notas = texto(body['notas'], 255), items = body['items'];
      exigir(Array.isArray(items) && items.length > 0 && items.length <= 200, 'Capture entre 1 y 200 items');
      const capturas = items.map(value => { const item = objeto(value); numero(item['cantidad'], true); exigir(['UNIDAD', 'PAQUETE'].includes(String(item['modoCaptura']))); return { id: idValido(item['insumoId']), modo: item['modoCaptura'], cantidad: item['cantidad'] }; });
      await transaccion(res, async client => {
        const insumos = await bloquear(client, [...new Set(capturas.map(item => item.id))].sort((left, right) => left - right));
        for (const item of capturas) {
          const insumo = insumos.find(row => row.id === item.id)!;
          const captura = conversion(insumo, item.modo, item.cantidad);
          if (Math.round(Number(insumo.stock_actual) * 100) < captura.delta) throw new InventarioError(409, `Stock insuficiente para ${insumo.nombre}`, { disponible: Number(insumo.stock_actual), solicitado: captura.delta / 100 });
          await movimiento(client, res, insumo, String(body['origen']), String(item.modo), captura.capturada, captura.factor, -captura.delta, notas);
        }
        return { ok: true };
      });
    } catch (error) { responder(error, res); }
  });
  app.post(`${ruta}/insumos`, requireAuth, admin, async (req, res) => {
    try {
      const body = objeto(req.body), valores = configuracion(body), inicial = numero(body['stock_inicial'] ?? 0);
      await transaccion(res, async client => {
        const { rows } = await client.query<Insumo>(`INSERT INTO inventario_insumos (codigo,nombre,categoria_almacen,unidad_base,permite_paquetes,nombre_paquete,factor_paquete,stock_minimo,costo_unitario,ubicacion,activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, valores);
        const insumo = rows[0]!;
        if (inicial > 0) await movimiento(client, res, insumo, 'ENTRADA_COMPRA', 'UNIDAD', inicial / 100, 1, inicial, 'Stock inicial');
        return enriquecerInsumo(insumo);
      }, 201);
    } catch (error) { responder(error, res); }
  });
  app.put(`${ruta}/insumos/:id`, requireAuth, admin, async (req, res) => {
    try {
      const id = idValido(req.params['id']), valores = configuracion(objeto(req.body));
      await transaccion(res, async client => {
        const { rows } = await client.query<Insumo>(`UPDATE inventario_insumos SET codigo=$1,nombre=$2,categoria_almacen=$3,unidad_base=$4,permite_paquetes=$5,nombre_paquete=$6,factor_paquete=$7,stock_minimo=$8,costo_unitario=$9,ubicacion=$10,activo=$11,actualizado_en=NOW() WHERE id=$12 RETURNING *`, [...valores, id]);
        if (!rows[0]) throw new InventarioError(404, 'Insumo no encontrado');
        return enriquecerInsumo(rows[0]);
      });
    } catch (error) { responder(error, res); }
  });
  app.post(`${ruta}/insumos/:id/ajuste`, requireAuth, admin, async (req, res) => {
    try {
      const id = idValido(req.params['id']), body = objeto(req.body), notas = texto(body['notas'], 255);
      exigir(body['tipoMovimiento'] === 'ENTRADA_COMPRA' || body['tipoMovimiento'] === 'REINVENTARIO_AJUSTE');
      await transaccion(res, async client => {
        const insumo = (await bloquear(client, [id]))[0]!;
        if (body['tipoMovimiento'] === 'ENTRADA_COMPRA') {
          const captura = conversion(insumo, body['modoCaptura'], body['cantidad']);
          await movimiento(client, res, insumo, 'ENTRADA_COMPRA', String(body['modoCaptura']), captura.capturada, captura.factor, captura.delta, notas);
        } else {
          let fisico: number;
          if (body['nuevoStockFisico'] !== undefined) {
            exigir(body['paquetesContados'] === undefined && body['unidadesSueltasContadas'] === undefined, 'Use un solo modo de conteo');
            fisico = numero(body['nuevoStockFisico']);
          } else {
            const paquetes = numero(body['paquetesContados']), sueltas = numero(body['unidadesSueltasContadas']);
            exigir(paquetes === 0 || insumo.permite_paquetes, 'El insumo no permite paquetes');
            fisico = paquetes === 0 ? sueltas : conversion(insumo, 'PAQUETE', paquetes / 100).delta + sueltas;
            exigir(fisico <= 999999999999);
          }
          const delta = fisico - Math.round(Number(insumo.stock_actual) * 100);
          if (delta !== 0) await movimiento(client, res, insumo, 'REINVENTARIO_AJUSTE', 'UNIDAD', Math.abs(delta) / 100, 1, delta, notas);
        }
        return { ok: true, insumo: enriquecerInsumo(insumo) };
      });
    } catch (error) { responder(error, res); }
  });
  app.get(`${ruta}/movimientos`, requireAuth, admin, async (req, res) => {
    try {
      const insumo = req.query['insumoId'] === undefined ? null : idValido(req.query['insumoId']);
      const tipo = req.query['tipoMovimiento'] ?? null;
      exigir(tipo === null || tipos.includes(String(tipo)));
      const limite = req.query['limite'] === undefined ? 100 : idValido(req.query['limite']); exigir(limite <= 500);
      const { rows } = await pool.query(`SELECT m.*, i.nombre AS insumo_nombre FROM inventario_movimientos m JOIN inventario_insumos i ON i.id=m.insumo_id WHERE ($1::int IS NULL OR m.insumo_id=$1) AND ($2::varchar IS NULL OR m.tipo_movimiento=$2) ORDER BY m.fecha DESC, m.id DESC LIMIT $3`, [insumo, tipo, limite]);
      res.json(rows);
    } catch (error) { responder(error, res); }
  });
}