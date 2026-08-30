import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Mesa } from '../../../../core/models/mesa';

export interface DialogDataAbrirMesa {
  mesa: Mesa;
}

@Component({
  selector: 'app-abrir-mesa-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './abrir-mesa-dialog.html',
  styleUrl: './abrir-mesa-dialog.scss'
})
export class AbrirMesaDialogComponent {
  readonly dialogRef = inject(MatDialogRef<AbrirMesaDialogComponent>);
  readonly data = inject<DialogDataAbrirMesa>(MAT_DIALOG_DATA);

  // Comensales por defecto: 2
  readonly comensales = signal<number>(2);
  readonly modoManual = signal<boolean>(false);

  incrementar() {
    if (this.comensales() < 99) {
      this.comensales.update(c => c + 1);
    }
  }

  decrementar() {
    if (this.comensales() > 1) {
      this.comensales.update(c => c - 1);
      if (this.comensales() < 6) {
        this.modoManual.set(false);
      }
    }
  }

  setComensales(num: number) {
    this.comensales.set(num);
    this.modoManual.set(false);
  }

  activarModoManual() {
    this.modoManual.set(true);
    if (this.comensales() < 6) {
      this.comensales.set(6);
    }
  }

  actualizarManual(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 99) {
      this.comensales.set(val);
    } else if (input.value === '') {
      this.comensales.set(1);
    }
  }

  confirmarApertura() {
    this.dialogRef.close({
      confirmado: true,
      comensales: this.comensales()
    });
  }
}