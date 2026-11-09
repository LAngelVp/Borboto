const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = text => transformSync(text, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
const backend = read('backend-borboto/index.ts');

test('SDD-023: categorias importadas normalizadas, dinamicas y evento Material change filtran productos', () => {
  const service = frontend('src/app/core/services/comanda.ts', 'ComandaService', {});
  service.productos.set([
    { id: 1, nombre: 'Agua', precio: 10, categoria: ' Bebidas ' },
    { id: 2, nombre: 'Cafe', precio: 20, categoria: '\u00a0bebidas\u00a0' },
    { id: 3, nombre: 'Pan', precio: 5, categoria: { nombre: ' Panaderia ' } },
    { id: 4, nombre: 'Sin categoria', precio: 0, categoria: null },
  ]);
  assert.deepEqual(Array.from(service.categoriasDisponibles()), ['TODOS', 'Bebidas', 'Panaderia']);
  const component = frontend('src/app/features/comanda/components/menu-productos/menu-productos.ts', 'MenuProductosComponent', { ComandaService: service });
  component.onCategoriaChange({ value: ' BEBIDAS ' });
  assert.equal(service.categoriaSeleccionada(), 'Bebidas');
  assert.deepEqual(Array.from(service.productosFiltrados(), product => product.id), [1, 2]);
  component.onCategoriaChange({ value: 'Panaderia' });
  assert.deepEqual(Array.from(service.productosFiltrados(), product => product.id), [3]);
  component.onCategoriaChange({ value: undefined });
  assert.equal(service.productosFiltrados().length, 4);
  service.productos.set([...service.productos(), { id: 5, categoria: 'Postres', nombre: 'Flan', precio: 15 }]);
  component.onCategoriaChange({ value: ' postres ' });
  assert.deepEqual(Array.from(service.productosFiltrados(), product => product.id), [5]);
  const html = read('src/app/features/comanda/components/menu-productos/menu-productos.html');
  assert.ok(html.includes('(change)="onCategoriaChange($event)"'));
  assert.ok(html.includes('comandaService.productosFiltrados()'));
  assert.ok(html.includes('(selectionChange)') === false);
});

test('SDD-023: importacion busca categoria trim y usa General cuando nombre esta vacio', async () => {
  for (const [categoria, expected] of [[' Bebidas ', 'Bebidas'], ['   ', 'General']]) {
    const result = await run('/api/productos/importar-lote', { productos: [{ nombre: 'Cafe', precio: 10, categoria }] }, sql => ({ rows: sql.includes('SELECT id FROM categorias') ? [{ id: 1 }] : [] }));
    assert.equal(result.res.code, 201);
    const lookup = result.log.find(entry => entry.sql.includes('FROM categorias'));
    assert.ok(lookup.sql.includes('LOWER(BTRIM(nombre))'));
    assert.equal(lookup.params[0], expected);
  }
});

test('SDD-023: ultimo check permanece en PREPARANDO/PENDIENTE y LISTO hasta despacho confirmado', () => {
  for (const filtro of ['PREPARANDO', 'PENDIENTE']) {
    const writes = [];
    const service = frontend('src/app/core/services/cocina.ts', 'CocinaService', {
      HttpClient: {
        patch() { return { subscribe(observer) { writes.push(observer); } }; },
        post() { return { subscribe(observer) { writes.push(observer); } }; },
      }, RuntimeConfigService: { apiBaseUrl: '/api' },
    });
    service.filtroEstado.set(filtro);
    service.tickets.set([{ id: 1, estado: 'PREPARANDO', items: [{ id: 3, completado: true }, { id: 4, completado: false }] }]);
    service.toggleItemCompletado(1, 4);
    assert.equal(service.tickets()[0].estado, 'LISTO');
    assert.equal(service.ticketsFiltrados().length, 1);
    assert.equal(service.contadores().listos, 1);
    writes[0].error(new Error('offline'));
    assert.equal(service.ticketsFiltrados().length, 1);
    assert.equal(service.tickets()[0].estado, 'PREPARANDO');
    service.toggleItemCompletado(1, 4);
    writes[1].next({ ok: true });
    service.filtroEstado.set('LISTO');
    assert.equal(service.ticketsFiltrados().length, 1);
    service.marcarTicketListo(1);
    assert.equal(service.ticketsFiltrados().length, 1);
    writes[2].next({ ok: true });
    assert.equal(service.ticketsFiltrados().length, 0);
    assert.equal(service.contadores().listos, 0);
  }
});

test('SDD-023: vistas compactas y contadores de activos no dependen de listas filtradas', () => {
  const rows = [
    { id: 1, estado: 'EN COCINA' }, { id: 2, estado: 'DISPONIBLE' },
    { id: -3, tipoOrigen: 'MOSTRADOR', estado: 'LISTO PARA SERVIR' },
    { id: -4, tipoOrigen: 'MOSTRADOR', estado: 'DISPONIBLE' },
    { id: -5, tipoOrigen: 'ENVIO', estado: 'SERVIDO' },
  ];
  const component = frontend('src/app/features/mesas/mesas.ts', 'MesasComponent', { MesaService: { mesas: () => rows } });
  assert.equal(component.contadoresActivos().MESAS, 1);
  assert.equal(component.contadoresActivos().MOSTRADOR, 1);
  assert.equal(component.contadoresActivos().DOMICILIO, 1);
  component.seleccionarVista('DOMICILIO');
  assert.equal(component.vistaCompacta(), 'DOMICILIO');
  assert.equal(component.vistaEspecial(), 'DOMICILIO');
  component.seleccionarVista('MESAS');
  assert.equal(component.vistaCompacta(), 'MESAS');
  const css = read('src/app/features/mesas/mesas.scss');
  assert.ok(css.includes('@media (width < 1200px)'));
  assert.ok(css.includes(".mesas-page:not([data-vista='MESAS']) .mesas-sec"));
  assert.ok(css.includes('minmax(min(300px, 100%), 1fr)'));
  const card = read('src/app/features/mesas/components/mesa-card/mesa-card.scss');
  assert.ok(card.includes('grid-template-columns: repeat(auto-fit'));
  assert.ok(card.includes('height: 240px') === false);
  assert.ok(card.includes('max-width: 100%'));
});

test('PostgreSQL portable initializes outside the installation directory and retries an empty cluster', () => {
  const main = read('main.js');
  const start = main.indexOf('function setupAndStartPostgres()');
  const end = main.indexOf('function waitForPostgres', start);
  for (const initialized of [false, true]) {
    let cleaned = false;
    const calls = [];
    const temporaryDirectory = path.join('user-temp', 'borboto-pg-test');
    vm.runInNewContext(main.slice(start, end) + 'setupAndStartPostgres();', {
      path, dataPath: 'user-data', binPath: 'read-only-install', logPath: 'user-data/logfile',
      DB_USER: 'test', DB_PASS: 'test', DB_PORT: 58432,
      app: { getPath: () => 'user-temp' },
      console: { log() {}, error() {} },
      fs: {
        existsSync(file) { assert.equal(file, path.join('user-data', 'PG_VERSION')); return initialized; },
        mkdirSync() {},
        mkdtempSync: () => temporaryDirectory,
        writeFileSync(file) { assert.equal(path.dirname(file), temporaryDirectory); },
        rmSync() { cleaned = true; },
      },
      execFileSync(executable, args, options) {
        calls.push({ executable, args });
        if (args.includes('start')) assert.equal(options.stdio, 'ignore');
        if (args.includes('status')) throw new Error('not running');
      },
    });
    assert.equal(calls.filter(call => call.executable.endsWith('initdb.exe')).length, initialized ? 0 : 1);
    assert.equal(cleaned, !initialized);
    assert.ok(calls.some(call => call.args.includes('start')));
  }
});

test('Windows package includes SQL resources at the production lookup location', () => {
  const configuration = JSON.parse(read('package.json'));
  assert.ok(configuration.build.extraResources.some(resource => resource.from === 'Database' && resource.to === 'Database'));
  assert.ok(configuration.build.extraResources.some(resource => resource.to === 'postgres-bin'));
});

function fiscalModule(pool) {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/services/fiscal-receipts.service.ts')), {
    module, exports: module.exports,
    require(name) { assert.equal(name, '../db'); return { pool }; },
  });
  return module.exports;
}

