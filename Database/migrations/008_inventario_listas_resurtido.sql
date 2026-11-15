CREATE TABLE IF NOT EXISTS inventario_listas_resurtido (
    id SERIAL PRIMARY KEY,
    folio VARCHAR(30) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL DEFAULT 'Lista de Resurtido',
    margen_guardia NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (margen_guardia >= 0),
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','RECIBIDA','CANCELADA')),
    notas VARCHAR(255),
    usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_nombre VARCHAR(100),
    creada_en TIMESTAMP NOT NULL DEFAULT NOW(),
    recibida_en TIMESTAMP NULL
);
CREATE TABLE IF NOT EXISTS inventario_listas_resurtido_items (
    id SERIAL PRIMARY KEY,
    lista_id INT NOT NULL REFERENCES inventario_listas_resurtido(id) ON DELETE CASCADE,
    insumo_id INT NOT NULL REFERENCES inventario_insumos(id) ON DELETE RESTRICT,
    modo_captura VARCHAR(15) NOT NULL DEFAULT 'UNIDAD' CHECK (modo_captura IN ('UNIDAD','PAQUETE')),
    cantidad_sugerida NUMERIC(12,2) NOT NULL CHECK (cantidad_sugerida > 0),
    cantidad_comprada NUMERIC(12,2) NULL CHECK (cantidad_comprada IS NULL OR cantidad_comprada >= 0),
    comprado BOOLEAN NOT NULL DEFAULT TRUE,
    stock_actual_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock_minimo_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
    UNIQUE (lista_id, insumo_id)
);
CREATE INDEX IF NOT EXISTS idx_resurtido_estado_fecha ON inventario_listas_resurtido(estado, creada_en DESC);
CREATE INDEX IF NOT EXISTS idx_resurtido_items_lista ON inventario_listas_resurtido_items(lista_id);