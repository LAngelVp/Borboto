// backend-borboto/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import { Jimp } from 'jimp';
import path from 'path';
import fs from 'fs';
import * as FacturapiModule from 'facturapi';

// ─── IMPORTACIÓN DE BASE DE DATOS Y SERVICIOS ───────────────────────────────
import { pool, initDB, sincronizarCombosComoProductos } from './src/db';
import { realizarSincronizacionFacturas } from './src/sincronizarFacturas';
import { enviarConteoAGoogleSheets } from './src/services/reporteFacturas.service';
import { PrinterService, PrecuentaError } from './src/modules/printer/printer.service';
import printerRoutes from './src/modules/printer/printer.routes';

dotenv.config();

// Helper para instanciar Facturapi de forma segura evitando problemas de empaquetado (CJS / ESM)
function obtenerInstanciaFacturapi(apiKey: string) {
  let FacturapiClass = (FacturapiModule as any).default || FacturapiModule;
  if (
    typeof FacturapiClass !== 'function' &&
    FacturapiClass &&
    typeof (FacturapiClass as any).default === 'function'
  ) {
    FacturapiClass = (FacturapiClass as any).default;
  }
  return new FacturapiClass(apiKey);
}

function enmascararApiKey(value: string | null | undefined): string {
  if (!value) return '';
  return `********${value.length > 4 ? value.slice(-4) : ''}`;
}

function resolverApiKey(value: unknown, stored: string | null | undefined): string | null {
  const input = typeof value === 'string' ? value.trim() : '';
  return !input || /^[*\u2022]/.test(input) ? stored || null : input;
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

function resolveFrontendDistPath() {
  const possiblePaths = [
    path.join(__dirname, 'dist', 'borboto', 'browser'),
    path.join(__dirname, 'dist', 'browser'),
    path.join(__dirname, 'dist', 'borboto'),
    path.join(__dirname, 'dist'),
    path.join(process.cwd(), 'dist', 'borboto', 'browser'),
    path.join(process.cwd(), 'dist', 'browser'),
    path.join(process.cwd(), 'dist', 'borboto'),
    path.join(process.cwd(), 'dist'),
  ];

  return (
    possiblePaths.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) || null
  );
}

const frontendDistPath = resolveFrontendDistPath();

// Configuración Multer y Sockets
const uploadsDir = path.join(process.cwd(), 'uploads', 'productos');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storageMemoria = multer.memoryStorage();
const uploadImagen = multer({
  storage: storageMemoria,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Formato no soportado. Solo se permiten archivos de imagen.'));
    }
  },
});

const uploadCSD = multer({ storage: multer.memoryStorage() });

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  },
});

export function emitirCambioGlobal(evento: string, data?: any) {
  io.emit(evento, data);
}

type TipoOrigenComanda = 'MESA' | 'MOSTRADOR' | 'ENVIO';

function resolverTipoOrigenPorZona(zona: string | null | undefined): TipoOrigenComanda {
  const zonaNormalizada = (zona || '').trim().toUpperCase();
  if (zonaNormalizada === 'MOSTRADOR') {
    return 'MOSTRADOR';
  }
  if (zonaNormalizada === 'DOMICILIO') {
    return 'ENVIO';
  }
  return 'MESA';
}

async function obtenerOrigenComandaPorMesa(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  mesaId: number | string,
): Promise<{
  mesaId: number;
  numero: string;
  zona: string;
  tipoOrigen: TipoOrigenComanda;
  folioOrigen: string;
}> {
  const { rows } = await db.query(
    `
      SELECT m.id AS "mesaId",
             m.numero,
             COALESCE(z.nombre, 'Sin Zona') AS zona
      FROM mesas m
      LEFT JOIN zonas z ON z.id = m.zona_id
      WHERE m.id = $1
      LIMIT 1
    `,
    [mesaId],
  );

  if (rows.length === 0) {
    throw new Error('La mesa indicada no existe.');
  }

  const origen = rows[0];
  return {
    mesaId: Number(origen.mesaId),
    numero: origen.numero,
    zona: origen.zona,
    tipoOrigen: resolverTipoOrigenPorZona(origen.zona),
    folioOrigen: origen.numero,
  };
}

async function obtenerComandaAbiertaPorMesa(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  mesaId: number | string,
) {
  const { rows } = await db.query(
    `
      SELECT c.id,
             c.mesa_id AS "mesaId",
             c.usuario_id AS "usuarioId",
             c.cliente_id AS "clienteId",
             c.total,
             c.estado,
             c.tipo_origen AS "tipoOrigen",
             c.folio_origen AS "folioOrigen"
      FROM comandas c
      WHERE c.mesa_id = $1 AND c.estado = 'ABIERTA'
      ORDER BY c.id DESC
      LIMIT 1
    `,
    [mesaId],
  );

  return rows[0] || null;
}

async function obtenerComandaPorId(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  comandaId: number | string,
) {
  const { rows } = await db.query(
    `
      SELECT c.id AS "comandaId",
             c.mesa_id AS "mesaId",
             c.usuario_id AS "usuarioId",
             c.cliente_id AS "clienteId",
             c.estado,
              c.estado_operativo AS "estadoOperativo",
             c.total,
             c.tipo_origen AS "tipoOrigen",
             c.folio_origen AS "folioOrigen",
             COALESCE(m.numero, c.folio_origen) AS "mesaNumero",
             COALESCE(m.comensales, 0) AS comensales,
             COALESCE(cli.nombre, null) AS "clienteNombre",
             COALESCE(cli.direccion, null) AS "clienteDireccion",
             COALESCE(cli.puntos_acumulados, 0) AS "clientePuntos",
             COALESCE(cli.es_frecuente, false) AS "clienteEsFrecuente",
             COALESCE(cli.visitas_count, 0) AS "clienteVisitas"
      FROM comandas c
      LEFT JOIN mesas m ON c.mesa_id = m.id
      LEFT JOIN clientes cli ON c.cliente_id = cli.id
      WHERE c.id = $1
      LIMIT 1
    `,
    [comandaId],
  );

  return rows[0] || null;
}

async function generarFolioOrigen(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  tipoOrigen: Exclude<TipoOrigenComanda, 'MESA'>,
) {
  const prefijo = tipoOrigen === 'MOSTRADOR' ? 'M' : 'E';
  const { rows } = await db.query(
    `
      SELECT COUNT(*)::integer + 1 AS consecutivo
      FROM comandas
      WHERE tipo_origen = $1
        AND DATE(fecha_apertura) = CURRENT_DATE
    `,
    [tipoOrigen],
  );

  return `${prefijo}-${rows[0].consecutivo}`;
}

io.on('connection', (socket) => {
  console.log(`🔌 Cliente conectado por WebSockets`);
  // console.log(`🔌 Cliente conectado por WebSockets: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado`);
    // console.log(`🔌 Cliente desconectado: ${socket.id}`);
  });
});

app.use(cors());
app.use(express.json());
app.use('/api/impresoras', printerRoutes);
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

if (frontendDistPath) {
  app.use(express.static(frontendDistPath));
}

// ─── 1. ENDPOINTS DE SUBIDA DE IMÁGENES (CON JIMP NATIVO JS) ──────────────────
app.post('/api/productos/upload', uploadImagen.single('imagen'), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ninguna imagen' });
    }
    const uniqueName = `prod-${Date.now()}-${Math.round(Math.random() * 1e9)}.png`;
    const outputPath = path.join(uploadsDir, uniqueName);

    // Procesamiento con Jimp
    const image: any = await Jimp.read(req.file.buffer);
    if (typeof image.resize === 'function') {
      image.resize({ w: 600, h: 600 });
    }
    await image.write(outputPath);

    const url = `/uploads/productos/${uniqueName}`;
    res.json({ url });
  } catch (err: any) {
    console.error('Error procesando la imagen con Jimp:', err.message);
    res.status(500).json({ error: err.message || 'Error al optimizar la imagen' });
  }
});

