import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { Mesa } from '../../../../core/models/mesa';

@Component({
  selector: 'app-mover-mesa-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    FormsModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dialog-container">
      <h2 mat-dialog-title class="dialog-title">
        Mover Mesa {{ data.mesaOrigen.numero }}
      </h2>
      <mat-dialog-content class="dialog-content">
        <p class="instruction">Selecciona la mesa libre a la que deseas transferir la comanda activa:</p>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Mesa Destino</mat-label>
          <mat-select [(ngModel)]="mesaDestinoId">
            @for (mesa of data.mesasLibres; track mesa.id) {
              <mat-option [value]="mesa.id">
                Mesa {{ mesa.numero }} ({{ mesa.zona }} - Cap: {{ mesa.capacidad }})
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="dialog-actions">
        <button mat-button (click)="dialogRef.close()">Cancelar</button>
        <button
          mat-flat-button
          color="primary"
          [disabled]="!mesaDestinoId"
          (click)="confirmar()">
          Confirmar Cambio
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background-color: var(--color-surface) !important;
      color: var(--color-text-main) !important;
    }

    .dialog-container {
      padding: 16px;
      background-color: var(--color-surface) !important;
      color: var(--color-text-main) !important;
    }

    .dialog-title {
      margin: 0 0 12px 0;
      font-size: 20px;
      font-weight: 800;
      color: var(--color-primary) !important;
    }

    .dialog-content {
      color: var(--color-text-main) !important;
      padding-top: 4px;

      .instruction {
        font-size: 14px;
        color: var(--color-text-main) !important;
        margin-bottom: 12px;
      }
    }

    /* Sobreescritura profunda de Angular Material MDC */
    ::ng-deep {
      .mat-mdc-text-field-wrapper {
        background-color: var(--color-bg) !important;
        border-radius: 8px;
      }

      .mat-mdc-select-value,
      .mat-mdc-select-min-line {
        color: var(--color-text-main) !important;
      }

      .mat-mdc-floating-label,
      .mat-mdc-select-placeholder {
        color: var(--color-text-muted) !important;
      }
    }

    .w-full {
      width: 100%;
      margin-top: 8px;
    }

    .dialog-actions {
      padding-top: 16px;
      border-top: 1px solid var(--color-border);
      margin-top: 16px;

      button {
        font-weight: 700;
      }
    }
  `]
})
export class MoverMesaDialogComponent {
  readonly dialogRef = inject(MatDialogRef<MoverMesaDialogComponent>);
  readonly data = inject<{ mesaOrigen: Mesa; mesasLibres: Mesa[] }>(MAT_DIALOG_DATA);

  mesaDestinoId: number | null = null;

  confirmar() {
    if (this.mesaDestinoId) {
      this.dialogRef.close({ confirmado: true, destinoId: this.mesaDestinoId });
    }
  }
}