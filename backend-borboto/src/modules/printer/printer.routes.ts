// src/modules/printer/printer.routes.ts

import { Router } from 'express';
import { pool } from '../../db.ts';
import { PrinterService } from './printer.service.ts';

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

router.get('/system', async (_req, res) => {
  res.status(410).json({
    error:
      'La detección de impresoras del sistema ahora se realiza por Electron IPC con getPrintersAsync(), no por el backend.',
  });
});

// Registrar nueva impresora
router.post('/', async (req, res) => {
  const {
    nombre,
    destino,
    tipo,
    ip_o_puerto,
    puerto_tcp,
    ancho_papel,
    es_termica,
    corte_tipo,
    activa,
  } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO impresoras (nombre, destino, tipo, ip_o_puerto, puerto_tcp, ancho_papel, es_termica, corte_tipo, activa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        nombre,
        destino,
        tipo || 'RED',
        ip_o_puerto,
        Number(puerto_tcp) || 9100,
        ancho_papel || '80mm',
        es_termica === true,
        es_termica === true ? corte_tipo || 'NINGUNO' : 'NINGUNO',
        activa !== false,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Editar impresora existente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    nombre,
    destino,
    tipo,
    ip_o_puerto,
    puerto_tcp,
    ancho_papel,
    es_termica,
    corte_tipo,
    activa,
  } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE impresoras
       SET nombre = $1, destino = $2, tipo = $3, ip_o_puerto = $4, puerto_tcp = $5, ancho_papel = $6, es_termica = $7, corte_tipo = $8, activa = $9
       WHERE id = $10
       RETURNING *`,
      [
        nombre,
        destino,
        tipo,
        ip_o_puerto,
        Number(puerto_tcp) || 9100,
        ancho_papel || '80mm',
        es_termica === true,
        es_termica === true ? corte_tipo || 'NINGUNO' : 'NINGUNO',
        activa,
        id,
      ],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Impresora no encontrada' });
    }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/test', async (req, res) => {
  const printerId = Number(req.params.id);
  if (!Number.isFinite(printerId)) {
    return res.status(400).json({ error: 'ID de impresora inválido.' });
  }

  try {
    const resultado = await PrinterService.probarImpresora(printerId);
    if (!resultado.ok) {
      return res.status(400).json({ error: resultado.mensaje, ticketTexto: resultado.ticketTexto });
    }

    res.json(resultado);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al probar impresora.' });
  }
});

router.post('/confirmar-impresion', async (req, res) => {
  try {
    res.json(await PrinterService.confirmarItemsImpresos(req.body?.itemIds));
  } catch (error: unknown) {
    const status = error instanceof Error && 'status' in error && error.status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'IDs de items invalidos' : 'No se pudo confirmar la impresion' });
  }
});

router.post('/usb/raw-print', async (req, res) => {
  const { printerName, contenido, anchoPapel, corteTipo } = req.body || {};

  if (!printerName || !contenido) {
    return res.status(400).json({ error: 'Faltan datos para impresión RAW USB.' });
  }

  try {
    const resultado = await PrinterService.imprimirUsbRaw({
      printerName,
      contenido,
      anchoPapel,
      corteTipo,
    });
    if (!resultado?.ok) return res.status(502).json(resultado);
    res.json(resultado);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error al imprimir por RAW USB.' });
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
