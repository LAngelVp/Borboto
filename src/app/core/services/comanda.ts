import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Producto, ItemComanda } from '../models/producto';

@Injectable({
  providedIn: 'root'
})
export class ComandaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:3000/api';

  readonly productos = signal<Producto[]>([]);

  // Ítems previamente guardados en la BD
  readonly itemsGuardados = signal<ItemComanda[]>([]);

  // Ítems NUEVOS seleccionados en esta sesión
  readonly itemsComanda = signal<ItemComanda[]>([]);

  readonly comandaIdActiva = signal<number>(0);
  readonly categoriaSeleccionada = signal<string>('TODOS');

  // Total de los nuevos ítems
  readonly totalNuevosItems = computed(() => {
    return this.itemsComanda().reduce((acc, item) => acc + (Number(item.subtotal) || Number(item.producto.precio) * item.cantidad), 0);
  });

  // Total acumulado general de la orden (Guardados + Nuevos)
  readonly totalComanda = computed(() => {
    const totalViejos = this.itemsGuardados().reduce((acc, item) => acc + (Number(item.subtotal) || Number(item.producto.precio) * item.cantidad), 0);
    return totalViejos + this.totalNuevosItems();
  });

  private obtenerNombreCategoria(cat: any): string {
    if (!cat) return '';
    if (typeof cat === 'string') return cat.trim();
    if (typeof cat === 'object' && cat.nombre) return cat.nombre.toString().trim();
    return String(cat).trim();
  }

  readonly categoriasDisponibles = computed(() => {
    const nombres = this.productos()
      .map(p => this.obtenerNombreCategoria(p.categoria))
      .filter(n => n.length > 0);
    return ['TODOS', ...Array.from(new Set(nombres))];
  });

  readonly productosFiltrados = computed(() => {
    const seleccion = this.categoriaSeleccionada().trim().toLowerCase();
    if (!seleccion || seleccion === 'todos') return this.productos();

    return this.productos().filter(p => {
      const cat = this.obtenerNombreCategoria(p.categoria).toLowerCase();
      return cat === seleccion;
    });
  });

  cargarProductos() {
    this.http.get<Producto[]>(`${this.apiUrl}/productos`).subscribe({
      next: (data) => {
        const parsed = (data || []).map(p => ({
          ...p,
          precio: Number(p.precio)
        }));
        this.productos.set(parsed);
      },
      error: (err) => console.error('Error al cargar menú:', err)
    });
  }

  // Carga los consumos previamente guardados sin mezclarlos con el borrador de nuevos ítems
  cargarComandaActivaPorMesa(mesaId: number) {
    // El borrador de nuevos ítems SIEMPRE inicia limpio
    this.itemsComanda.set([]);

    this.http.get<{ comandaId: number; items: any[] }>(`${this.apiUrl}/comandas/activa/${mesaId}`).subscribe({
      next: (res) => {
        if (res && res.comandaId > 0) {
          this.comandaIdActiva.set(res.comandaId);

          const itemsCargados: ItemComanda[] = (res.items || []).map(i => ({
            producto: {
              id: i.producto.id,
              nombre: i.producto.nombre,
              precio: Number(i.producto.precio),
              categoria: i.producto.categoria
            },
            cantidad: i.cantidad,
            subtotal: Number(i.subtotal),
            notas: i.notas
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
      }
    });
  }

  agregarProducto(producto: Producto, notas?: string) {
    this.itemsComanda.update(lista => {
      const existe = lista.find(i => i.producto.id === producto.id && i.notas === notas);
      if (existe) {
        return lista.map(i => i === existe
          ? { ...i, cantidad: i.cantidad + 1, subtotal: (i.cantidad + 1) * Number(i.producto.precio) }
          : i
        );
      }
      return [...lista, { producto: { ...producto, precio: Number(producto.precio) }, cantidad: 1, subtotal: Number(producto.precio), notas }];
    });
  }

  removerProducto(productoId: number) {
    this.itemsComanda.update(lista => lista.filter(item => item.producto.id !== productoId));
  }

  actualizarNotasPorIndice(index: number, notas: string) {
    this.itemsComanda.update(lista =>
      lista.map((item, i) => i === index ? { ...item, notas } : item)
    );
  }

  // Envía ÚNICAMENTE las adiciones recientes guardadas en itemsComanda()
  enviarComandaACocina(comandaId: number, mesaId: number, usuarioId?: number) {
    const payload = {
      comandaId: comandaId || this.comandaIdActiva(),
      mesaId,
      usuarioId: usuarioId || 1,
      items: this.itemsComanda().map(item => ({
        productoId: item.producto.id,
        cantidad: item.cantidad,
        precio: item.producto.precio,
        notas: item.notas || null
      }))
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
      `${this.apiUrl}/comandas/activa/${mesaId}`
    );
  }
}