import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Producto, ItemComanda } from '../models/producto';
import { RuntimeConfigService } from './runtime-config.service';

@Injectable({
  providedIn: 'root',
})
export class ComandaService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  private get apiUrl() {
    return this.runtimeConfig.apiBaseUrl;
  }

  readonly productos = signal<Producto[]>([]);

  // Ítems previamente guardados en la BD
  readonly itemsGuardados = signal<ItemComanda[]>([]);

  // Ítems NUEVOS seleccionados en esta sesión
  readonly itemsComanda = signal<ItemComanda[]>([]);

  readonly comandaIdActiva = signal<number>(0);
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
    this.http.get<Producto[]>(`${this.apiUrl}/productos`).subscribe({
      next: (data) => {
        const parsed = (data || []).map((p) => ({
          ...p,
          precio: Number(p.precio),
        }));
        this.productos.set(parsed);
      },
      error: (err) => console.error('Error al cargar menú:', err),
    });
  }

  // Carga los consumos previamente guardados sin mezclarlos con el borrador de nuevos ítems
  cargarComandaActivaPorMesa(mesaId: number) {
    // El borrador de nuevos ítems SIEMPRE inicia limpio
    this.itemsComanda.set([]);

    this.http
      .get<{ comandaId: number; items: any[] }>(`${this.apiUrl}/comandas/activa/${mesaId}`)
      .subscribe({
        next: (res) => {
          if (res && res.comandaId > 0) {
            this.comandaIdActiva.set(res.comandaId);

            const itemsCargados: ItemComanda[] = (res.items || []).map((i) => ({
              producto: {
                id: i.producto.id,
                nombre: i.producto.nombre,
                precio: Number(i.producto.precio),
                categoria: i.producto.categoria,
                imagen_url: i.producto.imagen_url,
              },
              cantidad: i.cantidad,
              subtotal: Number(i.subtotal),
              notas: i.notas,
            }));

            // Se asignan a la señal de ítems guardados (referencia visual)
            this.itemsGuardados.set(itemsCargados);
          } else {
            this.comandaIdActiva.set(0);
            this.itemsGuardados.set([]);
          }
        },
        error: () => {
          this.comandaIdActiva.set(0);
          this.itemsGuardados.set([]);
        },
      });
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
  enviarComandaACocina(comandaId: number, mesaId: number, usuarioId?: number) {
    const payload = {
      comandaId: comandaId || this.comandaIdActiva(),
      mesaId,
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
    this.itemsGuardados.set([]);
    this.itemsComanda.set([]);
    this.comandaIdActiva.set(0);
  }

  obtenerDesgloseMesa(mesaId: number) {
    return this.http.get<{ comandaId: number; total: number; items: ItemComanda[] }>(
      `${this.apiUrl}/comandas/activa/${mesaId}`,
    );
  }
}
