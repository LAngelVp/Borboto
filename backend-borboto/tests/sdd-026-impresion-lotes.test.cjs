const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { of, throwError } = require('rxjs');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = text => transformSync(text, { loader: 'ts', target: 'node18', format: 'cjs' }).code;

function printerModule(pool) {
  const template = { exports: {} };
  vm.runInNewContext(
    compile(read('backend-borboto/src/modules/printer/templates/ticket-templates.ts')),
    { module: template, exports: template.exports },
  );
  const module = { exports: {} };
  vm.runInNewContext(compile(read('backend-borboto/src/modules/printer/printer.service.ts')), {
    module,
    exports: module.exports,
    console: { log() {}, error() {} },
    require(name) {
      if (name.endsWith('/db.ts')) return { pool };
      if (name.includes('ticket-templates')) return template.exports;
      return {};
    },
  });
  return module.exports;
}

function frontend(file, name, injections, globals = {}) {
  function signal(initial) {
    let value = initial;
    const get = () => value;
    get.set = next => { value = next; };
    get.update = update => { value = update(value); };
    return get;
  }
  const tokens = new Map();
  const module = { exports: {} };
  vm.runInNewContext(compile(read(file)), {
    module,
    exports: module.exports,
    console: { log() {}, error() {} },
    ...globals,
    require(dependency) {
      if (dependency === 'rxjs') return require('rxjs');
      const angular = dependency === '@angular/core'
        ? {
            Injectable: () => target => target,
            Component: () => target => target,
            signal,
            computed: derive => derive,
            inject: token => injections[token.name] ?? {},
            ChangeDetectionStrategy: { OnPush: 0 },
          }
        : {};
      return new Proxy(angular, {
        get(target, property) {
          if (property === '__esModule') return undefined;
          if (property in target) return target[property];
          if (!tokens.has(property)) {
            tokens.set(property, Object.defineProperty(function Token() {}, 'name', { value: property }));
          }
          return tokens.get(property);
        },
      });
    },
  });
  return new module.exports[name]();
}

test('SDD-026: migracion 010 crea estados, lote e idempotencia', () => {
  const migration = read('Database/migrations/010_impresion_por_lotes.sql');
  assert.match(migration, /CREATE TYPE estado_impresion_enum/);
  for (const estado of ['PENDIENTE', 'ENVIADO', 'CONFIRMADO', 'ERROR', 'NO_APLICA', 'SIMULADO']) {
    assert.ok(migration.includes(`'${estado}'`));
  }
  assert.match(migration, /CREATE TABLE IF NOT EXISTS comanda_envios/);
  assert.match(migration, /UNIQUE \(comanda_id, idempotency_key\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS envio_id INT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS estado_impresion estado_impresion_enum/);
  assert.match(migration, /fk_comanda_items_envio/);
});

test('SDD-026: la impresion por lote selecciona solo itemIds del envio actual', async () => {
  const log = [];
  const client = {
    async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('FROM comandas')) return { rows: [{ folio_comanda: 9, atendido_por: 'Mesero', fecha: 'hoy' }] };
      if (sql.includes('FROM comanda_items')) {
        const ids = Array.isArray(params?.[1]) ? params[1] : [];
        return { rows: ids.map(id => ({ id, cantidad: 1, nombre: `Producto ${id}`, destino_impresion: 'COCINA' })) };
      }
      return { rows: [] };
    },
    release() {},
  };
  const { PrinterService } = printerModule({ connect: async () => client });
  PrinterService.obtenerImpresorasPorDestino = async () => [{ tipo: 'RED', nombre: 'Cocina', activa: true }];
  PrinterService.enviarDirectoAImpresora = async () => null;

  const result = await PrinterService.imprimirComandaProduccion(1, { itemIds: [4], envioId: 11 });

  const select = log.find(entry => entry.sql.includes('FROM comanda_items'));
  assert.deepEqual(Array.from(select.params[1]), [4]);
  assert.ok(select.sql.includes('ci.id = ANY($2::int[])'));
  assert.ok(select.sql.includes("estado_impresion IN ('PENDIENTE', 'ERROR')"));
  const confirm = log.find(entry => entry.sql.includes("estado_impresion = 'CONFIRMADO'"));
  assert.deepEqual(Array.from(confirm.params[0]), [4]);
  assert.equal(result.procesados, 1);
  assert.ok(log.some(entry => entry.sql.includes('UPDATE comanda_envios e SET')));
});

test('SDD-026: simulacion marca SIMULADO e impreso para no repetir el lote', async () => {
  const log = [];
  const client = {
    async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('FROM comandas')) return { rows: [{ folio_comanda: 2, atendido_por: 'Caja', fecha: 'hoy' }] };
      if (sql.includes('FROM comanda_items')) return { rows: [{ id: 8, cantidad: 2, nombre: 'Tacos', destino_impresion: 'COCINA' }] };
      return { rows: [] };
    },
    release() {},
  };
  const { PrinterService } = printerModule({ connect: async () => client });
  PrinterService.obtenerImpresorasPorDestino = async () => [{ tipo: 'SIMULACION', nombre: 'Sim', activa: true }];
  PrinterService.enviarDirectoAImpresora = async () => 'ticket simulado';

  const result = await PrinterService.imprimirComandaProduccion(1, { itemIds: [8], envioId: 12 });
  const simulado = log.find(entry => entry.sql.includes("estado_impresion = 'SIMULADO'"));
  assert.deepEqual(Array.from(simulado.params[0]), [8]);
  assert.ok(simulado.sql.includes('impreso = TRUE'));
  assert.equal(result.procesados, 1);
});

