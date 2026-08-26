import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule, MatChipListboxChange } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { ComandaService } from '../../../../core/services/comanda';
import { Producto } from '../../../../core/models/producto';

@Component({
  selector: 'app-menu-productos',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatIconModule],
  templateUrl: './menu-productos.html',
  styleUrl: './menu-productos.scss'
})
export class MenuProductosComponent {
  protected readonly comandaService = inject(ComandaService);

  // Método unificado para actualizar la categoría seleccionada
  seleccionarCategoria(categoria: string) {
    this.comandaService.categoriaSeleccionada.set(categoria || 'TODOS');
  }

  // Captura el cambio proveniente de mat-chip-listbox
  onCategoriaChange(event: MatChipListboxChange | any) {
    const seleccion = event?.value ?? 'TODOS';
    this.comandaService.categoriaSeleccionada.set(seleccion);
  }

  onAgregar(producto: Producto) {
    this.comandaService.agregarProducto(producto);
  }
}