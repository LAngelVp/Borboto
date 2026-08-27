import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { CajaService } from '../../core/services/caja-service';
import { MesaService } from '../../core/services/mesa';
import { AuthService } from '../../core/services/auth.service';
import { DesgloseCuentaComponent } from './components/desglose-cuenta/desglose-cuenta';
import { CalculadoraPagoComponent } from './components/calculadora-pago/calculadora-pago';
import { CorteCajaDialog } from './components/corte-caja-dialog/corte-caja-dialog';

@Component({
  selector: 'app-caja',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    MatCheckboxModule,
    DesgloseCuentaComponent,
    CalculadoraPagoComponent
  ],
  templateUrl: './caja.html',
  styleUrl: './caja.scss'
})
export class Caja implements OnInit {
  protected readonly cajaService = inject(CajaService);
  protected readonly authService = inject(AuthService);
  private readonly mesaService = inject(MesaService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const mesaId = Number(params['mesaId']);
      if (mesaId) {
        this.cajaService.cargarCuentaMesa(mesaId);
      } else {
        this.cajaService.limpiarSeleccion();
      }
    });
  }

  toggleFactura(solicita: boolean) {
    this.cajaService.setSolicitaFactura(solicita);
  }

  procesarCobro() {
    if (!this.cajaService.pagoSuficiente()) {
      this.snackBar.open('El pago recibido es insuficiente', 'Cerrar', { duration: 2500 });
      return;
    }

    const usuarioId = this.authService.usuarioActivo()?.id;
    this.cajaService.cobrarYCerrarMesa(usuarioId).subscribe({
      next: (res) => {
        let msj = '¡Pago procesado y mesa liberada con éxito!';

        if (this.cajaService.solicitaFactura() && res?.autofactura?.codigo) {
          msj += ` Ticket de autofactura: ${res.autofactura.codigo}`;
        }

        this.snackBar.open(msj, 'Cerrar', { duration: 4000 });
        this.mesaService.cargarMesas();
        this.router.navigate(['/mesas']);
      },
      error: () => this.snackBar.open('Error al procesar el cobro', 'Cerrar', { duration: 3000 })
    });
  }

  abrirCorteCaja() {
    this.dialog.open(CorteCajaDialog, {
      width: '600px',
      disableClose: true
    });
  }
}