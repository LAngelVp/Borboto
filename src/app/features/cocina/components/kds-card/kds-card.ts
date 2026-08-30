import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TicketCocina } from '../../../../core/models/cocina';

@Component({
  selector: 'app-kds-card',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kds-card.html',
  styleUrl: './kds-card.scss'
})
export class KdsCardComponent {
  readonly ticket = input.required<TicketCocina>();
  readonly ticketListo = output<void>();

  todosCompletados(): boolean {
    const list = this.ticket()?.items || [];
    return list.length > 0 && list.every(item => item.completado);
  }

  // Semáforo de urgencia según los minutos transcurridos
  getUrgenciaClass(minutos: number): string {
    if (minutos >= 20) return 'urgente-critico'; // Rojo
    if (minutos >= 12) return 'urgente-medio';   // Amarillo
    return 'urgente-normal';                     // Verde
  }
}