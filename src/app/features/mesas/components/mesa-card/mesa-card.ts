import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { Mesa } from '../../../../core/models/mesa';

export type AccionMesa = 'ABRIR' | 'AGREGAR_COMANDA' | 'VER_DETALLE' | 'IMPRIMIR_PRECUENTA' | 'MOVER_MESA' | 'COBRAR';

@Component({
  selector: 'app-mesa-card',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mesa-card.html',
  styleUrl: './mesa-card.scss'
})
export class MesaCardComponent {
  readonly mesa = input.required<Mesa>();
  readonly accion = output<{ tipo: AccionMesa; mesa: Mesa }>();

  emitirAccion(tipo: AccionMesa) {
    this.accion.emit({ tipo, mesa: this.mesa() });
  }

  getBadgeInfo(estado: string) {
    switch (estado) {
      case 'DISPONIBLE':
        return { label: 'Disponible', class: 'badge-libre' };
      case 'PENDIENTE':
        return { label: 'Pendiente', class: 'badge-pendiente' };
      case 'EN COCINA':
        return { label: 'En Cocina', class: 'badge-cocinando' };
      case 'LISTO PARA SERVIR':
        return { label: '¡Para Servir!', class: 'badge-listo' };
      case 'SERVIDO':
        return { label: 'Servido', class: 'badge-cobrar' };
      default:
        return { label: estado, class: '' };
    }
  }
}