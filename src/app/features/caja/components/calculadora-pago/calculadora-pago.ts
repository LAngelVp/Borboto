import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CajaService } from '../../../../core/services/caja-service'; // <-- Ruta corregida
import { MetodoPago } from '../../../../core/models/pago';
import { DatosTransferenciaDialogComponent } from '../datos-transferencia-dialog/datos-transferencia-dialog';

@Component({
  selector: 'app-calculadora-pago',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatDialogModule],
  templateUrl: './calculadora-pago.html',
  styleUrl: './calculadora-pago.scss'
})
export class CalculadoraPagoComponent { // <-- Agregado 'Component' al final
  protected readonly cajaService = inject(CajaService);
  private readonly dialog = inject(MatDialog);

  readonly billetesRapidos = [50, 100, 200, 500];

  seleccionarMetodo(metodo: MetodoPago) {
    this.cajaService.setMetodoPago(metodo);
    if (metodo !== 'EFECTIVO') {
      const aPagar = this.cajaService.numeroPartes() > 1
        ? this.cajaService.totalPorPersona()
        : this.cajaService.totalCuenta();
      this.cajaService.setMontoRecibido(aPagar);

      if (metodo === 'TRANSFERENCIA') {
        this.dialog.open(DatosTransferenciaDialogComponent, {
          width: '450px'
        });
      }
    } else {
      this.cajaService.setMontoRecibido(0);
    }
  }

  agregarNumero(num: string) {
    const actual = this.cajaService.montoRecibido().toString();
    const nuevo = actual === '0' ? num : actual + num;
    this.cajaService.setMontoRecibido(parseFloat(nuevo) || 0);
  }

  borrar() {
    const actual = this.cajaService.montoRecibido().toString();
    if (actual.length <= 1) {
      this.cajaService.setMontoRecibido(0);
    } else {
      this.cajaService.setMontoRecibido(parseFloat(actual.slice(0, -1)) || 0);
    }
  }

  sumarBillete(monto: number) {
    this.cajaService.setMontoRecibido(this.cajaService.montoRecibido() + monto);
  }
}