function fiscalFixture(options = {}) {
  const attempts = new Map();
  const tickets = new Map();
  const remotes = [];
  const log = [];
  const locks = new Map();
  let creates = 0;
  const pool = {
    async query(sql) {
      assert.match(sql, /SELECT pago_id FROM intentos_autofactura/);
      return { rows: [...attempts].filter(([, attempt]) => attempt.estado !== 'CONFIRMADO').map(([pago_id]) => ({ pago_id })) };
    },
    async connect() {
      let unlock;
      return {
        async query(sql, params = []) {
          log.push({ sql, params });
          const pagoId = params[0];
          if (sql.includes('pg_advisory_lock(')) {
            const key = params[1];
            const prior = locks.get(key) ?? Promise.resolve();
            const gate = new Promise(resolve => { unlock = resolve; });
            locks.set(key, prior.then(() => gate));
            await prior;
            return { rows: [] };
          }
          if (sql.includes('pg_advisory_unlock(')) { unlock?.(); return { rows: [] }; }
          if (sql.startsWith('SELECT codigo_ticket')) return { rows: tickets.has(pagoId) ? [tickets.get(pagoId)] : [] };
          if (sql.startsWith('SELECT total_cuenta')) return { rows: options.missingPago ? [] : [{ total_cuenta: '80.00', metodo_pago: 'EFECTIVO' }] };
          if (sql.startsWith('INSERT INTO intentos_autofactura')) {
            if (!attempts.has(pagoId)) attempts.set(pagoId, { estado: 'PENDIENTE', solicitud: JSON.parse(params[1]), fecha_expiracion: new Date(params[2]) });
            return { rows: [] };
          }
          if (sql.startsWith('SELECT estado, solicitud')) return { rows: attempts.has(pagoId) ? [{ ...attempts.get(pagoId) }] : [] };
          if (sql.includes('UPDATE intentos_autofactura')) {
            const attempt = attempts.get(pagoId);
            if (attempt) {
              if (sql.includes('CASE WHEN estado')) {
                if (attempt.estado !== 'PENDIENTE') attempt.estado = 'RECONCILIAR';
                attempt.error_generico = 'Operacion fiscal pendiente de conciliacion';
              } else if (sql.includes("estado = 'CONFIRMADO'")) { attempt.estado = 'CONFIRMADO'; attempt.error_generico = null; }
              else if (sql.includes("estado = 'EMITIENDO'")) attempt.estado = 'EMITIENDO';
              else if (sql.includes("estado = 'RECONCILIAR'")) { attempt.estado = 'RECONCILIAR'; attempt.facturapi_receipt_id = params[1]; }
            }
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO tickets_autofactura')) {
            assert.match(sql, /ON CONFLICT \(facturapi_receipt_id\) DO UPDATE/);
            assert.match(sql, /WHERE tickets_autofactura.pago_id = EXCLUDED.pago_id/);
            if (options.failInsert) { options.failInsert = false; throw new Error('mock INSERT failure'); }
            const ticket = { pago_id: pagoId, codigo_ticket: params[2], url_autofactura: params[3], fecha_expiracion: new Date(params[5]) };
            tickets.set(pagoId, ticket);
            return { rows: [ticket] };
          }
          throw new Error('SQL inesperado: ' + sql);
        },
        release(error) { log.push({ sql: 'RELEASE', error }); },
      };
    },
  };
  const provider = { receipts: {
    async list(params) {
      log.push({ sql: 'REMOTE_LIST', params });
      if (options.listFails) throw new Error('mock provider offline');
      const noise = { id: 'foreign', key: 'foreign', self_invoice_url: 'https://example.test/foreign', external_id: '10' };
      return { data: options.invisible ? [] : [noise, ...remotes], total_pages: 1 };
    },
    async create(params) {
      assert.ok(log.some(entry => entry.sql === 'REMOTE_LIST'));
      assert.equal(attempts.get(Number(params.external_id)).estado, 'EMITIENDO');
      log.push({ sql: 'REMOTE_CREATE', params });
      creates++;
      const receipt = { id: 'receipt-' + params.external_id, key: 'code-' + params.external_id, external_id: params.external_id,
        self_invoice_url: 'https://example.test/receipt/' + params.external_id, total: 80, created_at: new Date().toISOString() };
      remotes.push(receipt);
      if (options.throwAfterCreate) { options.throwAfterCreate = false; throw new Error('mock response lost'); }
      return receipt;
    },
  } };
  return { pool, provider, attempts, tickets, remotes, log, options, get creates() { return creates; }, reload: () => fiscalModule(pool) };
}