// ─── 2. MESAS Y ZONAS ────────────────────────────────────────────────────────
app.get('/api/mesas', async (_req, res) => {
  try {
    const query = `
      WITH mesas_fisicas AS (
        SELECT m.id,
               m.id AS "mesaId",
               m.numero,
               COALESCE(z.nombre, 'Sin Zona') AS zona,
               m.capacidad,
               COALESCE(m.estado, 'DISPONIBLE') AS estado,
               COALESCE(m.comensales, 0) AS comensales,
               COALESCE(m.minutos_abierta, 0) AS "minutosAbierta",
               COALESCE(c.total, 0.00) AS total,
               c.id AS "comandaId",
               c.tipo_origen AS "tipoOrigen",
               c.folio_origen AS "folioOrigen",
               c.estado_operativo AS "estadoOperativo",
               c.cliente_id AS "clienteId",
               cli.nombre AS "clienteNombre",
               cli.direccion AS "clienteDireccion",
               u.nombre AS mesero,
               m.creado_en AS "creadoEn"
        FROM mesas m
        LEFT JOIN zonas z ON m.zona_id = z.id
        LEFT JOIN comandas c ON c.mesa_id = m.id AND c.estado = 'ABIERTA'
        LEFT JOIN clientes cli ON c.cliente_id = cli.id
        LEFT JOIN usuarios u ON c.usuario_id = u.id
      ),
      pedidos_externos AS (
        SELECT -c.id AS id,
               NULL::INT AS "mesaId",
               c.folio_origen AS numero,
               CASE
                 WHEN c.tipo_origen = 'MOSTRADOR' THEN 'Mostrador'
                 WHEN c.tipo_origen = 'ENVIO' THEN 'Domicilio'
                 ELSE 'Sin Zona'
               END AS zona,
               1 AS capacidad,
               COALESCE(c.estado_operativo, 'PENDIENTE'::estado_mesa_enum) AS estado,
               1 AS comensales,
               GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - c.fecha_apertura)) / 60))::INT AS "minutosAbierta",
               COALESCE(c.total, 0.00) AS total,
               c.id AS "comandaId",
               c.tipo_origen AS "tipoOrigen",
               c.folio_origen AS "folioOrigen",
               c.estado_operativo AS "estadoOperativo",
               c.cliente_id AS "clienteId",
               cli.nombre AS "clienteNombre",
               cli.direccion AS "clienteDireccion",
               u.nombre AS mesero,
               c.fecha_apertura AS "creadoEn"
        FROM comandas c
        LEFT JOIN clientes cli ON c.cliente_id = cli.id
        LEFT JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.estado = 'ABIERTA'
          AND c.mesa_id IS NULL
          AND c.tipo_origen IN ('MOSTRADOR', 'ENVIO')
      )
      SELECT * FROM mesas_fisicas
      UNION ALL
      SELECT * FROM pedidos_externos
      ORDER BY id ASC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    console.error('❌ Error en GET mesas', err.message);
    // console.error('❌ Error en GET /api/mesas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mesas/:id/abrir', async (req, res) => {
  const { id } = req.params;
  const { comensales, usuarioId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mesaRes = await client.query('SELECT id, estado FROM mesas WHERE id = $1 FOR UPDATE', [id]);
    if (mesaRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mesa no encontrada' });
    }
    if (await obtenerComandaAbiertaPorMesa(client, id)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La mesa ya tiene una comanda abierta' });
    }
    const origenMesa = await obtenerOrigenComandaPorMesa(client, id);
    await client.query(
      `UPDATE mesas SET estado = 'PENDIENTE', comensales = $1, minutos_abierta = 1 WHERE id = $2`,
      [comensales || 1, id],
    );
    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, estado, total, tipo_origen, folio_origen)
        VALUES ($1, $2, 'ABIERTA', 0.00, $3, $4)
       RETURNING id, mesa_id AS "mesaId", tipo_origen AS "tipoOrigen", folio_origen AS "folioOrigen"`,
      [id, usuarioId || 1, origenMesa.tipoOrigen, origenMesa.folioOrigen],
    );
    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res.json({
      ok: true,
      comandaId: comandaRes.rows[0].id,
      mesaId: Number(id),
      tipoOrigen: comandaRes.rows[0].tipoOrigen,
      folioOrigen: comandaRes.rows[0].folioOrigen,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'La mesa ya tiene una comanda abierta' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/mesas/:origenId/mover', async (req, res) => {
  const { origenId } = req.params;
  const { destinoId } = req.body;
  if (!origenId || !destinoId) {
    return res
      .status(400)
      .json({ error: 'Faltan parámetros: origenId y destinoId son requeridos.' });
  }
  if (Number(origenId) === Number(destinoId)) {
    return res.status(400).json({ error: 'Origen y destino deben ser distintos' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const mesaId of [Number(origenId), Number(destinoId)].sort((left, right) => left - right)) {
      const mesaRes = await client.query('SELECT id, estado FROM mesas WHERE id = $1 FOR UPDATE', [mesaId]);
      if (mesaRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Mesa no encontrada' });
      }
    }
    if (await obtenerComandaAbiertaPorMesa(client, destinoId)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La mesa ya tiene una comanda abierta' });
    }
    const mesaOrigenRes = await client.query(
      `SELECT estado, comensales, minutos_abierta FROM mesas WHERE id = $1`,
      [origenId],
    );
    if (mesaOrigenRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'La mesa origen no existe.' });
    }
    const { estado: estadoOrigen, comensales, minutos_abierta } = mesaOrigenRes.rows[0];
    const comandaActual = await obtenerComandaAbiertaPorMesa(client, origenId);

    if (comandaActual) {
      await client.query(`UPDATE comandas SET mesa_id = $1 WHERE id = $2`, [
        destinoId,
        comandaActual.id,
      ]);
    }

    await client.query(
      `UPDATE mesas SET estado = $1, comensales = $2, minutos_abierta = $3 WHERE id = $4`,
      [estadoOrigen, comensales || 1, minutos_abierta || 1, destinoId],
    );
    await client.query(
      `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
      [origenId],
    );
    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res.json({ ok: true, mensaje: 'Mesa movida exitosamente' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'La mesa ya tiene una comanda abierta' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/mesas/mover', async (req, res) => {
  const { origenId, destinoId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE comandas SET mesa_id = $1 WHERE mesa_id = $2 AND estado = 'ABIERTA'`,
      [destinoId, origenId],
    );
    await client.query(`UPDATE mesas SET estado = 'PENDIENTE' WHERE id = $1`, [destinoId]);
    await client.query(`UPDATE mesas SET estado = 'DISPONIBLE' WHERE id = $1`, [origenId]);
    await client.query('COMMIT');
    io.emit('actualizar_mesas');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al mover comanda de mesa' });
  } finally {
    client.release();
  }
});

app.post('/api/comandas/:comandaId/asignar-mesa', async (req, res) => {
  const { comandaId } = req.params;
  const { destinoId } = req.body;
  if (!destinoId) {
    return res.status(400).json({ error: 'Falta la mesa destino.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const comanda = await obtenerComandaPorId(client, comandaId);
    if (!comanda) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'La comanda no existe.' });
    }

    if (comanda.estado !== 'ABIERTA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se pueden reasignar comandas abiertas.' });
    }

    const destinoMesa = await obtenerOrigenComandaPorMesa(client, destinoId);

    const destinoComandaActiva = await obtenerComandaAbiertaPorMesa(client, destinoId);
    if (destinoComandaActiva && Number(destinoComandaActiva.id) !== Number(comandaId)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La mesa destino ya tiene una comanda activa.' });
    }

    await client.query(
      `UPDATE comandas
       SET mesa_id = $1
       WHERE id = $2`,
      [destinoMesa.mesaId, comandaId],
    );

    await client.query(
      `UPDATE mesas
       SET estado = 'PENDIENTE',
           comensales = GREATEST(comensales, 1),
           minutos_abierta = GREATEST(minutos_abierta, 1)
       WHERE id = $1`,
      [destinoMesa.mesaId],
    );

    if (comanda.mesaId) {
      await client.query(
        `UPDATE mesas
         SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0
         WHERE id = $1`,
        [comanda.mesaId],
      );
    }

    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res.json({
      ok: true,
      comandaId: Number(comandaId),
      mesaId: destinoMesa.mesaId,
      tipoOrigen: comanda.tipoOrigen,
      folioOrigen: comanda.folioOrigen,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── 3. PRODUCTOS Y MOSTRADOR ────────────────────────────────────────────────
app.post('/api/productos/importar-lote', async (req, res) => {
  const { productos } = req.body;
  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'No se enviaron productos válidos.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let insertadosCount = 0;

    for (const prod of productos) {
      const nombreCategoria = (prod.categoria || 'General').trim();
      let catRes = await client.query('SELECT id FROM categorias WHERE LOWER(nombre) = LOWER($1)', [
        nombreCategoria,
      ]);
      let categoriaId: number;

      if (catRes.rows.length === 0) {
        const nuevaCat = await client.query(
          'INSERT INTO categorias (nombre, icono, orden) VALUES ($1, $2, 0) RETURNING id',
          [nombreCategoria, 'restaurant'],
        );
        categoriaId = nuevaCat.rows[0].id;
      } else {
        categoriaId = catRes.rows[0].id;
      }

      await client.query(
        `INSERT INTO productos (categoria_id, nombre, precio, disponible, clave_sat) VALUES ($1, $2, $3, $4, $5)`,
        [
          categoriaId,
          prod.nombre.trim(),
          Number(prod.precio),
          prod.disponible !== false,
          prod.clave_sat || null,
        ],
      );
      insertadosCount++;
    }

    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_productos');
    res.status(201).json({ ok: true, agregados: insertadosCount });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message || 'Error al importar los productos.' });
  } finally {
    client.release();
  }
});

