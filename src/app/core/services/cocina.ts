import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TicketCocina } from '../models/cocina';

@Injectable({
  providedIn: 'root'
})
export class CocinaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:3000/api/cocina';

  readonly tickets = signal<TicketCocina[]>([]);
  // 🔹 Iniciar en 'PENDIENTE' como filtro predeterminado
  readonly filtroEstado = signal<string>('PENDIENTE');

  // Cómputo dinámico corregido para evaluar por ítems pendientes/en preparación
  readonly ticketsFiltrados = computed(() => {
    const filtro = this.filtroEstado();
    const listaTickets = this.tickets();

    if (filtro === 'TODOS') return listaTickets;

    if (filtro === 'PENDIENTE') {
      // Muestra tickets que tengan al menos 1 platillo SIN tachar (pendiente por preparar)
      return listaTickets.filter(ticket =>
        ticket.items && ticket.items.some(item => !item.completado)
      );
    }

    if (filtro === 'PREPARANDO') {
      // Muestra tickets que ya tienen algunos ítems listos pero faltan otros
      return listaTickets.filter(ticket =>
        ticket.items &&
        ticket.items.some(item => item.completado) &&
        ticket.items.some(item => !item.completado)
      );
    }

    // Fallback estándar si el estado coincide con ticket.estado
    return listaTickets.filter(t => t.estado === filtro);
  });

  cargarTickets() {
    this.http.get<TicketCocina[]>(`${this.apiUrl}/tickets`).subscribe({
      next: (data) => this.tickets.set(data || []),
      error: (err) => console.error('Error cargando cocina:', err)
    });
  }

  marcarTicketListo(comandaId: number) {
    this.http.post(`${this.apiUrl}/tickets/${comandaId}/despachar`, {}).subscribe({
      next: () => {
        this.tickets.update(lista => lista.filter(t => t.id !== comandaId));
      },
      error: (err) => console.error('Error al despachar ticket:', err)
    });
  }

  toggleItemCompletado(ticketId: number, itemId: number) {
    // Actualización local rápida en UI
    this.tickets.update(lista =>
      lista.map(ticket => {
        if (ticket.id === ticketId) {
          const items = ticket.items.map(i => i.id === itemId ? { ...i, completado: !i.completado } : i);
          return { ...ticket, items };
        }
        return ticket;
      })
    );

    // Persistencia en base de datos
    this.http.patch(`${this.apiUrl}/items/${itemId}/toggle`, {}).subscribe({
      error: (err) => console.error('Error al actualizar item:', err)
    });
  }
}