import { Component, inject } from '@angular/core';
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
  template: `
    <h2 mat-dialog-title>Mover Mesa {{ data.mesaOrigen.numero }}</h2>
    <mat-dialog-content>
      <p>Selecciona la mesa libre a la que deseas transferir la comanda activa:</p>

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

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancelar</button>
      <button
        mat-flat-button
        color="primary"
        [disabled]="!mesaDestinoId"
        (click)="confirmar()">
        Confirmar Cambio
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .w-full { width: 100%; margin-top: 8px; }
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