test('SDD-017 durable: fallo local tras receipt remoto se recupera por external_id sin duplicar create', async () => {
  const fixture = fiscalFixture({ failInsert: true });
  const first = fixture.reload();
  await assert.rejects(() => first.emitirORecuperarRecibo(1, fixture.provider, { payment_form: '01', items: [{ quantity: 1, product: { price: 80 } }] }, 3), error => error.status === 503);
  assert.equal(fixture.creates, 1);
  assert.equal(fixture.tickets.size, 0);
  assert.equal(fixture.attempts.get(1).estado, 'RECONCILIAR');
  assert.equal(fixture.attempts.get(1).facturapi_receipt_id, 'receipt-1');
  assert.ok(fixture.attempts.get(1).error_generico);
  const expiration = fixture.attempts.get(1).fecha_expiracion.getTime();
  const restarted = fixture.reload();
  const recovered = await restarted.emitirORecuperarRecibo(1, fixture.provider, undefined, 30);
  assert.equal(recovered.codigo, 'code-1');
  assert.ok(new Date(recovered.expiracion).getTime() <= expiration);
  assert.equal(fixture.creates, 1);
  assert.equal(fixture.tickets.size, 1);
  assert.equal(fixture.attempts.get(1).estado, 'CONFIRMADO');
  const requests = fixture.log.filter(entry => entry.sql === 'REMOTE_LIST').length;
  await restarted.emitirORecuperarRecibo(1, fixture.provider);
  assert.equal(fixture.log.filter(entry => entry.sql === 'REMOTE_LIST').length, requests);
  assert.equal(fixture.log.filter(entry => entry.sql === 'REMOTE_CREATE')[0].params.external_id, '1');
});

test('SDD-017 durable: concurrencia por pago y respuesta remota perdida conservan una sola creacion', async () => {
  const concurrent = fiscalFixture();
  await Promise.all([concurrent.reload().emitirORecuperarRecibo(1, concurrent.provider), concurrent.reload().emitirORecuperarRecibo(1, concurrent.provider)]);
  assert.equal(concurrent.creates, 1);
  assert.equal(concurrent.tickets.size, 1);
  const lost = fiscalFixture({ throwAfterCreate: true });
  await assert.rejects(() => lost.reload().emitirORecuperarRecibo(1, lost.provider));
  assert.equal(lost.attempts.get(1).estado, 'RECONCILIAR');
  const result = await lost.reload().reconciliarRecibosPendientes(lost.provider);
  assert.equal(result.recuperados, 1);
  assert.equal(result.pendientes, 0);
  assert.equal(lost.creates, 1);
});

test('SDD-017 durable: busqueda fallida/visibilidad tardia no autorizan crear otro recibo', async () => {
  const unavailable = fiscalFixture({ listFails: true });
  await assert.rejects(() => unavailable.reload().emitirORecuperarRecibo(1, unavailable.provider));
  assert.equal(unavailable.creates, 0);
  assert.equal(unavailable.attempts.get(1).estado, 'PENDIENTE');
  unavailable.options.listFails = false;
  await unavailable.reload().emitirORecuperarRecibo(1, unavailable.provider);
  assert.equal(unavailable.creates, 1);
  const delayed = fiscalFixture({ failInsert: true, invisible: true });
  await assert.rejects(() => delayed.reload().emitirORecuperarRecibo(1, delayed.provider));
  await assert.rejects(() => delayed.reload().emitirORecuperarRecibo(1, delayed.provider), error => error.status === 409);
  assert.equal(delayed.creates, 1);
  delayed.options.invisible = false;
  const recovered = await delayed.reload().reconciliarRecibosPendientes(delayed.provider);
  assert.equal(recovered.recuperados, 1);
  assert.equal(delayed.creates, 1);
  assert.equal(delayed.log.filter(entry => entry.sql === 'RELEASE').length, 3);
});

function frontend(file, name, injections, globals = {}) {
  function signal(initial) { let value = initial; const get = () => value; get.set = next => { value = next; }; get.update = update => { value = update(value); }; return get; }
  const tokens = new Map();
  const module = { exports: {} };
  vm.runInNewContext(compile(read(file)), {
    module, exports: module.exports, console: { log() {}, error() {} }, ...globals,
    require(dependency) {
      if (dependency === 'rxjs') return require('rxjs');
      const angular = dependency === '@angular/core' ? {
        Injectable: () => target => target, Component: () => target => target, signal, computed: derive => derive,
        inject: token => injections[token.name] ?? {}, ChangeDetectionStrategy: { OnPush: 0 },
      } : {};
      return new Proxy(angular, { get(target, property) {
        if (property === '__esModule') return undefined;
        if (property in target) return target[property];
        if (!tokens.has(property)) tokens.set(property, Object.defineProperty(function Token() {}, 'name', { value: property }));
        return tokens.get(property);
      } });
    },
  });
  return new module.exports[name]();
}

