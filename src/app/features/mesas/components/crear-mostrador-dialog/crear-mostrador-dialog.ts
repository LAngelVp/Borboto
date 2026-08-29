import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AjustesService, Cliente } from '../../../../core/services/ajustes.service';

@Component({
  selector: 'app-crear-mostrador-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dialog-container">
      <h2 mat-dialog-title class="dialog-title">
        <mat-icon>storefront</mat-icon> Registrar Pedido de Mostrador
      </h2>

      <mat-dialog-content class="dialog-content">
        <!-- 1. Cliente Registrado de Cartera -->
        <div class="form-section">
          <h3>1. Seleccionar Cliente de Cartera (Opcional)</h3>
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Selecciona un cliente</mat-label>
            <mat-select
              [(ngModel)]="clienteSeleccionadoId"
              (selectionChange)="onSeleccionarCliente($event.value)"
              (openedChange)="alAbrirSelect($event)">

              <!-- Campo de búsqueda rápida -->
              <div class="search-input-box" (click)="$event.stopPropagation()">
                <mat-icon class="search-icon">search</mat-icon>
                <input
                  matInput
                  placeholder="Buscar por nombre o teléfono..."
                  [(ngModel)]="busquedaCliente"
                  (keydown)="$event.stopPropagation()"
                  class="search-input">
                @if (busquedaCliente()) {
                  <button mat-icon-button class="btn-clear" (click)="busquedaCliente.set('')">
                    <mat-icon>close</mat-icon>
                  </button>
                }
              </div>

              <mat-option [value]="0">-- CLIENTE GENERAL / MOSTRADOR --</mat-option>

              @for (c of clientesFiltrados(); track c.id) {
                <mat-option [value]="c.id">
                  {{ c.nombre }} @if(c.telefono) { ({{ c.telefono }}) }
                </mat-option>
              } @empty {
                <mat-option disabled class="no-results">
                  No se encontraron coincidencias
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="divider"></div>

        <!-- 2. Nombre manual o Identificador rápido -->
        <div class="form-section">
          <h3>2. Identificador del Pedido</h3>
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Nombre / Referencia del Cliente</mat-label>
            <input
              matInput
              [(ngModel)]="nombre"
              placeholder="Ej. Juan Pérez / Gorra azul"
              [disabled]="clienteSeleccionadoId !== 0">
          </mat-form-field>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions class="dialog-actions">
        <button mat-stroked-button (click)="cerrar(false)">Cancelar</button>
        <button mat-flat-button color="primary" (click)="confirmar()">
          Proceder a Comanda
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container { padding: 16px; background-color: #ffffff; }
    .dialog-title {
      display: flex; align-items: center; gap: 10px; font-size: 20px;
      font-weight: 800; color: #0288d1; margin-bottom: 16px;
    }
    .dialog-content { display: flex; flex-direction: column; gap: 12px; }
    .form-section h3 {
      margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase;
      color: #5f6368; letter-spacing: 0.5px; font-weight: 700;
    }
    .search-input-box {
      display: flex; align-items: center; padding: 8px 12px;
      position: sticky; top: 0; background: #ffffff; z-index: 10;
      border-bottom: 1px solid #e2e8f0;
      .search-icon { color: #94a3b8; font-size: 20px; width: 20px; height: 20px; margin-right: 8px; }
      .search-input { border: none; outline: none; width: 100%; font-size: 13px; color: #1e293b; background: transparent; }
      .btn-clear { width: 24px; height: 24px; line-height: 24px; mat-icon { font-size: 16px; width: 16px; height: 16px; color: #64748b; } }
    }
    .no-results { font-size: 12px; color: #94a3b8; text-align: center; }
    .divider { height: 1px; background-color: #e2e8f0; margin: 8px 0; }
    .w-full { width: 100%; }
    .dialog-actions {
      display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;
      button { font-weight: 700; border-radius: 8px; height: 40px; }
    }
  `]
})
export class CrearMostradorDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<CrearMostradorDialogComponent>);
  private readonly ajustesService = inject(AjustesService);
  private readonly snackBar = inject(MatSnackBar);

  readonly clientes = signal<Cliente[]>([]);
  readonly busquedaCliente = signal<string>('');

  readonly clientesFiltrados = computed(() => {
    const query = this.busquedaCliente().toLowerCase().trim();
    if (!query) return this.clientes();
    return this.clientes().filter(c =>
      c.nombre.toLowerCase().includes(query) ||
      (c.telefono && c.telefono.includes(query))
    );
  });

  clienteSeleccionadoId = 0;
  nombre = '';

  ngOnInit() {
    this.ajustesService.getClientes().subscribe({
      next: (list) => this.clientes.set(list || []),
      error: () => console.error('Error cargando cartera de clientes')
    });
  }

  alAbrirSelect(abierto: boolean) {
    if (!abierto) this.busquedaCliente.set('');
  }

  onSeleccionarCliente(id: number) {
    if (id === 0) {
      this.nombre = '';
    } else {
      const selected = this.clientes().find(c => c.id === id);
      if (selected) {
        this.nombre = selected.nombre;
      }
    }
  }

  cerrar(resultado: boolean) {
    this.dialogRef.close(resultado);
  }

  confirmar() {
    // Si se escribió un nombre manual sin elegir un cliente de la cartera, creamos un nuevo cliente rápido
    if (this.clienteSeleccionadoId === 0 && this.nombre.trim().length > 0) {
      const nuevo: Cliente = { nombre: this.nombre.trim() };
      this.ajustesService.crearCliente(nuevo).subscribe({
        next: (cli) => {
          this.dialogRef.close({ confirmado: true, clienteId: cli.id, nombre: cli.nombre });
        },
        error: () => {
          this.snackBar.open('Error al registrar el cliente.', 'Cerrar', { duration: 3000 });
        }
      });
    } else {
      this.dialogRef.close({
        confirmado: true,
        clienteId: this.clienteSeleccionadoId || null,
        nombre: this.nombre
      });
    }
  }
}