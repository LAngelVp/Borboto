const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const compile = text => transformSync(text, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), { module, exports: module.exports, Buffer, require: name => dependencies[name] ?? require(name) });
  return module.exports;
}
const session = load('backend-borboto/src/session.ts');
const backend = load('backend-borboto/src/modules/inventario.ts', { '../session': session, './resurtido': load('backend-borboto/src/modules/resurtido.ts') });
const insumo = (id, stock = 10, permite = true) => ({ id, nombre: `Insumo ${id}`, activo: true, permite_paquetes: permite, factor_paquete: 12, stock_actual: stock, stock_minimo: 20, unidad_base: 'PIEZA', categoria_almacen: 'ALMACEN', costo_unitario: 2 });
function fixture(options = {}) {
  let stocks = [insumo(1), insumo(2, 5, false), insumo(3)], listas = [], items = [], movimientos = [], snapshot, role;
  const routes = new Map(), log = [], events = [];
  const query = async (sql, values = []) => {
    log.push({ sql, values });
    if (options.fail && sql.startsWith(options.fail)) throw Error('Mock SQL failure');
    if (sql === 'BEGIN') snapshot = structuredClone({ stocks, listas, items, movimientos });
    if (sql === 'ROLLBACK') ({ stocks, listas, items, movimientos } = snapshot);
    if (sql.includes('FROM usuarios')) return { rows: [{ id: 7, rol: role, activo: true, nombre: 'Admin' }] };
    if (sql.includes('FROM inventario_insumos') && sql.includes('FOR UPDATE')) return { rows: stocks.filter(row => values[0].includes(row.id)) };
    if (sql.startsWith('UPDATE inventario_insumos SET stock_actual')) stocks.find(row => row.id === values[1]).stock_actual = values[0];
    if (sql.startsWith('INSERT INTO inventario_movimientos')) movimientos.push(values);
    if (sql.startsWith('WITH nuevo')) {
      const id = listas.length + 1, row = { id, folio: `RES-${String(id).padStart(4, '0')}`, nombre: values[0], margen_guardia: values[1], notas: values[2], usuario_id: values[3], usuario_nombre: values[4], estado: 'PENDIENTE', creada_en: '2026-11-13T10:00:00' };
      listas.push(row); return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO inventario_listas_resurtido_items')) {
      const extra = sql.includes('cantidad_comprada');
      items.push({ id: items.length + 1, lista_id: values[0], insumo_id: values[1], modo_captura: values[2], cantidad_sugerida: values[3], cantidad_comprada: extra ? values[3] : null, comprado: true, stock_actual_snapshot: values[4], stock_minimo_snapshot: values[5] });
    }
    if (sql.startsWith('SELECT li.*')) return { rows: items.filter(item => values[0].includes(item.lista_id)).map(item => ({ ...item, insumo: stocks.find(stock => stock.id === item.insumo_id) })) };
    if (sql.startsWith('SELECT * FROM inventario_listas_resurtido_items')) return { rows: items.filter(item => item.lista_id === values[0]) };
    if (sql.startsWith('SELECT * FROM inventario_listas_resurtido WHERE id')) return { rows: listas.filter(lista => lista.id === values[0]) };
    if (sql.startsWith('SELECT * FROM inventario_listas_resurtido WHERE estado')) return { rows: listas };
    if (sql.startsWith('UPDATE inventario_listas_resurtido_items SET comprado=FALSE')) items.filter(item => item.lista_id === values[0]).forEach(item => { item.comprado = false; item.cantidad_comprada = 0; });
    if (sql.startsWith('UPDATE inventario_listas_resurtido_items SET comprado=TRUE')) Object.assign(items.find(item => item.lista_id === values[2] && item.insumo_id === values[3]), { comprado: true, cantidad_comprada: values[0], modo_captura: values[1] });
    if (sql.startsWith('UPDATE inventario_listas_resurtido SET estado=')) listas.find(lista => lista.id === values[0]).estado = sql.includes("'RECIBIDA'") ? 'RECIBIDA' : 'CANCELADA';
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() { log.push({ sql: 'RELEASE' }); } }) };
  const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (route, ...handlers) => routes.set(`${method} ${route}`, handlers)]));
  backend.registrarInventario(app, pool, event => { events.push(event); log.push({ sql: 'EVENT' }); });
  return { log, events, get stocks() { return stocks; }, get listas() { return listas; }, get items() { return items; }, get movimientos() { return movimientos; },
    async request(method, route, body = {}, rol = 'ADMIN', id = '1') {
      role = rol;
      const res = { locals: {}, code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      for (const handler of routes.get(`${method} /api/inventario/listas-resurtido${route}`)) {
        let next = false; await handler({ body, params: { id }, headers: { authorization: rol ? `Bearer ${session.emitirSesion(7, rol)}` : '' } }, res, () => { next = true; });
        if (!next) break;
      }
      return res;
    },
  };
}
const pedido = { nombre: 'Compra semanal', margenGuardia: 5, items: [{ insumoId: 1, modoCaptura: 'PAQUETE', cantidadSugerida: 2 }, { insumoId: 2, modoCaptura: 'UNIDAD', cantidadSugerida: 5 }] };
const report = load('src/app/features/inventario/resurtido-report.ts');
test('margen, categoria y sugerencia de paquetes/unidades, incluida igualdad de umbral', () => {
  const rows = [insumo(1, 25), insumo(2, 26, false), insumo(3, 10)];
  assert.deepEqual(Array.from(report.filtrarResurtido(rows, 'GUARDIA_MAS_MARGEN', 5, 'TODAS'), row => row.id), [1, 3]);
  assert.deepEqual(Array.from(report.filtrarResurtido(rows, 'BAJO_GUARDIA', 5, 'TODAS'), row => row.id), [3]);
  assert.equal(report.filtrarResurtido(rows, 'CATEGORIA', 0, 'COCINA').length, 0);
  assert.equal(report.filtrarResurtido(rows, 'CATEGORIA', 0, 'ALMACEN').length, 3);
  assert.equal(report.sugerirResurtido(insumo(1, 5), 5).cantidad, 2);
  assert.equal(report.sugerirResurtido(insumo(2, 5, false), 5).cantidad, 20);
  assert.equal(report.sugerirResurtido(insumo(1, 25), 5).cantidad, 1);
});
test('exportacion Excel conserva 15 columnas, calculos y texto sin formulas; PDF usa DOM seguro', () => {
  const lista = { folio: 'RES-0001', nombre: 'Compra <script>', creada_en: '2026-11-13T10:00:00', margen_guardia: 5, notas: '=NOFORMULA()', items: [{ insumo: { ...insumo(1), nombre: '=Producto', codigo: 'A', nombre_paquete: 'CAJA', ubicacion: 'B' }, cantidad_sugerida: 2, cantidad_comprada: null, modo_captura: 'PAQUETE', stock_actual_snapshot: 29, stock_minimo_snapshot: 20 }] };
  const rows = report.columnasResurtido(lista);
  assert.equal(Object.keys(rows[0]).length, 15); assert.equal(rows[0]['Equivalente en Unidad Base'], 24); assert.equal(rows[0]['Subtotal Est.'], 48);
  const XLSX = require('xlsx'), book = report.libroResurtido(lista);
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(bytes, { type: 'buffer' });
  assert.equal(parsed.Sheets.Resurtido.C2.t, 's'); assert.equal(parsed.Sheets.Resurtido.C2.f, undefined);
  assert.equal(parsed.Sheets.Resurtido.O2.v, '=NOFORMULA()');
  function node(name) { return { name, children: [], textContent: '', append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } }; }
  const doc = { head: node('head'), body: node('body'), createElement: node };
  let prints = 0; report.imprimirResurtido(lista, { document: doc, focus() {}, print() { prints++; } });
  assert.equal(prints, 1); assert.equal(doc.body.children[0].textContent, 'RES-0001 - Compra <script>');
  const text = element => element.textContent + element.children.map(text).join(' ');
  assert.ok(text(doc.body).includes('[  ]')); assert.ok(text(doc.body).includes('=Producto'));
});
test('alta y consultas: folio, snapshots autoritativos y cantidades mixtas', async () => {
  const env = fixture(), result = await env.request('post', '', pedido);
  assert.equal(result.code, 201); assert.equal(result.body.folio, 'RES-0001');
  assert.equal(result.body.items[0].stock_actual_snapshot, 10); assert.equal(result.body.items[1].stock_minimo_snapshot, 20);
  assert.equal(env.movimientos.length, 0);
  assert.equal((await env.request('get', '')).body.length, 1);
  assert.equal((await env.request('get', '/:id')).body.items.length, 2);
  assert.equal((await env.request('get', '/:id', {}, 'ADMIN', '99')).code, 404);
  assert.ok(env.log.find(entry => entry.sql.startsWith('WITH nuevo')).sql.includes('nextval'));
});
test('TODO suma paquetes/unidades y audita folio; segunda recepcion devuelve 409', async () => {
  const env = fixture(); await env.request('post', '', pedido); env.events.length = 0;
  const result = await env.request('post', '/:id/recibir', { modo: 'TODO' });
  assert.equal(result.code, 200); assert.equal(env.stocks[0].stock_actual, 34); assert.equal(env.stocks[1].stock_actual, 10);
  assert.equal(env.movimientos.length, 2); assert.equal(env.movimientos[0][1], 'ENTRADA_COMPRA'); assert.equal(env.movimientos[0][5], 24);
  assert.ok(env.movimientos[0][8].includes('RES-0001')); assert.equal(env.movimientos[0][9], 7);
  assert.equal(env.listas[0].estado, 'RECIBIDA'); assert.equal(env.items[0].cantidad_comprada, 2);
  const lock = env.log.findIndex(entry => entry.sql.includes('inventario_listas_resurtido WHERE id = $1 FOR UPDATE'));
  assert.ok(lock >= 0); assert.match(env.log.slice(lock).find(entry => entry.sql.includes('inventario_insumos') && entry.sql.includes('FOR UPDATE')).sql, /ORDER BY id ASC FOR UPDATE/);
  assert.equal((await env.request('post', '/:id/recibir', { modo: 'TODO' })).code, 409); assert.equal(env.movimientos.length, 2);
  assert.deepEqual(env.events, ['actualizar_inventario']);
});
test('PARCIAL ignora false/cero y permite cambiar modo y agregar extra', async () => {
  const env = fixture(); await env.request('post', '', pedido);
  const result = await env.request('post', '/:id/recibir', { modo: 'PARCIAL', items: [{ insumoId: 1, comprado: false, modoCaptura: 'PAQUETE', cantidadComprada: 2 }, { insumoId: 2, comprado: true, modoCaptura: 'UNIDAD', cantidadComprada: 0 }, { insumoId: 3, comprado: true, modoCaptura: 'PAQUETE', cantidadComprada: 1 }] });
  assert.equal(result.code, 200); assert.equal(env.stocks[0].stock_actual, 10); assert.equal(env.stocks[1].stock_actual, 5); assert.equal(env.stocks[2].stock_actual, 22);
  assert.equal(env.items.length, 3); assert.equal(env.items[0].comprado, false); assert.equal(env.items[1].cantidad_comprada, 0); assert.equal(env.items[2].cantidad_comprada, 1);
  const changed = fixture(); await changed.request('post', '', pedido);
  await changed.request('post', '/:id/recibir', { modo: 'PARCIAL', items: [{ insumoId: 1, comprado: true, modoCaptura: 'UNIDAD', cantidadComprada: 3 }] });
  assert.equal(changed.stocks[0].stock_actual, 13); assert.equal(changed.items[0].modo_captura, 'UNIDAD');
});
test('fallo intermedio revierte stock, items y lista; cancelar no afecta existencias', async () => {
  const env = fixture({ fail: 'INSERT INTO inventario_movimientos' }); await env.request('post', '', pedido); env.events.length = 0;
  assert.equal((await env.request('post', '/:id/recibir', { modo: 'TODO' })).code, 500);
  assert.equal(env.stocks[0].stock_actual, 10); assert.equal(env.listas[0].estado, 'PENDIENTE'); assert.equal(env.items[0].cantidad_comprada, null); assert.equal(env.events.length, 0);
  assert.equal((await env.request('post', '/:id/cancelar')).code, 200); assert.equal(env.listas[0].estado, 'CANCELADA'); assert.equal(env.stocks[0].stock_actual, 10);
  assert.equal((await env.request('post', '/:id/recibir', { modo: 'TODO' })).code, 409);
});
test('permisos y capturas invalidas no crean listas ni entradas', async () => {
  const env = fixture();
  for (const rol of ['COCINERO', 'CAJERO', 'MESERO']) for (const [method, route] of [['get', ''], ['post', ''], ['post', '/:id/recibir'], ['post', '/:id/cancelar']]) assert.equal((await env.request(method, route, pedido, rol)).code, 403);
  assert.equal((await env.request('get', '', {}, '')).code, 401);
  for (const body of [{ items: [] }, { ...pedido, margenGuardia: -1 }, { ...pedido, items: [pedido.items[0], pedido.items[0]] }, { ...pedido, items: [{ insumoId: 2, modoCaptura: 'PAQUETE', cantidadSugerida: 1 }] }]) assert.equal((await env.request('post', '', body)).code, 400);
  assert.equal(env.listas.length, 0);
});
test('esquema inicial y 008 equivalentes, FK y restricciones persistentes', () => {
  const init = fs.readFileSync(path.join(root, 'Database/000_init.sql'), 'utf8'), migration = fs.readFileSync(path.join(root, 'Database/migrations/008_inventario_listas_resurtido.sql'), 'utf8');
  for (const table of ['inventario_listas_resurtido', 'inventario_listas_resurtido_items']) {
    const sql = text => text.match(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\([\\s\\S]*?\\n\\);`))[0].replace('IF NOT EXISTS ', '');
    assert.equal(sql(init), sql(migration));
  }
  assert.ok(migration.includes('UNIQUE (lista_id, insumo_id)')); assert.ok(migration.includes('ON DELETE RESTRICT')); assert.ok(migration.includes("'PENDIENTE','RECIBIDA','CANCELADA'"));
});
test('constructor: filtrados + manual, guardado reutilizado y recepcion con extras separados', async () => {
  await import('@angular/compiler'); const forms = await import('@angular/forms');
  const { of, Subject, takeUntil } = require('rxjs'), destroyed = new Subject();
  const catalogo = [insumo(1, 25), insumo(2, 30, false), insumo(3, 10)], saved = [], received = [];
  const service = {
    listasResurtido: () => of(saved), recargar() {},
    guardarResurtido(body) { const lista = { ...body, id: saved.length + 1, folio: `RES-${saved.length + 1}`, estado: 'PENDIENTE', margen_guardia: body.margenGuardia, creada_en: '2026-11-13', items: body.items.map(item => ({ insumo: catalogo.find(row => row.id === item.insumoId), insumo_id: item.insumoId, modo_captura: item.modoCaptura, cantidad_sugerida: item.cantidadSugerida })) }; saved.push(lista); return of(lista); },
    detalleResurtido: id => of(saved.find(lista => lista.id === id)),
    recibirResurtido(id, body) { received.push({ id, body }); return of({ ok: true }); },
  };
  const tokens = new Map(), core = {
    Component: () => target => target, ChangeDetectionStrategy: { OnPush: 0 }, computed: derive => derive,
    signal(initial) { let value = initial; const read = () => value; read.set = next => { value = next; }; read.update = update => { value = update(value); }; return read; },
    inject: dependency => ({ InventarioService: service, FormBuilder: new forms.FormBuilder(), SocketService: { onEvent: () => new Subject() }, DestroyRef: { onDestroy() {} }, Injector: {} })[dependency.name],
    input: { required: () => () => catalogo }, viewChild: () => () => undefined, afterNextRender: callback => callback(),
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/app/features/inventario/resurtido.ts'), 'utf8')), { module, exports: module.exports,
    require(name) {
      if (name === '@angular/forms') return forms;
      if (name === './resurtido-report') return report;
      if (name === '@angular/core/rxjs-interop') return { takeUntilDestroyed: () => takeUntil(destroyed) };
      return new Proxy(name === '@angular/core' ? core : {}, { get(target, key) { if (key === '__esModule') return undefined; if (key in target) return target[key]; if (!tokens.has(key)) tokens.set(key, Object.defineProperty(function Token() {}, 'name', { value: key })); return tokens.get(key); } });
    },
  });
  const component = new module.exports.ResurtidoComponent(); component.ngOnInit();
  component.formulario.patchValue({ modo: 'GUARDIA_MAS_MARGEN', margen: 5 }); component.agregarFiltrados(); component.agregar(catalogo[1]);
  assert.equal(component.filas().length, 3); component.agregar(catalogo[1]); assert.equal(component.filas().length, 3);
  component.guardar('GUARDAR'); assert.equal(saved.length, 1);
  component.formulario.controls.buscar.setValue('Insumo 1'); component.guardar('GUARDAR'); assert.equal(saved.length, 1);
  component.revisar(saved[0]); component.compras.set([]); component.agregar(catalogo[1], true); assert.equal(component.compras().length, 1); assert.equal(component.filas().length, 3);
  component.cambiar(2, { cantidad: 4, comprado: true }, true); component.recibir(saved[0], 'PARCIAL');
  assert.equal(received[0].body.items[0].cantidadComprada, 4); assert.equal(received[0].body.items[0].insumoId, 2);
  destroyed.next(); destroyed.complete();
  assert.ok(fs.readFileSync(path.join(root, 'src/app/features/ajustes/ajustes.html'), 'utf8').includes('<app-inventario-admin />'));
  const template = fs.readFileSync(path.join(root, 'src/app/features/inventario/resurtido.html'), 'utf8');
  assert.equal((template.match(/\[selected\]="fila.modo === 'PAQUETE'"/g) ?? []).length, 2);
});