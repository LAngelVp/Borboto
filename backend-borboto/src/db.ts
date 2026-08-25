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

// Prueba de conexión inicial
pool.connect()
  .then(client => {
    console.log('⚡ Conectado exitosamente a PostgreSQL (Borboto POS)');
    client.release();
  })
  .catch(err => console.error('❌ Error al conectar a PostgreSQL:', err.stack));