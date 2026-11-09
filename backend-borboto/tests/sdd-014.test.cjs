const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Subscription, Subject } = require('rxjs');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = text => transformSync(text, { loader: 'ts', target: 'node18', format: 'cjs' }).code;
const backend = read('backend-borboto/index.ts');

async function handler(method, route, options = {}) {
  const start = backend.indexOf(`app.${method}('${route}',`);
  const end = backend.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);
  const log = [];
  const query = async (sql, params) => {
    log.push({ sql, params });
    if (sql.startsWith('DELETE') && options.deleteError) throw Object.assign(new Error('delete failure'), { code: options.deleteError });
    if (options.fail) throw new Error('mock SQL failure');
    if (options.absent || (options.fallbackAbsent && sql.startsWith('UPDATE'))) return { rows: [] };
    return { rows: options.rows ?? [{ id: 7, numero: 'Terraza', zona_id: 2, capacidad: 4, estado: 'DISPONIBLE' }] };
  };
  const client = { query, release() { log.push({ sql: 'RELEASE' }); } };
  let callback;
  const register = (_route, registered) => { callback = registered; };
  vm.runInNewContext(compile(backend.slice(start, end)), {
    app: { get: register, post: register, put: register, delete: register },
    pool: { query, connect: async () => client },
    emitirCambioGlobal(event, data) { log.push({ sql: 'EVENT', event, data }); },
    console: { error() {} },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await callback({ params: { id: '7' }, body: options.body ?? {} }, res);
  return { res, log };
}

function loadClass(file, name, injections) {
  function signal(initial) {
    let value = initial;
    const get = () => value;
    get.set = next => { value = next; };
    get.update = update => { value = update(value); };
    return get;
  }
  const tokens = new Map();
  const token = name => {
    if (!tokens.has(name)) tokens.set(name, Object.defineProperty(function Token() {}, 'name', { value: name }));
    return tokens.get(name);
  };
  const angular = {
    Injectable: () => target => target, Component: () => target => target,
    ChangeDetectionStrategy: { OnPush: 0 }, signal, computed: derive => derive,
    inject: dependency => injections[dependency.name] ?? {},
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read(file)), {
    module, exports: module.exports,
    require(dependency) {
      if (dependency === 'rxjs') return { Subscription };
      return new Proxy(dependency === '@angular/core' ? angular : {}, {
        get(target, property) { return property === '__esModule' ? undefined : target[property] ?? token(property); },
      });
    },
    console: { log() {}, error() {} },
  });
  return new module.exports[name]();
}

function pendingHttp() {
  const requests = [];
  return {
    requests,
    get(url) { return { subscribe(observer) {
      const request = { url, observer, cancelled: false };
      requests.push(request);
      return new Subscription(() => { request.cancelled = true; });
    } }; },
  };
}

const response = (comandaId, mesaId = null) => ({
  comandaId, mesaId, tipoOrigen: mesaId === null ? 'MOSTRADOR' : 'MESA', folioOrigen: `F-${comandaId}`,
  items: [{ producto: { id: comandaId, nombre: 'Cafe', precio: '12.50', categoria: 'Bebidas' }, cantidad: 3, subtotal: '37.50', notas: 'Sin azucar' }],
});

test('REQ-01: GET admin solo mesas fisicas con zona_id; PUT valida y conserva 404', async () => {
  const result = await handler('get', '/api/admin/mesas');
  assert.equal(result.res.code, 200);
  assert.match(result.log[0].sql, /m.id, m.numero, m.zona_id, m.capacidad, m.estado, z.nombre AS zona/);
  assert.match(result.log[0].sql, /FROM mesas m LEFT JOIN zonas/);
  assert.ok(/UNION|comandas/.test(result.log[0].sql) === false);
  assert.equal(result.res.body[0].zona_id, 2);
  for (const body of [{}, { numero: '', zona_id: 2 }, { numero: '  ', zona_id: 2 }, { numero: 'Mesa', zona_id: 'x' }, { numero: 'Mesa', zona_id: 0 }, { numero: 'Mesa', zona_id: 1.5 }, { numero: 'Mesa', zona_id: true }]) {
    const invalid = await handler('put', '/api/mesas/:id', { body });
    assert.equal(invalid.res.code, 400);
    assert.equal(invalid.log.length, 0);
  }
  const body = { numero: ' Terraza ', zona_id: '2', capacidad: 6 };
  const updated = await handler('put', '/api/mesas/:id', { body });
  assert.equal(updated.log[0].params[0], 'Terraza');
  assert.equal(updated.log[0].params[1], 2);
  const missing = await handler('put', '/api/mesas/:id', { body, absent: true });
  assert.equal(missing.res.code, 404);
  assert.ok(missing.log.every(entry => entry.sql !== 'EVENT'));
});

