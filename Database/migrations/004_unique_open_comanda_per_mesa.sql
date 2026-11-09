LOCK TABLE comandas IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT mesa_id FROM comandas
    WHERE estado = 'ABIERTA' AND mesa_id IS NOT NULL
    GROUP BY mesa_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existen comandas abiertas duplicadas por mesa; reconciliar antes de aplicar 004'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_comandas_unica_mesa_abierta
ON comandas(mesa_id)
WHERE estado = 'ABIERTA' AND mesa_id IS NOT NULL;