test('SDD-011: CajaService comparte pago completo, cero valido y puntos configurados', () => {
  const service = frontend('src/app/core/services/caja-service.ts', 'CajaService', {});
  service.totalCuentaOriginal.set(100);
  service.totalCuenta.set(100);
  service.numeroPartes.set(2);
  service.montoRecibido.set(50);
  assert.equal(service.pagoSuficiente(), false);
  service.montoRecibido.set(100);
  assert.equal(service.pagoSuficiente(), true);
  service.totalCuenta.set(0);
  assert.equal(service.pagoSuficiente(), true);
  service.totalCuenta.set(100);
  service.pesosPorPunto.set(20);
  service.factorPuntos.set(3);
  assert.equal(service.puntosPorGanar(), 15);
  service.totalCuentaOriginal.set(19.5);
  service.clientePuntos.set(20);
  service.canjearPuntosLealtad(20);
  assert.equal(service.descuentoAplicado(), 19.5);
  assert.equal(service.totalCuenta(), 0);
});

test('SDD-016: fechas locales y busqueda global independiente de stats', () => {
  const requests = [];
  class LocalDate extends Date { getFullYear() { return 2026; } getMonth() { return 10; } getDate() { return 9; } toISOString() { throw new Error('UTC prohibido para filtro local'); } }
  const dashboard = frontend('src/app/features/dashboard/dashboard.ts', 'DashboardComponent', {
    RuntimeConfigService: { apiBaseUrl: '/api' }, HttpClient: { get(url) { return { subscribe(observer) { requests.push({ url, observer }); } }; } },
  }, { Date: LocalDate, URLSearchParams });
  dashboard.establecerRangoPredeterminado();
  assert.equal(dashboard.fechaInicio, '2026-11-09');
  assert.match(requests[0].url, /fechaInicio=2026-11-09&fechaFin=2026-11-09/);
  dashboard.filtroFolio = 'old';
  dashboard.cargarTickets();
  assert.equal(requests[1].url.includes('fechaInicio'), false);
  requests[1].observer.next([{ folio: 'old' }]);
  requests[0].observer.next({ tickets: [{ folio: 'new' }] });
  assert.equal(dashboard.tickets()[0].folio, 'old');
});

test('SDD-013: RAW ok=false activa fallback IPC controlado', async () => {
  const calls = [];
  const service = frontend('src/app/core/services/printer.service.ts', 'PrinterService', {
    RuntimeConfigService: { apiBaseUrl: '/api' },
    HttpClient: { post() { return { subscribe(observer) { observer.next({ ok: false }); } }; } },
  }, { window: { borbotoElectron: { invoke: async channel => { calls.push(channel); } } } });
  await service.printTicketSilently({ tipo: 'USB', printerName: 'Mock', contenido: 'ticket', titulo: 'Ticket', esTermica: true, corteTipo: 'TOTAL' });
  assert.deepEqual(calls, ['print-ticket-silent']);
});

test('SDD-006: dos bootstrap bajo lock exclusivo crean solo un administrador', async () => {
  let count = 0;
  let previous = Promise.resolve();
  const results = await Promise.all([1, 2].map(async () => {
    let unlock;
    return run('/api/auth/register-first-admin', { nombre: 'Admin', pin: '1234' }, async sql => {
      if (sql.startsWith('LOCK TABLE')) {
        const prior = previous;
        const gate = new Promise(resolve => { unlock = resolve; });
        previous = prior.then(() => gate);
        await prior;
      }
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count }] };
      if (sql.startsWith('INSERT INTO usuarios')) { count++; return { rows: [{ id: 1, nombre: 'Admin', rol: 'ADMIN' }] }; }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.();
      return { rows: [] };
    }, { hashPin: () => 'hash-mock', emitirSesion: () => 'mock-session' });
  }));
  assert.deepEqual(results.map(result => result.res.code).sort(), [201, 403]);
  assert.equal(count, 1);
});

test('SDD-021: shutdown compartido drena HTTP antes de reporte y pool, una sola vez', async () => {
  const start = backend.indexOf('let tareaFiscalInicial:');
  const end = backend.indexOf('// ─── FUNCION CONTROLADA', start);
  const context = { module: { exports: {} }, io: { close(callback) { log.push('http'); callback(); } },
    enviarConteoAGoogleSheets: async () => { log.push('report'); }, pool: { end: async () => { log.push('pool'); } } };
  const log = [];
  vm.createContext(context);
  vm.runInContext(compile(backend.slice(start, end)).replace(/exports.shutdownServer = shutdownServer;/g, '') + '\nglobalThis.closeBackend = shutdownServer;', context);
  await Promise.all([context.closeBackend(), context.closeBackend()]);
  assert.deepEqual(log, ['http', 'report', 'pool']);
});

test('SDD-018: draft a UUID conserva identidad y actualiza ticket en misma transaccion', async () => {
  let uuid;
  const log = [];
  const invoice = () => ({ id: 'invoice-1', uuid, receipt: 'receipt-1', total: 80, created_at: new Date(Date.now() - 1000).toISOString(), status: 'active' });
  const client = { async query(sql, params) {
    log.push({ sql, params });
    if (sql.includes('facturapi_receipt_id =')) return { rows: [{ id: 9 }] };
    return { rows: [] };
  }, release() { log.push({ sql: 'RELEASE' }); } };
  const module = { exports: {} };
  class Facturapi { invoices = { list: async () => ({ data: [invoice()], total_pages: 1 }) }; }
  vm.runInNewContext(compile(read('backend-borboto/src/sincronizarFacturas.ts')), {
    module, exports: module.exports, Buffer,
    process: { env: {}, platform: 'win32', cwd: () => 'mock' },
    console: { log() {}, error() {} },
    require(name) {
      if (name === './db') return { pool: { connect: async () => client, query: async () => ({ rows: [{ api_key_test: 'mock' }] }) } };
      if (name === './services/fiscal-receipts.service') return { reconciliarRecibosPendientes: async () => ({ recuperados: 0, pendientes: 0 }) };
      if (name === 'facturapi') return { default: Facturapi };
      if (name === 'fs') return { existsSync: () => false };
      if (name === 'os') return { homedir: () => 'mock' };
      return require(name);
    },
  });
  assert.equal((await module.exports.realizarSincronizacionFacturas()).ok, true);
  uuid = 'uuid-final';
  assert.equal((await module.exports.realizarSincronizacionFacturas()).ok, true);
  const inserts = log.filter(entry => entry.sql.includes('INSERT INTO facturas'));
  assert.equal(inserts[0].params[2], 'DRAFT_invoice-1');
  assert.equal(inserts[1].params[2], 'uuid-final');
  assert.equal(inserts[0].params[0], 9);
  assert.equal(log.filter(entry => entry.sql === 'COMMIT').length, 2);
  assert.equal(log.filter(entry => entry.sql.startsWith('UPDATE facturas SET uuid_sat')).length, 2);
  assert.ok(log.every(entry => /WHERE total =/.test(entry.sql) === false));
});