test('REQ-01: Ajustes carga fisicas y editar nombre/capacidad conserva zona', () => {
  const calls = [];
  const service = loadClass('src/app/core/services/ajustes.service.ts', 'AjustesService', {
    RuntimeConfigService: { apiBaseUrl: '/api' }, HttpClient: { get(url) { calls.push(url); return {}; } },
  });
  service.getAdminMesas();
  assert.equal(calls[0], '/api/admin/mesas');
  const physical = { id: 7, numero: 'Mesa 7', zona_id: 2, capacidad: 4 };
  let payload;
  const component = loadClass('src/app/features/ajustes/ajustes.ts', 'AjustesComponent', {
    AjustesService: {
      getAdminMesas() { return { subscribe(observer) { observer.next([physical, { id: -1, zona_id: null }, { id: 9 }]); } }; },
      actualizarMesa(id, body) { payload = { id, body }; return { subscribe(observer) { observer.next(body); } }; },
    },
    NotificationService: { success() {} },
  });
  component.cargarMesas();
  assert.equal(component.mesas().length, 1);
  component.habilitarEdicionMesa(physical);
  component.mesaEditando().numero = 'Terraza';
  component.mesaEditando().capacidad = 6;
  component.guardarEdicionMesa();
  assert.equal(payload.id, 7);
  assert.equal(payload.body.zona_id, 2);
  assert.equal(payload.body.capacidad, 6);
  assert.equal(physical.numero, 'Mesa 7');
  assert.equal(component.mesaEditando(), null);
});

test('REQ-02: productos CRUD uniforme, PUT ausente 404 y compatibilidad legacy', async () => {
  for (const method of ['post', 'put', 'delete']) {
    const route = method === 'post' ? '/api/productos' : '/api/productos/:id';
    const result = await handler(method, route, { body: { categoria_id: 1, nombre: 'Cafe', precio: 10 } });
    assert.equal(result.res.code, method === 'post' ? 201 : 200);
    assert.equal(result.log.filter(entry => entry.event === 'actualizar_productos').length, 1);
    assert.ok(result.log.findIndex(entry => entry.sql === 'EVENT') > 0);
    if (method === 'put') assert.equal(result.log.find(entry => entry.event === 'PRODUCTO_ACTUALIZADO').data.id, 7);
    if (method !== 'post') {
      const missing = await handler(method, route, { absent: true });
      assert.equal(missing.res.code, 404);
      assert.equal(missing.res.body.error, 'Producto no encontrado');
      assert.ok(missing.log.every(entry => entry.sql !== 'EVENT'));
    }
  }
});

test('REQ-02: DELETE solo desactiva FK conocida y valida fallback ausente/fallo', async () => {
  const route = '/api/productos/:id';
  const fk = await handler('delete', route, { deleteError: '23503' });
  assert.equal(fk.res.code, 200);
  assert.match(fk.log[1].sql, /UPDATE productos SET disponible = FALSE.*RETURNING id/);
  assert.equal(fk.log.filter(entry => entry.event === 'actualizar_productos').length, 1);
  const gone = await handler('delete', route, { deleteError: '23503', fallbackAbsent: true });
  assert.equal(gone.res.code, 404);
  assert.ok(gone.log.every(entry => entry.sql !== 'EVENT'));
  for (const code of ['08006', '42501', 'XX000']) {
    const failure = await handler('delete', route, { deleteError: code });
    assert.equal(failure.res.code, 500);
    assert.equal(failure.log.length, 1);
  }
  const failedFallback = await handler('delete', route, { deleteError: '23503', fail: true });
  assert.equal(failedFallback.res.code, 500);
  assert.ok(failedFallback.log.every(entry => entry.sql !== 'EVENT'));
});

test('REQ-02: importacion emite catalogo solo despues de COMMIT', async () => {
  const result = await handler('post', '/api/productos/importar-lote', { body: { productos: [{ nombre: 'Cafe', categoria: 'Bebidas', precio: 10 }] } });
  assert.equal(result.res.code, 201);
  assert.ok(result.log.findIndex(entry => entry.sql === 'COMMIT') < result.log.findIndex(entry => entry.event === 'actualizar_productos'));
  assert.equal(result.log.at(-1).sql, 'RELEASE');
});

