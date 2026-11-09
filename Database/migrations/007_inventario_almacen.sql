CREATE TABLE IF NOT EXISTS inventario_insumos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(40) UNIQUE,
    nombre VARCHAR(120) NOT NULL,
    categoria_almacen VARCHAR(60) NOT NULL DEFAULT 'ALMACEN',
    unidad_base VARCHAR(30) NOT NULL DEFAULT 'PIEZA',
    permite_paquetes BOOLEAN NOT NULL DEFAULT FALSE,
    nombre_paquete VARCHAR(30) NOT NULL DEFAULT 'CAJA',
    factor_paquete NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (factor_paquete > 0),
    stock_actual NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    stock_minimo NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    costo_unitario NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
    ubicacion VARCHAR(80),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inventario_movimientos (
    id SERIAL PRIMARY KEY,
    insumo_id INT NOT NULL REFERENCES inventario_insumos(id) ON DELETE RESTRICT,
    tipo_movimiento VARCHAR(30) NOT NULL CHECK (tipo_movimiento IN ('SALIDA_COCINA','SALIDA_ALMACEN','SALIDA_BARRA','MERMA','ENTRADA_COMPRA','REINVENTARIO_AJUSTE')),
    modo_captura VARCHAR(15) NOT NULL DEFAULT 'UNIDAD' CHECK (modo_captura IN ('UNIDAD','PAQUETE')),
    cantidad_capturada NUMERIC(12,2) NOT NULL CHECK (cantidad_capturada > 0),
    factor_aplicado NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (factor_aplicado > 0),
    delta_unidad_base NUMERIC(12,2) NOT NULL,
    stock_anterior NUMERIC(12,2) NOT NULL,
    stock_resultante NUMERIC(12,2) NOT NULL,
    motivo_notas VARCHAR(255),
    usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_nombre VARCHAR(100),
    fecha TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventario_activo ON inventario_insumos(activo);
CREATE INDEX IF NOT EXISTS idx_inventario_categoria ON inventario_insumos(categoria_almacen);
CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_fecha ON inventario_movimientos(insumo_id, fecha DESC);