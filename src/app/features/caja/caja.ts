import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
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

// 👈 1. Importar el componente del modal
import { TicketModal } from '../ticket-modal/ticket-modal';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  toggleAgruparConsumo(value: boolean) {
    this.cajaService.setAgruparConsumo(value);
  }

  procesarCobro() {
    if (!this.cajaService.pagoSuficiente()) {
      this.snackBar.open('El pago recibido es insuficiente', 'Cerrar', { duration: 2500 });
      return;
    }

    const usuarioId = this.authService.usuarioActivo()?.id;
    this.cajaService.cobrarYCerrarMesa(usuarioId).subscribe({
      next: (res: any) => {
        let msj = '¡Pago procesado y mesa liberada con éxito!';

        if (res?.autofactura?.codigo) {
          msj += ` Ticket autofactura: ${res.autofactura.codigo}`;
        } else if (res?.errorFacturapi) {
          console.error('Facturapi error:', res.errorFacturapi);
          this.snackBar.open(`Mesa cobrada, pero error de Facturación: ${res.errorFacturapi}`, 'Cerrar', { duration: 6000 });
        }

        // Si no se mostró snackbar de error arriba, mostramos el de éxito general
        if (!res?.errorFacturapi) {
          this.snackBar.open(msj, 'Cerrar', { duration: 4000 });
        }
        this.mesaService.cargarMesas();

        // 👈 2. Abrir la simulación del ticket en pantalla antes de redirigir
        if (res?.ticketTexto) {
          const dialogRef = this.dialog.open(TicketModal, {
            width: '360px',
            disableClose: false,
            data: {
              contenidoTicket: res.ticketTexto,
              titulo: 'Ticket de Cobro (Simulación)'
            }
          });

          // Redirigir al tablero de mesas al cerrar el modal
          dialogRef.afterClosed().subscribe(() => {
            this.router.navigate(['/mesas']);
          });
        } else {
          this.router.navigate(['/mesas']);
        }
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