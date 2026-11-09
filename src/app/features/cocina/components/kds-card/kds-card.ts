import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TicketCocina } from '../../../../core/models/cocina';

@Component({
  selector: 'app-kds-card',
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kds-card.html',
  styleUrl: './kds-card.scss',
})
export class KdsCardComponent {
  readonly ticket = input.required<TicketCocina>();
  readonly ticketListo = output<void>();
  readonly itemToggle = output<number>();
  readonly itemsPendientes = input<ReadonlySet<number>>(new Set());

  tieneItemsPendientes(): boolean {
    return this.ticket().items.some(item => this.itemsPendientes().has(item.id));
  }

  getOrigenLabel(): string {
    const actualTicket = this.ticket();
    if (actualTicket.tipoOrigen === 'MESA' && actualTicket.mesaNumero) {
      return `Mesa ${actualTicket.mesaNumero}`;
    }

    return actualTicket.folioOrigen || actualTicket.mesaNumero || 'Sin origen';
  }

  todosCompletados(): boolean {
    const list = this.ticket()?.items || [];
    return list.length > 0 && list.every((item) => item.completado);
  }

  // Semáforo de urgencia según los minutos transcurridos
  getUrgenciaClass(minutos: number): string {
    if (minutos >= 20) return 'urgente-critico'; // Rojo
    if (minutos >= 12) return 'urgente-medio'; // Amarillo
    return 'urgente-normal'; // Verde
  }
}
