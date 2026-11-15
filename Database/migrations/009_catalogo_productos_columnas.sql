-- 009: asegura columnas de catalogo en instalaciones creadas con esquemas previos.
-- 000_init.sql solo se aplica una vez; esta migracion es aditiva e idempotente.

DO $$
BEGIN
    CREATE TYPE destino_impresion_enum AS ENUM ('COCINA', 'BARRA', 'CAJA', 'NINGUNO');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE categorias ADD COLUMN IF NOT EXISTS clave_sat VARCHAR(10);
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS destino_impresion destino_impresion_enum NOT NULL DEFAULT 'COCINA';

ALTER TABLE productos ADD COLUMN IF NOT EXISTS promocion_id INT REFERENCES promociones(id) ON DELETE SET NULL;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS clave_sat VARCHAR(10);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url TEXT;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT TRUE;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
