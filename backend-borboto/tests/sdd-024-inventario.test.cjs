const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'backend-borboto/src/modules/inventario.ts'), 'utf8');
const sessionModule = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'backend-borboto/src/session.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node18' }).code, {
  module: sessionModule, exports: sessionModule.exports, require, Buffer,
});
const moduleMock = { exports: {} };
vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'node18' }).code, {
  module: moduleMock, exports: moduleMock.exports,
  require: name => {
    if (name === '../session') return sessionModule.exports;
    assert.equal(name, './resurtido');
    const module = { exports: {} };
    vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'backend-borboto/src/modules/resurtido.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports });
    return module.exports;
  },
});
const { enriquecerInsumo, registrarInventario } = moduleMock.exports;
async function componenteInventario(nombre, navegador = {}) {
  await import('@angular/compiler');
  const forms = await import('@angular/forms');
  const { Subject, of, takeUntil } = require('rxjs');
  const destruido = new Subject(), callbacks = [], avisos = [], guardados = [];
  let focos = 0;
  const providers = {
    FormBuilder: new forms.FormBuilder(),
    DestroyRef: { onDestroy(callback) { callbacks.push(callback); } },
    NotificationService: { warning(message) { avisos.push(message); } },
    SocketService: { onEvent() { return new Subject(); } },
    InventarioService: {
      insumos: () => [], listarTodos: () => of([]), movimientos: () => of([]), recargar() {},
      guardar(body, id) { guardados.push({ body, id }); return of({}); },
    },
  };
  const tokens = new Map();
  const core = {
    Component: () => target => target,
    ChangeDetectionStrategy: { OnPush: 0 },
    inject: dependency => providers[dependency.name],
    computed: derive => derive,
    viewChild: () => () => ({ nativeElement: { focus() { focos++; } } }),
    signal(initial) { let value = initial; const read = () => value; read.set = next => { value = next; }; read.update = update => { value = update(value); }; return read; },
  };
  const module = { exports: {} };
  const filename = nombre === 'InventarioAdminComponent' ? 'inventario-admin' : 'inventario';
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, `src/app/features/inventario/${filename}.ts`), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node18' }).code, {
    module, exports: module.exports, window: navegador, DOMException, setTimeout, clearTimeout,
    require(dependency) {
      if (dependency === '@angular/forms') return forms;
      if (dependency === 'rxjs') return require('rxjs');
      if (dependency === '@angular/core/rxjs-interop') return { takeUntilDestroyed: () => takeUntil(destruido) };
      return new Proxy(dependency === '@angular/core' ? core : {}, { get(target, key) {
        if (key === '__esModule') return undefined;
        if (key in target) return target[key];
        if (!tokens.has(key)) tokens.set(key, Object.defineProperty(function Token() {}, 'name', { value: key }));
        return tokens.get(key);
      } });
    },
  });
  return { component: new module.exports[nombre](), avisos, guardados, get focos() { return focos; }, destroy() { destruido.next(); destruido.complete(); callbacks.forEach(callback => callback()); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function navegadorVoz(options = {}) {
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); this.stops = 0; this.aborts = 0; }
    start() { if (options.startError) throw Error('microphone unavailable'); if (!options.delayedStart) this.onstart?.(); }
    stop() { this.stops++; }
    abort() { this.aborts++; }
    result(...texts) { this.onresult?.({ results: texts.map(transcript => [{ transcript }]) }); }
  }
  return { instances, window: options.webkit ? { webkitSpeechRecognition: Recognition } : { SpeechRecognition: Recognition } };
}
const pulsacion = () => ({ button: 0, preventDefault() {} });
test('TEST-06: paquetes sincronizados en alta, checkbox, editar, reset y payload getRawValue', async () => {
  const env = await componenteInventario('InventarioAdminComponent');
  const component = env.component, form = component.configuracion, controls = form.controls;
  assert.equal(controls.nombre_paquete.disabled, true);
  assert.equal(controls.factor_paquete.disabled, true);
  controls.permite_paquetes.setValue(true);
  assert.equal(controls.nombre_paquete.enabled, true);
  assert.equal(controls.factor_paquete.enabled, true);
  form.patchValue({ nombre_paquete: 'SIX', factor_paquete: 6 });
  controls.permite_paquetes.setValue(false);
  assert.equal(form.getRawValue().nombre_paquete, 'CAJA');
  assert.equal(form.getRawValue().factor_paquete, 1);
  component.editar({ ...base(1), codigo: null, ubicacion: null, nombre_paquete: 'SIX', factor_paquete: 6 });
  assert.equal(controls.factor_paquete.enabled, true);
  assert.equal(controls.factor_paquete.value, 6);
  component.editar({ ...base(2, 20, false), codigo: null, ubicacion: null, nombre_paquete: 'SIX', factor_paquete: 6 });
  assert.equal(controls.factor_paquete.disabled, true);
  assert.equal(controls.factor_paquete.value, 1);
  assert.equal(controls.nombre_paquete.value, 'CAJA');
  component.nuevo();
  controls.nombre.setValue('Servilleta');
  component.guardar();
  assert.equal(env.guardados[0].body.nombre_paquete, 'CAJA');
  assert.equal(env.guardados[0].body.factor_paquete, 1);
  assert.equal(controls.factor_paquete.disabled, true);
  env.destroy();
  controls.permite_paquetes.setValue(true);
  assert.equal(controls.factor_paquete.disabled, true);
});
const base = (id, stock = 40, paquetes = true) => ({ id, nombre: `Insumo ${id}`, stock_actual: stock, stock_minimo: 10, factor_paquete: 12, permite_paquetes: paquetes, activo: true });
function entorno(initial = [base(1), base(2)], options = {}) {
  let state = structuredClone(initial), snapshot, movimientos = [], anteriores;
  const log = [], events = [], routes = new Map();
  const query = async (sql, params = []) => {
    log.push({ sql, params });
    if (options.failSql && sql.startsWith(options.failSql)) throw Object.assign(new Error('mock persistence failure'), { code: options.errorCode });
    if (sql === 'BEGIN') { snapshot = structuredClone(state); anteriores = structuredClone(movimientos); }
    if (sql === 'ROLLBACK') { state = snapshot; movimientos = anteriores; }
    if (sql.includes('FOR UPDATE')) return { rows: state.filter(row => params[0].includes(row.id)) };
    if (sql.startsWith('UPDATE inventario_insumos SET stock_actual')) state.find(row => row.id === params[1]).stock_actual = params[0];
    if (sql.startsWith('INSERT INTO inventario_movimientos')) movimientos.push(params);
    if (sql.startsWith('INSERT INTO inventario_insumos') || sql.startsWith('UPDATE inventario_insumos SET codigo=')) {
      const updating = sql.startsWith('UPDATE');
      const row = updating ? state.find(row => row.id === params[11]) : { ...base(state.length + 1, 0) };
      if (!row) return { rows: [] };
      ['codigo','nombre','categoria_almacen','unidad_base','permite_paquetes','nombre_paquete','factor_paquete','stock_minimo','costo_unitario','ubicacion','activo'].forEach((key, index) => { row[key] = params[index]; });
      if (!updating) state.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT * FROM inventario_insumos')) return { rows: state.filter(row => row.activo || params[0] === true) };
    if (sql.startsWith('SELECT m.*')) return { rows: movimientos };
    return { rows: [] };
  };
  const client = { query, release() { log.push({ sql: 'RELEASE' }); } };
  const pool = { query: async (sql, params) => sql.includes('FROM usuarios') ? { rows: [{ id: 8, nombre: 'Operador', rol: options.storedRole ?? currentRole, activo: options.activeUser !== false }] } : query(sql, params), connect: async () => client };
  const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (route, ...handlers) => routes.set(`${method} ${route}`, handlers)]));
  registrarInventario(app, pool, event => { events.push(event); log.push({ sql: 'EVENT' }); });
  let currentRole;
  return { log, events, get state() { return state; }, get movimientos() { return movimientos; },
    async request(method, route, body = {}, role = 'ADMIN', params = {}, queryParams = {}) {
      currentRole = role;
      const req = { body, params, query: queryParams, headers: { authorization: role ? `Bearer ${sessionModule.exports.emitirSesion(8, role)}` : '' } };
      const res = Object.assign(new (require('node:events').EventEmitter)(), { locals: {}, code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
      for (const handler of routes.get(`${method} /api/inventario${route}`)) {
        let next = false;
        await handler(req, res, () => { next = true; });
        if (!next) break;
      }
      return res;
    } };
}
const lote = items => ({ origen: 'SALIDA_COCINA', items });
const item = (insumoId, cantidad, modoCaptura = 'UNIDAD') => ({ insumoId, cantidad, modoCaptura });
test('guardia: limites, prioridad, decimales y desglose', () => {
  for (const [stock, estado] of [[0,'SIN_STOCK'],[10,'BAJO_GUARDIA'],[12.5,'PRECAUCION'],[12.51,'OK']]) assert.equal(enriquecerInsumo(base(1, stock)).estado_guardia, estado);
  const value = enriquecerInsumo(base(1, 29));
  assert.equal(value.desglose_paquetes.paquetesCompletos, 2);
  assert.equal(value.desglose_paquetes.unidadesSueltas, 5);
  assert.equal(enriquecerInsumo(base(1, 3)).faltante_sugerido, 7);
  assert.equal(enriquecerInsumo(base(1, 29, false)).desglose_paquetes, null);
});
test('lote mixto: conversion, bloqueo ordenado, auditoria y evento tras commit', async () => {
  const env = entorno();
  const res = await env.request('post', '/salidas-lote', lote([item(2, 1, 'PAQUETE'), item(1, 3)]), 'COCINERO');
  assert.equal(res.code, 200);
  assert.equal(env.state[0].stock_actual, 37);
  assert.equal(env.state[1].stock_actual, 28);
  assert.match(env.log.find(entry => entry.sql.includes('FOR UPDATE')).sql, /ORDER BY id ASC FOR UPDATE/);
  assert.equal(JSON.stringify(env.log.find(entry => entry.sql.includes('FOR UPDATE')).params), '[[1,2]]');
  assert.equal(env.movimientos[0][5], -12);
  assert.equal(env.movimientos[0][9], 8);
  assert.equal(env.movimientos[0][10], 'Operador');
  assert.deepEqual(env.events, ['actualizar_inventario']);
  assert.ok(env.log.findIndex(entry => entry.sql === 'COMMIT') < env.log.findIndex(entry => entry.sql === 'EVENT'));
});
test('409 revierte lote completo y no emite; duplicados consumen saldo acumulado', async () => {
  for (const items of [[item(1, 2), item(2, 50)], [item(1, 30), item(1, 20)]]) {
    const env = entorno();
    const res = await env.request('post', '/salidas-lote', lote(items));
    assert.equal(res.code, 409);
    assert.equal(env.state[0].stock_actual, 40);
    assert.equal(env.state[1].stock_actual, 40);
    assert.equal(env.movimientos.length, 0);
    assert.equal(env.events.length, 0);
    assert.ok(env.log.some(entry => entry.sql === 'ROLLBACK'));
  }
});
test('paquete no permitido 400; ausente/inactivo 404; validacion numerica', async () => {
  const env = entorno([base(1, 40, false)]);
  assert.equal((await env.request('post', '/salidas-lote', lote([item(1, 1, 'PAQUETE')]))).code, 400);
  assert.equal((await env.request('post', '/salidas-lote', lote([item(9, 1)]))).code, 404);
  for (const cantidad of [0, -1, null, '1', 0.001, Infinity]) assert.equal((await env.request('post', '/salidas-lote', lote([item(1, cantidad)]))).code, 400);
  assert.equal((await env.request('post', '/salidas-lote', lote([]))).code, 400);
});
test('compra y conteo fisico generan delta real, saldo y responsable', async () => {
  const env = entorno();
  assert.equal((await env.request('post', '/insumos/:id/ajuste', { tipoMovimiento: 'ENTRADA_COMPRA', modoCaptura: 'PAQUETE', cantidad: 2 }, 'ADMIN', { id: '1' })).code, 200);
  assert.equal(env.state[0].stock_actual, 64);
  assert.equal(env.movimientos[0][5], 24);
  assert.equal((await env.request('post', '/insumos/:id/ajuste', { tipoMovimiento: 'REINVENTARIO_AJUSTE', paquetesContados: 3, unidadesSueltasContadas: 2, notas: 'Conteo' }, 'ADMIN', { id: '1' })).code, 200);
  assert.equal(env.state[0].stock_actual, 38);
  assert.equal(env.movimientos[1][5], -26);
  assert.equal(env.movimientos[1][7], 38);
  assert.equal(env.movimientos[1][8], 'Conteo');
  await env.request('post', '/insumos/:id/ajuste', { tipoMovimiento: 'REINVENTARIO_AJUSTE', nuevoStockFisico: 0 }, 'ADMIN', { id: '1' });
  assert.equal(env.state[0].stock_actual, 0);
  assert.equal(env.movimientos[2][5], -38);
});
test('sesion y roles: cocina opera pero no administra; mesero no descuenta', async () => {
  const env = entorno();
  for (const [method, route] of [['post','/insumos'],['put','/insumos/:id'],['post','/insumos/:id/ajuste'],['get','/movimientos']]) assert.equal((await env.request(method, route, {}, 'COCINERO')).code, 403);
  assert.equal((await env.request('post', '/salidas-lote', lote([item(1, 1)]), 'MESERO')).code, 403);
  assert.equal((await env.request('get', '/insumos', {}, '')).code, 401);
  assert.equal(env.log.length, 0);
});
test('sesion vigente: usuario desactivado o rol cambiado rechaza con 401 sin mutaciones', async () => {
  for (const options of [{ activeUser: false }, { storedRole: 'MESERO' }]) {
    const env = entorno(undefined, options);
    assert.equal((await env.request('post', '/salidas-lote', lote([item(1, 1)]))).code, 401);
    assert.equal(env.log.length, 0);
  }
});
test('altas/edicion: stock inicial auditado y PUT no permite cambiar stock directamente', async () => {
  const env = entorno([]);
  const config = { nombre: 'Botella', codigo: 'B-1', permite_paquetes: true, factor_paquete: 12, stock_minimo: 8, stock_inicial: 29 };
  const created = await env.request('post', '/insumos', config);
  assert.equal(created.code, 201);
  assert.equal(created.body.stock_actual, 29);
  assert.equal(created.body.desglose_paquetes.paquetesCompletos, 2);
  assert.equal(env.movimientos.length, 1);
  assert.equal(env.movimientos[0][1], 'ENTRADA_COMPRA');
  assert.equal(env.movimientos[0][5], 29);
  assert.equal(env.movimientos[0][8], 'Stock inicial');
  const updated = await env.request('put', '/insumos/:id', { ...config, nombre: 'Nueva botella', stock_actual: 999, stock_inicial: 999 }, 'ADMIN', { id: '1' });
  assert.equal(updated.code, 200);
  assert.equal(updated.body.stock_actual, 29);
  assert.equal(env.movimientos.length, 1);
  assert.equal((await env.request('put', '/insumos/:id', config, 'ADMIN', { id: '99' })).code, 404);
});
test('lecturas: roles, inactivos solo ADMIN, contadores y filtros Kardex acotados', async () => {
  const env = entorno([base(1, 0), base(2, 9), base(3, 12), base(4, 30), { ...base(5), activo: false }]);
  for (const role of ['ADMIN', 'CAJERO', 'COCINERO', 'MESERO']) {
    assert.equal((await env.request('get', '/insumos', {}, role)).body.length, 4);
    const res = await env.request('get', '/resumen-alertas', {}, role);
    assert.equal(res.body.totalInsumos, 4);
    assert.equal(res.body.sinStock, 1);
    assert.equal(res.body.bajoGuardia, 1);
    assert.equal(res.body.enPrecaucion, 1);
    assert.equal(res.body.itemsCriticos.length, 2);
  }
  assert.equal((await env.request('get', '/insumos', {}, 'ADMIN', {}, { incluirInactivos: 'true' })).body.length, 5);
  assert.equal((await env.request('get', '/insumos', {}, 'COCINERO', {}, { incluirInactivos: 'true' })).code, 403);
  assert.equal((await env.request('get', '/movimientos', {}, 'ADMIN', {}, { insumoId: '1', tipoMovimiento: 'MERMA', limite: '30' })).code, 200);
  assert.equal(JSON.stringify(env.log.at(-1).params), '[1,"MERMA",30]');
  assert.match(env.log.at(-1).sql, /ORDER BY m.fecha DESC, m.id DESC LIMIT/);
  for (const query of [{ limite: '501' }, { limite: '0' }, { insumoId: 'x' }, { tipoMovimiento: 'DROP' }]) assert.equal((await env.request('get', '/movimientos', {}, 'ADMIN', {}, query)).code, 400);
});
test('fallo de auditoria y codigo duplicado: rollback, release y ningun evento', async () => {
  const env = entorno(undefined, { failSql: 'INSERT INTO inventario_movimientos' });
  assert.equal((await env.request('post', '/salidas-lote', lote([item(1, 1)]))).code, 500);
  assert.equal(env.state[0].stock_actual, 40);
  assert.equal(env.events.length, 0);
  assert.equal(env.log.at(-1).sql, 'RELEASE');
  const duplicate = entorno([], { failSql: 'INSERT INTO inventario_insumos', errorCode: '23505' });
  assert.equal((await duplicate.request('post', '/insumos', { nombre: 'Duplicado' })).code, 409);
  assert.equal(duplicate.events.length, 0);
  assert.ok(duplicate.log.some(entry => entry.sql === 'ROLLBACK'));
});
test('conteo sin cambio no inserta cantidad cero; conversion subcentesimal se rechaza', async () => {
  const env = entorno([{ ...base(1, 10), factor_paquete: 1.25 }]);
  assert.equal((await env.request('post', '/insumos/:id/ajuste', { tipoMovimiento: 'REINVENTARIO_AJUSTE', nuevoStockFisico: 10 }, 'ADMIN', { id: '1' })).code, 200);
  assert.equal(env.movimientos.length, 0);
  assert.equal((await env.request('post', '/salidas-lote', lote([item(1, 0.01, 'PAQUETE')]))).code, 400);
  assert.equal(env.state[0].stock_actual, 10);
  assert.equal((await env.request('post', '/salidas-lote', lote([item(1, 0.04, 'PAQUETE')]))).code, 200);
  assert.equal(env.state[0].stock_actual, 9.95);
});
test('REQ-01: esquema inicial y migracion 007 equivalentes, checks y FK persistentes', () => {
  const init = fs.readFileSync(path.join(root, 'Database/000_init.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'Database/migrations/007_inventario_almacen.sql'), 'utf8');
  for (const table of ['inventario_insumos', 'inventario_movimientos']) {
    const tableSql = text => text.match(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\([\\s\\S]*?\\n\\);`))[0].replace('IF NOT EXISTS ', '');
    assert.equal(tableSql(init), tableSql(migration));
  }
  assert.match(migration, /REFERENCES inventario_insumos\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES usuarios\(id\) ON DELETE SET NULL/);
  for (const check of ['stock_actual >= 0', 'stock_minimo >= 0', 'cantidad_capturada > 0', 'factor_aplicado > 0']) assert.ok(migration.includes(check));
  assert.match(migration, /\(insumo_id, fecha DESC\)/);
  const index = fs.readFileSync(path.join(root, 'backend-borboto/index.ts'), 'utf8');
  const registro = index.indexOf('registrarInventario(app, pool, emitirCambioGlobal)');
  assert.ok(registro >= 0, 'index.ts debe registrar el modulo de inventario');
  assert.ok(registro < index.indexOf("app.use('/api',"), 'el inventario debe registrarse antes del middleware /api');
});
test('AC-09 / TEST-12: dictado nativo conserva prefijo y reemplaza provisionales sin duplicar', async () => {
  const voice = navegadorVoz(), env = await componenteInventario('InventarioComponent', voice.window), component = env.component;
  component.formulario.controls.notas.setValue('Para cocina  ');
  component.iniciarDictadoNota(pulsacion());
  const recognition = voice.instances[0];
  assert.equal(recognition.lang, 'es-MX'); assert.equal(recognition.interimResults, true); assert.equal(recognition.continuous, true);
  recognition.result('dos'); recognition.result('dos cajas', 'de agua');
  assert.equal(component.formulario.controls.notas.value, 'Para cocina dos cajas de agua');
  component.detenerDictadoNota(pulsacion()); component.detenerDictadoNota(pulsacion());
  assert.equal(recognition.stops, 1);
  recognition.result('dos cajas', 'de agua mineral'); recognition.onend();
  assert.equal(component.formulario.controls.notas.value, 'Para cocina dos cajas de agua mineral');
  assert.equal(component.procesandoDictado(), false); assert.equal(env.avisos.length, 0); env.destroy();
});
test('TEST-12: permiso nativo cierra tracks antes de reconocimiento y no repite solicitud concedida', async () => {
  let permitir, solicitudes = 0, stops = 0;
  const permiso = new Promise(resolve => { permitir = resolve; }), voice = navegadorVoz();
  const env = await componenteInventario('InventarioComponent', { ...voice.window, navigator: { mediaDevices: { getUserMedia(options) { assert.equal(options.audio, true); solicitudes++; return permiso; } } } });
  env.component.iniciarDictadoNota(pulsacion());
  assert.equal(env.component.pidiendoPermiso(), true); assert.equal(voice.instances.length, 0);
  permitir({ getTracks: () => [{ stop() { stops++; } }] }); await tick();
  assert.equal(stops, 1); assert.equal(voice.instances.length, 1); assert.equal(env.component.pidiendoPermiso(), false);
  env.component.detenerDictadoNota(pulsacion()); voice.instances[0].onend();
  env.component.iniciarDictadoNota(pulsacion()); await tick();
  assert.equal(solicitudes, 1); assert.equal(voice.instances.length, 2); env.destroy();
});
test('TEST-12: clic corto y destroy durante permiso cierran tracks tardios sin abrir reconocimiento', async () => {
  for (const destruir of [true, false]) {
    let permitir, stops = 0;
    const voice = navegadorVoz(), permiso = new Promise(resolve => { permitir = resolve; });
    const env = await componenteInventario('InventarioComponent', { ...voice.window, navigator: { mediaDevices: { getUserMedia: () => permiso } } });
    env.component.iniciarDictadoNota(pulsacion());
    if (destruir) env.destroy(); else env.component.detenerDictadoNota(pulsacion());
    permitir({ getTracks: () => [{ stop() { stops++; } }] }); await tick();
    assert.equal(stops, 1); assert.equal(voice.instances.length, 0); assert.equal(env.component.procesandoDictado(), false);
    assert.equal(env.focos, 0); assert.equal(env.avisos.length, 0); if (!destruir) env.destroy();
  }
});
test('TEST-12: HTTP inseguro o API ausente enfoca nota y guia discreta sin alertas ni flags', async () => {
  for (const options of [{ isSecureContext: false, ...navegadorVoz().window }, {}]) {
    const env = await componenteInventario('InventarioComponent', options);
    env.component.formulario.controls.notas.setValue('Escrito'); env.component.iniciarDictadoNota(pulsacion());
    assert.equal(env.focos, 1); assert.ok(env.component.guiaDictado().includes('teclado'));
    assert.equal(env.component.guiaDictado().includes('chrome://'), false); assert.equal(env.avisos.length, 0);
    assert.equal(env.component.formulario.controls.notas.value, 'Escrito'); assert.equal(env.component.procesandoDictado(), false); env.destroy();
  }
});
test('TEST-12: fallos nativos dejan nota editable con foco y sin avisos alarmantes', async () => {
  for (const error of ['network', 'service-not-allowed', 'not-allowed', 'audio-capture', 'no-speech', 'language-not-supported']) {
    const voice = navegadorVoz(), env = await componenteInventario('InventarioComponent', voice.window);
    env.component.formulario.controls.notas.setValue('Nota'); env.component.iniciarDictadoNota(pulsacion());
    voice.instances[0].onerror({ error });
    assert.equal(env.focos, 1, error); assert.equal(env.avisos.length, 0, error);
    assert.equal(env.component.formulario.controls.notas.value, 'Nota'); assert.equal(env.component.procesandoDictado(), false);
    assert.equal(voice.instances[0].aborts, 1); assert.equal(voice.instances[0].onresult, null);
    if (['network', 'service-not-allowed'].includes(error)) { env.component.iniciarDictadoNota(pulsacion()); assert.equal(voice.instances.length, 1); assert.equal(env.focos, 2); }
    env.destroy();
  }
});
test('TEST-12: permiso denegado o start fallido usa teclado sin snackbar', async () => {
  for (const denegado of [true, false]) {
    let rechazar;
    const permiso = new Promise((_resolve, reject) => { rechazar = reject; }), voice = navegadorVoz({ startError: !denegado });
    const env = await componenteInventario('InventarioComponent', denegado ? { ...voice.window, navigator: { mediaDevices: { getUserMedia: () => permiso } } } : voice.window);
    env.component.iniciarDictadoNota(pulsacion());
    if (denegado) rechazar(new DOMException('Denied', 'NotAllowedError'));
    await tick(); assert.equal(env.focos, 1); assert.equal(env.avisos.length, 0); assert.equal(env.component.procesandoDictado(), false); env.destroy();
  }
});
test('TEST-12: teclado, variante webkit, limite 255 y destroy descartan eventos tardios', async () => {
  const voice = navegadorVoz({ webkit: true }), env = await componenteInventario('InventarioComponent', voice.window);
  env.component.iniciarDictadoNota({ key: 'Tab', preventDefault() {} }); assert.equal(voice.instances.length, 0);
  env.component.formulario.controls.notas.setValue('x'.repeat(250));
  env.component.iniciarDictadoNota({ key: ' ', preventDefault() {} });
  const recognition = voice.instances[0]; recognition.result('texto mas largo');
  assert.equal(env.component.formulario.controls.notas.value.length, 255);
  const callback = recognition.onresult, anterior = env.component.formulario.controls.notas.value;
  env.destroy(); assert.equal(recognition.aborts, 1); assert.equal(recognition.onresult, null);
  callback({ results: [[{ transcript: 'no escribir' }]] }); assert.equal(env.component.formulario.controls.notas.value, anterior);
});
test('TEST-12: permiso Electron media solo audio, origen propio, ventana principal', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = main.indexOf('function configurarPermisoMedios('), end = main.indexOf('function createMainWindow()', start);
  if (start < 0) {
    assert.ok(main.includes('contextIsolation: true'));
    assert.ok(main.includes('nodeIntegration: false'));
    assert.equal(main.includes('dictado-iniciar'), false);
    assert.equal(main.includes('setPermissionRequestHandler'), false);
    return;
  }
  for (const isDev of [true, false]) {
    let check, request;
    const ownUrl = isDev ? 'http://127.0.0.1:4200/#/inventario' : require('node:url').pathToFileURL(path.join(root, 'dist/borboto/browser/index.html')).href + '#/inventario';
    const webContents = { getURL: () => ownUrl, session: { setPermissionCheckHandler(handler) { check = handler; }, setPermissionRequestHandler(handler) { request = handler; } } };
    const ventana = { webContents, isDestroyed: () => false };
    vm.runInNewContext(main.slice(start, end) + 'configurarPermisoMedios(ventana);', { path, require, URL, __dirname: root, isDev, ventana });
    const origin = isDev ? 'http://127.0.0.1:4200' : 'file://';
    const details = { mediaType: 'audio', mediaTypes: ['audio'], isMainFrame: true, requestingUrl: ownUrl };
    assert.equal(check(webContents, 'media', origin, details), true);
    assert.equal(check(webContents, 'media', origin, { ...details, mediaType: 'video' }), false);
    assert.equal(check(webContents, 'media', origin, { ...details, isMainFrame: false }), false);
    assert.equal(check({}, 'media', origin, details), false);
    assert.equal(check(webContents, 'media', 'https://otro.example', details), false);
    let autorizado; request(webContents, 'media', value => { autorizado = value; }, details); assert.equal(autorizado, true);
    request(webContents, 'media', value => { autorizado = value; }, { ...details, mediaTypes: ['video'] }); assert.equal(autorizado, false);
    request(webContents, 'notifications', value => { autorizado = value; }, details); assert.equal(autorizado, false);
  }
});
test('TEST-12: distribucion y backend no dependen de voz externa', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(fs.existsSync(path.join(root, 'speech')), false);
  assert.equal(fs.existsSync(path.join(root, 'electron-dictation.cjs')), false);
  assert.equal(config.dependencies['@huggingface/transformers'], undefined);
  assert.equal(config.scripts['speech:check'], undefined); assert.equal(config.scripts['speech:prepare'], undefined);
  assert.equal(config.scripts.dist.includes('speech:'), false);
  assert.equal(config.build.extraResources.some(resource => resource.from === 'speech'), false);
  assert.deepEqual(config.build.asarUnpack, ['**/node_modules/pdf-to-printer/**/*']);
  for (const file of ['backend-borboto/index.ts', 'backend-borboto/src/modules/inventario.ts', 'src/app/core/services/inventario.service.ts']) assert.equal(fs.readFileSync(path.join(root, file), 'utf8').includes('transcribir-nota'), false);
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8'); assert.equal(preload.includes('dictado-'), false);
});