test('SDD-007: migracion retiene el mismo client y libera en exito/fallo', async () => {
  const text = read('backend-borboto/src/db.ts');
  const fragment = text.slice(text.indexOf('async function applySqlMigration('), text.indexOf('export async function sincronizarCombos'));
  for (const fail of [false, true]) {
    const log = [];
    const client = { async query(sql) {
      log.push(sql);
      if (sql === 'SQL-MOCK' && fail) throw new Error('migration failure');
      return { rows: [] };
    }, release() { log.push('RELEASE'); } };
    const context = { fs: { readFileSync: () => 'SQL-MOCK' }, console: { log() {}, error() {} } };
    vm.createContext(context);
    vm.runInContext(compile(fragment) + '\nglobalThis.migrate = applySqlMigration;', context);
    const promise = context.migrate({ connect: async () => client, query() { throw new Error('Pool query prohibido en migracion'); } }, 'test', 'mock.sql');
    if (fail) await assert.rejects(promise); else await promise;
    assert.equal(log[0], 'BEGIN');
    assert.equal(log.at(-2), fail ? 'ROLLBACK' : 'COMMIT');
    assert.equal(log.at(-1), 'RELEASE');
  }
});

test('SDD-020: preload allowlist, runtime puerto y evento sin objeto Electron', async () => {
  const exposed = {};
  let listener;
  const calls = [];
  vm.runInNewContext(read('preload.js'), {
    process: { argv: ['--borboto-port=4321'] },
    require: () => ({ contextBridge: { exposeInMainWorld(name, value) { exposed[name] = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); }, on(_channel, callback) { listener = callback; }, removeListener() {}, once() {}, send() {} } }),
  });
  assert.equal(exposed.__BORBOTO_RUNTIME_CONFIG__.apiBaseUrl, 'http://127.0.0.1:4321/api');
  const api = exposed.borbotoElectron;
  await assert.rejects(() => api.invoke('arbitrary-channel'));
  await assert.rejects(() => api.invoke('print-ticket-silent', { content: 'ticket' }));
  await api.invoke('print-ticket-silent', { printerName: 'Mock', content: 'ticket' });
  assert.equal(calls.length, 1);
  let eventValue;
  api.on('app-notification', event => { eventValue = event; });
  listener({ privileged: true }, { message: 'test' });
  assert.equal(eventValue, undefined);
});

test('SDD-021: licencia rechaza objeto/fecha invalidos sin ejecutar Electron', () => {
  const text = read('main.js');
  const fragment = text.slice(text.indexOf('function validarLicencia('), text.indexOf('// ─── HANDLERS IPC'));
  const context = { getPublicKeyPath: () => 'mock', fs: { readFileSync: () => 'mock-key' }, Buffer,
    crypto: { createVerify: () => ({ update() {}, verify: () => true }) }, getHardwareId: () => 'mock' };
  vm.createContext(context);
  vm.runInContext(fragment + '\nglobalThis.validate = validarLicencia;', context);
  for (const payload of [null, [], {}, { vencimiento: 'invalid' }, { vencimiento: '2099-02-30' }, { vencimiento: '2099-13-01' }]) {
    assert.equal(context.validate(Buffer.from(JSON.stringify(payload)).toString('base64') + '.mock-signature').valida, false);
  }
  assert.equal(context.validate(Buffer.from(JSON.stringify({ vencimiento: '2099-12-31', hardware_id: 'mock' })).toString('base64') + '.mock-signature').valida, true);
});

test('SDD-019: Sheets oculta token incluso en respuesta y limpia timeout tras error', async () => {
  for (const mode of ['success', 'fetch-error', 'sql-error']) {
    const module = { exports: {} };
    const logs = [];
    let cleared = 0;
    let fetched = 0;
    vm.runInNewContext(compile(read('backend-borboto/src/services/reporteFacturas.service.ts')), {
      module, exports: module.exports, URL, AbortController, Buffer,
      process: { env: { GOOGLE_SHEET_TOKEN: 'test-secret', HARDWARE_ID: 'mock', NOMBRE_NEGOCIO: 'mock' } },
      console: { log(...args) { logs.push(args.join(' ')); }, warn(...args) { logs.push(args.join(' ')); }, error() {} },
      setTimeout: () => 1, clearTimeout: () => { cleared++; },
      fetch: async () => { fetched++; if (mode === 'fetch-error') throw new Error('token=test-secret'); return { ok: true, status: 200, text: async () => 'test-secret' }; },
      require(name) { return name === '../db' ? { pool: { query: async () => { if (mode === 'sql-error') throw new Error('SQL failure'); return { rows: [{ count: 3 }] }; } } } : require(name); },
    });
    const result = await module.exports.enviarConteoAGoogleSheets();
    assert.equal(JSON.stringify(result).includes('test-secret'), false);
    assert.equal(logs.join(' ').includes('test-secret'), false);
    assert.equal(result.success, mode === 'success');
    assert.equal(fetched, mode === 'sql-error' ? 0 : 1);
    assert.equal(cleared, mode === 'sql-error' ? 0 : 1);
  }
});

