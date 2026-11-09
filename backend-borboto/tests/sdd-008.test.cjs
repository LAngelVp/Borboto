const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const source = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
const routes = [
  '/api/comandas', '/api/cocina/items/:itemId/toggle',
  '/api/cocina/tickets/:comandaId/despachar', '/api/caja/cobrar',
];
const handlers = new Map();
for (const route of routes) {
  const start = source.indexOf(`app.${route.includes('toggle') ? 'patch' : 'post'}('${route}',`);
  const end = source.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  handlers.set(route, transformSync(source.slice(start, end), {
    loader: 'ts', target: 'node18', format: 'cjs',
  }).code);
}

async function run(route, options = {}) {
  const log = [];
  const comanda = options.absent ? undefined : {
    id: 1, mesa_id: options.mesa ?? null, estado: options.estado ?? 'ABIERTA', total: 20,
  };
  const client = {
    async query(sql, params) {
      log.push({ sql, params });
      if (options.fail && sql.startsWith('UPDATE')) throw new Error('mock write failure');
      if (sql.includes('FROM productos')) return { rows: options.productos ?? [{ id: 2, nombre: 'Cafe', precio: '10.00', disponible: true }] };
      if (sql.startsWith('SELECT id FROM comanda_items')) return { rows: options.absent ? [] : [{ id: 3 }] };
      if (sql.includes('SUM(subtotal)')) return { rows: [{ subtotal: '20.00' }] };
      if (sql.includes('FROM configuracion_facturacion')) return { rows: [] };
      if (sql.includes('SELECT cliente_id')) return { rows: [{ cliente_id: null, mesa_id: null }] };
      if (sql.startsWith('INSERT INTO pagos')) return { rows: [{ id: 9 }] };
      if (sql.includes('FROM comandas')) return { rows: comanda ? [comanda] : [] };
      return { rows: [] };
    },
    release() { log.push({ sql: 'RELEASE' }); },
  };
  let handler;
  const register = (_route, callback) => { handler = callback; };
  vm.runInNewContext(handlers.get(route), {
    app: { post: register, patch: register }, pool: { connect: async () => client },
    emitirCambioGlobal: event => {
      assert.ok(log.some(entry => entry.sql === 'COMMIT'), 'evento previo a COMMIT');
      log.push({ sql: 'EVENT', event });
    },
    PrinterService: { imprimirComandaProduccion: async () => null, imprimirTicketCobro: async () => null },
    console: { log() {}, error() {}, warn() {} },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { itemId: '3', comandaId: '1' }, body: {
    comandaId: 1, mesaId: 5, items: [{ productoId: 2, cantidad: 2, precio: 0.01 }],
    metodoPago: 'EFECTIVO', montoRecibido: 20, ...options.body,
  } }, res);
  assert.equal(log.filter(entry => entry.sql === 'RELEASE').length, 1);
  const released = log.findIndex(entry => entry.sql === 'RELEASE');
  assert.ok(log.slice(released + 1).every(entry => entry.sql === 'EVENT'));
  return { res, log };
}

function rejected(result, status) {
  assert.equal(result.res.code, status);
  assert.equal(result.log.filter(entry => entry.sql === 'ROLLBACK').length, 1);
  assert.ok(!result.log.some(entry => /^(INSERT|UPDATE|COMMIT|EVENT)/.test(entry.sql)));
}

test('REQ-01: adiciones inexistentes o terminales no escriben', async () => {
  rejected(await run(routes[0], { absent: true }), 404);
  for (const estado of ['CERRADA', 'CANCELADA']) {
    const result = await run(routes[0], { estado });
    rejected(result, 409);
    assert.ok(result.log.some(entry => entry.sql.includes('FOR UPDATE')));
    assert.equal(result.res.body.error, 'No se pueden agregar productos a una comanda cerrada o cancelada');
  }
});

test('REQ-02: catalogo manda, incluido precio cero y alias producto.id', async () => {
  for (const precio of ['10.00', '0.00']) {
    const result = await run(routes[0], {
      productos: [{ id: 2, nombre: 'Cafe', precio, disponible: true }],
      body: { items: [{ producto: { id: 2, precio: 999 }, cantidad: 2, precio: 999 }] },
    });
    assert.equal(result.res.code, 200);
    assert.equal(result.res.body.totalAdicional, Number(precio) * 2);
    const insert = result.log.find(entry => entry.sql.startsWith('INSERT INTO comanda_items'));
    assert.equal(insert.params[3], Number(precio));
    assert.ok(result.log.some(entry => entry.sql.includes('ANY($1::int[])')));
  }
});

test('REQ-02: rechazos de catalogo y cantidades sin escrituras', async () => {
  rejected(await run(routes[0], { productos: [] }), 400);
  rejected(await run(routes[0], { productos: [{ id: 2, nombre: 'Cafe', precio: 10, disponible: false }] }), 409);
  for (const cantidad of [0, -1, 1.5, undefined]) {
    rejected(await run(routes[0], { body: { items: [{ productoId: 2, cantidad }] } }), 400);
  }
  rejected(await run(routes[0], { body: { items: [{ productoId: 'no', cantidad: 1 }] } }), 400);
});

test('REQ-03: KDS ausente/terminal hace rollback sin mutaciones', async () => {
  for (const route of routes.slice(1, 3)) {
    rejected(await run(route, { absent: true }), 404);
    for (const estado of ['CERRADA', 'CANCELADA']) rejected(await run(route, { estado }), 409);
    const result = await run(route);
    assert.equal(result.res.code, 200);
    assert.ok(result.log.some(entry => entry.sql.includes('FOR UPDATE')));
    assert.ok(result.log.some(entry => entry.event === 'actualizar_cocina'));
    if (route.includes('toggle')) assert.equal(result.log.filter(entry => entry.sql.includes('FOR UPDATE')).length, 2);
  }
});

test('REQ-04: cobro externo ignora mesa 5 y notifica mesas/cocina', async () => {
  const result = await run(routes[3]);
  assert.equal(result.res.code, 200);
  assert.ok(!result.log.some(entry => entry.sql.startsWith('UPDATE mesas')));
  assert.deepEqual(result.log.filter(entry => entry.sql === 'EVENT').map(entry => entry.event).sort(), ['actualizar_cocina', 'actualizar_mesas']);
  const physical = await run(routes[3], { mesa: 7 });
  assert.equal(physical.log.find(entry => entry.sql.startsWith('UPDATE mesas')).params[0], 7);
});

test('fallos de escritura hacen rollback y liberan sin eventos', async () => {
  for (const route of routes) {
    const result = await run(route, { fail: true });
    assert.equal(result.res.code, 500);
    assert.equal(result.log.filter(entry => entry.sql === 'ROLLBACK').length, 1);
    assert.ok(!result.log.some(entry => entry.sql === 'COMMIT' || entry.sql === 'EVENT'));
  }
});