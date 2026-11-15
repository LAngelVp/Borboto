import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, tap } from 'rxjs';
import { Producto, ItemComanda } from '../models/producto';
import { RuntimeConfigService } from './runtime-config.service';

interface ComandaCargada {
  comandaId: number;
  mesaId: number | null;
  tipoOrigen: 'MESA' | 'MOSTRADOR' | 'ENVIO' | null;
  folioOrigen: string | null;
  items: {
    producto: Omit<Producto, 'precio'> & { precio: number | string };
    cantidad: number;
    subtotal: number | string;
    notas?: string;
  }[];
}

export interface EnvioImpresion {
  id: number;
  estado: 'PENDIENTE' | 'ENVIADO' | 'CONFIRMADO' | 'ERROR';
  error?: string | null;
  creado_en: string;
  confirmado_en?: string | null;
  items: number;
  pendientes: number;
  enviados: number;
  errores: number;
}

export interface ResultadoEnvioComanda {
  ok: boolean;
  comandaId: number;
  envioId?: number;
  itemIds?: number[];
  idempotente?: boolean;
  totalAdicional?: number;
  ticketTexto?: string;
  impresionesPendientes?: import('./printer.service').ElectronPendingPrintJob[];
}

@Injectable({
  providedIn: 'root',
})
export class ComandaService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);
  private cargaComanda?: Subscription;
  private cargaProductos?: Subscription;
  private versionComanda = 0;
  private versionProductos = 0;

  private get apiUrl() {
    return this.runtimeConfig.apiBaseUrl;
  }

  readonly productos = signal<Producto[]>([]);

  // Ítems previamente guardados en la BD
  readonly itemsGuardados = signal<ItemComanda[]>([]);

  // Ítems NUEVOS seleccionados en esta sesión
  readonly itemsComanda = signal<ItemComanda[]>([]);

  readonly comandaIdActiva = signal<number>(0);
  readonly mesaIdActual = signal<number | null>(null);
  readonly tipoOrigenActual = signal<'MESA' | 'MOSTRADOR' | 'ENVIO' | null>(null);
  readonly folioOrigenActual = signal<string>('');
  readonly categoriaSeleccionada = signal<string>('TODOS');
  readonly envios = signal<EnvioImpresion[]>([]);
  readonly enviosPendientes = computed(() =>
    this.envios().filter(envio => ['PENDIENTE', 'ENVIADO', 'ERROR'].includes(envio.estado)),
  );

  // Total de los nuevos ítems
  readonly totalNuevosItems = computed(() => {
    return this.itemsComanda().reduce(
      (acc, item) => acc + (Number(item.subtotal) || Number(item.producto.precio) * item.cantidad),
      0,
    );
  });

  // Total acumulado general de la orden (Guardados + Nuevos)
  readonly totalComanda = computed(() => {
    const totalViejos = this.itemsGuardados().reduce(
      (acc, item) => acc + (Number(item.subtotal) || Number(item.producto.precio) * item.cantidad),
      0,
    );
    return totalViejos + this.totalNuevosItems();
  });

  private obtenerNombreCategoria(producto: unknown): string {
    if (!producto || typeof producto !== 'object') return '';
    const datos = producto as Record<string, unknown>;
    const cat = datos['categoria'];
    if (typeof cat === 'string' && cat.trim()) return cat.trim();
    if (cat && typeof cat === 'object' && 'nombre' in cat) return String(cat.nombre ?? '').trim();
    const alternativo = datos['categoriaNombre'] ?? datos['categoria_nombre'];
    if (alternativo != null) return String(alternativo).trim();
    if (datos['categoria_id']) return `Categoría ${datos['categoria_id']}`;
    return '';
  }

  readonly categoriasDisponibles = computed(() => {
    const categorias = new Map<string, string>();
    for (const producto of this.productos()) {
      const nombre = this.obtenerNombreCategoria(producto);
      const clave = nombre.toLowerCase();
      if (nombre && !['todos', 'todas'].includes(clave) && !categorias.has(clave)) categorias.set(clave, nombre);
    }
    return ['TODOS', ...categorias.values()];
  });

  seleccionarCategoria(categoria: unknown) {
    const clave = String(categoria ?? 'TODOS').trim().toLowerCase();
    this.categoriaSeleccionada.set(this.categoriasDisponibles().find(nombre => nombre.trim().toLowerCase() === clave) ?? 'TODOS');
  }

  readonly productosFiltrados = computed(() => {
    const seleccion = String(this.categoriaSeleccionada() ?? '').trim().toLowerCase();
    if (!seleccion || seleccion === 'todos' || seleccion === 'todas') return this.productos();

    return this.productos().filter((p) => {
      const cat = this.obtenerNombreCategoria(p).toLowerCase();
      return cat === seleccion;
    });
  });

  cargarProductos() {
    const version = ++this.versionProductos;
    this.cargaProductos?.unsubscribe();
    this.cargaProductos = this.http.get<Producto[]>(`${this.apiUrl}/productos`).subscribe({
      next: (data) => {
        if (version !== this.versionProductos) return;
        const parsed = (data || []).map((p) => ({
          ...p,
          precio: Number(p.precio),
        }));
        this.productos.set(parsed);
      },
      error: (err: unknown) => {
        if (version === this.versionProductos) console.error('Error al cargar menú:', err);
      },
    });
  }

  cargarComandaActivaPorMesa(mesaId: number) {
    this.cargarSeleccion(`/comandas/activa/${mesaId}`, mesaId);
  }

  cargarComandaPorId(comandaId: number) {
    this.cargarSeleccion(`/comandas/${comandaId}`, null);
  }

  private cargarSeleccion(ruta: string, mesaRespaldo: number | null) {
    this.limpiarComanda();
    const version = this.versionComanda;
    this.cargaComanda = this.http.get<ComandaCargada>(`${this.apiUrl}${ruta}`).subscribe({
      next: (res) => {
        if (version !== this.versionComanda) return;
        if (!res || res.comandaId <= 0) {
          this.restablecerSeleccion();
          return;
        }
        this.comandaIdActiva.set(res.comandaId);
        this.mesaIdActual.set(res.mesaId ?? mesaRespaldo);
        this.tipoOrigenActual.set(res.tipoOrigen ?? null);
        this.folioOrigenActual.set(res.folioOrigen ?? '');
        this.itemsGuardados.set(this.mapearItems(res.items ?? []));
        this.cargarEnvios(res.comandaId);
      },
      error: () => {
        if (version === this.versionComanda) this.restablecerSeleccion();
      },
    });
  }

  private mapearItems(items: ComandaCargada['items']): ItemComanda[] {
    return items.map(item => ({
      producto: { ...item.producto, precio: Number(item.producto.precio) },
      cantidad: item.cantidad,
      subtotal: Number(item.subtotal),
      notas: item.notas,
    }));
  }

  agregarProducto(producto: Producto, notas?: string) {
    this.itemsComanda.update((lista) => {
      const existe = lista.find((i) => i.producto.id === producto.id && i.notas === notas);
      if (existe) {
        return lista.map((i) =>
          i === existe
            ? {
                ...i,
                cantidad: i.cantidad + 1,
                subtotal: (i.cantidad + 1) * Number(i.producto.precio),
              }
            : i,
        );
      }
      return [
        ...lista,
        {
          producto: { ...producto, precio: Number(producto.precio) },
          cantidad: 1,
          subtotal: Number(producto.precio),
          notas,
        },
      ];
    });
  }

  removerProducto(productoId: number) {
    this.itemsComanda.update((lista) => lista.filter((item) => item.producto.id !== productoId));
  }

  actualizarNotasPorIndice(index: number, notas: string) {
    this.itemsComanda.update((lista) =>
      lista.map((item, i) => (i === index ? { ...item, notas } : item)),
    );
  }

  // Envía ÚNICAMENTE las adiciones recientes guardadas en itemsComanda()
  enviarComandaACocina(comandaId: number, mesaId?: number | null, usuarioId?: number) {
    const payload = {
      comandaId: comandaId || this.comandaIdActiva(),
      mesaId: mesaId ?? this.mesaIdActual(),
      usuarioId: usuarioId || 1,
      idempotencyKey: this.generarIdempotencyKey(),
      items: this.itemsComanda().map((item) => ({
        productoId: item.producto.id,
        cantidad: item.cantidad,
        precio: item.producto.precio,
        notas: item.notas || null,
      })),
    };

    return this.http.post<ResultadoEnvioComanda>(`${this.apiUrl}/comandas`, payload);
  }

  cargarEnvios(comandaId = this.comandaIdActiva()) {
    if (!Number.isInteger(comandaId) || comandaId <= 0) {
      this.envios.set([]);
      return;
    }
    this.http.get<EnvioImpresion[]>(`${this.apiUrl}/comandas/${comandaId}/envios`).subscribe({
      next: (envios) => this.envios.set(envios || []),
      error: () => this.envios.set([]),
    });
  }

  reimprimirEnvio(comandaId: number, envioId: number) {
    return this.http
      .post<{
        ok: boolean;
        ticketTexto?: string;
        impresionesPendientes?: import('./printer.service').ElectronPendingPrintJob[];
      }>(`${this.apiUrl}/comandas/${comandaId}/envios/${envioId}/reimprimir`, {})
      .pipe(tap(() => this.cargarEnvios(comandaId)));
  }

  confirmarEnvio(comandaId: number, envioId: number) {
    return this.http
      .post<{ ok: boolean; confirmados: number }>(`${this.apiUrl}/comandas/${comandaId}/envios/${envioId}/confirmar`, {})
      .pipe(tap(() => this.cargarEnvios(comandaId)));
  }

  private generarIdempotencyKey(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    return `envio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  limpiarComanda() {
    ++this.versionComanda;
    this.cargaComanda?.unsubscribe();
    this.cargaComanda = undefined;
    this.restablecerSeleccion();
  }

  cancelarCargas() {
    this.limpiarComanda();
    ++this.versionProductos;
    this.cargaProductos?.unsubscribe();
    this.cargaProductos = undefined;
  }

  private restablecerSeleccion() {
    this.itemsGuardados.set([]);
    this.itemsComanda.set([]);
    this.comandaIdActiva.set(0);
    this.mesaIdActual.set(null);
    this.tipoOrigenActual.set(null);
    this.folioOrigenActual.set('');
    this.envios.set([]);
  }

  obtenerDesgloseComanda(comandaId: number) {
    return this.http.get<{
      comandaId: number;
      mesaId: number | null;
      total: number;
      tipoOrigen: 'MESA' | 'MOSTRADOR' | 'ENVIO';
      folioOrigen: string;
      items: ItemComanda[];
    }>(`${this.apiUrl}/comandas/${comandaId}`);
  }

  obtenerDesgloseMesa(mesaId: number) {
    return this.http.get<{
      comandaId: number;
      mesaId: number;
      total: number;
      tipoOrigen: 'MESA' | 'MOSTRADOR' | 'ENVIO' | null;
      folioOrigen: string | null;
      items: ItemComanda[];
    }>(`${this.apiUrl}/comandas/activa/${mesaId}`);
  }
}
