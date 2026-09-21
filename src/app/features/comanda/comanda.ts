import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog'; // 👈 1. Importar MatDialog

import { ComandaService } from '../../core/services/comanda';
import { MesaService } from '../../core/services/mesa';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { PrinterService, ElectronPendingPrintJob } from '../../core/services/printer.service';
import { OrdenResumenComponent } from './components/orden-resumen/orden-resumen';
import { MenuProductosComponent } from './components/menu-productos/menu-productos';
import { TicketModal } from '../ticket-modal/ticket-modal'; // 👈 2. Importar TicketModal

@Component({
  selector: 'app-comanda',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    OrdenResumenComponent,
    MenuProductosComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './comanda.html',
  styleUrl: './comanda.scss',
})
export class Comanda implements OnInit {
  protected readonly comandaService = inject(ComandaService);
  protected readonly mesaService = inject(MesaService);
  protected readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog); // 👈 Inyectar MatDialog
  private readonly printerService = inject(PrinterService);

  comandaId = 0;
  mesaId = 0;

  ngOnInit() {
    this.comandaService.cargarProductos();

    this.route.queryParams.subscribe((params) => {
      this.mesaId = Number(params['mesaId']) || 0;
      this.comandaId = Number(params['comandaId']) || 0;

      if (this.comandaId > 0) {
        this.comandaService.cargarComandaPorId(this.comandaId);
      } else if (this.mesaId > 0) {
        this.comandaService.cargarComandaActivaPorMesa(this.mesaId);
      }
    });
  }

  enviarCocina() {
    if (this.comandaService.itemsComanda().length === 0) {
      this.notifications.warning('Seleccione al menos un producto', 2500);
      return;
    }

    const usuarioId = this.authService.usuarioActivo()?.id;
    this.comandaService
      .enviarComandaACocina(
        this.comandaId,
        this.comandaId > 0 ? this.comandaService.mesaIdActual() : this.mesaId,
        usuarioId,
      )
      .subscribe({
        next: (res: any) => {
          void this.procesarImpresionesPendientes(res?.impresionesPendientes || []);
          this.notifications.success('Comanda actualizada y enviada a cocina.');
          this.comandaService.limpiarComanda();
          this.mesaService.cargarMesas();

          // Si el backend devuelve la comanda simulada la previsualizamos en el modal
          if (res?.ticketTexto) {
            const dialogRef = this.dialog.open(TicketModal, {
              width: '360px',
              data: {
                contenidoTicket: res.ticketTexto,
                titulo: 'Comanda Enviada (Simulación)',
              },
            });

            dialogRef.afterClosed().subscribe(() => {
              this.router.navigate(['/mesas']);
            });
          } else {
            this.router.navigate(['/mesas']);
          }
        },
        error: () => this.notifications.error('Error al guardar comanda en base de datos'),
      });
  }

  private async procesarImpresionesPendientes(impresionesPendientes: ElectronPendingPrintJob[]) {
    for (const trabajo of impresionesPendientes) {
      try {
        await this.printerService.printTicketSilently(trabajo);
      } catch (err: any) {
        console.error('Error en impresión USB con Electron:', err);
        this.notifications.error(
          err?.message || 'No se pudo imprimir la comanda USB automáticamente.',
          5000,
        );
      }
    }
  }
}
