// backend-borboto/src/db.ts
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envPath = (process as any).resourcesPath
  ? path.resolve((process as any).resourcesPath, 'backend-borboto/.env')
  : path.resolve(process.cwd(), 'backend-borboto/.env');

dotenv.config({ path: envPath });

const { Pool } = pkg;

const dbUser = process.env.DB_USER || 'borboto_admin';
const dbPassword = process.env.DB_PASSWORD || 'holamundo31';
const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = Number(process.env.DB_PORT) || 58432;
const dbTargetName = process.env.DB_NAME || 'borboto_pos';

// Pool exportado para las rutas de la app
export const pool = new Pool({
  user: dbUser,
  host: dbHost,
  database: dbTargetName,
  password: dbPassword,
  port: dbPort,
});

pool.on('connect', () => {
  console.log(`🟢 Conexión activa a PostgreSQL en ${dbTargetName}:${dbPort}`);
});

pool.on('error', (err) => {
  console.error('❌ Error imprevisto en el pool de PostgreSQL:', err);
});

// Función auxiliar para localizar la carpeta Database
function getDatabaseDirectory(): string {
  const possiblePaths = [
    path.resolve(__dirname, 'Database'),
    path.resolve(process.cwd(), 'Database'),
    path.resolve(process.cwd(), 'backend-borboto', 'Database'),
    path.resolve(__dirname, '..', 'Database')
  ];

  if ((process as any).resourcesPath) {
    possiblePaths.unshift(path.resolve((process as any).resourcesPath, 'Database'));
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`📂 Carpeta "Database" localizada en: ${p}`);
      return p;
    }
  }

  throw new Error('❌ No se encontró la carpeta "Database" con el archivo 000_init.sql');
}

export async function sincronizarCombosComoProductos() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const promosRes = await client.query(`SELECT * FROM promociones WHERE tipo = 'COMBO_PRECIO'`);
    const promos = promosRes.rows;

    const promoIdsEncontrados = [];
    for (const promo of promos) {
      promoIdsEncontrados.push(promo.id);

      const prodRes = await client.query(`SELECT id FROM productos WHERE promocion_id = $1 LIMIT 1`, [promo.id]);

      if (prodRes.rows.length > 0) {
        await client.query(`
          UPDATE productos
          SET nombre = $1, precio = $2, disponible = $3, categoria_id = $4
          WHERE id = $5
        `, [promo.nombre, promo.valor, promo.activo !== false, categoriaId, prodRes.rows[0].id]);
      } else {
        await client.query(`
          INSERT INTO productos (categoria_id, nombre, precio, disponible, promocion_id)
          VALUES ($1, $2, $3, $4, $5)
        `, [categoriaId, promo.nombre, promo.valor, promo.activo !== false, promo.id]);
      }
    }

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
    console.log('🔄 Sincronización de Combos completada.');
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('❌ Error sincronizando combos:', err.message);
  } finally {
    client.release();
  }
}

// 💡 SCRIPT DE INICIALIZACIÓN FÍSICA Y AUTO-MIGRACIÓN
export async function initDB(): Promise<void> {
  // 1. Conexión temporal a la BD 'postgres' para verificar/crear 'borboto_pos'
  const maintenancePool = new Pool({
    user: dbUser,
    host: dbHost,
    password: dbPassword,
    port: dbPort,
    database: 'postgres'
  });

  try {
    const res = await maintenancePool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbTargetName]
    );

    if (res.rowCount === 0) {
      console.log(`🛠️ La base de datos '${dbTargetName}' no existe. Creándola...`);
      await maintenancePool.query(`CREATE DATABASE "${dbTargetName}"`);
      console.log(`✅ Base de datos '${dbTargetName}' creada exitosamente.`);
    }
  } catch (err: any) {
    console.error('⚠️ Error al verificar/crear la base de datos:', err.message);
  } finally {
    await maintenancePool.end();
  }

  // 2. Conectarse a 'borboto_pos' para verificar e insertar las 18 tablas
  const targetPool = new Pool({
    user: dbUser,
    host: dbHost,
    database: dbTargetName,
    password: dbPassword,
    port: dbPort,
  });

  try {
    await targetPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(150) NOT NULL UNIQUE,
        ejecutado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const dbDir = getDatabaseDirectory();
    const initPath = path.join(dbDir, '000_init.sql');

    const checkInit = await targetPool.query(
      'SELECT id FROM schema_migrations WHERE version = $1',
      ['000_init.sql']
    );

    if (checkInit.rows.length === 0) {
      if (fs.existsSync(initPath)) {
        console.log(`🚀 Aplicando migración inicial desde: ${initPath}`);
        const sqlContent = fs.readFileSync(initPath, 'utf-8');

        await targetPool.query('BEGIN');
        try {
          await targetPool.query(sqlContent);
          await targetPool.query(
            'INSERT INTO schema_migrations (version) VALUES ($1)',
            ['000_init.sql']
          );
          await targetPool.query('COMMIT');
          console.log('✅ Estructura inicial (000_init.sql) creada exitosamente en borboto_pos.');
        } catch (migrationError: any) {
          await targetPool.query('ROLLBACK');
          console.error('❌ Falló la migración 000_init.sql:', migrationError.message);
          throw migrationError;
        }
      } else {
        console.warn(`⚠️ No se encontró el archivo 000_init.sql en: ${initPath}`);
      }
    } else {
      console.log('ℹ️ La migración 000_init.sql ya se encontraba aplicada.');
    }

    // Incremental migrations to ensure 'facturas' table satisfies new audit requirements
    console.log('🔄 Ejecutando migraciones incrementales para la tabla "facturas"...');
    await targetPool.query(`
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS facturapi_invoice_id VARCHAR(100) UNIQUE;
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS total NUMERIC(10, 2);
      ALTER TABLE facturas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'active';
      ALTER TABLE facturas ALTER COLUMN ticket_id DROP NOT NULL;
    `);

    try {
      await targetPool.query(`
        ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_ticket_id_fkey;
        ALTER TABLE facturas ADD CONSTRAINT facturas_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets_autofactura(id) ON DELETE SET NULL;
      `);
    } catch (fkErr: any) {
      console.warn('⚠️ No se pudo migrar la restricción FK de "facturas_ticket_id_fkey":', fkErr.message);
    }
    console.log('✅ Migraciones incrementales de "facturas" completadas.');
  } catch (sqlErr: any) {
    console.error('❌ Error durante el proceso de migraciones de la base de datos:', sqlErr.message);
    throw sqlErr;
  } finally {
    await targetPool.end();
  }
}