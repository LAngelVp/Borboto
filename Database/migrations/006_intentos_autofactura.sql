CREATE TABLE IF NOT EXISTS intentos_autofactura (
  pago_id INTEGER PRIMARY KEY REFERENCES pagos(id),
  solicitud JSONB NOT NULL,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'EMITIENDO', 'RECONCILIAR', 'CONFIRMADO')),
  facturapi_receipt_id TEXT,
  fecha_expiracion TIMESTAMPTZ NOT NULL,
  error_generico TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_intentos_autofactura_pendientes
  ON intentos_autofactura (actualizado_en) WHERE estado <> 'CONFIRMADO';