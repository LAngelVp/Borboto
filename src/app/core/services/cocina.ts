import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TicketCocina } from '../models/cocina';
import { RuntimeConfigService } from './runtime-config.service';

@Injectable({
  providedIn: 'root',
})
export class CocinaService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  private get apiUrl() {
    return `${this.runtimeConfig.apiBaseUrl}/cocina`;
  }

  readonly tickets = signal<TicketCocina[]>([]);
  readonly itemsPendientes = signal<ReadonlySet<number>>(new Set());
  // 🔹 Iniciar en 'PENDIENTE' como filtro predeterminado
  readonly filtroEstado = signal<string>('PENDIENTE');

  // Cómputo dinámico corregido para evaluar por ítems pendientes/en preparación
  readonly ticketsFiltrados = computed(() => {
    const filtro = this.filtroEstado();
    const listaTickets = this.tickets();

    if (filtro === 'TODOS') return listaTickets;

    if (filtro === 'PENDIENTE') {
      // Muestra tickets que tengan al menos 1 platillo SIN tachar (pendiente por preparar)
      return listaTickets.filter(
        (ticket) => ticket.estado === 'PENDIENTE',
      );
    }

    if (filtro === 'PREPARANDO') {
      // Muestra tickets que ya tienen algunos ítems listos pero faltan otros
      return listaTickets.filter(
        (ticket) =>
          ticket.items &&
          ticket.items.some((item) => item.completado) &&
          ticket.items.some((item) => !item.completado),
      );
    }

    // Fallback estándar si el estado coincide con ticket.estado
    return listaTickets.filter((t) => t.estado === filtro);
  });

  cargarTickets() {
    this.http.get<TicketCocina[]>(`${this.apiUrl}/tickets`).subscribe({
      next: (data) => this.tickets.set(data || []),
      error: (err) => console.error('Error cargando cocina:', err),
    });
  }

  marcarTicketListo(comandaId: number) {
    this.http.post(`${this.apiUrl}/tickets/${comandaId}/despachar`, {}).subscribe({
      next: () => {
        this.tickets.update((lista) => lista.filter((t) => t.id !== comandaId));
      },
      error: (err) => console.error('Error al despachar ticket:', err),
    });
  }

  toggleItemCompletado(ticketId: number, itemId: number) {
    const previo = this.tickets().find(ticket => ticket.id === ticketId)?.items.find(item => item.id === itemId);
    if (!previo || this.itemsPendientes().has(itemId)) return;
    this.itemsPendientes.update(actual => new Set([...actual, itemId]));
    this.actualizarItem(ticketId, itemId, !previo.completado);
    const finalizar = () => this.itemsPendientes.update(actual => {
      const siguiente = new Set(actual);
      siguiente.delete(itemId);
      return siguiente;
    });
    this.http.patch(`${this.apiUrl}/items/${itemId}/toggle`, {}).subscribe({
      next: finalizar,
      error: (err: unknown) => {
        this.actualizarItem(ticketId, itemId, previo.completado);
        finalizar();
        console.error('Error al actualizar item:', err);
      },
    });
  }

  private actualizarItem(ticketId: number, itemId: number, completado: boolean) {
    this.tickets.update((lista) =>
      lista.map((ticket) => {
        if (ticket.id === ticketId) {
          const items = ticket.items.map((i) =>
            i.id === itemId ? { ...i, completado, estado_kds: completado ? 'LISTO' as const : 'PENDIENTE' as const } : i,
          );
          const listos = items.filter(item => item.completado).length;
          const estado = listos === 0 ? 'PENDIENTE' as const : listos === items.length ? 'LISTO' as const : 'PREPARANDO' as const;
          return { ...ticket, items, estado };
        }
        return ticket;
      }),
    );

  }
}
