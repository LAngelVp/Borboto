import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ComandaService } from '../../../../core/services/comanda';

@Component({
  selector: 'app-orden-resumen',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './orden-resumen.html',
  styleUrl: './orden-resumen.scss'
})
export class OrdenResumenComponent {
  protected readonly comandaService = inject(ComandaService);

  // Evento que notifica al componente padre (Comanda) para guardar en la BD
  readonly confirmarComanda = output<void>();

  actualizarNota(index: number, notas: string) {
    this.comandaService.actualizarNotasPorIndice(index, notas);
  }

  enviarCocina() {
    this.confirmarComanda.emit();
  }
}