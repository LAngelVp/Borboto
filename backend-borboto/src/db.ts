// src/db.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
});

async function inicializarTablasAdicionales() {
  const client = await pool.connect();
  try {
    // Crear tabla de clientes
    await client.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        telefono VARCHAR(20),
        direccion TEXT,
        email VARCHAR(100),
        notas TEXT,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Crear tabla de datos del negocio
    await client.query(`
      CREATE TABLE IF NOT EXISTS datos_negocio (
        id INT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        rfc VARCHAR(20),
        telefono VARCHAR(20),
        direccion TEXT,
        email VARCHAR(100),
        mensaje_recibo TEXT,
        visitas_requeridas_frecuente INT DEFAULT 5,
        puntos_por_cada_diez_pesos INT DEFAULT 1,
        pesos_por_punto DECIMAL(10,2) DEFAULT 1.00
      );
    `);

    // Insertar datos del negocio iniciales
    await client.query(`
      INSERT INTO datos_negocio (id, nombre, rfc, telefono, direccion, email, mensaje_recibo, visitas_requeridas_frecuente, puntos_por_cada_diez_pesos, pesos_por_punto)
      VALUES (1, 'Borboto Taquería', 'XAXX010101000', '5512345678', 'Av. Principal 123, CDMX', 'contacto@borboto.com', '¡Gracias por su preferencia!', 5, 1, 1.00)
      ON CONFLICT (id) DO NOTHING;
    `);

    // Crear tabla de datos de transferencia
    await client.query(`
      CREATE TABLE IF NOT EXISTS datos_transferencia (
        id INT PRIMARY KEY,
        banco VARCHAR(100) NOT NULL,
        titular VARCHAR(100) NOT NULL,
        clabe VARCHAR(20) NOT NULL,
        email VARCHAR(100)
      );
    `);

    // Insertar datos de transferencia iniciales
    await client.query(`
      INSERT INTO datos_transferencia (id, banco, titular, clabe, email)
      VALUES (1, 'BBVA', 'Borboto S.A. de C.V.', '012180001234567890', 'pagos@borboto.com')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Crear tabla de promociones
    await client.query(`
      CREATE TABLE IF NOT EXISTS promociones (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        codigo VARCHAR(30) UNIQUE,
        tipo VARCHAR(20) NOT NULL, -- 'COMBO_PRECIO', 'DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO'
        valor DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        descripcion TEXT,
        activo BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Crear tabla de cortes de caja
    await client.query(`
      CREATE TABLE IF NOT EXISTS cortes_caja (
        id SERIAL PRIMARY KEY,
        usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fecha_cierre TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fondo_apertura DECIMAL(10,2) DEFAULT 0.00,
        efectivo_real DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        efectivo_calculado DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        tarjeta_calculado DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        transferencia_calculado DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        ventas_totales DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        diferencia DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        notas TEXT
      );
    `);

    // Insertar algunos promociones iniciales de prueba
    await client.query(`
      INSERT INTO promociones (nombre, codigo, tipo, valor, descripcion)
      VALUES
        ('Combo Pareja (2 Refrescos + 10 Tacos)', 'PAREJA10', 'COMBO_PRECIO', 220.00, 'Precio especial para 2 personas'),
        ('Descuento de Apertura 10%', 'APERTURA10', 'DESCUENTO_PORCENTAJE', 10.00, 'Aplica el 10% de descuento al total de la cuenta'),
        ('Descuento de Lealtad $50', 'LEALTAD50', 'DESCUENTO_MONTO', 50.00, 'Descuento directo de $50 pesos')
      ON CONFLICT (codigo) DO NOTHING;
    `);

    // Insertar usuarios de prueba si la tabla está vacía
    const tableCheck = await client.query(`SELECT to_regclass('public.usuarios')`);
    if (tableCheck.rows[0].to_regclass) {
      const userCount = await client.query('SELECT COUNT(*) FROM usuarios');
      if (parseInt(userCount.rows[0].count) === 0) {
        await client.query(`
          INSERT INTO usuarios (nombre, pin, rol) VALUES
          ('Juan Mesero', '1234', 'MESERO'),
          ('María Cajera', '4321', 'CAJERO'),
          ('Carlos Cocinero', '1111', 'COCINERO'),
          ('Sofía Administradora', '0000', 'ADMIN')
        `);
        console.log('✅ Usuarios iniciales sembrados.');
      }
    }

    // Agregar columna promocion_id a productos si no existe
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS promocion_id INT REFERENCES promociones(id) ON DELETE SET NULL;
    `);

    // Agregar columna cliente_id a comandas si no existe
    await client.query(`
      ALTER TABLE comandas ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES clientes(id) ON DELETE SET NULL;
    `);

    // Agregar campos de cliente frecuente y lealtad
    await client.query(`
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS puntos_acumulados INT DEFAULT 0;
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS es_frecuente BOOLEAN DEFAULT FALSE;
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS visitas_count INT DEFAULT 0;
    `);

    // Asegurar que las columnas visitas_requeridas_frecuente y puntos_por_cada_diez_pesos existan en datos_negocio
    await client.query(`
      ALTER TABLE datos_negocio ADD COLUMN IF NOT EXISTS visitas_requeridas_frecuente INT DEFAULT 5;
      ALTER TABLE datos_negocio ADD COLUMN IF NOT EXISTS puntos_por_cada_diez_pesos INT DEFAULT 1;
      ALTER TABLE datos_negocio ADD COLUMN IF NOT EXISTS pesos_por_punto DECIMAL(10,2) DEFAULT 1.00;
    `);

    // Agregar descuento y promocion_id de auditoría a la tabla de pagos
    await client.query(`
      ALTER TABLE pagos ADD COLUMN IF NOT EXISTS descuento DECIMAL(10,2) DEFAULT 0.00;
      ALTER TABLE pagos ADD COLUMN IF NOT EXISTS promocion_id INT REFERENCES promociones(id) ON DELETE SET NULL;
    `);

    console.log('✅ Tablas adicionales (clientes, negocio, transferencia, promociones) listas.');
  } catch (err) {
    console.error('❌ Error al inicializar tablas adicionales:', err);
  } finally {
    client.release();
  }
}

export async function sincronizarCombosComoProductos() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Obtener el id de la categoría 'Combos y Promociones'
    const catRes = await client.query(`SELECT id FROM categorias WHERE nombre = 'Combos y Promociones' LIMIT 1`);
    let categoriaId;
    if (catRes.rows.length === 0) {
      const newCatRes = await client.query(`
        INSERT INTO categorias (nombre, icono, orden)
        VALUES ('Combos y Promociones', 'card_giftcard', 99)
        RETURNING id
      `);
      categoriaId = newCatRes.rows[0].id;
    } else {
      categoriaId = catRes.rows[0].id;
    }

    // 2. Obtener todas las promociones activas del tipo 'COMBO_PRECIO'
    const promosRes = await client.query(`SELECT * FROM promociones WHERE tipo = 'COMBO_PRECIO'`);
    const promos = promosRes.rows;

    // 3. Insertar o actualizar cada combo en la tabla productos
    const promoIdsEncontrados = [];
    for (const promo of promos) {
      promoIdsEncontrados.push(promo.id);

      // Verificar si ya existe un producto para esta promocion
      const prodRes = await client.query(`SELECT id FROM productos WHERE promocion_id = $1 LIMIT 1`, [promo.id]);

      if (prodRes.rows.length > 0) {
        // Actualizar el producto existente
        await client.query(`
          UPDATE productos
          SET nombre = $1, precio = $2, disponible = $3, categoria_id = $4
          WHERE id = $5
        `, [promo.nombre, promo.valor, promo.activo !== false, categoriaId, prodRes.rows[0].id]);
      } else {
        // Insertar un nuevo producto
        await client.query(`
          INSERT INTO productos (categoria_id, nombre, precio, disponible, promocion_id)
          VALUES ($1, $2, $3, $4, $5)
        `, [categoriaId, promo.nombre, promo.valor, promo.activo !== false, promo.id]);
      }
    }

    // 4. Desactivar o eliminar productos vinculados a promociones que ya no son COMBO_PRECIO o que fueron eliminadas
    if (promoIdsEncontrados.length > 0) {
      await client.query(`
        UPDATE productos
        SET disponible = FALSE
        WHERE promocion_id IS NOT NULL AND NOT (promocion_id = ANY($1))
      `, [promoIdsEncontrados]);
    } else {
      await client.query(`
        UPDATE productos
        SET disponible = FALSE
        WHERE promocion_id IS NOT NULL
      `);
    }

    await client.query('COMMIT');
    console.log('🔄 Sincronización de Combos con Productos Menú completada.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error sincronizando combos:', err);
  } finally {
    client.release();
  }
}

// Prueba de conexión inicial e inicialización de tablas
pool.connect()
  .then(async (client) => {
    console.log('⚡ Conectado exitosamente a PostgreSQL (Borboto POS)');
    client.release();
    await inicializarTablasAdicionales();
    await sincronizarCombosComoProductos();
  })
  .catch(err => console.error('❌ Error al conectar a PostgreSQL:', err.stack));