const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'backend-borboto/index.ts'), 'utf8');
const compile = text => transformSync(text, { loader: 'ts', target: 'node18', format: 'cjs' }).code;
const helpers = source.slice(source.indexOf('async function generarFolioOrigen('), source.indexOf("io.on('connection'"));
const routes = ['/api/mesas/:origenId/mover', '/api/mesas/mover', '/api/comandas/:comandaId/asignar-mesa'];

function register(route, pool, emit) {
  const start = source.indexOf(`app.post('${route}',`);
  const end = source.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  let handler;
  vm.runInNewContext(compile(helpers + source.slice(start, end)), {
    app: { post(_route, callback) { handler = callback; } }, pool, emitirCambioGlobal: emit,
  });
  return handler;
}

function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

async function transfer(route, options = {}) {
  const log = [];
  const comanda = options.absent ? null : { id: 11, mesa_id: options.external ? null : 7,
    estado: options.estado ?? 'ABIERTA', estado_operativo: 'LISTO PARA SERVIR', tipo_origen: 'MOSTRADOR', folio_origen: 'M-8' };
  const client = {
    async query(sql, params) {
      log.push({ sql, params });
      if (sql === 'ROLLBACK' && options.rollbackFail) throw new Error('rollback failure');
      if (sql.startsWith('UPDATE') && options.fail) throw Object.assign(new Error('write failure'), { code: options.fail });
      if (sql.includes('ORDER BY id ASC FOR UPDATE')) return { rows: params[0].filter(id => id !== options.missingMesa).map(id => ({ id, comensales: id === 7 ? 4 : 0, minutos_abierta: id === 7 ? 12 : 0 })) };
      if (sql.startsWith('SELECT id FROM comandas')) return { rows: options.occupied ? [{ id: 99 }] : [] };
      if (sql.includes('FROM comandas')) return { rows: comanda ? [comanda] : [] };
      return { rows: [] };
    },
    release(error) { log.push({ sql: 'RELEASE', error }); },
  };
  const handler = register(route, { connect: async () => client }, event => {
    assert.ok(log.some(entry => entry.sql === 'COMMIT'), 'evento antes de COMMIT');
    log.push({ sql: 'EVENT', event });
  });
  const res = response();
  await handler({ params: { origenId: '7', comandaId: options.id ?? '11' },
    body: { origenId: options.origen ?? 7, destinoId: options.destino ?? 2 } }, res);
  return { res, log };
}

test('REQ-01: tres rutas comparten lock comanda->mesas ascendentes y traslado autoritativo', async () => {
  for (const route of routes) {
    const result = await transfer(route);
    assert.equal(result.res.code, 200);
    assert.match(result.log[1].sql, /FROM comandas.*FOR UPDATE/);
    assert.match(result.log[2].sql, /FROM mesas.*ORDER BY id ASC FOR UPDATE/);
    assert.deepEqual(Array.from(result.log[2].params[0]), [2, 7]);
    const update = result.log.find(entry => entry.sql.startsWith('UPDATE mesas SET estado = $1'));
    assert.deepEqual(Array.from(update.params), ['LISTO PARA SERVIR', 4, 12, 2]);
    assert.equal(result.log.find(entry => entry.sql.includes("estado = 'DISPONIBLE'")).params[0], 7);
    assert.equal(result.res.body.folioOrigen, 'M-8');
    assert.equal(result.res.body.mesaId, 2);
    assert.deepEqual(result.log.filter(entry => entry.sql === 'EVENT').map(entry => entry.event), ['actualizar_mesas', 'actualizar_cocina']);
    assert.equal(result.log.at(-1).sql, 'RELEASE');
  }
});

test('REQ-01: IDs/igualdad/huerfano/mesa ausente/destino ocupado rechazan sin mutaciones', async () => {
  for (const route of routes) {
    for (const [options, status] of [[{ destino: 7 }, 400], [{ destino: -1 }, 400], [{ destino: 1.5 }, 400], [{ destino: 'x' }, 400], [{ absent: true }, 404], [{ missingMesa: 2 }, 404], [{ missingMesa: 7 }, 404], [{ occupied: true }, 409]]) {
      const result = await transfer(route, options);
      assert.equal(result.res.code, status);
      assert.ok(result.log.every(entry => /^(UPDATE|COMMIT|EVENT)/.test(entry.sql) === false));
      if (options.destino === 7) assert.equal(result.res.body.error, 'La mesa de destino debe ser distinta a la mesa de origen');
      if (options.occupied) assert.equal(result.res.body.error, 'La mesa ya tiene una comanda abierta');
      if (result.log.length) {
        assert.equal(result.log.filter(entry => entry.sql === 'ROLLBACK').length, 1);
        assert.equal(result.log.at(-1).sql, 'RELEASE');
      }
    }
  }
  for (const estado of ['CERRADA', 'CANCELADA']) {
    const result = await transfer(routes[2], { estado });
    assert.equal(result.res.code, 409);
    assert.ok(result.log.every(entry => entry.sql.startsWith('UPDATE') === false));
  }
});

