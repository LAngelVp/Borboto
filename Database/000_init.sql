-- ============================================================================
-- SCRIPT COMPLETO Y UNIFICADO (BORBOTO POS)
-- Base de datos lista para entorno Portable/Producción con PostgreSQL
-- ============================================================================

SET timezone = 'America/Mexico_City';

-- 1. ELIMINACIÓN DE TABLAS (Orden estricto por dependencias FK)
DROP TABLE IF EXISTS facturas CASCADE;
DROP TABLE IF EXISTS tickets_autofactura CASCADE;
DROP TABLE IF EXISTS configuracion_facturacion CASCADE;
DROP TABLE IF EXISTS impresoras CASCADE;
DROP TABLE IF EXISTS pagos CASCADE;
DROP TABLE IF EXISTS comanda_items CASCADE;
DROP TABLE IF EXISTS comandas CASCADE;
DROP TABLE IF EXISTS productos CASCADE;
DROP TABLE IF EXISTS promociones CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS cortes_caja CASCADE;
DROP TABLE IF EXISTS mesas CASCADE;
DROP TABLE IF EXISTS zonas CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS datos_negocio CASCADE;
DROP TABLE IF EXISTS datos_transferencia CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;

-- ELIMINACIÓN DE TIPOS ENUMERADOS
DROP TYPE IF EXISTS destino_impresion_enum CASCADE;
DROP TYPE IF EXISTS estado_factura_enum CASCADE;
DROP TYPE IF EXISTS estado_mesa_enum CASCADE;
DROP TYPE IF EXISTS estado_comanda_enum CASCADE;
DROP TYPE IF EXISTS estado_item_kds_enum CASCADE;
DROP TYPE IF EXISTS metodo_pago_enum CASCADE;
DROP TYPE IF EXISTS rol_usuario_enum CASCADE;

-- 2. ENUMERADOS
CREATE TYPE estado_mesa_enum AS ENUM ('DISPONIBLE', 'PENDIENTE', 'EN COCINA', 'LISTO PARA SERVIR', 'SERVIDO');
CREATE TYPE estado_comanda_enum AS ENUM ('ABIERTA', 'CERRADA', 'CANCELADA');
CREATE TYPE estado_item_kds_enum AS ENUM ('PENDIENTE', 'PREPARANDO', 'LISTO');
CREATE TYPE metodo_pago_enum AS ENUM ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA');
CREATE TYPE rol_usuario_enum AS ENUM ('ADMIN', 'MESERO', 'COCINERO', 'CAJERO');
CREATE TYPE estado_factura_enum AS ENUM ('PENDIENTE', 'TIMBRADA', 'CANCELADA', 'ERROR');
CREATE TYPE destino_impresion_enum AS ENUM ('COCINA', 'BARRA', 'CAJA', 'NINGUNO');

-- 3. MIGRACIONES
CREATE TABLE schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(150) NOT NULL UNIQUE,
    ejecutado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. TABLAS GLOBALES Y DE USUARIOS
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    pin VARCHAR(6) NOT NULL UNIQUE,
    rol rol_usuario_enum NOT NULL DEFAULT 'MESERO',
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE datos_negocio (
    id INT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    rfc VARCHAR(20),
    telefono VARCHAR(20),
    direccion TEXT,
    email VARCHAR(100),
    mensaje_recibo TEXT,
    visitas_requeridas_frecuente INT DEFAULT 5,
    puntos_por_cada_diez_pesos INT DEFAULT 1,
    pesos_por_punto NUMERIC(10, 2) DEFAULT 1.00
);

CREATE TABLE datos_transferencia (
    id INT PRIMARY KEY,
    banco VARCHAR(100) NOT NULL,
    titular VARCHAR(100) NOT NULL,
    clabe VARCHAR(20) NOT NULL,
    email VARCHAR(100)
);

CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20),
    direccion TEXT,
    email VARCHAR(100),
    notas TEXT,
    puntos_acumulados INT DEFAULT 0,
    es_frecuente BOOLEAN DEFAULT FALSE,
    visitas_count INT DEFAULT 0,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE zonas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE mesas (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(50) NOT NULL,
    zona_id INT NOT NULL REFERENCES zonas(id) ON DELETE RESTRICT,
    capacidad INT DEFAULT 4,
    estado estado_mesa_enum DEFAULT 'DISPONIBLE',
    comensales INT DEFAULT 0,
    minutos_abierta INT DEFAULT 0,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_mesa_zona UNIQUE(numero, zona_id)
);

CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    icono VARCHAR(30) DEFAULT 'restaurant',
    orden INT DEFAULT 0,
    clave_sat VARCHAR(10),
    destino_impresion destino_impresion_enum NOT NULL DEFAULT 'COCINA'
);

