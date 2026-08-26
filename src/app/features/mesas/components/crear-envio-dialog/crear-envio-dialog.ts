import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
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
  selector: 'app-crear-envio-dialog',
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
        <mat-icon>local_shipping</mat-icon> Registrar Envío a Domicilio
      </h2>

      <mat-dialog-content class="dialog-content">
        <!-- Selector de Cliente Existente -->
        <div class="form-section">
          <h3>1. Seleccionar Cliente de Cartera</h3>
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Selecciona un cliente</mat-label>
            <mat-select [(ngModel)]="clienteSeleccionadoId" (selectionChange)="onSeleccionarCliente($event.value)">
              <mat-option [value]="0">-- NUEVO CLIENTE --</mat-option>
              @for (c of clientes(); track c.id) {
                <mat-option [value]="c.id">
                  {{ c.nombre }} @if(c.telefono) { ({{ c.telefono }}) }
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="divider"></div>

        <!-- Campos de Datos de Envío -->
        <div class="form-section">
          <h3>2. Datos del Solicitante y Dirección</h3>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Nombre Completo</mat-label>
            <input matInput [(ngModel)]="nombre" required placeholder="Ej. Juan Pérez" [disabled]="clienteSeleccionadoId !== 0">
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Dirección de Envío</mat-label>
            <textarea matInput [(ngModel)]="direccion" required placeholder="Ej. Calle Palmas 204, Col. Centro" rows="2" [disabled]="clienteSeleccionadoId !== 0"></textarea>
          </mat-form-field>

          <div class="grid-row-2">
            <mat-form-field appearance="outline">
              <mat-label>Teléfono</mat-label>
              <input matInput [(ngModel)]="telefono" placeholder="Ej. 5511223344" [disabled]="clienteSeleccionadoId !== 0">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Notas internas</mat-label>
              <input matInput [(ngModel)]="notas" placeholder="Ej. Portón café / Sin cambio" [disabled]="clienteSeleccionadoId !== 0">
            </mat-form-field>
          </div>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions class="dialog-actions">
        <button mat-stroked-button (click)="cerrar(false)">Cancelar</button>
        <button mat-flat-button color="primary" [disabled]="!nombre || !direccion" (click)="confirmar()">
          Proceder con Envío
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container {
      padding: 16px;
      background-color: #ffffff;
    }
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 800;
      color: var(--color-primary, #e65100);
      margin-bottom: 16px;
    }
    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .form-section {
      h3 {
        margin: 0 0 8px 0;
        font-size: 13px;
        text-transform: uppercase;
        color: var(--color-text-muted, #5f6368);
        letter-spacing: 0.5px;
        font-weight: 700;
      }
    }
    .divider {
      height: 1px;
      background-color: #e2e8f0;
      margin: 8px 0;
    }
    .w-full {
      width: 100%;
    }
    .grid-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;

      button {
        font-weight: 700;
        border-radius: 8px;
        height: 40px;
      }
    }
  `]
})
export class CrearEnvioDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<CrearEnvioDialogComponent>);
  private readonly ajustesService = inject(AjustesService);
  private readonly snackBar = inject(MatSnackBar);

  readonly clientes = signal<Cliente[]>([]);

  clienteSeleccionadoId = 0;
  nombre = '';
  direccion = '';
  telefono = '';
  notas = '';

  ngOnInit() {
    this.ajustesService.getClientes().subscribe({
      next: (list) => {
        this.clientes.set(list || []);
      },
      error: () => console.error('Error cargando clientes para envío')
    });
  }

  onSeleccionarCliente(id: number) {
    if (id === 0) {
      this.nombre = '';
      this.direccion = '';
      this.telefono = '';
      this.notas = '';
    } else {
      const selected = this.clientes().find(c => c.id === id);
      if (selected) {
        this.nombre = selected.nombre;
        this.direccion = selected.direccion || '';
        this.telefono = selected.telefono || '';
        this.notas = selected.notas || '';
      }
    }
  }

  cerrar(resultado: boolean) {
    this.dialogRef.close(resultado);
  }

  confirmar() {
    if (!this.nombre || !this.direccion) return;

    if (this.clienteSeleccionadoId === 0) {
      // Registrar cliente nuevo antes de crear envío
      const nuevo: Cliente = {
        nombre: this.nombre,
        direccion: this.direccion,
        telefono: this.telefono,
        notas: this.notas
      };

      this.ajustesService.crearCliente(nuevo).subscribe({
        next: (cli) => {
          this.dialogRef.close({
            confirmado: true,
            clienteId: cli.id
          });
        },
        error: () => {
          this.snackBar.open('Error al pre-registrar el cliente.', 'Cerrar', { duration: 3000 });
        }
      });
    } else {
      // Cliente ya existe en la base de datos
      this.dialogRef.close({
        confirmado: true,
        clienteId: this.clienteSeleccionadoId
      });
    }
  }
}
