-- 011: logotipo configurable en el ticket de caja y tamaño de fuente
-- para impresoras de producción (cocina/barra).

ALTER TABLE datos_negocio
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE datos_negocio
    ADD COLUMN IF NOT EXISTS imprimir_logo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE impresoras
    ADD COLUMN IF NOT EXISTS tamano_fuente VARCHAR(20) NOT NULL DEFAULT 'NORMAL';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_impresoras_tamano_fuente'
    ) THEN
        ALTER TABLE impresoras
            ADD CONSTRAINT chk_impresoras_tamano_fuente
            CHECK (tamano_fuente IN ('NORMAL', 'DOBLE_ALTO', 'DOBLE_ANCHO', 'DOBLE'));
    END IF;
END
$$;
