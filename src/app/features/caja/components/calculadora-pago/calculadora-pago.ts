import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CajaService } from '../../../../core/services/caja-service';
import { MetodoPago } from '../../../../core/models/pago';
import { DatosTransferenciaDialogComponent } from '../datos-transferencia-dialog/datos-transferencia-dialog';

@Component({
  selector: 'app-calculadora-pago',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calculadora-pago.html',
  styleUrl: './calculadora-pago.scss'
})
export class CalculadoraPagoComponent {
  protected readonly cajaService = inject(CajaService);
  private readonly dialog = inject(MatDialog);

  readonly billetesRapidos = [50, 100, 200, 500];

  seleccionarMetodo(metodo: MetodoPago) {
    // Evitar hacer nada si hace clic en el método que ya estaba activo
    if (this.cajaService.metodoPago() === metodo && metodo === 'EFECTIVO') {
      return;
    }

    this.cajaService.setMetodoPago(metodo);

    const totalAPagar = this.cajaService.numeroPartes() > 1
      ? this.cajaService.totalPorPersona()
      : this.cajaService.totalCuenta();

    if (metodo !== 'EFECTIVO') {
      // Tarjeta o Transferencia cubren el pago exacto
      this.cajaService.setMontoRecibido(totalAPagar);

      if (metodo === 'TRANSFERENCIA') {
        this.dialog.open(DatosTransferenciaDialogComponent, {
          width: '450px'
        });
      }
    } else {
      // 🔹 CORRECCIÓN: Si al regresar a EFECTIVO el monto es 0 o venía de tarjeta/transferencia,
      // asignamos el total exacto por defecto para facilitar el cobro rápido.
      // Si prefieres que al cambiar a efectivo quede en 0 solo si estaba vacío, se mantiene la memoria.
      if (this.cajaService.montoRecibido() === 0) {
        this.cajaService.setMontoRecibido(totalAPagar);
      }
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