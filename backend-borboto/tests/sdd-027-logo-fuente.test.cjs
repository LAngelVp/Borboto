const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = text => transformSync(text, { loader: 'ts', target: 'node18', format: 'cjs' }).code;

function templatesModule() {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/modules/printer/templates/ticket-templates.ts')), {
    module,
    exports: module.exports,
    console: { log() {}, error() {} },
  });
  return module.exports;
}

function printerModule(pool) {
  const template = templatesModule();
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/modules/printer/printer.service.ts')), {
    module,
    exports: module.exports,
    console: { log() {}, error() {} },
    Buffer,
    process,
    setTimeout,
    require(name) {
      if (name.endsWith('/db.ts')) return { pool };
      if (name.includes('ticket-templates')) return template;
      if (name === 'jimp') return require('jimp');
      return {};
    },
  });
  return module.exports;
}

test('SDD-027: migracion 011 agrega logo, interruptor y tamano de fuente', () => {
  const migration = read('Database/migrations/011_logo_ticket_y_fuente_produccion.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS logo_url TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS imprimir_logo BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS tamano_fuente VARCHAR\(20\) NOT NULL DEFAULT 'NORMAL'/);
  for (const valor of ['NORMAL', 'DOBLE_ALTO', 'DOBLE_ANCHO', 'DOBLE']) {
    assert.ok(migration.includes(`'${valor}'`));
  }
});

test('SDD-027: produccion reduce columnas cuando la fuente es doble ancho', () => {
  const { generarTemplateProduccion } = templatesModule();
  const datos = {
    folioComanda: 10,
    mesa: '5',
    zona: 'Salón',
    atendidoPor: 'Ana',
    fecha: '01/01/2026 10:00',
    items: [{ cantidad: 1, nombre: 'Producto con nombre muy largo para prueba' }],
  };
  const normal = generarTemplateProduccion(datos, 'COCINA', '80mm', 'NORMAL');
  const doble = generarTemplateProduccion(datos, 'COCINA', '80mm', 'DOBLE_ANCHO');
  const maxLinea = texto => Math.max(...texto.split('\n').map(linea => linea.length));
  assert.ok(maxLinea(normal) <= 42);
  assert.ok(maxLinea(doble) <= 21);
  assert.ok(doble.includes('COMANDA'));
});

test('SDD-027: ESC/POS aplica tamano de fuente, corte y logotipo raster', async () => {
  const { PrinterService } = printerModule({ query: async () => ({ rows: [] }) });
  const buffer = PrinterService.construirBufferTermico('HOLA', '80mm', 'TOTAL', { fontSize: 'DOBLE' });
  assert.ok(buffer.includes(Buffer.from([0x1d, 0x21, 0x30])));
  assert.ok(buffer.includes(Buffer.from([0x1d, 0x56, 0x41, 0x10])));

  // PNG 1x1 transparente válido.
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const logo = await PrinterService.construirLogoDesdeDataUrl(`data:image/png;base64,${png1x1}`, '58mm');
  assert.ok(Buffer.isBuffer(logo));
  assert.ok(logo.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00])));
});

test('SDD-027: carga de logo valida PNG/JPG, 2 MB y persiste en datos_negocio', () => {
  const backend = read('backend-borboto/index.ts');
  assert.match(backend, /const uploadLogo = multer/);
  assert.match(backend, /fileSize: 2 \* 1024 \* 1024/);
  assert.match(backend, /\['image\/png', 'image\/jpeg'\]/);
  assert.match(backend, /app\.post\('\/api\/ajustes\/negocio\/logo'/);
  assert.match(backend, /app\.delete\('\/api\/ajustes\/negocio\/logo'/);
  assert.match(backend, /logo_url = COALESCE\(\$10, datos_negocio\.logo_url\)/);
  assert.match(backend, /imprimir_logo = \$11/);
});

test('SDD-027: configuracion de impresora acepta y normaliza tamano_fuente', () => {
  const routes = read('backend-borboto/src/modules/printer/printer.routes.ts');
  assert.match(routes, /TAMANOS_FUENTE = \['NORMAL', 'DOBLE_ALTO', 'DOBLE_ANCHO', 'DOBLE'\]/);
  assert.match(routes, /normalizarFuente\(tamano_fuente\)/);
  assert.match(routes, /INSERT INTO impresoras .*tamano_fuente/s);
  assert.match(routes, /SET .*tamano_fuente = \$10/s);
});

test('SDD-027: USB transporta logo y fuente al HTML de Electron', () => {
  const main = read('main.js');
  assert.match(main, /function buildTicketHtml\(\{ content, title = 'Ticket', anchoPapel = '80mm', fontSize = 'NORMAL', logoDataUrl \}\)/);
  assert.match(main, /class="ticket-logo"/);
  assert.match(main, /const \{ printerName, content, title, anchoPapel, fontSize, logoDataUrl \} = payload/);
  const backend = read('backend-borboto/src/modules/printer/printer.service.ts');
  assert.match(backend, /logoDataUrl: datosEmpresa\.imprimirLogo/);
  assert.match(backend, /fontSize: impresora\.tamano_fuente \|\| 'NORMAL'/);
});
