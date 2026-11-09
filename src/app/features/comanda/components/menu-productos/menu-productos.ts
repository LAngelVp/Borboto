import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule, MatChipListboxChange } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { ComandaService } from '../../../../core/services/comanda';
import { Producto } from '../../../../core/models/producto';

@Component({
  selector: 'app-menu-productos',
  imports: [CommonModule, MatChipsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menu-productos.html',
  styleUrl: './menu-productos.scss'
})
export class MenuProductosComponent {
  protected readonly comandaService = inject(ComandaService);

  // URL base del backend Express
  private readonly API_URL = 'http://127.0.01:3000';

  onCategoriaChange(event: MatChipListboxChange) {
    this.comandaService.seleccionarCategoria(event.value);
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