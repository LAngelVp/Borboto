import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
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

  // METODO EXTRA RESILIENTE PARA EXTRACTAR EL NOMBRE DE LA CATEGORIA
  private obtenerNombreCategoria(producto: any): string {
    if (!producto) return '';

    // 1. Revisa si viene en la propiedad directa 'categoria' (objeto o string)
    const cat = producto.categoria;
    if (typeof cat === 'string' && cat.trim()) return cat.trim();
    if (typeof cat === 'object' && cat?.nombre) return cat.nombre.toString().trim();

    // 2. Revisa propiedades alternativas comunes del backend
    if (producto.categoriaNombre) return producto.categoriaNombre.toString().trim();
    if (producto.categoria_nombre) return producto.categoria_nombre.toString().trim();

    // 3. Si sólo tiene el ID, retorna como fallback
    if (producto.categoria_id) return `Categoría ${producto.categoria_id}`;

    return '';
  }

  readonly categoriasDisponibles = computed(() => {
    const nombres = this.productos()
      .map((p) => this.obtenerNombreCategoria(p))
      .filter((n) => n.length > 0);
    return ['TODOS', ...Array.from(new Set(nombres))];
  });

  readonly productosFiltrados = computed(() => {
    const seleccion = this.categoriaSeleccionada().trim().toLowerCase();
    if (!seleccion || seleccion === 'todos') return this.productos();

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
      items: this.itemsComanda().map((item) => ({
        productoId: item.producto.id,
        cantidad: item.cantidad,
        precio: item.producto.precio,
        notas: item.notas || null,
      })),
    };

    return this.http.post<{ ok: boolean }>(`${this.apiUrl}/comandas`, payload);
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