test('REQ-03: cargas cruzadas cancelan e ignoran respuesta/error viejos en ambos sentidos', () => {
  for (const reverse of [false, true]) {
    const http = pendingHttp();
    const service = loadClass('src/app/core/services/comanda.ts', 'ComandaService', { HttpClient: http, RuntimeConfigService: { apiBaseUrl: '/api' } });
    service.itemsComanda.set([{ producto: { id: 99 }, cantidad: 1 }]);
    if (reverse) service.cargarComandaPorId(1); else service.cargarComandaActivaPorMesa(7);
    assert.equal(service.itemsComanda().length, 0);
    if (reverse) service.cargarComandaActivaPorMesa(8); else service.cargarComandaPorId(2);
    assert.equal(http.requests[0].cancelled, true);
    assert.equal(service.itemsGuardados().length, 0);
    http.requests[1].observer.next(response(2, reverse ? 8 : null));
    http.requests[0].observer.next(response(1, 7));
    http.requests[0].observer.error(new Error('late error'));
    assert.equal(service.comandaIdActiva(), 2);
    assert.equal(service.mesaIdActual(), reverse ? 8 : null);
    assert.equal(service.folioOrigenActual(), 'F-2');
    assert.equal(service.itemsGuardados()[0].producto.id, 2);
    assert.equal(service.itemsGuardados()[0].producto.precio, 12.5);
    assert.equal(service.itemsGuardados()[0].subtotal, 37.5);
    service.limpiarComanda();
    http.requests[1].observer.next(response(2));
    assert.equal(http.requests[1].cancelled, true);
    assert.equal(service.comandaIdActiva(), 0);
    assert.equal(service.mesaIdActual(), null);
    assert.equal(service.itemsGuardados().length, 0);
    assert.equal(service.itemsComanda().length, 0);
  }
});

test('REQ-02/03: catalogo cancelable no toca consumos y teardown invalida pendientes', () => {
  const http = pendingHttp();
  const service = loadClass('src/app/core/services/comanda.ts', 'ComandaService', { HttpClient: http, RuntimeConfigService: { apiBaseUrl: '/api' } });
  service.itemsGuardados.set([{ subtotal: 12.5 }]);
  service.itemsComanda.set([{ subtotal: 10 }]);
  service.cargarProductos();
  service.cargarProductos();
  assert.equal(http.requests[0].cancelled, true);
  http.requests[1].observer.next([{ id: 2, precio: '0.00', disponible: true }]);
  http.requests[0].observer.next([{ id: 1, precio: '999.00' }]);
  assert.equal(service.productos()[0].id, 2);
  assert.equal(service.productos()[0].precio, 0);
  assert.equal(service.itemsGuardados()[0].subtotal, 12.5);
  assert.equal(service.itemsComanda()[0].subtotal, 10);
  service.cancelarCargas();
  http.requests[1].observer.next([{ id: 3, precio: 1 }]);
  assert.equal(service.productos()[0].id, 2);
  assert.equal(http.requests[1].cancelled, true);
});

test('REQ-02/03: Comanda limpia ruta invalida, escucha catalogo y retira listeners', () => {
  const route = new Subject();
  const catalog = new Subject();
  const calls = [];
  const service = {
    cargarProductos() { calls.push('menu'); }, limpiarComanda() { calls.push('reset'); }, cancelarCargas() { calls.push('cancel'); },
    cargarComandaPorId(id) { calls.push(`comanda:${id}`); }, cargarComandaActivaPorMesa(id) { calls.push(`mesa:${id}`); },
  };
  const component = loadClass('src/app/features/comanda/comanda.ts', 'Comanda', {
    ComandaService: service, ActivatedRoute: { queryParamMap: route },
    SocketService: { onEvent(event) { assert.equal(event, 'actualizar_productos'); return catalog; } },
  });
  const params = values => ({ get: key => values[key] ?? null });
  component.ngOnInit();
  route.next(params({ comandaId: '2', mesaId: '7' }));
  assert.equal(calls.at(-1), 'comanda:2');
  route.next(params({ mesaId: '8' }));
  assert.equal(calls.at(-1), 'mesa:8');
  for (const values of [{}, { comandaId: '-1', mesaId: 'x' }, { comandaId: '1.5' }]) {
    route.next(params(values));
    assert.equal(calls.at(-1), 'reset');
    assert.equal(component.comandaId, 0);
    assert.equal(component.mesaId, 0);
  }
  catalog.next();
  assert.equal(calls.at(-1), 'menu');
  component.ngOnDestroy();
  assert.equal(calls.at(-1), 'cancel');
  const count = calls.length;
  catalog.next();
  route.next(params({ comandaId: '3' }));
  assert.equal(calls.length, count);
});