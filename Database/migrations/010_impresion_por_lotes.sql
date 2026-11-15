-- 010: impresión diferencial de comandas por lotes de envío.
-- Cada "enviar a cocina" crea un lote y solo sus ítems se imprimen.
-- El estado de impresión vive por ítem y por lote, evitando reimprimir
-- adiciones anteriores cuando ya fueron enviadas.

DO $$
BEGIN
    CREATE TYPE estado_impresion_enum AS ENUM
        ('PENDIENTE', 'ENVIADO', 'CONFIRMADO', 'ERROR', 'NO_APLICA', 'SIMULADO');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS comanda_envios (
    id SERIAL PRIMARY KEY,
    comanda_id INT NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(120),
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    error TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmado_en TIMESTAMP,
    CONSTRAINT uq_comanda_envios_idempotencia UNIQUE (comanda_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_comanda_envios_comanda
    ON comanda_envios(comanda_id, creado_en DESC);

ALTER TABLE comanda_items
    ADD COLUMN IF NOT EXISTS estado_impresion estado_impresion_enum NOT NULL DEFAULT 'PENDIENTE';

ALTER TABLE comanda_items
    ADD COLUMN IF NOT EXISTS envio_id INT;

ALTER TABLE comanda_items
    ADD COLUMN IF NOT EXISTS impresion_intentos INT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_comanda_items_envio'
    ) THEN
        ALTER TABLE comanda_items
            ADD CONSTRAINT fk_comanda_items_envio
            FOREIGN KEY (envio_id) REFERENCES comanda_envios(id) ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_comanda_items_pendientes
    ON comanda_items(comanda_id, estado_impresion);

-- Sincroniza el estado nuevo con la bandera histórica impreso/impreso_en.
UPDATE comanda_items
SET estado_impresion = CASE
        WHEN impreso IS TRUE THEN 'CONFIRMADO'::estado_impresion_enum
        ELSE 'PENDIENTE'::estado_impresion_enum
    END
WHERE estado_impresion = 'PENDIENTE'
  AND impreso IS TRUE;