app.get('/api/productos', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.categoria_id, p.nombre, p.precio, p.disponible, p.imagen_url, c.nombre AS "categoria"
      FROM productos p LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.disponible = TRUE ORDER BY c.orden ASC, p.nombre ASC
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mostrador/crear', async (req, res) => {
  const { usuarioId, clienteId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numeroOrden = await generarFolioOrigen(client, 'MOSTRADOR');

    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, cliente_id, estado, total, tipo_origen, folio_origen)
       VALUES (NULL, $1, $2, 'ABIERTA', 0.00, 'MOSTRADOR', $3)
       RETURNING id, mesa_id AS "mesaId", tipo_origen AS "tipoOrigen", folio_origen AS "folioOrigen"`,
      [usuarioId || 1, clienteId || null, numeroOrden],
    );

    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res.status(201).json({
      ok: true,
      mesaId: comandaRes.rows[0].mesaId,
      comandaId: comandaRes.rows[0].id,
      numero: numeroOrden,
      tipoOrigen: comandaRes.rows[0].tipoOrigen,
      folioOrigen: comandaRes.rows[0].folioOrigen,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── 4. COMANDAS Y CUENTA ─────────────────────────────────────────────────────
app.get('/api/comandas/activa/:mesaId', async (req, res) => {
  const { mesaId } = req.params;
  try {
    const comandaRes = await pool.query(
      `SELECT id,
              mesa_id AS "mesaId",
              total,
              tipo_origen AS "tipoOrigen",
              folio_origen AS "folioOrigen",
              estado_operativo AS "estadoOperativo"
       FROM comandas
       WHERE mesa_id = $1 AND estado = 'ABIERTA'
       ORDER BY id DESC LIMIT 1`,
      [mesaId],
    );
    if (comandaRes.rows.length === 0) {
      return res.json({
        comandaId: 0,
        mesaId: Number(mesaId),
        total: 0,
        tipoOrigen: null,
        folioOrigen: null,
        estadoOperativo: null,
        items: [],
      });
    }
    const comandaId = comandaRes.rows[0].id;
    const itemsRes = await pool.query(
      `SELECT ci.id, ci.cantidad, ci.subtotal, ci.precio_unitario, ci.notas, ci.completado, ci.estado_kds,
              json_build_object('id', p.id, 'nombre', p.nombre, 'precio', ci.precio_unitario, 'categoria', c.nombre) AS producto
       FROM comanda_items ci JOIN productos p ON ci.producto_id = p.id JOIN categorias c ON p.categoria_id = c.id
       WHERE ci.comanda_id = $1 ORDER BY ci.id ASC`,
      [comandaId],
    );
    res.json({
      comandaId,
      mesaId: comandaRes.rows[0].mesaId,
      total: comandaRes.rows[0].total,
      tipoOrigen: comandaRes.rows[0].tipoOrigen,
      folioOrigen: comandaRes.rows[0].folioOrigen,
      estadoOperativo: comandaRes.rows[0].estadoOperativo,
      items: itemsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comandas/:comandaId', async (req, res) => {
  const { comandaId } = req.params;
  try {
    const comanda = await obtenerComandaPorId(pool, comandaId);
    if (!comanda) {
      return res.status(404).json({ error: 'Comanda no encontrada.' });
    }

    const itemsRes = await pool.query(
      `SELECT ci.id, ci.cantidad, ci.subtotal, ci.precio_unitario, ci.notas, ci.completado, ci.estado_kds,
              json_build_object('id', p.id, 'nombre', p.nombre, 'precio', ci.precio_unitario, 'categoria', c.nombre) AS producto
       FROM comanda_items ci
       JOIN productos p ON ci.producto_id = p.id
       JOIN categorias c ON p.categoria_id = c.id
       WHERE ci.comanda_id = $1
       ORDER BY ci.id ASC`,
      [comandaId],
    );

    res.json({
      ...comanda,
      items: itemsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usuarios', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, rol, activo FROM usuarios ORDER BY nombre',
    );
    res.json(rows.map((usuario) => ({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, activo: usuario.activo, pin: '', tienePin: true })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register-first-admin', async (req, res) => {
  const { nombre, pin } = req.body;
  if (!nombre || !pin) {
    return res.status(400).json({ error: 'Faltan parámetros: nombre y pin son requeridos.' });
  }
  try {
    const checkCount = await pool.query('SELECT COUNT(*) FROM usuarios');
    if (parseInt(checkCount.rows[0].count) > 0) {
      return res.status(403).json({ error: 'Ya existen usuarios registrados en el sistema.' });
    }
    const { rows } = await pool.query(
      "INSERT INTO usuarios (nombre, pin, rol, activo) VALUES ($1, $2, 'ADMIN', TRUE) RETURNING id, nombre, rol",
      [nombre, pin],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/usuarios', async (req, res) => {
  const { nombre, pin, rol, activo } = req.body;
  if (!nombre || !pin || !rol) {
    return res.status(400).json({ error: 'Faltan parámetros: nombre, pin y rol son requeridos.' });
  }
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'El PIN debe contener de 4 a 6 digitos' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nombre, pin, rol, activo) VALUES ($1, $2, $3, $4) RETURNING id, nombre, rol, activo',
      [nombre, pin, rol, activo !== false],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'PIN ya utilizado por otro usuario' : 'Error al guardar empleado' });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, pin, rol, activo } = req.body;
  const nuevoPin = typeof pin === 'string' ? pin.trim() : pin;
  if (nuevoPin != null && nuevoPin !== '' && (typeof nuevoPin !== 'string' || !/^\d{4,6}$/.test(nuevoPin))) {
    return res.status(400).json({ error: 'El PIN debe contener de 4 a 6 digitos' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE usuarios SET nombre = $1, pin = COALESCE($2, pin), rol = $3, activo = $4 WHERE id = $5 RETURNING id, nombre, rol, activo',
      [nombre, nuevoPin || null, rol, activo !== false, id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'PIN ya utilizado por otro usuario' : 'Error al guardar empleado' });
  }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: comandas } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM comandas WHERE usuario_id = $1',
      [id],
    );
    if (comandas[0].count > 0) {
      await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [id]);
      return res.json({
        ok: true,
        mensaje: 'El colaborador cuenta con historial. Marcar como inactivo.',
      });
    }
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Empleado eliminado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, rol FROM usuarios WHERE pin = $1 AND activo = TRUE',
      [pin],
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'PIN incorrecto o usuario inactivo' });
    }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/envios/crear', async (req, res) => {
  const { usuarioId, clienteId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numeroOrden = await generarFolioOrigen(client, 'ENVIO');

    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, cliente_id, estado, total, tipo_origen, folio_origen)
       VALUES (NULL, $1, $2, 'ABIERTA', 0.00, 'ENVIO', $3)
       RETURNING id, mesa_id AS "mesaId", tipo_origen AS "tipoOrigen", folio_origen AS "folioOrigen"`,
      [usuarioId || 1, clienteId || null, numeroOrden],
    );

    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res.status(201).json({
      ok: true,
      mesaId: comandaRes.rows[0].mesaId,
      comandaId: comandaRes.rows[0].id,
      numero: numeroOrden,
      tipoOrigen: comandaRes.rows[0].tipoOrigen,
      folioOrigen: comandaRes.rows[0].folioOrigen,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/mesas/:mesaId/servir', async (req, res) => {
  const { mesaId } = req.params;
  const client = await pool.connect();
  let transactionOpen = true;
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const mesaRes = await client.query('SELECT id FROM mesas WHERE id = $1 FOR UPDATE', [mesaId]);
    if (!mesaRes.rows.length) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ error: 'Mesa no encontrada' });
    }
    await client.query(`UPDATE mesas SET estado = 'SERVIDO' WHERE id = $1`, [mesaId]);
    await client.query(`UPDATE comandas SET estado_operativo = 'SERVIDO' WHERE mesa_id = $1 AND estado = 'ABIERTA'`, [mesaId]);
    await client.query('COMMIT');
    transactionOpen = false;
    emitirCambioGlobal('actualizar_mesas');
    emitirCambioGlobal('actualizar_cocina');
    res.json({ ok: true, mensaje: 'Mesa marcada como servida' });
  } catch (err: unknown) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: unknown) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release(releaseError);
  }
});

app.post('/api/comandas/:comandaId/precuenta', async (req, res) => {
  const comandaId = Number(req.params.comandaId);
  if (!Number.isInteger(comandaId) || comandaId <= 0) {
    return res.status(400).json({ error: 'ID de comanda invalido' });
  }
  try {
    res.json(await PrinterService.imprimirPrecuenta(comandaId));
  } catch (error: unknown) {
    res.status(error instanceof PrecuentaError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : 'Error al generar precuenta' });
  }
});

app.post('/api/mesas/:mesaId/precuenta', async (req, res) => {
  const mesaId = Number(req.params.mesaId);
  if (!Number.isInteger(mesaId) || mesaId <= 0) {
    return res.status(400).json({ error: 'ID de mesa invalido' });
  }
  try {
    const comanda = await obtenerComandaAbiertaPorMesa(pool, mesaId);
    if (!comanda) return res.status(404).json({ error: 'Mesa sin comanda abierta' });
    res.json(await PrinterService.imprimirPrecuenta(Number(comanda.id)));
  } catch (error: unknown) {
    res.status(error instanceof PrecuentaError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : 'Error al generar precuenta' });
  }
});

