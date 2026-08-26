import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CajaService } from '../../../../core/services/caja-service'; // <-- Ruta corregida

@Component({
  selector: 'app-desglose-cuenta',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './desglose-cuenta.html',
  styleUrl: './desglose-cuenta.scss'
})
export class DesgloseCuentaComponent { // <-- Agregado 'Component' al final
  protected readonly cajaService = inject(CajaService);
  private readonly snackBar = inject(MatSnackBar);

  codigoPromo = signal<string>('');

  incrementarPartes() {
    this.cajaService.setNumeroPartes(this.cajaService.numeroPartes() + 1);
  }

  decrementarPartes() {
    if (this.cajaService.numeroPartes() > 1) {
      this.cajaService.setNumeroPartes(this.cajaService.numeroPartes() - 1);
    }
  }

  aplicarCodigo() {
    const cod = this.codigoPromo().trim();
    if (!cod) return;

    this.cajaService.validarCupon(cod).subscribe({
      next: (promo) => {
        this.cajaService.aplicarDescuento(promo);
        this.snackBar.open(`¡Cupón "${promo.nombre}" aplicado con éxito!`, 'Cerrar', { duration: 3000 });
        this.codigoPromo.set('');
      },
      error: () => {
        this.snackBar.open('Código de cupón inválido o expirado.', 'Cerrar', { duration: 3000 });
      }
    });
  }

  quitarDescuento() {
    this.cajaService.descuentoAplicado.set(0);
    this.cajaService.promocionIdAplicada.set(null);
    this.cajaService.promocionNombreAplicada.set('');
    this.cajaService.totalCuenta.set(this.cajaService.totalCuentaOriginal());
    this.cajaService.montoRecibido.set(this.cajaService.totalCuentaOriginal());
    this.snackBar.open('Cupón removido.', 'Cerrar', { duration: 2500 });
  }
}