test('REQ-01: externa asigna sin liberar mesa ajena, 23505 normalizado y rollback fallido descarta', async () => {
  const external = await transfer(routes[2], { external: true });
  assert.equal(external.res.code, 200);
  assert.deepEqual(Array.from(external.log[2].params[0]), [2]);
  assert.ok(external.log.every(entry => entry.sql.includes("estado = 'DISPONIBLE'") === false));
  for (const route of routes) {
    const duplicate = await transfer(route, { fail: '23505' });
    assert.equal(duplicate.res.code, 409);
    assert.equal(duplicate.res.body.error, 'La mesa ya tiene una comanda abierta');
    assert.ok(duplicate.log.some(entry => entry.sql === 'ROLLBACK'));
    assert.ok(duplicate.log.every(entry => entry.sql !== 'COMMIT' && entry.sql !== 'EVENT'));
  }
  const failure = await transfer(routes[2], { fail: 'XX000', rollbackFail: true });
  assert.equal(failure.res.code, 500);
  assert.ok(failure.log.at(-1).error);
});

function folioPool(initial = [], failInsert = false) {
  const committed = [...initial];
  const locks = new Map();
  const clients = [];
  return {
    committed, clients,
    async connect() {
      const log = [];
      let unlock;
      let origin;
      let pending;
      clients.push(log);
      return {
        async query(sql, params) {
          log.push({ sql, params });
          if (sql.includes('pg_advisory_xact_lock')) {
            assert.deepEqual(Array.from(params).slice(0, 1), [9009]);
            const key = params[1];
            const previous = locks.get(key) ?? Promise.resolve();
            const gate = new Promise(resolve => { unlock = resolve; });
            locks.set(key, previous.then(() => gate));
            await previous;
            origin = key === 1 ? 'MOSTRADOR' : 'ENVIO';
          } else if (sql.includes('AS consecutivo')) {
            assert.ok(origin, 'MAX sin advisory lock');
            assert.match(sql, /COALESCE\(MAX\(CASE WHEN folio_origen ~ \$2 THEN SUBSTRING\(folio_origen FROM 3\)::bigint END\), COUNT\(\*\)\) \+ 1/);
            assert.match(sql, /DATE\(fecha_apertura\) = CURRENT_DATE/);
            assert.equal(params[0], origin);
            const matching = committed.filter(row => row.origin === origin);
            const numeric = matching.map(row => new RegExp(params[1]).test(row.folio) ? Number(row.folio.slice(2)) : null).filter(value => value !== null);
            return { rows: [{ consecutivo: numeric.length ? Math.max(...numeric) + 1 : matching.length + 1 }] };
          } else if (sql.startsWith('INSERT INTO comandas')) {
            if (failInsert) throw new Error('insert failure');
            pending = { origin, folio: params[2] };
            return { rows: [{ id: 1, mesaId: null, tipoOrigen: origin, folioOrigen: pending.folio }] };
          } else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (sql === 'COMMIT' && pending) committed.push(pending);
            pending = undefined;
            unlock?.();
          }
          return { rows: [] };
        },
        release() { log.push({ sql: 'RELEASE' }); },
      };
    },
  };
}

test('REQ-02: creaciones concurrentes serializadas, maximo con huecos y tipos independientes', async () => {
  const pool = folioPool([{ origin: 'MOSTRADOR', folio: 'M-1' }, { origin: 'MOSTRADOR', folio: 'M-7' }, { origin: 'ENVIO', folio: 'E-4' }]);
  const results = await Promise.all(['/api/mostrador/crear', '/api/mostrador/crear', '/api/envios/crear', '/api/envios/crear'].map(async route => {
    const handler = register(route, pool, () => {});
    const res = response();
    await handler({ body: { usuarioId: 1, clienteId: 2 } }, res);
    assert.equal(res.code, 201);
    return res.body.numero;
  }));
  assert.deepEqual(results.sort(), ['E-5', 'E-6', 'M-8', 'M-9']);
  for (const log of pool.clients) {
    assert.equal(log[0].sql, 'BEGIN');
    assert.match(log[1].sql, /pg_advisory_xact_lock/);
    assert.equal(log.at(-2).sql, 'COMMIT');
    assert.equal(log.at(-1).sql, 'RELEASE');
  }
});