app.post('/api/comandas', async (req, res) => {
  const { comandaId, mesaId, items, usuarioId } = req.body;
  if ((!comandaId && !mesaId) || !items || !Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ error: 'Faltan parámetros: comandaId o mesaId e items son requeridos.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let idComandaActual = comandaId;
    let origenMesa = null;
    let comandaActual = null;
    let mesaIdEfectiva = mesaId ? Number(mesaId) : null;

    if (idComandaActual) {
      const resultado = await client.query(
        'SELECT id, mesa_id, estado, total, tipo_origen, folio_origen FROM comandas WHERE id = $1 FOR UPDATE',
        [idComandaActual],
      );
      comandaActual = resultado.rows[0];
      if (!comandaActual) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Comanda no encontrada' });
      }
      if (comandaActual.estado !== 'ABIERTA') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden agregar productos a una comanda cerrada o cancelada' });
      }
      mesaIdEfectiva = comandaActual.mesa_id ?? null;
    }

    if (!comandaActual && mesaIdEfectiva) {
      origenMesa = await obtenerOrigenComandaPorMesa(client, mesaIdEfectiva);
    }

    if (!idComandaActual || idComandaActual === 0) {
      if (!mesaIdEfectiva) {
        throw new Error('Se requiere mesaId para crear una comanda nueva desde una mesa física.');
      }
      const comandaExistente = await client.query(
        `SELECT id, mesa_id, estado FROM comandas WHERE mesa_id = $1 AND estado = 'ABIERTA' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [mesaIdEfectiva],
      );
      if (comandaExistente.rows.length > 0) {
        idComandaActual = comandaExistente.rows[0].id;
        comandaActual = comandaExistente.rows[0];
      } else {
        const nuevaComanda = await client.query(
          `INSERT INTO comandas (mesa_id, usuario_id, estado, total, tipo_origen, folio_origen)
           VALUES ($1, $2, 'ABIERTA', 0.00, $3, $4) RETURNING id`,
          [
            mesaIdEfectiva,
            usuarioId || 1,
            origenMesa?.tipoOrigen || 'MESA',
            origenMesa?.folioOrigen || String(mesaIdEfectiva),
          ],
        );
        idComandaActual = nuevaComanda.rows[0].id;
        comandaActual = await obtenerComandaPorId(client, idComandaActual);
      }
    }

    const itemsValidados: { productoId: number; cantidad: number; notas: unknown }[] = [];
    for (const item of items) {
      const productoId = Number(item?.productoId ?? item?.producto?.id);
      const cantidad = Number(item?.cantidad);
      if (!Number.isInteger(productoId) || productoId <= 0 || productoId > 2147483647 ||
          !Number.isInteger(cantidad) || cantidad <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Producto y cantidad deben ser enteros positivos' });
      }
      itemsValidados.push({ productoId, cantidad, notas: item.notas ?? null });
    }
    const catalogo = await client.query<{ id: number; nombre: string; precio: string | number; disponible: boolean }>(
      'SELECT id, nombre, precio, disponible FROM productos WHERE id = ANY($1::int[])',
      [[...new Set(itemsValidados.map(item => item.productoId))]],
    );
    const productos = new Map(catalogo.rows.map(producto => [producto.id, producto]));
    for (const item of itemsValidados) {
      const producto = productos.get(item.productoId);
      if (!producto) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Producto ${item.productoId} no existe` });
      }
      if (producto.disponible === false) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Producto ${producto.id} (${producto.nombre}) no esta disponible` });
      }
      if (!Number.isFinite(Number(producto.precio)) || Number(producto.precio) < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Precio invalido del producto ${producto.id}` });
      }
    }
    let totalAdicional = 0;
    for (const item of itemsValidados) {
      const productoId = item.productoId;
      const precioUnitario = Number(productos.get(productoId)!.precio);
      const cantidad = item.cantidad;
      const subtotalItem = precioUnitario * cantidad;
      totalAdicional += subtotalItem;

      await client.query(
        `INSERT INTO comanda_items (comanda_id, producto_id, cantidad, precio_unitario, notas, estado_kds) VALUES ($1, $2, $3, $4, $5, 'PENDIENTE')`,
        [idComandaActual, productoId, cantidad, precioUnitario, item.notas],
      );
    }

    await client.query(`UPDATE comandas SET total = total + $1 WHERE id = $2`, [
      totalAdicional,
      idComandaActual,
    ]);
    await client.query(`UPDATE comandas SET estado_operativo = 'EN COCINA' WHERE id = $1`, [
      idComandaActual,
    ]);
    if (mesaIdEfectiva) {
      await client.query(`UPDATE mesas SET estado = 'EN COCINA' WHERE id = $1`, [mesaIdEfectiva]);
    }
    await client.query('COMMIT');

    emitirCambioGlobal('actualizar_mesas');
    emitirCambioGlobal('actualizar_cocina');

    let ticketTextoRes: string | null = null;
    let impresionesPendientes: any[] = [];
    try {
      const resPrinter = await PrinterService.imprimirComandaProduccion(idComandaActual);
      if (resPrinter && (resPrinter as any).ticketTexto) {
        ticketTextoRes = (resPrinter as any).ticketTexto;
      }
      if (
        resPrinter &&
        typeof resPrinter === 'object' &&
        (resPrinter as any).impresionesPendientes
      ) {
        impresionesPendientes = (resPrinter as any).impresionesPendientes;
      }
    } catch (errPrinter: any) {
      console.error('⚠️ Error al imprimir comanda de producción:', errPrinter.message);
    }

    res.json({
      ok: true,
      totalAdicional,
      comandaId: idComandaActual,
      ticketTexto: ticketTextoRes,
      impresionesPendientes,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'La mesa ya tiene una comanda abierta' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/comandas/:comandaId/cancelar', async (req, res) => {
  const { comandaId } = req.params;
  const { notas } = req.body;
  const client = await pool.connect();
  let transactionOpen = true;
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const comandaRes = await client.query('SELECT mesa_id, estado FROM comandas WHERE id = $1 FOR UPDATE', [
      comandaId,
    ]);
    if (comandaRes.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ error: 'Comanda no existe.' });
    }
    const { mesa_id, estado } = comandaRes.rows[0];
    if (estado !== 'ABIERTA') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Solo se pueden cancelar comandas abiertas.' });
    }

    await client.query(
      `UPDATE comandas SET estado = 'CANCELADA', fecha_cierre = CURRENT_TIMESTAMP WHERE id = $1`,
      [comandaId],
    );
    await client.query(`UPDATE comandas SET estado_operativo = 'DISPONIBLE' WHERE id = $1`, [
      comandaId,
    ]);
    if (mesa_id) {
      await client.query(
        `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
        [mesa_id],
      );
    }
    await client.query(
      `UPDATE comanda_items SET completado = TRUE, notas = COALESCE($1 || ' - ', '') || COALESCE(notas, '') WHERE comanda_id = $2`,
      [notas || 'CANCELADO POR USUARIO', comandaId],
    );
    await client.query('COMMIT');
    transactionOpen = false;

    emitirCambioGlobal('actualizar_mesas');
    emitirCambioGlobal('actualizar_cocina');
    res.json({
      ok: true,
      mensaje: mesa_id ? 'Comanda cancelada y mesa liberada' : 'Comanda cancelada correctamente',
    });
  } catch (err: unknown) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: unknown) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release(releaseError);
  }
});

app.patch('/api/comandas/:comandaId/cliente', async (req, res) => {
  const { comandaId } = req.params;
  const { clienteId } = req.body;
  try {
    const { rows: comandaCheck } = await pool.query('SELECT estado FROM comandas WHERE id = $1', [
      comandaId,
    ]);
    if (comandaCheck.length === 0) return res.status(404).json({ error: 'La comanda no existe.' });
    if (comandaCheck[0].estado !== 'ABIERTA')
      return res.status(400).json({ error: 'Solo se puede asociar cliente a comandas abiertas.' });

    await pool.query('UPDATE comandas SET cliente_id = $1 WHERE id = $2', [
      clienteId || null,
      comandaId,
    ]);

    let clientInfo = null;
    if (clienteId) {
      const { rows: cli } = await pool.query(
        'SELECT id, nombre, puntos_acumulados AS "clientePuntos", es_frecuente AS "clienteEsFrecuente", visitas_count AS "clienteVisitas" FROM clientes WHERE id = $1',
        [clienteId],
      );
      if (cli.length > 0) clientInfo = cli[0];
    }
    emitirCambioGlobal('actualizar_mesas');
    res.json({ ok: true, cliente: clientInfo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 5. COCINA KDS ────────────────────────────────────────────────────────────
app.get('/api/cocina/tickets', async (_req, res) => {
  try {
    const queryComandas = `
            SELECT c.id, c.mesa_id AS "mesaId", m.numero AS "mesaNumero", COALESCE(u.nombre, 'Mesero') AS mesero,
              c.id AS "comandaId",
              c.tipo_origen AS "tipoOrigen",
              c.folio_origen AS "folioOrigen",
              COALESCE(m.numero, c.folio_origen) AS "mesaNumero",
              COALESCE(m.minutos_abierta, 1) AS "minutosTranscurridos", COALESCE(c.estado_operativo, 'PENDIENTE') AS estado
            FROM comandas c LEFT JOIN mesas m ON c.mesa_id = m.id LEFT JOIN usuarios u ON c.usuario_id = u.id
      WHERE c.estado = 'ABIERTA' ORDER BY c.fecha_apertura ASC;
    `;
    const { rows: tickets } = await pool.query(queryComandas);
    const ticketsConItems = [];

    for (const ticket of tickets) {
      const itemsQuery = `
        SELECT ci.id, p.nombre, ci.cantidad, ci.notas, COALESCE(ci.completado, false) AS completado, ci.estado_kds
        FROM comanda_items ci JOIN productos p ON ci.producto_id = p.id
        WHERE ci.comanda_id = $1 ORDER BY ci.id ASC;
      `;
      const { rows: items } = await pool.query(itemsQuery, [ticket.id]);
      if (items.length > 0) {
        ticket.items = items;
        ticketsConItems.push(ticket);
      }
    }
    res.json(ticketsConItems);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/cocina/items/:itemId/toggle', async (req, res) => {
  const { itemId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comandaRes = await client.query(
      'SELECT c.id, c.estado FROM comandas c WHERE c.id = (SELECT comanda_id FROM comanda_items WHERE id = $1) FOR UPDATE',
      [itemId],
    );
    const itemRes = await client.query('SELECT id FROM comanda_items WHERE id = $1 FOR UPDATE', [itemId]);
    if (!itemRes.rows[0] || !comandaRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    if (comandaRes.rows[0].estado !== 'ABIERTA') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La comanda esta cerrada o cancelada' });
    }
    await client.query(
      `UPDATE comanda_items SET completado = NOT COALESCE(completado, false) WHERE id = $1`,
      [itemId],
    );
    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_cocina');
    res.json({ ok: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/cocina/tickets/:comandaId/despachar', async (req, res) => {
  const { comandaId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comandaRes = await client.query(
      'SELECT id, mesa_id, estado FROM comandas WHERE id = $1 FOR UPDATE', [comandaId],
    );
    const comanda = comandaRes.rows[0];
    if (!comanda) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Comanda no encontrada' });
    }
    if (comanda.estado !== 'ABIERTA') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La comanda esta cerrada o cancelada' });
    }
    await client.query(
      `UPDATE comanda_items SET completado = TRUE, estado_kds = 'LISTO' WHERE comanda_id = $1`,
      [comandaId],
    );
    await client.query(`UPDATE comandas SET estado_operativo = 'LISTO PARA SERVIR' WHERE id = $1`, [
      comandaId,
    ]);
    if (comanda.mesa_id) {
      await client.query(`UPDATE mesas SET estado = 'LISTO PARA SERVIR' WHERE id = $1`, [
        comanda.mesa_id,
      ]);
    }
    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    emitirCambioGlobal('actualizar_cocina');
    res.json({ ok: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── 6. CAJA Y COBRO ──────────────────────────────────────────────────────────
app.get('/api/caja/mesa/:mesaId', async (req, res) => {
  const { mesaId } = req.params;
  try {
    const query = `
      SELECT c.id AS "comandaId", m.id AS "mesaId", m.numero AS "mesaNumero", m.comensales, COALESCE(c.total, 0.00) AS total,
              c.tipo_origen AS "tipoOrigen", c.folio_origen AS "folioOrigen",
             c.cliente_id AS "clienteId", cli.nombre AS "clienteNombre", COALESCE(cli.puntos_acumulados, 0) AS "clientePuntos",
             COALESCE(cli.es_frecuente, false) AS "clienteEsFrecuente", COALESCE(cli.visitas_count, 0) AS "clienteVisitas"
            FROM comandas c LEFT JOIN mesas m ON c.mesa_id = m.id LEFT JOIN clientes cli ON c.cliente_id = cli.id
      WHERE m.id = $1 AND c.estado = 'ABIERTA' LIMIT 1;
    `;
    const { rows } = await pool.query(query, [mesaId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Mesa sin comanda activa' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/caja/comanda/:comandaId', async (req, res) => {
  const { comandaId } = req.params;
  try {
    const comanda = await obtenerComandaPorId(pool, comandaId);
    if (!comanda || comanda.estado !== 'ABIERTA') {
      return res.status(404).json({ error: 'Comanda sin cuenta activa' });
    }

    res.json(comanda);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/caja/cobrar', async (req, res) => {
  const {
    comandaId,
    usuarioId,
    metodoPago,
    montoRecibido: montoSolicitado,
    dividirCuenta,
    partesIguales,
    descuento: descuentoSolicitado,
    promocionId,
    puntosCanjeados,
    solicitaFactura,
    agruparConsumo,
  } = req.body;
  const client = await pool.connect();
  let transactionOpen = true;
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');

    const comandaRes = await client.query(
      'SELECT id, mesa_id, estado, total FROM comandas WHERE id = $1 FOR UPDATE',
      [comandaId],
    );
    if (comandaRes.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ error: 'Comanda no encontrada' });
    }
    if (comandaRes.rows[0].estado !== 'ABIERTA') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ error: 'La comanda ya fue cobrada o cancelada' });
    }

    const subtotalRes = await client.query(
      'SELECT COALESCE(SUM(subtotal), 0) AS subtotal FROM comanda_items WHERE comanda_id = $1',
      [comandaId],
    );
    const subtotalServidor = Math.round(Number(subtotalRes.rows[0].subtotal) * 100) / 100;
    let descuento = Number(descuentoSolicitado ?? 0);
    const puntos = Number(puntosCanjeados ?? 0);
    const partes = dividirCuenta === true ? Number(partesIguales ?? 1) : 1;
    const montoRecibido = Number(montoSolicitado);
    if (!Number.isFinite(subtotalServidor) || subtotalServidor < 0 ||
        !Number.isFinite(descuento) || descuento < 0 || descuento > subtotalServidor ||
        !Number.isInteger(puntos) || puntos < 0 ||
        !Number.isInteger(partes) || partes < 1 ||
        !Number.isFinite(montoRecibido) || montoRecibido < 0 || (promocionId && puntos > 0)) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Importes, descuento o division de cuenta invalidos' });
    }
    if (promocionId) {
      const promoRes = await client.query('SELECT tipo, valor FROM promociones WHERE id = $1 AND activo = TRUE', [promocionId]);
      const promo = promoRes.rows[0];
      if (!promo || !['DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO'].includes(promo.tipo) ||
          !Number.isFinite(Number(promo.valor)) || Number(promo.valor) < 0) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ error: 'Promocion invalida' });
      }
      descuento = Math.min(subtotalServidor, promo.tipo === 'DESCUENTO_PORCENTAJE'
        ? subtotalServidor * Number(promo.valor) / 100 : Number(promo.valor));
    } else if (puntos > 0) {
      const clienteRes = await client.query(
        'SELECT cli.puntos_acumulados FROM clientes cli JOIN comandas c ON c.cliente_id = cli.id WHERE c.id = $1 FOR UPDATE OF cli',
        [comandaId],
      );
      if (!clienteRes.rows[0] || puntos > Number(clienteRes.rows[0].puntos_acumulados) || puntos > Math.ceil(subtotalServidor)) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(400).json({ error: 'Puntos de lealtad insuficientes o invalidos' });
      }
      descuento = Math.min(subtotalServidor, puntos);
    }
    descuento = Math.round(descuento * 100) / 100;
    const totalCuenta = Math.max(0, Math.round((subtotalServidor - descuento) * 100) / 100);
    const totalExigible = Math.round(totalCuenta / partes * 100) / 100;
    if (metodoPago === 'EFECTIVO' && montoRecibido < totalExigible) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Monto recibido insuficiente para cubrir el total de la cuenta' });
    }
    const cambio = metodoPago === 'EFECTIVO' ? Math.round((montoRecibido - totalExigible) * 100) / 100 : 0;
    if (Number(comandaRes.rows[0].total) !== subtotalServidor) {
      await client.query('UPDATE comandas SET total = $1 WHERE id = $2', [subtotalServidor, comandaId]);
    }

    const configRes = await client.query(
      `SELECT api_key_test, api_key_live, modo_produccion, clave_sat_defecto FROM configuracion_facturacion WHERE id = 1`,
    );
    const configFiscal = configRes.rows[0];
    const apiKeyActiva = configFiscal?.modo_produccion
      ? configFiscal.api_key_live
      : configFiscal?.api_key_test;

    let claveSatDefecto = (configFiscal?.clave_sat_defecto || '').trim();
    if (!claveSatDefecto || claveSatDefecto.length < 8 || isNaN(Number(claveSatDefecto))) {
      claveSatDefecto = '90101501'; // '90101501' es la clave oficial del SAT para servicios de Restaurantes y preparación de alimentos. Mucho más seguro que '01010101'.
    }

    const pagoRes = await client.query(
      `INSERT INTO pagos (comanda_id, usuario_id, metodo_pago, total_cuenta, monto_recibido, cambio, dividir_cuenta, partes_iguales, descuento, promocion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        comandaId,
        usuarioId || 1,
        metodoPago,
        totalCuenta,
        montoRecibido,
        cambio,
        dividirCuenta === true,
        partes,
        descuento || 0.0,
        promocionId || null,
      ],
    );

    const pagoId = pagoRes.rows[0].id;
    let datosAutofactura = null;
    let errorFacturapiMsg: string | null = null;

    const solicitaFacturaActual = solicitaFactura === true || solicitaFactura === 'true';

    console.log(
      `[Cobro #${pagoId}] Iniciando proceso. solicitaFactura: ${solicitaFacturaActual}, apiKeyActiva: ${apiKeyActiva ? 'Sí (Configurada)' : 'No (Vacía)'}`,
    );

    if (solicitaFacturaActual) {
      if (apiKeyActiva) {
        try {
          const itemsRes = await client.query(
            `SELECT ci.cantidad, ci.precio_unitario, p.nombre, p.clave_sat AS prod_clave, cat.clave_sat AS cat_clave
             FROM comanda_items ci JOIN productos p ON ci.producto_id = p.id JOIN categorias cat ON p.categoria_id = cat.id
             WHERE ci.comanda_id = $1`,
            [comandaId],
          );

          console.log(
            `[Cobro #${pagoId}] Productos obtenidos para Facturapi:`,
            itemsRes.rows.length,
          );

          let paymentForm = '01';
          if (metodoPago === 'TARJETA') paymentForm = '04';
          if (metodoPago === 'TRANSFERENCIA') paymentForm = '03';

          const esConsumoGeneral = agruparConsumo === true || agruparConsumo === 'true';
          let lineItemsFacturapi = [];

          if (esConsumoGeneral) {
            lineItemsFacturapi = [
              {
                quantity: 1,
                product: {
                  description: 'CONSUMO DE ALIMENTOS Y BEBIDAS',
                  product_key: '90101501',
                  unit_key: 'E48',
                  price: Number(totalCuenta),
                  tax_included: true,
                },
              },
            ];
          } else {
            lineItemsFacturapi = itemsRes.rows.map((row: any) => {
              let itemKey = (row.prod_clave || row.cat_clave || '').toString().trim();
              // Sanitización estricta: debe ser una cadena numérica de 8 dígitos
              if (!itemKey || itemKey.length < 8 || isNaN(Number(itemKey))) {
                itemKey = claveSatDefecto;
              }
              return {
                quantity: Number(row.cantidad),
                product: {
                  description: row.nombre,
                  product_key: itemKey,
                  price: Number(row.precio_unitario),
                  tax_included: true,
                },
              };
            });
          }

          console.log(
            `[Cobro #${pagoId}] Payload que se envía a Factura`,
            // `[Cobro #${pagoId}] Payload que se envía a Facturapi (esConsumoGeneral: ${esConsumoGeneral}):`,
            JSON.stringify(lineItemsFacturapi),
          );

          const facturapi = obtenerInstanciaFacturapi(apiKeyActiva);
          const receipt = await facturapi.receipts.create({
            payment_form: paymentForm,
            items: lineItemsFacturapi,
          });

          console.log(
            `[Cobro #${pagoId}] Recibo generado exitosamente en Factura`,
            // `[Cobro #${pagoId}] Recibo generado exitosamente en Facturapi. ID: ${receipt.id}, Código: ${receipt.key}`,
          );

          await client.query(
            `INSERT INTO tickets_autofactura (pago_id, facturapi_receipt_id, codigo_ticket, url_autofactura, total, fecha_expiracion)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              pagoId,
              receipt.id,
              receipt.key,
              receipt.self_invoice_url,
              totalCuenta,
              receipt.expires_at,
            ],
          );

          datosAutofactura = {
            codigo: receipt.key,
            url: receipt.self_invoice_url,
            expiracion: receipt.expires_at,
          };
        } catch (fError: any) {
          const errorDetails = fError.message || String(fError);
          console.error(`❌ [Cobro #${pagoId}] Error generando recibo en Factura:`, fError);
          // console.error(`❌ [Cobro #${pagoId}] Error generando recibo en Facturapi:`, fError);
          errorFacturapiMsg = `Error en servidor Facturapi: ${errorDetails}`;
        }
      } else {
        console.warn(
          `⚠️ [Cobro #${pagoId}] Se solicitó autofactura pero no hay ninguna API Key de Factura activa configurada.`,
          // `⚠️ [Cobro #${pagoId}] Se solicitó autofactura pero no hay ninguna API Key de Facturapi activa configurada.`,
        );
        errorFacturapiMsg =
          'No hay una API Key de Factura activa configurada en el sistema (Ajustes -> Facturación).';
        // 'No hay una API Key de Facturapi activa configurada en el sistema (Ajustes -> Facturación).';
      }
    }

    const comandaInfo = await client.query(
      'SELECT cliente_id, mesa_id, tipo_origen AS "tipoOrigen", folio_origen AS "folioOrigen" FROM comandas WHERE id = $1',
      [comandaId],
    );
    const clienteId = comandaInfo.rows[0]?.cliente_id;
    const comandaBloqueada = comandaRes.rows[0];
    const mesaIdReal = comandaBloqueada.mesa_id ?? null;
    if (clienteId) {
      const negocioInfo = await client.query(
        'SELECT COALESCE(visitas_requeridas_frecuente, 5) AS visitas_requeridas_frecuente, COALESCE(puntos_por_cada_diez_pesos, 1) AS puntos_por_cada_diez_pesos, COALESCE(pesos_por_punto, 10.00) AS pesos_por_punto FROM datos_negocio WHERE id = 1 LIMIT 1',
      );
      const visitasRequeridas = negocioInfo.rows[0]?.visitas_requeridas_frecuente || 5;
      const factorPuntos = negocioInfo.rows[0]?.puntos_por_cada_diez_pesos || 1;
      const pesosPorPunto = Number(negocioInfo.rows[0]?.pesos_por_punto) || 10.0;

      const puntosNuevos = Math.floor(Number(totalCuenta) / pesosPorPunto) * factorPuntos;
      const ptsCanjeados = Number(puntosCanjeados) || 0;

      await client.query(
        `UPDATE clientes
         SET visitas_count = COALESCE(visitas_count, 0) + 1,
             puntos_acumulados = GREATEST(0, COALESCE(puntos_acumulados, 0) - $1::integer) + $2::integer,
             es_frecuente = CASE WHEN (COALESCE(visitas_count, 0) + 1) >= $3::integer THEN TRUE ELSE COALESCE(es_frecuente, FALSE) END
         WHERE id = $4`,
        [ptsCanjeados, puntosNuevos, visitasRequeridas, clienteId],
      );
    }

    await client.query(
      `UPDATE comandas SET estado = 'CERRADA', fecha_cierre = CURRENT_TIMESTAMP WHERE id = $1`,
      [comandaId],
    );
    await client.query(`UPDATE comandas SET estado_operativo = 'DISPONIBLE' WHERE id = $1`, [
      comandaId,
    ]);
    if (mesaIdReal) {
      await client.query(
        `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
        [mesaIdReal],
      );
    }
    await client.query('COMMIT');
    transactionOpen = false;
    emitirCambioGlobal('actualizar_mesas');

    let ticketTextoCobro: string | null = null;
    emitirCambioGlobal('actualizar_cocina');
    let impresionesPendientes: any[] = [];
    try {
      const resCobroPrinter = await PrinterService.imprimirTicketCobro(pagoId);
      if (resCobroPrinter) {
        if (typeof resCobroPrinter === 'string') {
          ticketTextoCobro = resCobroPrinter;
        } else if (typeof resCobroPrinter === 'object' && (resCobroPrinter as any).ticketTexto) {
          ticketTextoCobro = (resCobroPrinter as any).ticketTexto;
        }
        if (typeof resCobroPrinter === 'object' && (resCobroPrinter as any).impresionesPendientes) {
          impresionesPendientes = (resCobroPrinter as any).impresionesPendientes;
        }
      }
    } catch (errPrinter: any) {
      console.error('⚠️ Error al imprimir ticket de cobro:', errPrinter.message);
    }

    res.json({
      ok: true,
      ticketId: pagoId,
      totalCuenta,
      descuento,
      cambio,
      comandaId: Number(comandaId),
      mesaId: mesaIdReal,
      tipoOrigen: comandaInfo.rows[0]?.tipoOrigen,
      folioOrigen: comandaInfo.rows[0]?.folioOrigen,
      autofactura: datosAutofactura,
      ticketTexto: ticketTextoCobro,
      impresionesPendientes,
      errorFacturapi: errorFacturapiMsg,
    });
  } catch (err: unknown) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: unknown) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    client.release(releaseError);
  }
});

app.get('/api/caja/corte/actual/:usuarioId', async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const lastCorteRes = await pool.query(
      `SELECT fecha_cierre FROM cortes_caja WHERE usuario_id = $1 ORDER BY fecha_cierre DESC LIMIT 1`,
      [usuarioId],
    );
    const lastCorteFecha = lastCorteRes.rows.length > 0 ? lastCorteRes.rows[0].fecha_cierre : null;

    let pagosQuery = `SELECT p.id, p.total_cuenta AS total, p.metodo_pago AS metodo, p.fecha, c.id AS "comandaId", c.tipo_origen AS "tipoOrigen", c.folio_origen AS "folioOrigen", c.mesa_id AS "mesaId", COALESCE(m.numero, c.folio_origen) AS mesa FROM pagos p JOIN comandas c ON p.comanda_id = c.id LEFT JOIN mesas m ON c.mesa_id = m.id WHERE p.usuario_id = $1`;
    const queryParams: any[] = [usuarioId];

    if (lastCorteFecha) {
      pagosQuery += ' AND p.fecha > $2';
      queryParams.push(lastCorteFecha);
    }

    pagosQuery += ' ORDER BY p.fecha ASC';
    const { rows: pagos } = await pool.query(pagosQuery, queryParams);

    let efectivo = 0,
      tarjeta = 0,
      transferencia = 0,
      ventasTotales = 0;
    pagos.forEach((pago) => {
      const tot = parseFloat(pago.total);
      if (pago.metodo === 'EFECTIVO') efectivo += tot;
      else if (pago.metodo === 'TARJETA') tarjeta += tot;
      else if (pago.metodo === 'TRANSFERENCIA') transferencia += tot;
      ventasTotales += tot;
    });

    res.json({
      ok: true,
      fechaUltimoCorte: lastCorteFecha,
      pagosCount: pagos.length,
      efectivoCalculado: efectivo,
      tarjetaCalculado: tarjeta,
      transferenciaCalculado: transferencia,
      ventasTotales,
      pagos,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/caja/corte', async (req, res) => {
  const {
    usuarioId,
    fechaApertura,
    fondoApertura,
    efectivoReal,
    efectivoCalculado,
    tarjetaCalculado,
    transferenciaCalculado,
    ventasTotales,
    diferencia,
    notas,
  } = req.body;
  try {
    const query = `
      INSERT INTO cortes_caja (usuario_id, fecha_apertura, fecha_cierre, fondo_apertura, efectivo_real, efectivo_calculado, tarjeta_calculado, transferencia_calculado, ventas_totales, diferencia, notas)
      VALUES ($1, COALESCE($2, CURRENT_TIMESTAMP - INTERVAL '1 day'), CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id;
    `;
    const { rows } = await pool.query(query, [
      usuarioId,
      fechaApertura || null,
      fondoApertura || 0.0,
      efectivoReal || 0.0,
      efectivoCalculado || 0.0,
      tarjetaCalculado || 0.0,
      transferenciaCalculado || 0.0,
      ventasTotales || 0.0,
      diferencia || 0.0,
      notas || '',
    ]);

    // Disparador del reporte síncronico/asíncrono de facturas al cerrarse la caja diaria
    enviarConteoAGoogleSheets().catch(() => {});

    res.json({ ok: true, corteId: rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/caja/cortes/historial', async (_req, res) => {
  try {
    const query = `SELECT c.*, u.nombre AS "usuarioNombre" FROM cortes_caja c JOIN usuarios u ON c.usuario_id = u.id ORDER BY c.fecha_cierre DESC;`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 7. ADMINISTRATIVO Y AJUSTES ──────────────────────────────────────────────
app.get('/api/categorias', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categorias ORDER BY orden, nombre');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categorias', async (req, res) => {
  const { nombre, icono, orden, destino_impresion } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre, icono, orden, destino_impresion) VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, icono || 'restaurant', Number(orden) || 0, destino_impresion || 'COCINA'],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/productos', async (req, res) => {
  const { categoria_id, nombre, precio, disponible, imagen_url, clave_sat } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO productos (categoria_id, nombre, precio, disponible, imagen_url, clave_sat) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [Number(categoria_id), nombre, Number(precio), disponible !== false, imagen_url || null, clave_sat || null],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/zonas', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM zonas ORDER BY id');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mesas', async (req, res) => {
  const { numero, zona_id, capacidad } = req.body;
  try {
    const query = `
      WITH nueva_mesa AS (
        INSERT INTO mesas (numero, zona_id, capacidad, estado, comensales, minutos_abierta)
        VALUES ($1, $2, $3, 'DISPONIBLE', 0, 0) RETURNING *
      )
      SELECT m.id, m.numero, COALESCE(z.nombre, 'Sin Zona') AS zona, m.capacidad, m.estado, m.comensales, m.minutos_abierta AS "minutosAbierta", 0.00 AS total, m.creado_en AS "creadoEn"
      FROM nueva_mesa m LEFT JOIN zonas z ON m.zona_id = z.id;
    `;
    const { rows } = await pool.query(query, [numero, Number(zona_id), Number(capacidad) || 4]);
    emitirCambioGlobal('actualizar_mesas');
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ajustes/negocio', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM datos_negocio WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ajustes/negocio', async (req, res) => {
  const {
    nombre,
    rfc,
    telefono,
    direccion,
    email,
    mensaje_recibo,
    visitas_requeridas_frecuente,
    puntos_por_cada_diez_pesos,
    pesos_por_punto,
  } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO datos_negocio (id, nombre, rfc, telefono, direccion, email, mensaje_recibo, visitas_requeridas_frecuente, puntos_por_cada_diez_pesos, pesos_por_punto)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         nombre = EXCLUDED.nombre, rfc = EXCLUDED.rfc, telefono = EXCLUDED.telefono, direccion = EXCLUDED.direccion, email = EXCLUDED.email,
         mensaje_recibo = EXCLUDED.mensaje_recibo, visitas_requeridas_frecuente = EXCLUDED.visitas_requeridas_frecuente,
         puntos_por_cada_diez_pesos = EXCLUDED.puntos_por_cada_diez_pesos, pesos_por_punto = EXCLUDED.pesos_por_punto RETURNING *`,
      [
        nombre,
        rfc,
        telefono,
        direccion,
        email,
        mensaje_recibo,
        Number(visitas_requeridas_frecuente) || 5,
        Number(puntos_por_cada_diez_pesos) || 1,
        Number(pesos_por_punto) || 1.0,
      ],
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ajustes/transferencia', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM datos_transferencia WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ajustes/transferencia', async (req, res) => {
  const { banco, titular, clabe, email } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO datos_transferencia (id, banco, titular, clabe, email) VALUES (1, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET banco = EXCLUDED.banco, titular = EXCLUDED.titular, clabe = EXCLUDED.clabe, email = EXCLUDED.email RETURNING *`,
      [banco, titular, clabe, email],
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clientes', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes ORDER BY nombre ASC');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clientes', async (req, res) => {
  const { nombre, telefono, direccion, email, notas } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, direccion, email, notas) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, telefono, direccion, email, notas],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 8. PANEL DE CONTROL Y CONFIGURACIÓN FISCAL ──────────────────────────────
app.get('/api/admin/productos', async (_req, res) => {
  try {
    const query = `SELECT p.id, p.nombre, p.precio, p.disponible, p.imagen_url, p.clave_sat, p.categoria_id, c.nombre AS "categoriaNombre" FROM productos p JOIN categorias c ON p.categoria_id = c.id ORDER BY c.orden, p.nombre;`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categorias/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, icono, orden, destino_impresion } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE categorias
       SET nombre = $1, icono = $2, orden = $3, destino_impresion = $4
       WHERE id = $5
       RETURNING *`,
      [nombre, icono || 'restaurant', Number(orden) || 0, destino_impresion || 'COCINA', id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categorias/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM productos WHERE categoria_id = $1', [
      id,
    ]);
    if (parseInt(countRes.rows[0].count) > 0) {
      return res
        .status(400)
        .json({ error: 'No es posible eliminar la categoría porque contiene productos activos.' });
    }
    await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Categoría eliminada' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { categoria_id, nombre, precio, disponible, imagen_url, clave_sat } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE productos SET categoria_id = $1, nombre = $2, precio = $3, disponible = $4, imagen_url = $5,
       clave_sat = CASE WHEN $7::boolean THEN $8::varchar ELSE clave_sat END WHERE id = $6 RETURNING *`,
      [Number(categoria_id), nombre, Number(precio), disponible, imagen_url || null, id, clave_sat !== undefined, clave_sat || null],
    );
    emitirCambioGlobal('PRODUCTO_ACTUALIZADO', rows[0]);
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('DELETE FROM productos WHERE id = $1 RETURNING *', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ ok: true, mensaje: 'Producto removido' });
  } catch (err: any) {
    try {
      await pool.query('UPDATE productos SET disponible = FALSE WHERE id = $1', [id]);
      res.json({ ok: true, mensaje: 'Producto desactivado lógicamente.' });
    } catch (err2: any) {
      res.status(500).json({ error: err2.message });
    }
  }
});

app.post('/api/zonas', async (req, res) => {
  const { nombre } = req.body;
  try {
    const { rows } = await pool.query(`INSERT INTO zonas (nombre) VALUES ($1) RETURNING *`, [
      nombre,
    ]);
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/zonas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const { rows } = await pool.query(`UPDATE zonas SET nombre = $1 WHERE id = $2 RETURNING *`, [
      nombre,
      id,
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Zona no encontrada' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/zonas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM mesas WHERE zona_id = $1', [id]);
    if (parseInt(countRes.rows[0].count) > 0) {
      return res
        .status(400)
        .json({ error: 'No es posible eliminar la zona porque contiene mesas asociadas.' });
    }
    await pool.query('DELETE FROM zonas WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Zona eliminada' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mesas/:id', async (req, res) => {
  const { id } = req.params;
  const { numero, zona_id, capacidad } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE mesas SET numero = $1, zona_id = $2, capacidad = $3 WHERE id = $4 RETURNING *`,
      [numero, Number(zona_id), Number(capacidad) || 4, id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Mesa no encontrada' });
    emitirCambioGlobal('actualizar_mesas');
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mesas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM mesas WHERE id = $1', [id]);
    emitirCambioGlobal('actualizar_mesas');
    res.json({ ok: true, mensaje: 'Mesa eliminada' });
  } catch (err: any) {
    res.status(400).json({ error: 'La mesa tiene historial de comandas.' });
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, direccion, email, notas } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE clientes SET nombre = $1, telefono = $2, direccion = $3, email = $4, notas = $5 WHERE id = $6 RETURNING *`,
      [nombre, telefono, direccion, email, notas, id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Cliente eliminado' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 9. PROMOCIONES ───────────────────────────────────────────────────────────
app.get('/api/promociones/validar/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, codigo, tipo, valor, descripcion FROM promociones WHERE UPPER(codigo) = UPPER($1) AND activo = TRUE LIMIT 1',
      [codigo],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Código de promoción inválido' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/promociones', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM promociones ORDER BY creado_en DESC');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/promociones', async (req, res) => {
  const { nombre, codigo, tipo, valor, descripcion, activo } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO promociones (nombre, codigo, tipo, valor, descripcion, activo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre, codigo, tipo, Number(valor) || 0, descripcion, activo !== false],
    );
    await sincronizarCombosComoProductos();
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/promociones/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, codigo, tipo, valor, descripcion, activo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE promociones SET nombre = $1, codigo = $2, tipo = $3, valor = $4, descripcion = $5, activo = $6 WHERE id = $7 RETURNING *`,
      [nombre, codigo, tipo, Number(valor) || 0, descripcion, activo !== false, id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada' });
    await sincronizarCombosComoProductos();
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/promociones/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('DELETE FROM promociones WHERE id = $1 RETURNING *', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Promoción no encontrada' });
    await sincronizarCombosComoProductos();
    res.json({ ok: true, mensaje: 'Promoción eliminada' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 10. FACTURACIÓN ELECTRÓNICA ─────────────────────────────────────────────
app.get('/api/ajustes/facturacion', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, api_key_test AS "apiKeyTest", api_key_live AS "apiKeyLive", modo_produccion AS "modoProduccion",
             rfc_emisor AS "rfcEmisor", razon_social AS "razonSocial", regimen_fiscal AS "regimenFiscal",
             codigo_postal AS "codigoPostal", email_notificaciones AS "emailNotificaciones", dias_vigencia_ticket AS "diasVigenciaTicket", tiene_csd AS "tieneCsd"
      FROM configuracion_facturacion WHERE id = 1
    `);
    if (!rows[0]) return res.json(null);
    const { apiKeyTest, apiKeyLive, ...config } = rows[0];
    res.json({
      ...config,
      apiKeyTest: enmascararApiKey(apiKeyTest),
      apiKeyLive: enmascararApiKey(apiKeyLive),
      tieneApiKeyTest: Boolean(apiKeyTest),
      tieneApiKeyLive: Boolean(apiKeyLive),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  '/api/ajustes/facturacion',
  uploadCSD.fields([
    { name: 'csdCer', maxCount: 1 },
    { name: 'csdKey', maxCount: 1 },
  ]),
  async (req: any, res) => {
    const {
      apiKeyTest,
      apiKeyLive,
      modoProduccion,
      rfcEmisor,
      razonSocial,
      regimenFiscal,
      codigoPostal,
      emailNotificaciones,
      csdPassword,
      diasVigenciaTicket,
    } = req.body;
    try {
      const modoProdBool = modoProduccion === 'true' || modoProduccion === true;
      const configRes = await pool.query('SELECT api_key_test, api_key_live FROM configuracion_facturacion WHERE id = 1');
      const configGuardada = configRes.rows[0];
      const keyTest = resolverApiKey(apiKeyTest, configGuardada?.api_key_test);
      const keyLive = resolverApiKey(apiKeyLive, configGuardada?.api_key_live);
      if (!keyTest) {
        return res.status(400).json({ error: 'Se requiere una API Key de prueba inicial' });
      }
      let tieneCsd = false;
      const apiKeyActiva = modoProdBool ? keyLive : keyTest;

      if (req.files?.csdCer?.[0] && req.files?.csdKey?.[0] && apiKeyActiva) {
        const facturapi = obtenerInstanciaFacturapi(apiKeyActiva);
        await facturapi.organizations.uploadCertificate(
          'me',
          req.files.csdCer[0].buffer,
          req.files.csdKey[0].buffer,
          csdPassword || '',
        );
        tieneCsd = true;
      }

      const query = `
      INSERT INTO configuracion_facturacion (id, api_key_test, api_key_live, modo_produccion, rfc_emisor, razon_social, regimen_fiscal, codigo_postal, email_notificaciones, dias_vigencia_ticket, tiene_csd, actualizado_en)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        api_key_test = EXCLUDED.api_key_test, api_key_live = EXCLUDED.api_key_live, modo_produccion = EXCLUDED.modo_produccion,
        rfc_emisor = EXCLUDED.rfc_emisor, razon_social = EXCLUDED.razon_social, regimen_fiscal = EXCLUDED.regimen_fiscal,
        codigo_postal = EXCLUDED.codigo_postal, email_notificaciones = EXCLUDED.email_notificaciones,
        dias_vigencia_ticket = EXCLUDED.dias_vigencia_ticket, tiene_csd = CASE WHEN EXCLUDED.tiene_csd THEN TRUE ELSE configuracion_facturacion.tiene_csd END,
        actualizado_en = CURRENT_TIMESTAMP RETURNING *;
    `;
      await pool.query(query, [
        keyTest,
        keyLive,
        modoProdBool,
        rfcEmisor?.toUpperCase(),
        razonSocial,
        regimenFiscal,
        codigoPostal,
        emailNotificaciones || null,
        Number(diasVigenciaTicket) || 7,
        tieneCsd,
      ]);
      res.json({ ok: true, mensaje: 'Configuración fiscal guardada correctamente.' });
    } catch (err: any) {
      res.status(500).json({ error: 'Error al procesar la configuracion fiscal' });
    }
  },
);

app.post('/api/ajustes/facturacion/test', async (req, res) => {
  const { apiKey, isLive } = req.body;

  try {
    const configRes = await pool.query('SELECT api_key_test, api_key_live, modo_produccion FROM configuracion_facturacion WHERE id = 1');
    const config = configRes.rows[0];
    const modoLive = isLive === undefined ? config?.modo_produccion === true : isLive === true || isLive === 'true';
    const key = resolverApiKey(apiKey, modoLive ? config?.api_key_live : config?.api_key_test);
    if (!key) return res.status(400).json({ error: 'No hay una API Key configurada para el modo seleccionado' });
    const facturapi = obtenerInstanciaFacturapi(key);
    await facturapi.customers.list({ limit: 1 });
    res.json({ ok: true, mensaje: 'Conexión con Facturapi v2 autenticada correctamente.' });
  } catch (err: any) {
    res.status(err?.status || 401).json({ error: 'No se pudo validar la conexion fiscal' });
  }
});

app.post('/api/ajustes/facturacion/sincronizar', async (_req, res) => {
  try {
    const r = await realizarSincronizacionFacturas();
    if (!r.ok) {
      return res.status(400).json({ error: r.error });
    }
    res.json({
      ok: true,
      total: r.total,
      mensaje: `Sincronización de facturas finalizada con éxito: ${r.total} procesadas.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/licencia/test-sheets', async (_req, res) => {
  try {
    console.log('📡 [PRUEBA MANUAL] Iniciando prueba de conexión con Sheets...');
    const result = await enviarConteoAGoogleSheets();
    res.json({
      ok: result.success,
      ...result,
    });
  } catch (err: any) {
    console.error('❌ [PRUEBA MANUAL] Fallo en la ruta de prueba de Sheets:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── 11. DASHBOARD ───────────────────────────────────────────────────────────
app.get('/api/dashboard/stats', async (req, res) => {
  const { fechaInicio, fechaFin } = req.query;
  try {
    let dateFilter = 'DATE(fecha) = CURRENT_DATE';
    let params: any[] = [];

    if (fechaInicio && !fechaFin) {
      dateFilter = 'DATE(fecha) >= $1';
      params.push(fechaInicio);
    } else if (fechaInicio && fechaFin) {
      dateFilter = 'DATE(fecha) BETWEEN $1 AND $2';
      params.push(fechaInicio, fechaFin);
    }

    const totalVentasRes = await pool.query(
      `SELECT COALESCE(SUM(total_cuenta), 0)::float AS "totalVentas", COUNT(*)::int AS "totalOrdenes", COALESCE(AVG(total_cuenta), 0)::float AS "ticketPromedio" FROM pagos WHERE ${dateFilter}`,
      params,
    );
    const metodoPagoRes = await pool.query(
      `SELECT metodo_pago AS metodo, COALESCE(SUM(total_cuenta), 0)::float AS total, COUNT(*)::int as cantidad FROM pagos WHERE ${dateFilter} GROUP BY metodo_pago`,
      params,
    );
    const ventasCatRes = await pool.query(
      `
      SELECT c.nombre AS categoria, COALESCE(SUM(ci.cantidad * ci.precio_unitario), 0)::float AS total
      FROM pagos pa JOIN comanda_items ci ON pa.comanda_id = ci.comanda_id JOIN productos p ON ci.producto_id = p.id JOIN categorias c ON p.categoria_id = c.id
      WHERE DATE(pa.fecha) ${fechaInicio ? (fechaFin ? 'BETWEEN $1 AND $2' : '>= $1') : '= CURRENT_DATE'} GROUP BY c.nombre ORDER BY total DESC
    `,
      params,
    );

    const ultimosTicketsRes = await pool.query(
      `
      SELECT pa.id AS folio,
              co.id AS "comandaId",
             TO_CHAR(pa.fecha, 'DD/MM HH24:MI') AS fecha,
             COALESCE(cl.nombre, 'Cliente General') AS cliente,
             pa.total_cuenta::float AS total,
             pa.metodo_pago AS metodo,
             u.nombre AS usuario,
             co.estado AS estatus,
              co.tipo_origen AS "tipoOrigen",
              co.folio_origen AS "folioOrigen",
              co.mesa_id AS "mesaId",
              COALESCE(m.numero, co.folio_origen) AS mesa
      FROM pagos pa
      JOIN comandas co ON pa.comanda_id = co.id
            LEFT JOIN mesas m ON co.mesa_id = m.id
      JOIN usuarios u ON pa.usuario_id = u.id
      LEFT JOIN clientes cl ON co.cliente_id = cl.id
      WHERE DATE(pa.fecha) ${fechaInicio ? (fechaFin ? 'BETWEEN $1 AND $2' : '>= $1') : '= CURRENT_DATE'} ORDER BY pa.fecha DESC LIMIT 15
    `,
      params,
    );

    res.json({
      resumen: totalVentasRes.rows[0],
      pagosMetodo: metodoPagoRes.rows,
      categorias: ventasCatRes.rows,
      tickets: ultimosTicketsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/tickets', async (req, res) => {
  const { fechaInicio, fechaFin, folio, cliente } = req.query;
  try {
    const conditions: string[] = [];
    const params: any[] = [];
    const tieneFiltroTexto =
      Boolean(String(folio || '').trim()) || Boolean(String(cliente || '').trim());

    if (fechaInicio && fechaFin) {
      params.push(fechaInicio, fechaFin);
      conditions.push(`DATE(pa.fecha) BETWEEN $${params.length - 1} AND $${params.length}`);
    } else if (fechaInicio) {
      params.push(fechaInicio);
      conditions.push(`DATE(pa.fecha) >= $${params.length}`);
    } else if (!tieneFiltroTexto) {
      conditions.push('DATE(pa.fecha) = CURRENT_DATE');
    }

    if (folio) {
      const folioNum = Number(folio);
      if (!Number.isFinite(folioNum)) {
        return res.status(400).json({ error: 'El folio debe ser numérico.' });
      }

      params.push(folioNum);
      conditions.push(`pa.id = $${params.length}`);
    }

    if (cliente) {
      params.push(`%${String(cliente).trim()}%`);
      conditions.push(`COALESCE(cl.nombre, '') ILIKE $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `
      SELECT
        pa.id AS folio,
        co.id AS "comandaId",
        TO_CHAR(pa.fecha, 'DD/MM/YYYY HH24:MI') AS fecha,
        COALESCE(cl.nombre, 'Cliente General') AS cliente,
        pa.total_cuenta::float AS total,
        pa.metodo_pago AS metodo,
        u.nombre AS usuario,
        co.estado AS estatus,
        co.tipo_origen AS "tipoOrigen",
        co.folio_origen AS "folioOrigen",
        co.mesa_id AS "mesaId",
        COALESCE(m.numero, co.folio_origen) AS mesa
      FROM pagos pa
      JOIN comandas co ON pa.comanda_id = co.id
      LEFT JOIN mesas m ON co.mesa_id = m.id
      JOIN usuarios u ON pa.usuario_id = u.id
      LEFT JOIN clientes cl ON co.cliente_id = cl.id
      ${whereClause}
      ORDER BY pa.fecha DESC
      LIMIT 100
      `,
      params,
    );

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dashboard/tickets/:pagoId/reprint', async (req, res) => {
  const pagoId = Number(req.params.pagoId);
  if (!Number.isFinite(pagoId)) {
    return res.status(400).json({ error: 'ID de ticket inválido.' });
  }

  try {
    let ticketTextoCobro: string | null = null;
    let impresionesPendientes: any[] = [];

    const resCobroPrinter = await PrinterService.imprimirTicketCobro(pagoId);
    if (resCobroPrinter) {
      if (typeof resCobroPrinter === 'string') {
        ticketTextoCobro = resCobroPrinter;
      } else if (typeof resCobroPrinter === 'object' && (resCobroPrinter as any).ticketTexto) {
        ticketTextoCobro = (resCobroPrinter as any).ticketTexto;
      }

      if (typeof resCobroPrinter === 'object' && (resCobroPrinter as any).impresionesPendientes) {
        impresionesPendientes = (resCobroPrinter as any).impresionesPendientes;
      }
    }

    res.json({ ok: true, ticketId: pagoId, ticketTexto: ticketTextoCobro, impresionesPendientes });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al reimprimir ticket.' });
  }
});

if (frontendDistPath) {
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// ─── FUNCION CONTROLADA DE ARRANQUE EXPORTADA (BLOQUEANTE) ─────────────────
export async function startServer() {
  try {
    console.log('⏳ Inicializando esquema de base de datos...');

    // 1. Conexión bloqueante que asegura la BD física y ejecuta 000_init.sql
    await initDB();

    // 2. Sincronización secundaria opcional
    try {
      await sincronizarCombosComoProductos();
    } catch (syncErr: any) {
      console.warn('⚠️ Sincronización de combos omitida:', syncErr.message);
    }

    try {
      realizarSincronizacionFacturas().then((r) => {
        if (r.ok) {
          console.log(
            `📡 [BACKEND] Sincronización automática de facturas completada.`,
            // `📡 [BACKEND] Sincronización automática de facturas completada. ${r.total} facturas procesadas.`,
          );
        } else {
          console.warn(
            '⚠️ [BACKEND] Sincronización de facturas automática parcial/fallida:',
            // '⚠️ [BACKEND] Sincronización de facturas automática parcial/fallida:',
            r.error,
          );
        }
      });
    } catch (syncFactErr: any) {
      console.warn('⚠️ Sincronización automática de facturas omitida:', syncFactErr.message);
    }

    // 3. Levantar listener de servidor Express y Socket.io
    return new Promise((resolve, reject) => {
      const serverInstance = server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 [BACKEND] API REST & Sockets listos en red local por puerto ${PORT}`);
        // Envío asíncrono y tolerante a fallos del conteo de facturas locales a la nube sobre el arranque de la API
        enviarConteoAGoogleSheets().catch(() => {});
        resolve(serverInstance);
      });

      serverInstance.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ El puerto ${PORT} está ocupado. Liberando...`);
        }
        reject(err);
      });
    });
  } catch (error) {
    console.error('❌ Error fatal durante el arranque del servidor:', error);
    throw error;
  }
}

// ─── MANEJADORES DE APAGADO GRACIOSO (GRACEFUL SHUTDOWN) ────────────────────
async function apagarServidorGraciosamente(signal: string) {
  console.log(
    `🔌 [BACKEND] Señal de terminación recibida (${signal}). Sincronizando último conteo de facturas locales...`,
  );
  try {
    // Esperar la resolución del envío a Google Sheets antes de cerrar
    await enviarConteoAGoogleSheets();
  } catch (err: any) {
    console.warn(
      '⚠️ [BACKEND] Error al realizar el reporte de apagado de Sheets:',
      err.message || err,
    );
  } finally {
    console.log('📦 [BACKEND] Liberando conexiones de base de datos...');
    try {
      await pool.end();
    } catch {}
    console.log('👋 [BACKEND] Apagado completo del servidor backend.');
    process.exit(0);
  }
}

process.on('SIGINT', () => apagarServidorGraciosamente('SIGINT'));
process.on('SIGTERM', () => apagarServidorGraciosamente('SIGTERM'));

if (require.main === module) {
  startServer();
}
