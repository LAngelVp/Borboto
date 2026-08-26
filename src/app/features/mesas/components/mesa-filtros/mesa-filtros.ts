import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MesaService } from '../../../../core/services/mesa';

@Component({
  selector: 'app-mesa-filtros',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatButtonModule, MatIconModule],
  templateUrl: './mesa-filtros.html',
  styleUrl: './mesa-filtros.scss'
})
export class MesaFiltrosComponent {
  protected readonly mesaService = inject(MesaService);

  readonly zonas = computed(() => {
    const list = this.mesaService.mesas().map(m => m.zona || '').filter(Boolean);
    return ['TODAS', ...Array.from(new Set(list))];
  });

  readonly estados = [
    { label: 'Todos', value: 'TODOS' },
    { label: 'Libres', value: 'DISPONIBLE' }, // Corregido para que coincida con DB: 'DISPONIBLE' en vez de 'LIBRE'
    { label: 'Pendientes', value: 'PENDIENTE' },
    { label: 'Cocinando', value: 'EN COCINA' }, // Corregido para coincidir con DB: 'EN COCINA'
    { label: 'Listo para Servir', value: 'LISTO PARA SERVIR' }, // Corregido para coincidir con DB
    { label: 'Servidos', value: 'SERVIDO' } // Corregido
  ];
}