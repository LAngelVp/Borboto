import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Mesa } from '../../../../core/models/mesa';

export interface DialogDataAbrirMesa {
  mesa: Mesa;
}

@Component({
  selector: 'app-abrir-mesa-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './abrir-mesa-dialog.html',
  styleUrl: './abrir-mesa-dialog.scss'
})
export class AbrirMesaDialogComponent {
  readonly dialogRef = inject(MatDialogRef<AbrirMesaDialogComponent>);
  readonly data = inject<DialogDataAbrirMesa>(MAT_DIALOG_DATA);

  // Comensales por defecto: 2
  readonly comensales = signal<number>(2);

  incrementar() {
    if (this.comensales() < 20) this.comensales.update(c => c + 1);
  }

  decrementar() {
    if (this.comensales() > 1) this.comensales.update(c => c - 1);
  }

  setComensales(num: number) {
    this.comensales.set(num);
  }

  confirmarApertura() {
    this.dialogRef.close({
      confirmado: true,
      comensales: this.comensales()
    });
  }
}