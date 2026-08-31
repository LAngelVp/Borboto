// src/modules/printer/printer.routes.ts

import { Router } from 'express';
import { pool } from '../../db.ts';

const router = Router();

// Obtener todas las impresoras
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM impresoras ORDER BY id ASC');
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Registrar nueva impresora
router.post('/', async (req, res) => {
  const { nombre, destino, tipo, ip_o_puerto, puerto_tcp, ancho_papel, activa } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO impresoras (nombre, destino, tipo, ip_o_puerto, puerto_tcp, ancho_papel, activa)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        nombre,
        destino,
        tipo || 'RED',
        ip_o_puerto,
        Number(puerto_tcp) || 9100,
        ancho_papel || '80mm', // 👈 Guardar '58mm' u '80mm'
        activa !== false
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Editar impresora existente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, destino, tipo, ip_o_puerto, puerto_tcp, ancho_papel, activa } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE impresoras
       SET nombre = $1, destino = $2, tipo = $3, ip_o_puerto = $4, puerto_tcp = $5, ancho_papel = $6, activa = $7
       WHERE id = $8
       RETURNING *`,
      [
        nombre,
        destino,
        tipo,
        ip_o_puerto,
        Number(puerto_tcp) || 9100,
        ancho_papel || '80mm', // 👈 Actualizar ancho de papel
        activa,
        id
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Impresora no encontrada' });
    }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar impresora
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM impresoras WHERE id = $1', [id]);
    res.json({ ok: true, mensaje: 'Impresora eliminada exitosamente' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;