function sessionModule() {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/session.ts')), { module, exports: module.exports, require, Buffer });
  return module.exports;
}

test('SDD-005/006: sesion firmada y PIN legado/hash compatibles', () => {
  const security = sessionModule();
  const token = security.emitirSesion(7, 'CAJERO');
  assert.equal(security.verificarSesion(token).id, 7);
  assert.equal(security.verificarSesion(token + 'tampered'), null);
  assert.equal(security.verificarSesion(''), null);
  const hash = security.hashPin('1234');
  assert.equal(security.verificarPin('1234', hash), true);
  assert.equal(security.verificarPin('1234', '1234'), true);
  assert.equal(security.verificarPin('9999', hash), false);
});

test('SDD-005: middleware sensible exige sesion y rol antes de SQL', async () => {
  const security = sessionModule();
  const start = backend.indexOf("app.use('/api', async");
  const end = backend.indexOf('\n});', start) + 4;
  let callback;
  let queries = 0;
  vm.runInNewContext(compile(backend.slice(start, end)), {
    app: { use(_path, handler) { callback = handler; } }, verificarSesion: security.verificarSesion,
    pool: { query: async () => { queries++; return { rows: [{ activo: true, rol: 'ADMIN' }] }; } },
  });
  const request = { method: 'POST', path: '/ajustes/negocio', headers: {}, body: {} };
  const res = { code: 200, status(code) { this.code = code; return this; }, json() {} };
  await callback(request, res, () => {});
  assert.equal(res.code, 401);
  assert.equal(queries, 0);
  request.headers.authorization = 'Bearer ' + security.emitirSesion(7, 'MESERO');
  await callback(request, res, () => {});
  assert.equal(res.code, 403);
  assert.equal(queries, 0);
  request.headers.authorization = 'Bearer ' + security.emitirSesion(7, 'ADMIN');
  let passed = false;
  await callback(request, res, () => { passed = true; });
  assert.equal(passed, true);
});

function printerModule(pool) {
  const template = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/modules/printer/templates/ticket-templates.ts')), { module: template, exports: template.exports });
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/modules/printer/printer.service.ts')), {
    module, exports: module.exports, console: { log() {}, error() {} },
    require(name) {
      if (name.endsWith('/db.ts')) return { pool };
      if (name.includes('ticket-templates')) return template.exports;
      return {};
    },
  });
  return module.exports;
}

test('SDD-013: produccion marca RED exitosa y conserva USB pendiente con itemIds', async () => {
  for (const mode of ['absent', 'fallback', 'RED', 'USB']) {
    const log = [];
    let impreso = false;
    const client = { async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('SET impreso = TRUE') && params[0].includes(3)) impreso = true;
      if (sql.includes('FROM comandas')) return { rows: [{ folio_comanda: 1, atendido_por: 'Caja', fecha: 'hoy' }] };
      if (sql.includes('FROM comanda_items')) return { rows: [{ id: 3, cantidad: 1, nombre: 'Cafe', destino_impresion: 'COCINA' }] };
      return { rows: [] };
    }, release() {} };
    const { PrinterService } = printerModule({ connect: async () => client });
    PrinterService.obtenerImpresorasPorDestino = async () => mode === 'absent' ? [] : [{ tipo: mode === 'USB' ? 'USB' : 'RED', nombre: 'Test', activa: true }];
    PrinterService.enviarDirectoAImpresora = async () => mode === 'fallback' ? 'texto fallback' : null;
    const result = await PrinterService.imprimirComandaProduccion(1);
    assert.equal(result.ok, true);
    const update = log.find(entry => entry.sql.includes('SET impreso = TRUE'));
    assert.equal(update?.params[0].length ?? 0, mode === 'RED' ? 1 : 0);
    assert.equal(impreso, mode === 'RED');
    if (mode === 'USB') assert.deepEqual(Array.from(result.impresionesPendientes[0].itemIds), [3]);
    assert.ok(log.some(entry => entry.sql.includes('SKIP LOCKED')));
  }
});

test('SDD-013: pago ausente devuelve error 404, no exito vacio', async () => {
  const { PrinterService } = printerModule({ query: async () => ({ rows: [] }) });
  PrinterService.obtenerImpresorasPorDestino = async () => [];
  await assert.rejects(() => PrinterService.imprimirTicketCobro(999), error => error.status === 404 && error.message === 'Pago no encontrado');
});

