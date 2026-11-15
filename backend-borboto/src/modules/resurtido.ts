import type { Express, RequestHandler, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { Insumo } from './inventario';
type Datos = Record<string, unknown>;
interface Lista extends Datos { id: number; folio: string; estado: string; margen_guardia: number | string }
interface Item extends Datos { lista_id: number; insumo_id: number; modo_captura: string; cantidad_sugerida: number | string; insumo: Insumo }
interface Contexto {
  pool: Pool; requireAuth: RequestHandler; admin: RequestHandler;
  transaccion: <T>(res: Response, tarea: (client: PoolClient) => Promise<T>, status?: number) => Promise<void>;
  bloquear: (client: PoolClient, ids: number[]) => Promise<Insumo[]>;
  movimiento: (client: PoolClient, res: Response, insumo: Insumo, tipo: string, modo: string, cantidad: number, factor: number, delta: number, notas: string | null) => Promise<void>;
  conversion: (insumo: Insumo, modo: unknown, cantidad: unknown) => { capturada: number; factor: number; delta: number };
  numero: (value: unknown, positivo?: boolean) => number;
  texto: (value: unknown, maximo: number, obligatorio?: boolean) => string | null;
  objeto: (value: unknown) => Datos; idValido: (value: unknown) => number;
  exigir: (condition: unknown, mensaje?: string) => void;
  error: (status: number, mensaje: string) => Error;
  responder: (error: unknown, res: Response) => unknown;
  enriquecer: (insumo: Insumo) => Datos;
}
export function registrarResurtido(app: Express, contexto: Contexto) {
  const { pool, requireAuth, admin, transaccion, bloquear, movimiento, conversion, numero, texto, objeto, idValido, exigir, error, responder, enriquecer } = contexto;
  const ruta = '/api/inventario/listas-resurtido';
  async function completar(db: Pick<PoolClient, 'query'>, listas: Lista[]) {
    if (!listas.length) return [];
    const { rows } = await db.query<Item>(`SELECT li.*, row_to_json(i) AS insumo FROM inventario_listas_resurtido_items li JOIN inventario_insumos i ON i.id=li.insumo_id WHERE li.lista_id = ANY($1::int[]) ORDER BY li.id`, [listas.map(lista => lista.id)]);
    return listas.map(lista => ({ ...lista, margen_guardia: Number(lista.margen_guardia), items: rows.filter(item => item.lista_id === lista.id).map(item => ({ ...item,
      cantidad_sugerida: Number(item.cantidad_sugerida), cantidad_comprada: item['cantidad_comprada'] == null ? null : Number(item['cantidad_comprada']),
      stock_actual_snapshot: Number(item['stock_actual_snapshot']), stock_minimo_snapshot: Number(item['stock_minimo_snapshot']), insumo: enriquecer(item.insumo) })) }));
  }
  app.get(ruta, requireAuth, admin, async (_req, res) => {
    try {
      const { rows } = await pool.query<Lista>(`SELECT * FROM inventario_listas_resurtido WHERE estado='PENDIENTE' OR creada_en >= NOW() - INTERVAL '30 days' ORDER BY (estado='PENDIENTE') DESC, creada_en DESC, id DESC LIMIT 100`);
      res.json(await completar(pool, rows));
    } catch (err) { responder(err, res); }
  });
  app.get(`${ruta}/:id`, requireAuth, admin, async (req, res) => {
    try {
      const { rows } = await pool.query<Lista>('SELECT * FROM inventario_listas_resurtido WHERE id=$1', [idValido(req.params['id'])]);
      if (!rows.length) throw error(404, 'Lista de resurtido no encontrada');
      res.json((await completar(pool, rows))[0]);
    } catch (err) { responder(err, res); }
  });
  app.post(ruta, requireAuth, admin, async (req, res) => {
    try {
      const body = objeto(req.body), nombre = texto(body['nombre'] ?? 'Lista de Resurtido', 120, true), notas = texto(body['notas'], 255), margen = numero(body['margenGuardia'] ?? 0) / 100;
      const values = body['items']; exigir(Array.isArray(values) && values.length > 0 && values.length <= 200, 'Capture entre 1 y 200 insumos');
      const items = (values as unknown[]).map(value => { const item = objeto(value); return { id: idValido(item['insumoId']), modo: item['modoCaptura'], cantidad: numero(item['cantidadSugerida'], true) / 100 }; });
      exigir(new Set(items.map(item => item.id)).size === items.length, 'Insumos duplicados');
      await transaccion(res, async client => {
        const insumos = await bloquear(client, items.map(item => item.id).sort((left, right) => left - right));
        for (const item of items) conversion(insumos.find(insumo => insumo.id === item.id)!, item.modo, item.cantidad);
        const usuario = res.locals['inventarioUsuario'];
        const { rows } = await client.query<Lista>(`WITH nuevo AS (SELECT nextval(pg_get_serial_sequence('inventario_listas_resurtido','id')) AS id) INSERT INTO inventario_listas_resurtido (id,folio,nombre,margen_guardia,notas,usuario_id,usuario_nombre) SELECT id,'RES-' || lpad(id::text,GREATEST(4,length(id::text)),'0'),$1,$2,$3,$4,$5 FROM nuevo RETURNING *`, [nombre, margen, notas, usuario.id, usuario.nombre]);
        const lista = rows[0]!;
        for (const item of items) {
          const insumo = insumos.find(insumo => insumo.id === item.id)!;
          await client.query(`INSERT INTO inventario_listas_resurtido_items (lista_id,insumo_id,modo_captura,cantidad_sugerida,stock_actual_snapshot,stock_minimo_snapshot) VALUES ($1,$2,$3,$4,$5,$6)`, [lista.id, item.id, item.modo, item.cantidad, Number(insumo.stock_actual), Number(insumo.stock_minimo)]);
        }
        return (await completar(client, [lista]))[0];
      }, 201);
    } catch (err) { responder(err, res); }
  });
  async function listaPendiente(client: PoolClient, id: number) {
    const { rows } = await client.query<Lista>('SELECT * FROM inventario_listas_resurtido WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw error(404, 'Lista de resurtido no encontrada');
    if (rows[0].estado !== 'PENDIENTE') throw error(409, 'Esta lista ya fue recibida o cancelada');
    return rows[0];
  }
  app.post(`${ruta}/:id/recibir`, requireAuth, admin, async (req, res) => {
    try {
      const id = idValido(req.params['id']), body = objeto(req.body), notas = texto(body['notas'], 255);
      exigir(body['modo'] === 'TODO' || body['modo'] === 'PARCIAL', 'Modo de recepcion invalido');
      await transaccion(res, async client => {
        const lista = await listaPendiente(client, id);
        const { rows: originales } = await client.query<Item>('SELECT * FROM inventario_listas_resurtido_items WHERE lista_id=$1 ORDER BY id', [id]);
        let items: { id: number; modo: unknown; cantidad: number; comprado: boolean }[];
        if (body['modo'] === 'TODO') {
          exigir(originales.length > 0, 'Lista sin insumos');
          items = originales.map(item => ({ id: item.insumo_id, modo: item.modo_captura, cantidad: Number(item.cantidad_sugerida), comprado: true }));
        } else {
          exigir(Array.isArray(body['items']) && body['items'].length <= 200, 'Items de recepcion invalidos');
          items = (body['items'] as unknown[]).map(value => {
            const item = objeto(value); exigir(typeof item['comprado'] === 'boolean', 'Marque si fue comprado');
            exigir(item['modoCaptura'] === 'UNIDAD' || item['modoCaptura'] === 'PAQUETE', 'Modo de captura invalido');
            return { id: idValido(item['insumoId']), modo: item['modoCaptura'], cantidad: numero(item['cantidadComprada']) / 100, comprado: item['comprado'] as boolean };
          });
          exigir(new Set(items.map(item => item.id)).size === items.length, 'Insumos duplicados');
        }
        const comprados = items.filter(item => item.comprado && item.cantidad > 0);
        const insumos = comprados.length ? await bloquear(client, comprados.map(item => item.id).sort((left, right) => left - right)) : [];
        await client.query('UPDATE inventario_listas_resurtido_items SET comprado=FALSE,cantidad_comprada=0 WHERE lista_id=$1', [id]);
        for (const item of comprados) {
          const insumo = insumos.find(insumo => insumo.id === item.id)!;
          const captura = conversion(insumo, item.modo, item.cantidad);
          await movimiento(client, res, insumo, 'ENTRADA_COMPRA', String(item.modo), captura.capturada, captura.factor, captura.delta, `${lista.folio}${notas ? ' - ' + notas : ''}`.slice(0, 255));
          if (originales.some(original => original.insumo_id === item.id)) await client.query('UPDATE inventario_listas_resurtido_items SET comprado=TRUE,cantidad_comprada=$1,modo_captura=$2 WHERE lista_id=$3 AND insumo_id=$4', [item.cantidad, item.modo, id, item.id]);
          else await client.query(`INSERT INTO inventario_listas_resurtido_items (lista_id,insumo_id,modo_captura,cantidad_sugerida,cantidad_comprada,comprado,stock_actual_snapshot,stock_minimo_snapshot) VALUES ($1,$2,$3,$4,$4,TRUE,$5,$6)`, [id, item.id, item.modo, item.cantidad, Number(insumo.stock_actual) - captura.delta / 100, Number(insumo.stock_minimo)]);
        }
        await client.query(`UPDATE inventario_listas_resurtido SET estado='RECIBIDA',recibida_en=NOW() WHERE id=$1`, [id]);
        return { ok: true };
      });
    } catch (err) { responder(err, res); }
  });
  app.post(`${ruta}/:id/cancelar`, requireAuth, admin, async (req, res) => {
    try {
      const id = idValido(req.params['id']);
      await transaccion(res, async client => { await listaPendiente(client, id); await client.query(`UPDATE inventario_listas_resurtido SET estado='CANCELADA' WHERE id=$1`, [id]); return { ok: true }; });
    } catch (err) { responder(err, res); }
  });
}