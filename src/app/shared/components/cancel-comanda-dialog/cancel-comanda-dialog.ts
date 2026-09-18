import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-cancel-comanda-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Cancelar comanda</h2>
    <mat-dialog-content>
      <p>Esta acción liberará la mesa y no se puede deshacer.</p>
      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Motivo de cancelación</mat-label>
        <textarea matInput rows="3" [(ngModel)]="motivo"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancelar</button>
      <button mat-flat-button color="warn" (click)="confirmar()">Confirmar</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancelComandaDialogComponent {
  readonly dialogRef = inject(MatDialogRef<CancelComandaDialogComponent, string | undefined>);
  motivo = '';

  confirmar() {
    this.dialogRef.close(this.motivo.trim() || 'Sin motivo especificado');
  }
}
