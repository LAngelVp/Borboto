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
import { PrinterService } from './src/modules/printer/printer.service';
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

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
      SELECT m.id,
             m.numero,
             COALESCE(z.nombre, 'Sin Zona') AS zona,
             m.capacidad,
             COALESCE(m.estado, 'DISPONIBLE') AS estado,
             COALESCE(m.comensales, 0) AS comensales,
             COALESCE(m.minutos_abierta, 0) AS "minutosAbierta",
             COALESCE(c.total, 0.00) AS total,
             c.id AS "comandaId",
             c.cliente_id AS "clienteId",
             cli.nombre AS "clienteNombre",
             cli.direccion AS "clienteDireccion",
             u.nombre AS mesero,
             m.creado_en AS "creadoEn"
      FROM mesas m
      LEFT JOIN zonas z ON m.zona_id = z.id
      LEFT JOIN comandas c ON c.mesa_id = m.id AND c.estado != 'CERRADA'
      LEFT JOIN clientes cli ON c.cliente_id = cli.id
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY m.id ASC;
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
    await client.query(
      `UPDATE mesas SET estado = 'PENDIENTE', comensales = $1, minutos_abierta = 1 WHERE id = $2`,
      [comensales || 1, id],
    );
    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, estado, total) VALUES ($1, $2, 'ABIERTA', 0.00) RETURNING id`,
      [id, usuarioId || 1],
    );
    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res.json({ ok: true, comandaId: comandaRes.rows[0].id });
  } catch (err: any) {
    await client.query('ROLLBACK');
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mesaOrigenRes = await client.query(
      `SELECT estado, comensales, minutos_abierta FROM mesas WHERE id = $1`,
      [origenId],
    );
    if (mesaOrigenRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'La mesa origen no existe.' });
    }
    const { estado: estadoOrigen, comensales, minutos_abierta } = mesaOrigenRes.rows[0];
    const comandaRes = await client.query(
      `SELECT id FROM comandas WHERE mesa_id = $1 AND estado != 'CERRADA' ORDER BY id DESC LIMIT 1`,
      [origenId],
    );

    if (comandaRes.rows.length > 0) {
      await client.query(`UPDATE comandas SET mesa_id = $1 WHERE id = $2`, [
        destinoId,
        comandaRes.rows[0].id,
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
      `UPDATE comandas SET mesa_id = $1 WHERE mesa_id = $2 AND estado != 'CERRADA'`,
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
    let zonaRes = await client.query(
      `SELECT id FROM zonas WHERE UPPER(TRIM(nombre)) = 'MOSTRADOR'`,
    );
    let zonaId: number;

    if (zonaRes.rows.length === 0) {
      const nuevaZona = await client.query(
        `INSERT INTO zonas (nombre) VALUES ('Mostrador') RETURNING id`,
      );
      zonaId = nuevaZona.rows[0].id;
    } else {
      zonaId = zonaRes.rows[0].id;
    }

    const numRes = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS num FROM mesas`);
    const numeroOrden = `M-${numRes.rows[0].num}`;

    const mesaRes = await client.query(
      `INSERT INTO mesas (numero, zona_id, capacidad, estado, comensales, minutos_abierta) VALUES ($1, $2, 1, 'PENDIENTE', 1, 1) RETURNING id, numero`,
      [numeroOrden, zonaId],
    );

    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, cliente_id, estado, total) VALUES ($1, $2, $3, 'ABIERTA', 0.00) RETURNING id`,
      [mesaRes.rows[0].id, usuarioId || 1, clienteId || null],
    );

    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res
      .status(201)
      .json({
        ok: true,
        mesaId: Number(mesaRes.rows[0].id),
        comandaId: comandaRes.rows[0].id,
        numero: numeroOrden,
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
      `SELECT id, total FROM comandas WHERE mesa_id = $1 AND estado != 'CERRADA' ORDER BY id DESC LIMIT 1`,
      [mesaId],
    );
    if (comandaRes.rows.length === 0) {
      return res.json({ comandaId: 0, total: 0, items: [] });
    }
    const comandaId = comandaRes.rows[0].id;
    const itemsRes = await pool.query(
      `SELECT ci.id, ci.cantidad, ci.precio_unitario AS subtotal, ci.notas, ci.completado, ci.estado_kds,
              json_build_object('id', p.id, 'nombre', p.nombre, 'precio', ci.precio_unitario, 'categoria', c.nombre) AS producto
       FROM comanda_items ci JOIN productos p ON ci.producto_id = p.id JOIN categorias c ON p.categoria_id = c.id
       WHERE ci.comanda_id = $1 ORDER BY ci.id ASC`,
      [comandaId],
    );
    res.json({ comandaId, total: comandaRes.rows[0].total, items: itemsRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usuarios', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, rol, pin, activo FROM usuarios ORDER BY nombre',
    );
    res.json(rows);
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
  try {
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nombre, pin, rol, activo) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, pin, rol, activo !== false],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, pin, rol, activo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE usuarios SET nombre = $1, pin = $2, rol = $3, activo = $4 WHERE id = $5 RETURNING *',
      [nombre, pin, rol, activo !== false, id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    let zonaRes = await client.query(
      `SELECT id FROM zonas WHERE UPPER(TRIM(nombre)) = 'DOMICILIO'`,
    );
    let zonaId: number;
    if (zonaRes.rows.length === 0) {
      const nuevaZona = await client.query(
        `INSERT INTO zonas (nombre) VALUES ('Domicilio') RETURNING id`,
      );
      zonaId = nuevaZona.rows[0].id;
    } else {
      zonaId = zonaRes.rows[0].id;
    }

    const numRes = await client.query(
      `SELECT COUNT(*)::integer + 1 AS proximo FROM mesas WHERE zona_id = $1 AND DATE(creado_en) = CURRENT_DATE`,
      [zonaId],
    );
    const numeroOrden = `E-${numRes.rows[0].proximo}`;

    const mesaRes = await client.query(
      `INSERT INTO mesas (numero, zona_id, capacidad, estado, comensales, minutos_abierta) VALUES ($1, $2, 1, 'PENDIENTE', 1, 1) RETURNING id, numero`,
      [numeroOrden, zonaId],
    );

    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, cliente_id, estado, total) VALUES ($1, $2, $3, 'ABIERTA', 0.00) RETURNING id`,
      [mesaRes.rows[0].id, usuarioId || 1, clienteId || null],
    );

    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');
    res
      .status(201)
      .json({
        ok: true,
        mesaId: Number(mesaRes.rows[0].id),
        comandaId: comandaRes.rows[0].id,
        numero: numeroOrden,
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
  try {
    await pool.query(`UPDATE mesas SET estado = 'SERVIDO' WHERE id = $1`, [mesaId]);
    emitirCambioGlobal('actualizar_mesas');
    res.json({ ok: true, mensaje: 'Mesa marcada como servida' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/comandas', async (req, res) => {
  const { comandaId, mesaId, items, usuarioId } = req.body;
  if (!mesaId || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan parámetros: mesaId e items son requeridos.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let idComandaActual = comandaId;

    if (!idComandaActual || idComandaActual === 0) {
      const comandaExistente = await client.query(
        `SELECT id FROM comandas WHERE mesa_id = $1 AND estado != 'CERRADA' ORDER BY id DESC LIMIT 1`,
        [mesaId],
      );
      if (comandaExistente.rows.length > 0) {
        idComandaActual = comandaExistente.rows[0].id;
      } else {
        const nuevaComanda = await client.query(
          `INSERT INTO comandas (mesa_id, usuario_id, estado, total) VALUES ($1, $2, 'ABIERTA', 0.00) RETURNING id`,
          [mesaId, usuarioId || 1],
        );
        idComandaActual = nuevaComanda.rows[0].id;
      }
    }

    let totalAdicional = 0;
    for (const item of items) {
      const productoId = item.productoId || item.producto?.id;
      const precioUnitario = Number(item.precio || item.producto?.precio || 0);
      const cantidad = Number(item.cantidad || 1);
      const subtotalItem = precioUnitario * cantidad;
      totalAdicional += subtotalItem;

      await client.query(
        `INSERT INTO comanda_items (comanda_id, producto_id, cantidad, precio_unitario, notas, estado_kds) VALUES ($1, $2, $3, $4, $5, 'PENDIENTE')`,
        [idComandaActual, productoId, cantidad, precioUnitario, item.notas || null],
      );
    }

    await client.query(`UPDATE comandas SET total = total + $1 WHERE id = $2`, [
      totalAdicional,
      idComandaActual,
    ]);
    await client.query(`UPDATE mesas SET estado = 'EN COCINA' WHERE id = $1`, [mesaId]);
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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/comandas/:comandaId/cancelar', async (req, res) => {
  const { comandaId } = req.params;
  const { notas } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comandaRes = await client.query('SELECT mesa_id, estado FROM comandas WHERE id = $1', [
      comandaId,
    ]);
    if (comandaRes.rows.length === 0) return res.status(404).json({ error: 'Comanda no existe.' });
    const { mesa_id, estado } = comandaRes.rows[0];
    if (estado !== 'ABIERTA')
      return res.status(400).json({ error: 'Solo se pueden cancelar comandas abiertas.' });

    await client.query(
      `UPDATE comandas SET estado = 'CANCELADA', fecha_cierre = CURRENT_TIMESTAMP WHERE id = $1`,
      [comandaId],
    );
    await client.query(
      `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
      [mesa_id],
    );
    await client.query(
      `UPDATE comanda_items SET completado = TRUE, notas = COALESCE($1 || ' - ', '') || COALESCE(notas, '') WHERE comanda_id = $2`,
      [notas || 'CANCELADO POR USUARIO', comandaId],
    );
    await client.query('COMMIT');

    emitirCambioGlobal('actualizar_mesas');
    emitirCambioGlobal('actualizar_cocina');
    res.json({ ok: true, mensaje: 'Comanda cancelada y mesa liberada' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
             COALESCE(m.minutos_abierta, 1) AS "minutosTranscurridos", 'PREPARANDO' AS estado
      FROM comandas c JOIN mesas m ON c.mesa_id = m.id LEFT JOIN usuarios u ON c.usuario_id = u.id
      WHERE c.estado != 'CERRADA' ORDER BY c.fecha_apertura ASC;
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
  try {
    await pool.query(
      `UPDATE comanda_items SET completado = NOT COALESCE(completado, false) WHERE id = $1`,
      [itemId],
    );
    emitirCambioGlobal('actualizar_cocina');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cocina/tickets/:comandaId/despachar', async (req, res) => {
  const { comandaId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE comanda_items SET completado = TRUE, estado_kds = 'LISTO' WHERE comanda_id = $1`,
      [comandaId],
    );
    await client.query(
      `UPDATE mesas SET estado = 'LISTO PARA SERVIR' WHERE id = (SELECT mesa_id FROM comandas WHERE id = $1)`,
      [comandaId],
    );
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
             c.cliente_id AS "clienteId", cli.nombre AS "clienteNombre", COALESCE(cli.puntos_acumulados, 0) AS "clientePuntos",
             COALESCE(cli.es_frecuente, false) AS "clienteEsFrecuente", COALESCE(cli.visitas_count, 0) AS "clienteVisitas"
      FROM comandas c JOIN mesas m ON c.mesa_id = m.id LEFT JOIN clientes cli ON c.cliente_id = cli.id
      WHERE m.id = $1 AND c.estado != 'CERRADA' LIMIT 1;
    `;
    const { rows } = await pool.query(query, [mesaId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Mesa sin comanda activa' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/caja/cobrar', async (req, res) => {
  const {
    comandaId,
    mesaId,
    usuarioId,
    metodoPago,
    totalCuenta,
    montoRecibido,
    cambio,
    dividirCuenta,
    partesIguales,
    descuento,
    promocionId,
    puntosCanjeados,
    solicitaFactura,
    agruparConsumo,
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
        dividirCuenta || false,
        partesIguales || 1,
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

    const comandaInfo = await client.query('SELECT cliente_id FROM comandas WHERE id = $1', [
      comandaId,
    ]);
    const clienteId = comandaInfo.rows[0]?.cliente_id;
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
    await client.query(
      `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
      [mesaId],
    );
    await client.query('COMMIT');
    emitirCambioGlobal('actualizar_mesas');

    let ticketTextoCobro: string | null = null;
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
      autofactura: datosAutofactura,
      ticketTexto: ticketTextoCobro,
      impresionesPendientes,
      errorFacturapi: errorFacturapiMsg,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

    let pagosQuery = `SELECT p.id, p.total_cuenta AS total, p.metodo_pago AS metodo, p.fecha, m.numero AS mesa FROM pagos p JOIN comandas c ON p.comanda_id = c.id JOIN mesas m ON c.mesa_id = m.id WHERE p.usuario_id = $1`;
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
  const { nombre, icono, orden } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre, icono, orden) VALUES ($1, $2, $3) RETURNING *`,
      [nombre, icono || 'restaurant', Number(orden) || 0],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/productos', async (req, res) => {
  const { categoria_id, nombre, precio, disponible, imagen_url } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO productos (categoria_id, nombre, precio, disponible, imagen_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [Number(categoria_id), nombre, Number(precio), disponible !== false, imagen_url || null],
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
    const query = `SELECT p.id, p.nombre, p.precio, p.disponible, p.imagen_url, p.categoria_id, c.nombre AS "categoriaNombre" FROM productos p JOIN categorias c ON p.categoria_id = c.id ORDER BY c.orden, p.nombre;`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categorias/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, icono, orden } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE categorias SET nombre = $1, icono = $2, orden = $3 WHERE id = $4 RETURNING *`,
      [nombre, icono || 'restaurant', Number(orden) || 0, id],
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
  const { categoria_id, nombre, precio, disponible, imagen_url } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE productos SET categoria_id = $1, nombre = $2, precio = $3, disponible = $4, imagen_url = $5 WHERE id = $6 RETURNING *`,
      [Number(categoria_id), nombre, Number(precio), disponible, imagen_url || null, id],
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
    res.json(rows[0] || null);
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
      let tieneCsd = false;
      const apiKeyActiva = modoProdBool ? apiKeyLive : apiKeyTest;

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
        apiKeyTest,
        apiKeyLive || null,
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
      res.status(500).json({ error: err.message || 'Error al procesar la configuración fiscal.' });
    }
  },
);

app.post('/api/ajustes/facturacion/test', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Proporciona una API Key para validar.' });

  try {
    const facturapi = obtenerInstanciaFacturapi(apiKey.trim());
    await facturapi.customers.list({ limit: 1 });
    res.json({ ok: true, mensaje: 'Conexión con Facturapi v2 autenticada correctamente.' });
  } catch (err: any) {
    console.error('❌ Error Factura:', err?.message || err);
    res.status(err?.status || 401).json({ error: err?.message || 'Error al validar la API Key.' });
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
      SELECT pa.id, pa.total_cuenta::float AS total, pa.metodo_pago AS metodo, COALESCE(EXTRACT(EPOCH FROM (co.fecha_cierre - co.fecha_apertura))/60, 0)::int AS "duracionMinutos",
             m.numero AS "mesaNombre", TO_CHAR(pa.fecha, 'DD/MM HH24:MI') AS hora
      FROM pagos pa JOIN comandas co ON pa.comanda_id = co.id JOIN mesas m ON co.mesa_id = m.id
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
        console.log(`🚀 [BACKEND] API REST & Sockets listos en http://127.0.0.1:${PORT}`);
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