test('SDD-026: ACK USB confirma lote y error de impresion lo marca ERROR', async () => {
  const queries = [];
  const { PrinterService } = printerModule({
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT DISTINCT envio_id')) return { rows: [{ envio_id: 15 }] };
      return { rows: [] };
    },
  });

  await PrinterService.confirmarItemsImpresos([5], 15);
  assert.ok(queries[0].sql.includes("estado_impresion = 'CONFIRMADO'"));
  assert.ok(queries.some(entry => entry.sql.includes('UPDATE comanda_envios e SET')));

  queries.length = 0;
  await PrinterService.marcarItemsErrorImpresion([6], 16, 'impresora desconectada');
  assert.ok(queries[0].sql.includes("estado_impresion = 'ERROR'"));
  assert.ok(queries[0].sql.includes('impresion_intentos = impresion_intentos + 1'));
  assert.ok(queries.some(entry => entry.sql.includes("SET estado = 'ERROR'") && entry.params[1] === 'impresora desconectada'));
});

test('SDD-026: idempotencyKey evita duplicar items y devuelve el lote existente', async () => {
  const backend = read('backend-borboto/index.ts');
  const start = backend.indexOf("app.post('/api/comandas',");
  const end = backend.indexOf('\n});', start) + 4;
  assert.ok(start >= 0 && end > start);

  const log = [];
  const client = {
    async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('FROM comandas WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 1, mesa_id: 5, estado: 'ABIERTA', total: 0, tipo_origen: 'MESA', folio_origen: '5' }] };
      }
      if (sql.includes('FROM comanda_envios')) return { rows: [{ id: 55, estado: 'CONFIRMADO' }] };
      if (/^(INSERT|UPDATE)/.test(sql)) throw new Error(`escritura inesperada: ${sql}`);
      return { rows: [] };
    },
    release() {},
  };

  let handler;
  vm.runInNewContext(compile(backend.slice(start, end)), {
    app: { post(_route, callback) { handler = callback; } },
    pool: { connect: async () => client, query: async () => ({ rows: [] }) },
    emitirCambioGlobal() {},
    PrinterService: { imprimirComandaProduccion: async () => { throw new Error('no debe imprimir'); } },
    obtenerOrigenComandaPorMesa: async () => null,
    obtenerComandaPorId: async () => null,
    console: { log() {}, error() {}, warn() {} },
  });

  const res = {
    code: 200,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ body: {
    comandaId: 1,
    usuarioId: 3,
    idempotencyKey: 'envio-prueba-1',
    items: [{ productoId: 2, cantidad: 1 }],
  } }, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.envioId, 55);
  assert.equal(res.body.idempotente, true);
  assert.equal(log.some(entry => entry.sql.startsWith('INSERT INTO comanda_items')), false);
  assert.equal(log.some(entry => entry.sql.startsWith('INSERT INTO comanda_envios')), false);
});

test('SDD-026: frontend envia envioId en ACK y reporta error USB', async () => {
  for (const mode of ['ok', 'error']) {
    const calls = [];
    const service = frontend('src/app/core/services/printer.service.ts', 'PrinterService', {
      RuntimeConfigService: { apiBaseUrl: '/api' },
      HttpClient: {
        post(url, body) {
          calls.push({ url, body });
          if (mode === 'error' && url.endsWith('/error-impresion')) return of({ ok: true });
          if (mode === 'ok' && url.endsWith('/confirmar-impresion')) return of({ ok: true });
          return throwError(() => new Error('fallo'));
        },
      },
    }, {
      window: {
        borbotoElectron: {
          invoke: async () => {
            if (mode === 'error') throw new Error('impresora desconectada');
            return { ok: true };
          },
        },
      },
    });

    const job = {
      tipo: 'USB',
      printerName: 'Mock',
      contenido: 'ticket',
      titulo: 'Comanda',
      itemIds: [3],
      envioId: 21,
    };

    if (mode === 'error') {
      await assert.rejects(() => service.printTicketSilently(job));
      const reporte = calls.find(call => call.url.endsWith('/error-impresion'));
      assert.equal(reporte.body.envioId, 21);
      assert.deepEqual(Array.from(reporte.body.itemIds), [3]);
    } else {
      await service.printTicketSilently(job);
      const ack = calls.find(call => call.url.endsWith('/confirmar-impresion'));
      assert.equal(ack.body.envioId, 21);
      assert.deepEqual(Array.from(ack.body.itemIds), [3]);
    }
  }
});
