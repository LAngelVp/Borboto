import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule, MatChipListboxChange } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { ComandaService } from '../../../../core/services/comanda';
import { Producto } from '../../../../core/models/producto';

@Component({
  selector: 'app-menu-productos',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menu-productos.html',
  styleUrl: './menu-productos.scss'
})
export class MenuProductosComponent {
  protected readonly comandaService = inject(ComandaService);

  // URL base del backend Express
  private readonly API_URL = 'http://127.0.01:3000';

  // Se permite 'any' o 'MatChipListboxChange' para evitar el error de asignación de $event desde la plantilla
  onCategoriaChange(event: MatChipListboxChange | any) {
    const seleccion = event?.value ?? 'TODOS';
    this.comandaService.categoriaSeleccionada.set(seleccion);
  }

  obtenerUrlImagen(url?: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  onAgregar(producto: Producto) {
    this.comandaService.agregarProducto(producto);
  }
}