CREATE TABLE promociones (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    codigo VARCHAR(30) UNIQUE,
    tipo VARCHAR(20) NOT NULL,
    valor NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    categoria_id INT NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
    promocion_id INT REFERENCES promociones(id) ON DELETE SET NULL,
    nombre VARCHAR(100) NOT NULL,
    precio NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
    clave_sat VARCHAR(10),
    imagen_url TEXT,
    disponible BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comandas (
    id SERIAL PRIMARY KEY,
    mesa_id INT REFERENCES mesas(id) ON DELETE RESTRICT,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    cliente_id INT REFERENCES clientes(id) ON DELETE SET NULL,
    tipo_origen VARCHAR(20) NOT NULL DEFAULT 'MESA',
    folio_origen VARCHAR(50) NOT NULL,
    estado_operativo estado_mesa_enum NOT NULL DEFAULT 'PENDIENTE',
    estado estado_comanda_enum DEFAULT 'ABIERTA',
    total NUMERIC(10, 2) DEFAULT 0.00,
    fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP
);

CREATE TABLE comanda_items (
    id SERIAL PRIMARY KEY,
    comanda_id INT NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    producto_id INT NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(10, 2) NOT NULL,
    subtotal NUMERIC(10, 2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    notas TEXT,
    estado_kds estado_item_kds_enum DEFAULT 'PENDIENTE',
    completado BOOLEAN DEFAULT FALSE,
    impreso BOOLEAN DEFAULT FALSE,
    impreso_en TIMESTAMP,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pagos (
    id SERIAL PRIMARY KEY,
    comanda_id INT NOT NULL REFERENCES comandas(id) ON DELETE RESTRICT,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    promocion_id INT REFERENCES promociones(id) ON DELETE SET NULL,
    metodo_pago metodo_pago_enum NOT NULL,
    total_cuenta NUMERIC(10, 2) NOT NULL,
    monto_recibido NUMERIC(10, 2) NOT NULL,
    cambio NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    descuento NUMERIC(10, 2) DEFAULT 0.00,
    dividir_cuenta BOOLEAN DEFAULT FALSE,
    partes_iguales INT DEFAULT 1,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cortes_caja (
    id SERIAL PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fondo_apertura NUMERIC(10, 2) DEFAULT 0.00,
    efectivo_real NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    efectivo_calculado NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    tarjeta_calculado NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    transferencia_calculado NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    ventas_totales NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    diferencia NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    notas TEXT
);

-- 5. HARDWARE Y FACTURACIÓN
CREATE TABLE impresoras (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    destino destino_impresion_enum NOT NULL,
    tipo VARCHAR(20) NOT NULL DEFAULT 'RED',
    ip_o_puerto VARCHAR(100) NOT NULL,
    puerto_tcp INT DEFAULT 9100,
    ancho_papel VARCHAR(10) NOT NULL DEFAULT '80mm',
    es_termica BOOLEAN NOT NULL DEFAULT FALSE,
    corte_tipo VARCHAR(20) NOT NULL DEFAULT 'NINGUNO',
    activa BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE configuracion_facturacion (
    id SERIAL PRIMARY KEY,
    api_key_test VARCHAR(255) NOT NULL,
    api_key_live VARCHAR(255),
    modo_produccion BOOLEAN DEFAULT FALSE,
    rfc_emisor VARCHAR(13) NOT NULL,
    razon_social VARCHAR(255) NOT NULL,
    regimen_fiscal VARCHAR(5) NOT NULL,
    codigo_postal VARCHAR(5) NOT NULL,
    clave_sat_defecto VARCHAR(10) DEFAULT '01010101',
    email_notificaciones VARCHAR(150),
    dias_vigencia_ticket INT DEFAULT 7,
    tiene_csd BOOLEAN DEFAULT FALSE,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tickets_autofactura (
    id SERIAL PRIMARY KEY,
    pago_id INT NOT NULL REFERENCES pagos(id) ON DELETE RESTRICT,
    facturapi_receipt_id VARCHAR(100) NOT NULL UNIQUE,
    codigo_ticket VARCHAR(20) NOT NULL UNIQUE,
    url_autofactura TEXT NOT NULL,
    total NUMERIC(10, 2) NOT NULL,
    estado estado_factura_enum DEFAULT 'PENDIENTE',
    fecha_expiracion TIMESTAMP NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE facturas (
    id SERIAL PRIMARY KEY,
    ticket_id INT REFERENCES tickets_autofactura(id) ON DELETE SET NULL,
    facturapi_invoice_id VARCHAR(100) UNIQUE,
    uuid_sat VARCHAR(36) NOT NULL UNIQUE,
    rfc_receptor VARCHAR(13) NOT NULL,
    razon_social_receptor VARCHAR(255) NOT NULL,
    regimen_fiscal_receptor VARCHAR(5) NOT NULL,
    codigo_postal_receptor VARCHAR(5) NOT NULL,
    uso_cfdi VARCHAR(5) NOT NULL,
    total NUMERIC(10, 2),
    estado VARCHAR(20) DEFAULT 'active',
    url_pdf TEXT,
    url_xml TEXT,
    fecha_timbrado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. ÍNDICES DE ALTO RENDIMIENTO
CREATE INDEX idx_mesas_estado ON mesas(estado);
CREATE INDEX idx_comandas_mesa ON comandas(mesa_id) WHERE estado = 'ABIERTA';
CREATE UNIQUE INDEX IF NOT EXISTS idx_comandas_unica_mesa_abierta ON comandas(mesa_id) WHERE estado = 'ABIERTA' AND mesa_id IS NOT NULL;
CREATE INDEX idx_comandas_origen_estado ON comandas(tipo_origen, estado, fecha_apertura DESC);
CREATE INDEX idx_comandas_folio_origen ON comandas(folio_origen);
CREATE INDEX idx_comanda_items_kds ON comanda_items(completado) WHERE completado = FALSE;
CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_tickets_codigo ON tickets_autofactura(codigo_ticket);
CREATE INDEX idx_tickets_estado ON tickets_autofactura(estado);
CREATE INDEX idx_facturas_uuid ON facturas(uuid_sat);
CREATE INDEX idx_facturas_rfc_receptor ON facturas(rfc_receptor);
