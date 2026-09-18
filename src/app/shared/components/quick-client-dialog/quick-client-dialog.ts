import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface QuickClientDialogResult {
  nombre: string;
  telefono: string;
  direccion: string;
}

@Component({
  selector: 'app-quick-client-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Registrar cliente rápido</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Nombre</mat-label>
        <input matInput [(ngModel)]="form.nombre" required />
      </mat-form-field>
      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Teléfono</mat-label>
        <input matInput [(ngModel)]="form.telefono" />
      </mat-form-field>
      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Dirección</mat-label>
        <input matInput [(ngModel)]="form.direccion" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancelar</button>
      <button mat-flat-button color="primary" (click)="guardar()" [disabled]="!form.nombre.trim()">
        Guardar
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickClientDialogComponent {
  readonly dialogRef = inject(
    MatDialogRef<QuickClientDialogComponent, QuickClientDialogResult | undefined>,
  );
  readonly data = inject(MAT_DIALOG_DATA, { optional: true });

  form: QuickClientDialogResult = {
    nombre: '',
    telefono: '',
    direccion: '',
  };

  guardar() {
    this.dialogRef.close({
      nombre: this.form.nombre.trim(),
      telefono: this.form.telefono.trim(),
      direccion: this.form.direccion.trim(),
    });
  }
}
