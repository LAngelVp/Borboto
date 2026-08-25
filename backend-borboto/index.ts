// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './src/db.ts';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors()); // Permite peticiones desde Angular (http://127.0.0.1:4200)
app.use(express.json());

/* ==========================================================================
   1. ENDPOINTS DE MESAS Y ZONAS
   ========================================================================== */

// Obtener todas las mesas con su zona y el total de la comanda abierta
app.get('/api/mesas', async (_req, res) => {
  try {
    const query = `
      SELECT m.id, m.numero, z.nombre AS zona, m.capacidad, m.estado,
             m.comensales, m.minutos_abierta AS "minutosAbierta",
             COALESCE(c.total, 0.00) AS total
      FROM mesas m
      JOIN zonas z ON m.zona_id = z.id
      LEFT JOIN comandas c ON c.mesa_id = m.id AND c.estado != 'CERRADA'
      ORDER BY m.id ASC;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Abrir una mesa (Asignar comensales y crear comanda ABIERTA)
app.post('/api/mesas/:id/abrir', async (req, res) => {
  const { id } = req.params;
  const { comensales, usuarioId } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Actualizar estado de la mesa a PENDIENTE
    await client.query(
      `UPDATE mesas SET estado = 'PENDIENTE', comensales = $1, minutos_abierta = 1 WHERE id = $2`,
      [comensales || 1, id]
    );

    // 2. Crear nueva comanda en estado 'ABIERTA'
    const comandaRes = await client.query(
      `INSERT INTO comandas (mesa_id, usuario_id, estado, total)
       VALUES ($1, $2, 'ABIERTA', 0.00) RETURNING id`,
      [id, usuarioId || 1]
    );

    await client.query('COMMIT');
    res.json({ ok: true, comandaId: comandaRes.rows[0].id });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Transferir / Mover mesa ocupada a una libre
app.post('/api/mesas/:origenId/mover', async (req, res) => {
  const { origenId } = req.params;
  const { destinoId } = req.body;

  if (!origenId || !destinoId) {
    return res.status(400).json({ error: 'Faltan parámetros: origenId y destinoId son requeridos.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const mesaOrigenRes = await client.query(
      `SELECT estado, comensales, minutos_abierta FROM mesas WHERE id = $1`,
      [origenId]
    );

    if (mesaOrigenRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'La mesa origen no existe.' });
    }

    const { estado: estadoOrigen, comensales, minutos_abierta } = mesaOrigenRes.rows[0];

    const comandaRes = await client.query(
      `SELECT id FROM comandas WHERE mesa_id = $1 AND estado != 'CERRADA' ORDER BY id DESC LIMIT 1`,
      [origenId]
    );

    if (comandaRes.rows.length > 0) {
      const comandaId = comandaRes.rows[0].id;
      await client.query(`UPDATE comandas SET mesa_id = $1 WHERE id = $2`, [destinoId, comandaId]);
    }

    await client.query(
      `UPDATE mesas SET estado = $1, comensales = $2, minutos_abierta = $3 WHERE id = $4`,
      [estadoOrigen, comensales || 1, minutos_abierta || 1, destinoId]
    );

    await client.query(
      `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
      [origenId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, mensaje: 'Mesa movida exitosamente' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ==========================================================================
   2. ENDPOINTS DE MENÚ Y COMANDERO
   ========================================================================== */

app.get('/api/productos', async (_req, res) => {
  try {
    const query = `
      SELECT p.id, p.nombre, p.precio,
             json_build_object('id', c.id, 'nombre', c.nombre) AS categoria,
             c.icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      WHERE p.disponible = TRUE
      ORDER BY c.orden, p.nombre;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   DESGLOSE DE CUENTA Y ADICIÓN DE PRODUCTOS
   ========================================================================== */

// Obtener los productos guardados de la comanda activa de la mesa en cualquier estado
app.get('/api/comandas/activa/:mesaId', async (req, res) => {
  const { mesaId } = req.params;
  try {
    const comandaRes = await pool.query(
      `SELECT id, total FROM comandas WHERE mesa_id = $1 AND estado != 'CERRADA' ORDER BY id DESC LIMIT 1`,
      [mesaId]
    );

    if (comandaRes.rows.length === 0) {
      return res.json({ comandaId: 0, total: 0, items: [] });
    }

    const comandaId = comandaRes.rows[0].id;

    const itemsRes = await pool.query(
      `SELECT ci.id, ci.cantidad, ci.precio_unitario AS subtotal, ci.notas, ci.completado, ci.estado_kds,
              json_build_object(
                'id', p.id,
                'nombre', p.nombre,
                'precio', ci.precio_unitario,
                'categoria', c.nombre
              ) AS producto
       FROM comanda_items ci
       JOIN productos p ON ci.producto_id = p.id
       JOIN categorias c ON p.categoria_id = c.id
       WHERE ci.comanda_id = $1
       ORDER BY ci.id ASC`,
      [comandaId]
    );

    res.json({ comandaId, total: comandaRes.rows[0].total, items: itemsRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Marcar la mesa como SERVIDO (Al entregar la comida)
app.post('/api/mesas/:mesaId/servir', async (req, res) => {
  const { mesaId } = req.params;
  try {
    await pool.query(`UPDATE mesas SET estado = 'SERVIDO' WHERE id = $1`, [mesaId]);
    res.json({ ok: true, mensaje: 'Mesa marcada como servida' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Acumular o guardar nuevos productos en la comanda (Pasa mesa a 'EN COCINA')
app.post('/api/comandas', async (req, res) => {
  const { comandaId, mesaId, items } = req.body;

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
        [mesaId]
      );

      if (comandaExistente.rows.length > 0) {
        idComandaActual = comandaExistente.rows[0].id;
      } else {
        const nuevaComanda = await client.query(
          `INSERT INTO comandas (mesa_id, usuario_id, estado, total) VALUES ($1, 1, 'ABIERTA', 0.00) RETURNING id`,
          [mesaId]
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
        `INSERT INTO comanda_items (comanda_id, producto_id, cantidad, precio_unitario, notas, estado_kds)
         VALUES ($1, $2, $3, $4, $5, 'PENDIENTE')`,
        [idComandaActual, productoId, cantidad, precioUnitario, item.notas || null]
      );
    }

    await client.query(`UPDATE comandas SET total = total + $1 WHERE id = $2`, [totalAdicional, idComandaActual]);
    await client.query(`UPDATE mesas SET estado = 'EN COCINA' WHERE id = $1`, [mesaId]);

    await client.query('COMMIT');
    res.json({ ok: true, totalAdicional, comandaId: idComandaActual });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ==========================================================================
   3. ENDPOINTS DE COCINA (KDS)
   ========================================================================== */

// GET /api/cocina/tickets
app.get('/api/cocina/tickets', async (_req, res) => {
  try {
    // 1. Consulta simplificada: Trae todas las comandas abiertas
    const queryComandas = `
      SELECT c.id,
             c.mesa_id AS "mesaId",
             m.numero AS "mesaNumero",
             COALESCE(u.nombre, 'Mesero') AS mesero,
             COALESCE(m.minutos_abierta, 1) AS "minutosTranscurridos",
             'PREPARANDO' AS estado
      FROM comandas c
      JOIN mesas m ON c.mesa_id = m.id
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      WHERE c.estado != 'CERRADA'
      ORDER BY c.fecha_apertura ASC;
    `;
    const { rows: tickets } = await pool.query(queryComandas);

    const ticketsConItems = [];

    // 2. Trae los ítems de cada comanda
    for (const ticket of tickets) {
      const itemsQuery = `
        SELECT ci.id, p.nombre, ci.cantidad, ci.notas, COALESCE(ci.completado, false) AS completado, ci.estado_kds
        FROM comanda_items ci
        JOIN productos p ON ci.producto_id = p.id
        WHERE ci.comanda_id = $1
        ORDER BY ci.id ASC;
      `;
      const { rows: items } = await pool.query(itemsQuery, [ticket.id]);

      // Solo enviamos a cocina las comandas que tengan al menos 1 producto
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

// Cambiar estado individual de un ítem (Tachar/Destachar platillo)
app.patch('/api/cocina/items/:itemId/toggle', async (req, res) => {
  const { itemId } = req.params;
  try {
    await pool.query(
      `UPDATE comanda_items SET completado = NOT COALESCE(completado, false) WHERE id = $1`,
      [itemId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Despachar ticket completo (Pasa la mesa a 'LISTO PARA SERVIR')
app.post('/api/cocina/tickets/:comandaId/despachar', async (req, res) => {
  const { comandaId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE comanda_items SET completado = TRUE, estado_kds = 'LISTO' WHERE comanda_id = $1`,
      [comandaId]
    );

    await client.query(
      `UPDATE mesas SET estado = 'LISTO PARA SERVIR' WHERE id = (SELECT mesa_id FROM comandas WHERE id = $1)`,
      [comandaId]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ==========================================================================
   4. ENDPOINTS DE CAJA Y COBRO
   ========================================================================== */

app.get('/api/caja/mesa/:mesaId', async (req, res) => {
  const { mesaId } = req.params;
  try {
    const query = `
      SELECT c.id AS "comandaId", m.id AS "mesaId", m.numero AS "mesaNumero",
             m.comensales, COALESCE(c.total, 0.00) AS total
      FROM comandas c
      JOIN mesas m ON c.mesa_id = m.id
      WHERE m.id = $1 AND c.estado != 'CERRADA'
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [mesaId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'La mesa no cuenta con una comanda activa' });
    }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Procesar Pago y Liberar Mesa (Pasa a 'DISPONIBLE')
app.post('/api/caja/cobrar', async (req, res) => {
  const { comandaId, mesaId, usuarioId, metodoPago, totalCuenta, montoRecibido, cambio, dividirCuenta, partesIguales } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pagoRes = await client.query(
      `INSERT INTO pagos (comanda_id, usuario_id, metodo_pago, total_cuenta, monto_recibido, cambio, dividir_cuenta, partes_iguales)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [comandaId, usuarioId || 1, metodoPago, totalCuenta, montoRecibido, cambio, dividirCuenta || false, partesIguales || 1]
    );

    await client.query(
      `UPDATE comandas SET estado = 'CERRADA', fecha_cierre = CURRENT_TIMESTAMP WHERE id = $1`,
      [comandaId]
    );

    await client.query(
      `UPDATE mesas SET estado = 'DISPONIBLE', comensales = 0, minutos_abierta = 0 WHERE id = $1`,
      [mesaId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, ticketId: pagoRes.rows[0].id });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Borboto POS activo en: http://127.0.0.1:${PORT}`);
});