// backend-borboto/src/db.ts
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.DB_USER || 'borboto_admin',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'borboto_pos',
  password: process.env.DB_PASSWORD || 'BorbotoPass2026!',
  port: Number(process.env.DB_PORT) || 58432
});

// ─── MOTOR AUTOMÁTICO DE MIGRACIONES Y CONTROL DE VERSIONES ───────────────
export async function ejecutarMigracionesAutomatizadas() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Crear tabla de control de migraciones
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(150) NOT NULL UNIQUE,
        ejecutado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Resolver rutas absolutas robustas para encontrar Database/
    const posiblesRutas = [
      path.resolve(process.cwd(), '..', 'Database'),
      path.resolve(process.cwd(), 'Database'),
      path.resolve(__dirname, '..', '..', 'Database'),
      path.resolve(__dirname, '..', 'Database')
    ];

    let dirDatabase = posiblesRutas.find(r => fs.existsSync(r));

    if (!dirDatabase) {
      console.error('❌ CRÍTICO: No se encontró la carpeta "Database" en el proyecto.');
      await client.query('ROLLBACK');
      return;
    }

    const initPath = path.join(dirDatabase, '000_init.sql');

    // 3. Comprobar si ya se aplicó el script inicial 000_init.sql
    const checkInit = await client.query(
      'SELECT id FROM schema_migrations WHERE version = $1',
      ['000_init.sql']
    );

    if (checkInit.rows.length === 0) {
      if (fs.existsSync(initPath)) {
        console.log(`📦 Ejecutando script de estructura inicial desde: ${initPath}`);
        const sqlInit = fs.readFileSync(initPath, 'utf8');
        await client.query(sqlInit);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['000_init.sql']);
        console.log('✅ Estructura de base de datos inicial creada exitosamente.');
      } else {
        console.warn(`⚠️ No se encontró el archivo 000_init.sql en: ${initPath}`);
      }
    }

    // 4. Buscar y ejecutar migraciones pendientes en la carpeta Database/migrations/
    const dirMigrations = path.join(dirDatabase, 'migrations');

    if (fs.existsSync(dirMigrations)) {
      const archivos = fs.readdirSync(dirMigrations)
        .filter(f => f.endsWith('.sql'))
        .sort(); // Garantiza el orden secuencial numérico (001, 002, 003...)

      for (const archivo of archivos) {
        const checkMig = await client.query(
          'SELECT id FROM schema_migrations WHERE version = $1',
          [archivo]
        );

        if (checkMig.rows.length === 0) {
          console.log(`🚀 Aplicando migración de versión: ${archivo}...`);
          const sqlMig = fs.readFileSync(path.join(dirMigrations, archivo), 'utf8');
          await client.query(sqlMig);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [archivo]);
          console.log(`✅ Migración ${archivo} aplicada con éxito.`);
        }
      }
    }

    await client.query('COMMIT');
    console.log('🛡️ Base de datos sincronizada y actualizada a la última versión.');

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Error fatal al ejecutar migraciones en la base de datos:', error.message);
  } finally {
    client.release();
  }
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

// Bucle de intento diferido con reintentos para evitar errores 500 al arrancar
async function conectarYMigrar() {
  let intentos = 5;
  while (intentos > 0) {
    try {
      const client = await pool.connect();
      console.log('⚡ Conectado exitosamente a PostgreSQL (Borboto POS)');
      client.release();

      await ejecutarMigracionesAutomatizadas();
      await sincronizarCombosComoProductos();
      break;
    } catch (err: any) {
      intentos--;
      console.warn(`⚠️ Esperando que la base de datos responda... (${intentos} intentos restantes)`);
      if (intentos === 0) {
        console.error('❌ Error crítico al conectar a PostgreSQL:', err.message);
      } else {
        await new Promise(res => setTimeout(res, 2000));
      }
    }
  }
}

// Ejecutar conexión inicial
conectarYMigrar();