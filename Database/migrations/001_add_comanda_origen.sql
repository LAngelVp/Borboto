ALTER TABLE comandas
ADD COLUMN IF NOT EXISTS tipo_origen VARCHAR(20),
ADD COLUMN IF NOT EXISTS folio_origen VARCHAR(50);

UPDATE comandas c
SET tipo_origen = CASE
      WHEN UPPER(TRIM(COALESCE(z.nombre, ''))) = 'MOSTRADOR' THEN 'MOSTRADOR'
      WHEN UPPER(TRIM(COALESCE(z.nombre, ''))) = 'DOMICILIO' THEN 'ENVIO'
      ELSE 'MESA'
    END,
    folio_origen = m.numero
FROM mesas m
LEFT JOIN zonas z ON z.id = m.zona_id
WHERE c.mesa_id = m.id
  AND (c.tipo_origen IS NULL OR c.folio_origen IS NULL);

ALTER TABLE comandas
ALTER COLUMN tipo_origen SET DEFAULT 'MESA';

ALTER TABLE comandas
ALTER COLUMN tipo_origen SET NOT NULL;

ALTER TABLE comandas
ALTER COLUMN folio_origen SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comandas_origen_estado
ON comandas(tipo_origen, estado, fecha_apertura DESC);

CREATE INDEX IF NOT EXISTS idx_comandas_folio_origen
ON comandas(folio_origen);