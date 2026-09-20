ALTER TABLE comandas
ALTER COLUMN mesa_id DROP NOT NULL;

DROP INDEX IF EXISTS idx_comandas_mesa;

CREATE INDEX IF NOT EXISTS idx_comandas_mesa
ON comandas(mesa_id)
WHERE estado = 'ABIERTA' AND mesa_id IS NOT NULL;