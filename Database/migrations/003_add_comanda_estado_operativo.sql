ALTER TABLE comandas
ADD COLUMN IF NOT EXISTS estado_operativo estado_mesa_enum;

UPDATE comandas c
SET estado_operativo = CASE
    WHEN c.estado = 'CANCELADA' THEN 'DISPONIBLE'::estado_mesa_enum
    WHEN c.estado = 'CERRADA' THEN 'DISPONIBLE'::estado_mesa_enum
    WHEN c.mesa_id IS NOT NULL THEN COALESCE(m.estado, 'PENDIENTE'::estado_mesa_enum)
    WHEN EXISTS (
      SELECT 1
      FROM comanda_items ci
      WHERE ci.comanda_id = c.id
        AND ci.estado_kds = 'LISTO'
    ) THEN 'LISTO PARA SERVIR'::estado_mesa_enum
    WHEN EXISTS (
      SELECT 1
      FROM comanda_items ci
      WHERE ci.comanda_id = c.id
    ) THEN 'EN COCINA'::estado_mesa_enum
    ELSE 'PENDIENTE'::estado_mesa_enum
  END
FROM mesas m
WHERE c.mesa_id = m.id
   OR c.estado_operativo IS NULL;

UPDATE comandas
SET estado_operativo = COALESCE(estado_operativo, 'PENDIENTE'::estado_mesa_enum);

ALTER TABLE comandas
ALTER COLUMN estado_operativo SET DEFAULT 'PENDIENTE'::estado_mesa_enum;

ALTER TABLE comandas
ALTER COLUMN estado_operativo SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comandas_estado_operativo
ON comandas(estado_operativo, estado, fecha_apertura DESC);