test('REQ-02: fallback sin sufijos y fallo de insert revierte/libera sin evento', async () => {
  const pool = folioPool([{ origin: 'ENVIO', folio: 'legacy' }]);
  const res = response();
  await register('/api/envios/crear', pool, () => {})({ body: {} }, res);
  assert.equal(res.body.numero, 'E-2');
  const failing = folioPool([], true);
  const events = [];
  const failed = response();
  await register('/api/mostrador/crear', failing, event => events.push(event))({ body: {} }, failed);
  assert.equal(failed.code, 500);
  assert.equal(failing.committed.length, 0);
  assert.equal(failing.clients[0].at(-2).sql, 'ROLLBACK');
  assert.equal(failing.clients[0].at(-1).sql, 'RELEASE');
  assert.equal(events.length, 0);
});

function dialog() {
  const file = 'src/app/features/mesas/components/crear-envio-dialog/crear-envio-dialog.ts';
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const requests = [];
  const closed = [];
  const errors = [];
  const original = { id: 2, nombre: 'Ana', direccion: 'Calle 1', telefono: '111', notas: 'Porton', email: 'ana@example.test' };
  const injections = {
    MatDialogRef: { close(value) { closed.push(value); } },
    NotificationService: { error(message) { errors.push(message); } },
    AjustesService: {
      actualizarCliente(id, payload) { return { subscribe(observer) { requests.push({ id, payload, observer }); } }; },
      crearCliente(payload) { return { subscribe(observer) { requests.push({ payload, observer }); } }; },
    },
  };
  function signal(initial) { let value = initial; const get = () => value; get.set = next => { value = next; }; return get; }
  const module = { exports: {} };
  vm.runInNewContext(compile(text), {
    module, exports: module.exports,
    require(dependency) {
      if (dependency === '@angular/core') return { Component: () => target => target, ChangeDetectionStrategy: { OnPush: 0 }, signal,
        computed: derive => derive, inject: token => injections[token.name] };
      return new Proxy({}, { get(_target, name) { return name === '__esModule' ? undefined : Object.defineProperty(function Token() {}, 'name', { value: name }); } });
    },
  });
  const component = new module.exports.CrearEnvioDialogComponent();
  component.clientes.set([original]);
  component.onSeleccionarCliente(2);
  return { component, original, requests, closed, errors, text };
}

test('REQ-03: contacto existente editable se guarda antes de close conservando otros datos', () => {
  const result = dialog();
  result.component.direccion = ' Calle 2 ';
  result.component.telefono = '222';
  result.component.notas = 'Puerta azul';
  result.component.confirmar();
  assert.equal(result.closed.length, 0);
  assert.equal(result.component.guardando(), true);
  result.component.confirmar();
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].id, 2);
  assert.equal(result.requests[0].payload.direccion, 'Calle 2');
  assert.equal(result.requests[0].payload.telefono, '222');
  assert.equal(result.requests[0].payload.notas, 'Puerta azul');
  assert.equal(result.requests[0].payload.email, result.original.email);
  assert.equal(result.original.direccion, 'Calle 1');
  result.requests[0].observer.next({ id: 2 });
  assert.equal(result.closed[0].confirmado, true);
  assert.equal(result.closed[0].clienteId, 2);
  assert.equal(result.component.guardando(), false);
  assert.match(result.text, /rows="2"\s+\[disabled\]="guardando\(\)"/);
});

test('REQ-03: fallo no cierra, reintento permitido, sin cambios no PUT y direccion vacia rechaza', () => {
  const failure = dialog();
  failure.component.direccion = 'Calle 3';
  failure.component.confirmar();
  failure.requests[0].observer.error(new Error('offline'));
  assert.equal(failure.closed.length, 0);
  assert.equal(failure.errors.length, 1);
  assert.equal(failure.component.guardando(), false);
  failure.component.confirmar();
  assert.equal(failure.requests.length, 2);
  const unchanged = dialog();
  unchanged.component.confirmar();
  assert.equal(unchanged.requests.length, 0);
  assert.equal(unchanged.closed[0].clienteId, 2);
  const invalid = dialog();
  invalid.component.direccion = '   ';
  invalid.component.confirmar();
  assert.equal(invalid.closed.length, 0);
  assert.equal(invalid.requests.length, 0);
});