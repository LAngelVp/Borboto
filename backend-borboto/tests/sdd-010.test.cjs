const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const backend = read('backend-borboto/index.ts');
const compile = text => transformSync(text, { loader: 'ts', target: 'node18', format: 'cjs' }).code;

async function handler(method, route, options = {}) {
  const start = backend.indexOf(`app.${method}('${route}',`);
  const end = backend.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const log = [];
  const comanda = options.absent ? undefined : { id: 1, mesa_id: options.mesa ?? null, estado: options.estado ?? 'ABIERTA' };
  const query = async (sql, params) => {
    log.push({ sql, params });
    if (options.fail && sql.startsWith('UPDATE')) throw new Error('mock update failure');
    if (options.rollbackFail && sql === 'ROLLBACK') throw new Error('mock rollback failure');
    if (sql.includes('WITH mesas_fisicas')) return { rows: options.mesas ?? [] };
    if (sql.includes('SELECT ci.id, p.nombre')) return { rows: options.items ?? [] };
    if (sql.includes('ORDER BY c.fecha_apertura')) return { rows: [{ id: 1, minutosTranscurridos: 23, mesaNumero: 'M-1' }] };
    if (sql.startsWith('SELECT id FROM comanda_items')) return { rows: options.absent ? [] : [{ id: 3 }] };
    if (sql.includes('FROM comandas')) return { rows: comanda ? [comanda] : [] };
    return { rows: [] };
  };
  const client = { query, release(error) { log.push({ sql: 'RELEASE', error }); } };
  let callback;
  const register = (_route, registered) => { callback = registered; };
  vm.runInNewContext(compile(backend.slice(start, end)), {
    app: { get: register, post: register, patch: register },
    pool: { query, connect: async () => client },
    emitirCambioGlobal(event) {
      assert.ok(log.some(entry => entry.sql === 'COMMIT'), 'evento antes de COMMIT');
      log.push({ sql: 'EVENT', event });
    },
    console: { error() {} },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await callback({ params: { comandaId: options.id ?? '1', itemId: '3' }, body: {} }, res);
  return { res, log };
}

function loadService(file, name, http) {
  function signal(initial) {
    let value = initial;
    const get = () => value;
    get.set = next => { value = next; };
    get.update = update => { value = update(value); };
    return get;
  }
  class HttpClient {}
  class RuntimeConfigService {}
  const module = { exports: {} };
  vm.runInNewContext(compile(read(file)), {
    module, exports: module.exports,
    require(dependency) {
      if (dependency === '@angular/core') return {
        Injectable: () => target => target, signal, computed: derive => derive,
        inject: token => token === HttpClient ? http : { apiBaseUrl: '/api' },
      };
      if (dependency === '@angular/common/http') return { HttpClient };
      if (dependency === './runtime-config.service') return { RuntimeConfigService };
      throw new Error(`Import inesperado: ${dependency}`);
    },
    console: { log() {}, error() {} },
  });
  return new module.exports[name]();
}

test('REQ-01: toggle SQL sincroniza item y estados operativos tras lock', async () => {
  for (const mesa of [null, 7]) {
    const result = await handler('patch', '/api/cocina/items/:itemId/toggle', { mesa });
    assert.equal(result.res.code, 200);
    const update = result.log.find(entry => entry.sql.startsWith('UPDATE comanda_items'));
    assert.match(update.sql, /completado = NOT COALESCE\(completado, false\)/);
    assert.match(update.sql, /CASE WHEN NOT COALESCE\(completado, false\) THEN 'LISTO'::estado_item_kds_enum ELSE 'PENDIENTE'::estado_item_kds_enum/);
    assert.ok(result.log.some(entry => entry.sql.includes("estado_operativo = 'EN COCINA'")));
    assert.equal(result.log.filter(entry => entry.sql.startsWith('UPDATE mesas')).length, mesa === null ? 0 : 1);
    assert.deepEqual(result.log.filter(entry => entry.sql === 'EVENT').map(entry => entry.event).sort(), ['actualizar_cocina', 'actualizar_mesas']);
  }
});

test('REQ-01: servicio optimista revierte error, conserva otros items y evita duplicados', () => {
  const requests = [];
  const service = loadService('src/app/core/services/cocina.ts', 'CocinaService', {
    patch(url) { return { subscribe(observer) { requests.push({ url, observer }); } }; },
  });
  service.tickets.set([{ id: 1, estado: 'PENDIENTE', items: [
    { id: 3, completado: false }, { id: 4, completado: false },
  ] }]);
  service.toggleItemCompletado(1, 3);
  assert.equal(service.tickets()[0].estado, 'PREPARANDO');
  assert.equal(service.tickets()[0].items[0].estado_kds, 'LISTO');
  service.toggleItemCompletado(1, 3);
  assert.equal(requests.length, 1);
  service.toggleItemCompletado(1, 4);
  assert.equal(service.tickets()[0].estado, 'LISTO');
  requests[1].observer.next({ ok: true });
  requests[0].observer.error(new Error('offline'));
  assert.equal(service.tickets()[0].items[0].completado, false);
  assert.equal(service.tickets()[0].items[0].estado_kds, 'PENDIENTE');
  assert.equal(service.tickets()[0].items[1].completado, true);
  assert.equal(service.tickets()[0].estado, 'PREPARANDO');
  assert.equal(service.itemsPendientes().size, 0);
  service.toggleItemCompletado(1, 4);
  requests[2].observer.next({ ok: true });
  assert.equal(service.tickets()[0].estado, 'PENDIENTE');
  service.filtroEstado.set('PENDIENTE');
  assert.equal(service.ticketsFiltrados().length, 1);
});

test('REQ-02/03: GET normaliza agregados, excluye despachados y calcula tiempo SQL', async () => {
  for (const [flags, estado] of [[[false, false], 'PENDIENTE'], [[true, false], 'PREPARANDO'], [[true, true], 'LISTO']]) {
    const result = await handler('get', '/api/cocina/tickets', { items: flags.map((completado, index) => ({ id: index + 1, completado })) });
    assert.equal(result.res.body[0].estado, estado);
    assert.equal(result.res.body[0].minutosTranscurridos, 23);
    const sql = result.log[0].sql;
    assert.match(sql, /NOT IN \('LISTO PARA SERVIR', 'SERVIDO'\)/);
    assert.equal((sql.match(/AS "mesaNumero"/g) ?? []).length, 1);
    assert.match(sql, /GREATEST\(1, FLOOR\(EXTRACT\(EPOCH FROM \(CURRENT_TIMESTAMP - c.fecha_apertura\)\) \/ 60\)\)::INT/);
  }
  const empty = await handler('get', '/api/cocina/tickets');
  assert.equal(empty.res.body.length, 0);
});

test('REQ-04: servir fisica/externa, rechazos limpios y fallo rollback descarta client', async () => {
  const route = '/api/comandas/:comandaId/servir';
  for (const mesa of [null, 7]) {
    const result = await handler('post', route, { mesa });
    assert.equal(result.res.code, 200);
    assert.match(result.log[1].sql, /FOR UPDATE/);
    assert.ok(result.log.some(entry => entry.sql.includes("estado_operativo = 'SERVIDO'")));
    assert.equal(result.log.filter(entry => entry.sql.startsWith('UPDATE mesas')).length, mesa === null ? 0 : 1);
    assert.equal(result.log.filter(entry => entry.sql === 'EVENT').length, 2);
    assert.equal(result.log.at(-1).sql, 'RELEASE');
  }
  for (const [options, status] of [[{ absent: true }, 404], [{ estado: 'CERRADA' }, 409], [{ estado: 'CANCELADA' }, 409]]) {
    const result = await handler('post', route, options);
    assert.equal(result.res.code, status);
    assert.equal(result.log.filter(entry => entry.sql === 'ROLLBACK').length, 1);
    assert.ok(result.log.every(entry => /^(UPDATE|COMMIT|EVENT)/.test(entry.sql) === false));
    assert.equal(result.log.at(-1).sql, 'RELEASE');
  }
  const invalid = await handler('post', route, { id: 'x' });
  assert.equal(invalid.res.code, 400);
  assert.equal(invalid.log.length, 0);
  const failure = await handler('post', route, { fail: true, rollbackFail: true });
  assert.equal(failure.res.code, 500);
  assert.ok(failure.log.at(-1).error);
  assert.ok(failure.log.every(entry => entry.sql !== 'EVENT'));
});

test('REQ-03/05: SQL mesas devuelve cerradas de hoy con DISPONIBLE y minutos dinamicos', async () => {
  const result = await handler('get', '/api/mesas');
  const sql = result.log[0].sql;
  assert.match(sql, /CASE WHEN c.id IS NULL THEN 0 ELSE GREATEST/);
  assert.match(sql, /c.estado = 'CERRADA' AND c.fecha_cierre >= CURRENT_DATE AND c.fecha_cierre < CURRENT_DATE \+ INTERVAL '1 day'/);
  assert.match(sql, /CASE WHEN c.estado = 'CERRADA' THEN 'DISPONIBLE'::estado_mesa_enum/);
  assert.match(sql, /CASE WHEN c.estado = 'CERRADA' THEN 0 ELSE GREATEST/);
  assert.match(sql, /CASE WHEN c.estado = 'CERRADA' THEN c.fecha_cierre ELSE c.fecha_apertura END AS "creadoEn"/);
});

test('REQ-04/05: MesaService entrega por comanda y filtra activos/finalizados de ambos origenes', () => {
  const calls = [];
  const service = loadService('src/app/core/services/mesa.ts', 'MesaService', {
    get() { return { subscribe(observer) { observer.next([]); } }; },
    post(url, body) { calls.push({ url, body }); return {}; },
  });
  for (const tipoOrigen of ['MOSTRADOR', 'ENVIO']) {
    service.mesas.set([
      { id: -1, comandaId: 1, tipoOrigen, estado: 'SERVIDO', creadoEn: new Date().toISOString() },
      { id: -2, comandaId: 2, tipoOrigen, estado: 'DISPONIBLE', creadoEn: new Date().toISOString() },
    ]);
    const setEstado = tipoOrigen === 'ENVIO' ? value => service.setFiltroEnvioEstado(value) : value => service.setFiltroMostradorEstado(value);
    const lista = tipoOrigen === 'ENVIO' ? service.enviosDomicilio : service.pedidosMostrador;
    setEstado('ACTIVOS');
    assert.equal(lista().length, 1);
    assert.equal(lista()[0].comandaId, 1);
    setEstado('DISPONIBLE');
    assert.equal(lista().length, 1);
    assert.equal(lista()[0].comandaId, 2);
    setEstado('TODOS');
    assert.equal(lista().length, 2);
    service.marcarServido({ id: -1, comandaId: 1, tipoOrigen });
    assert.equal(calls.at(-1).url, '/api/comandas/1/servir');
  }
  service.marcarServido({ id: 7, mesaId: 7 });
  assert.equal(calls.at(-1).url, '/api/mesas/7/servir');
});

test('REQ-01/04: wiring accesible y acciones externas finalizadas protegidas', () => {
  const card = read('src/app/features/cocina/components/kds-card/kds-card.html');
  assert.match(card, /<button type="button" class="item-row"/);
  assert.match(card, /\[attr.aria-pressed\]="item.completado"/);
  assert.match(card, /itemToggle.emit\(item.id\)/);
  assert.ok(card.includes('[disabled]="todosCompletados()"') === false);
  assert.match(read('src/app/features/cocina/cocina.html'), /toggleItemCompletado\(ticket.id, \$event\)/);
  assert.match(read('src/app/features/mesas/components/mesa-card/mesa-card.html'), /emitirAccion\('SERVIR'\)/);
  const mesas = read('src/app/features/mesas/mesas.html');
  for (const name of ['item', 'envio']) {
    assert.ok(mesas.includes(`@if (${name}.estado !== 'DISPONIBLE')`));
    assert.ok(mesas.includes(`tipo: 'SERVIR', mesa: ${name}`));
  }
  assert.match(read('src/app/features/mesas/mesas.ts'), /case 'SERVIR':[\s\S]*?notifications.success[\s\S]*?notifications.error/);
});