async function run(route, body, resolve, extra = {}) {
  const start = backend.indexOf(`app.post('${route}',`);
  const end = backend.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const log = [];
  const client = { async query(sql, params) { log.push({ sql, params }); return resolve(sql, params); }, release() { log.push({ sql: 'RELEASE' }); } };
  let callback;
  vm.runInNewContext(compile(backend.slice(start, end)), {
    app: { post(_route, handler) { callback = handler; } }, pool: { connect: async () => client, query: (sql, params) => resolve(sql, params) },
    emitirCambioGlobal() {}, enviarConteoAGoogleSheets: async () => {},
    PrinterService: { imprimirTicketCobro: async () => null }, console: { log() {}, error() {}, warn() {} }, ...extra,
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await callback({ body, params: { id: '1', pagoId: '1' } }, res);
  return { res, log };
}

test('SDD-011: cuota informativa no liquida venta completa', async () => {
  const result = await run('/api/caja/cobrar', { comandaId: 1, metodoPago: 'EFECTIVO', montoRecibido: 50, dividirCuenta: true, partesIguales: 2 }, sql => {
    if (sql.includes('FROM comandas')) return { rows: [{ id: 1, mesa_id: null, estado: 'ABIERTA', total: 100 }] };
    if (sql.includes('SUM(subtotal)')) return { rows: [{ subtotal: 100 }] };
    return { rows: [] };
  });
  assert.equal(result.res.code, 400);
  assert.ok(result.log.some(entry => entry.sql === 'ROLLBACK'));
  assert.ok(result.log.every(entry => entry.sql.startsWith('INSERT INTO pagos') === false));
});

test('SDD-012: corte ignora sumas cliente y calcula diferencia desde pagos', async () => {
  const result = await run('/api/caja/corte', { usuarioId: 1, fondoApertura: 10, efectivoReal: 110, efectivoCalculado: 999, ventasTotales: 999 }, sql => {
    if (sql.includes('AS cantidad')) return { rows: [{ cantidad: 2, apertura: '2026-11-09', efectivo: 100, tarjeta: 20, transferencia: 30, ventas: 150 }] };
    if (sql.includes('INSERT INTO cortes_caja')) return { rows: [{ id: 1 }] };
    return { rows: [] };
  });
  assert.equal(result.res.code, 200);
  const insert = result.log.find(entry => entry.sql.includes('INSERT INTO cortes_caja'));
  assert.deepEqual(Array.from(insert.params).slice(4, 9), [100, 20, 30, 150, 0]);
  assert.ok(result.log[1].sql.includes('pg_advisory_xact_lock'));
});

test('SDD-012: sin pagos nuevos no duplica corte', async () => {
  const result = await run('/api/caja/corte', { usuarioId: 1 }, sql => ({ rows: sql.includes('AS cantidad') ? [{ cantidad: 0 }] : [] }));
  assert.equal(result.res.code, 409);
  assert.ok(result.log.every(entry => entry.sql.includes('INSERT INTO cortes_caja') === false));
});

test('SDD-015: fallo de sync revierte promocion en mismo client', async () => {
  const result = await run('/api/promociones', { nombre: 'Combo', tipo: 'COMBO_PRECIO', valor: 10 }, sql => ({ rows: sql.includes('RETURNING') ? [{ id: 1 }] : [] }), {
    sincronizarCombosComoProductos: async () => { throw new Error('sync failure'); },
  });
  assert.equal(result.res.code, 500);
  assert.ok(result.log.some(entry => entry.sql === 'ROLLBACK'));
  assert.ok(result.log.every(entry => entry.sql !== 'COMMIT'));
});

test('SDD-011: ticket neto/subtotal/descuento/cuota', () => {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/modules/printer/templates/ticket-templates.ts')), { module, exports: module.exports });
  const text = module.exports.generarTemplateCobro({ pagoId: 1, folioComanda: 1, zona: 'Mesa', atendidoPor: 'Caja', fecha: 'hoy', metodoPago: 'EFECTIVO', totalCuenta: 80, subtotal: 100, descuento: 20, dividirCuenta: true, partesIguales: 2, montoRecibido: 100, cambio: 20, items: [] });
  assert.match(text, /SUBTOTAL:.*100.00/);
  assert.match(text, /DESCUENTO:.*20.00/);
  assert.match(text, /TOTAL:.*80.00/);
  assert.match(text, /CUOTA INFORMATIVA:.*40.00/);
});

test('SDD-017: llamada receipt posterior a COMMIT, total neto y vigencia local', async () => {
  let committed = false;
  let receiptBody;
  const result = await run('/api/caja/cobrar', { comandaId: 1, metodoPago: 'EFECTIVO', montoRecibido: 80, descuento: 20, solicitaFactura: true, agruparConsumo: true }, sql => {
    if (sql === 'COMMIT') committed = true;
    if (sql.includes('SELECT id, mesa_id')) return { rows: [{ id: 1, mesa_id: null, estado: 'ABIERTA', total: 100 }] };
    if (sql.includes('SUM(subtotal)')) return { rows: [{ subtotal: 100 }] };
    if (sql.includes('FROM configuracion_facturacion')) return { rows: [{ api_key_test: 'mock-key', dias_vigencia_ticket: 3 }] };
    if (sql.includes('INSERT INTO pagos')) return { rows: [{ id: 1 }] };
    if (sql.includes('SELECT cliente_id')) return { rows: [{ cliente_id: null, tipoOrigen: 'MOSTRADOR' }] };
    return { rows: [] };
  }, { emitirORecuperarRecibo: async (pagoId, proveedor, solicitud, dias) => {
    const receipt = await proveedor.receipts.create({ ...solicitud, external_id: String(pagoId) });
    return { codigo: receipt.key, url: receipt.self_invoice_url, expiracion: new Date(Date.now() + dias * 86400000).toISOString() };
  }, obtenerInstanciaFacturapi: () => ({ receipts: { create: async body => {
    assert.equal(committed, true);
    receiptBody = body;
    return { id: 'receipt', key: 'code', self_invoice_url: 'https://example.test', expires_at: '2099-01-01' };
  } } }) });
  assert.equal(result.res.code, 200);
  assert.equal(receiptBody.items[0].product.price, 80);
  assert.equal(receiptBody.external_id, '1');
  assert.ok(new Date(result.res.body.autofactura.expiracion).getTime() < Date.now() + 4 * 86400000);
});

test('SDD-017: reparto proporcional mantiene suma neta exacta con cantidades y centavos', () => {
  const start = backend.indexOf('function ajustarImportesRecibo');
  const end = backend.indexOf('function enmascararApiKey', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(compile(backend.slice(start, end)) + '\nglobalThis.adjust = ajustarImportesRecibo;', context);
  const original = [{ quantity: 3, product: { price: 12.5, description: 'Cafe' } }, { quantity: 2, product: { price: 7, description: 'Pan' } }];
  for (const total of [0, 19.99, 40.01]) {
    const result = context.adjust(original, total);
    const cents = result.reduce((sum, item) => sum + item.quantity * Math.round(item.product.price * 100), 0);
    assert.equal(cents, Math.round(total * 100));
    assert.equal(result.reduce((sum, item) => sum + item.quantity, 0), 5);
  }
  assert.equal(original[0].product.price, 12.5);
});

test('SDD-013: ack de items validado e idempotente conserva fecha de primer exito', async () => {
  const queries = [];
  const { PrinterService } = printerModule({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } });
  for (const invalid of [undefined, [], [0], [-1], [1.5], ['3'], [2147483648]]) {
    await assert.rejects(() => PrinterService.confirmarItemsImpresos(invalid), error => error.status === 400);
  }
  assert.equal(queries.length, 0);
  await PrinterService.confirmarItemsImpresos([3, 3, 4]);
  await PrinterService.confirmarItemsImpresos([3, 4]);
  assert.deepEqual(Array.from(queries[0].params[0]), [3, 4]);
  assert.ok(queries.every(query => query.sql.includes('AND impreso IS NOT TRUE')));
});

test('SDD-013: USB confirma itemIds solo tras exito RAW o IPC; fallo/ack perdido no reimprime', async () => {
  const { of, throwError } = require('rxjs');
  for (const mode of ['RAW', 'IPC', 'fallback-success', 'print-failure', 'ipc-negative', 'ack-failure']) {
    const calls = [];
    const service = frontend('src/app/core/services/printer.service.ts', 'PrinterService', {
      RuntimeConfigService: { apiBaseUrl: '/api' },
      HttpClient: { post(url, body) {
        calls.push({ kind: url.endsWith('/confirmar-impresion') ? 'ack' : 'raw', body });
        if (url.endsWith('/confirmar-impresion')) return mode === 'ack-failure' ? throwError(() => new Error('ack perdido')) : of({ ok: true });
        return of({ ok: !['print-failure', 'fallback-success'].includes(mode) });
      } },
    }, { window: { borbotoElectron: { invoke: async () => {
      calls.push({ kind: 'ipc' });
      if (mode === 'print-failure') throw new Error('impresora desconectada');
      return { ok: mode !== 'ipc-negative' };
    } } } });
    const job = { tipo: 'USB', printerName: 'Mock', contenido: 'ticket', titulo: 'Produccion', itemIds: [3, 4],
      esTermica: ['RAW', 'fallback-success', 'print-failure', 'ack-failure'].includes(mode), corteTipo: 'TOTAL' };
    if (['print-failure', 'ipc-negative', 'ack-failure'].includes(mode)) await assert.rejects(() => service.printTicketSilently(job));
    else await service.printTicketSilently(job);
    assert.equal(calls.filter(call => call.kind === 'ack').length, ['print-failure', 'ipc-negative'].includes(mode) ? 0 : 1);
    const ack = calls.find(call => call.kind === 'ack');
    if (ack) assert.deepEqual(Array.from(ack.body.itemIds), [3, 4]);
    if (mode === 'ack-failure' || mode === 'RAW') assert.equal(calls.some(call => call.kind === 'ipc'), false);
    if (mode === 'IPC') assert.equal(calls[0].kind, 'ipc');
    if (mode === 'fallback-success') assert.deepEqual(calls.map(call => call.kind), ['raw', 'ipc', 'ack']);
  }
});

test('SDD-013: trabajos USB separan itemIds por destino y endpoint valida confirmacion', async () => {
  const { PrinterService } = printerModule({ connect: async () => ({
    query: async sql => ({ rows: sql.includes('FROM comandas') ? [{ folio_comanda: 1 }] : sql.includes('FROM comanda_items')
      ? [{ id: 3, cantidad: 1, nombre: 'Cafe', destino_impresion: 'COCINA' }, { id: 4, cantidad: 1, nombre: 'Agua', destino_impresion: 'BARRA' }] : [] }),
    release() {},
  }) });
  PrinterService.obtenerImpresorasPorDestino = async destino => [{ tipo: 'USB', nombre: destino, activa: true }];
  const production = await PrinterService.imprimirComandaProduccion(1);
  assert.equal(production.procesados, 0);
  assert.deepEqual(Array.from(production.impresionesPendientes, job => Array.from(job.itemIds)), [[3], [4]]);
  const text = read('backend-borboto/src/modules/printer/printer.routes.ts');
  const start = text.indexOf("router.post('/confirmar-impresion'");
  const end = text.indexOf('\n});', start) + 4;
  let handler;
  let marked = false;
  vm.runInNewContext(compile(text.slice(start, end)), {
    router: { post(_path, callback) { handler = callback; } }, Error,
    PrinterService: { async confirmarItemsImpresos(ids) {
      if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('invalid'), { status: 400 });
      marked = true;
      return { ok: true };
    } },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
  await handler({ body: {} }, res);
  assert.equal(res.code, 400);
  assert.equal(marked, false);
  await handler({ body: { itemIds: [3] } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(marked, true);
});

test('SDD-017: endpoint autofactura recupera intento durable y pago ausente responde 404', async () => {
  const fixture = fiscalFixture({ failInsert: true });
  const service = fixture.reload();
  await assert.rejects(() => service.emitirORecuperarRecibo(1, fixture.provider));
  const result = await run('/api/caja/pagos/:pagoId/autofactura', {}, () => ({ rows: [{ api_key_test: 'mock', dias_vigencia_ticket: 7 }] }), {
    emitirORecuperarRecibo: service.emitirORecuperarRecibo, ReciboFiscalError: service.ReciboFiscalError, obtenerInstanciaFacturapi: () => fixture.provider,
  });
  assert.equal(result.res.code, 200);
  assert.equal(result.res.body.autofactura.codigo, 'code-1');
  assert.equal(fixture.creates, 1);
  const missing = fiscalFixture({ missingPago: true });
  const missingService = missing.reload();
  const notFound = await run('/api/caja/pagos/:pagoId/autofactura', {}, () => ({ rows: [{ api_key_test: 'mock' }] }), {
    emitirORecuperarRecibo: missingService.emitirORecuperarRecibo, ReciboFiscalError: missingService.ReciboFiscalError, obtenerInstanciaFacturapi: () => missing.provider,
  });
  assert.equal(notFound.res.code, 404);
  assert.equal(missing.creates, 0);
});