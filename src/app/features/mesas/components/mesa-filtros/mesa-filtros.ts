import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MesaService } from '../../../../core/services/mesa';

@Component({
  selector: 'app-mesa-filtros',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mesa-filtros.html',
  styleUrl: './mesa-filtros.scss'
})
export class MesaFiltrosComponent {
  protected readonly mesaService = inject(MesaService);

  // Obtiene dinámicamente las zonas desde la BD (vía MesaService) y excluye 'Domicilio'
  readonly zonas = computed(() => {
    const zonasBD = this.mesaService.zonas()
      .map(z => z.nombre)
      .filter(nombre => nombre && nombre !== 'Domicilio');

    // Si aún no han cargado las zonas desde la BD, se extraen de las mesas registradas como fallback
    if (zonasBD.length === 0) {
      const zonasMesas = this.mesaService.mesas()
        .map(m => m.zona || '')
        .filter(z => z && z !== 'Domicilio');
      return ['TODAS', ...Array.from(new Set(zonasMesas))];
    }

    return ['TODAS', ...Array.from(new Set(zonasBD))];
  });

  readonly estados = [
    { label: 'Todos', value: 'TODOS' },
    { label: 'Libres', value: 'DISPONIBLE' },          // Mapea a 'DISPONIBLE'
    { label: 'Pendientes', value: 'PENDIENTE' },       // Mapea a 'PENDIENTE'
    { label: 'Cocinando', value: 'EN COCINA' },        // Mapea a 'EN COCINA'
    { label: 'Listo p/ Servir', value: 'LISTO PARA SERVIR' }, // Mapea a 'LISTO PARA SERVIR'
    { label: 'Servidos', value: 'SERVIDO' }            // Mapea a 'SERVIDO'
  ];

  onCambioZona(valor: any) {
    this.mesaService.setFiltroZona(valor || 'TODAS');
  }

  onCambioEstado(valor: any) {
    this.mesaService.setFiltroEstado(valor || 'TODOS');
  }
}