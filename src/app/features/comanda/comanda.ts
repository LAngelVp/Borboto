import { ChangeDetectionStrategy, Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog'; // 👈 1. Importar MatDialog

import { ComandaService } from '../../core/services/comanda';
import { SocketService } from '../../core/services/socket.service';
import { MesaService } from '../../core/services/mesa';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { PrinterService, ElectronPendingPrintJob } from '../../core/services/printer.service';
import { OrdenResumenComponent } from './components/orden-resumen/orden-resumen';
import { MenuProductosComponent } from './components/menu-productos/menu-productos';
import { TicketModal } from '../ticket-modal/ticket-modal'; // 👈 2. Importar TicketModal

@Component({
  selector: 'app-comanda',
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
export class Comanda implements OnInit, OnDestroy {
  protected readonly comandaService = inject(ComandaService);
  private readonly socketService = inject(SocketService);
  private readonly subscriptions = new Subscription();
  protected readonly mesaService = inject(MesaService);
  protected readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog); // 👈 Inyectar MatDialog
  private readonly printerService = inject(PrinterService);

  comandaId = 0;
  mesaId = 0;
  private comandaParaReintento = 0;

  ngOnInit() {
    this.comandaService.cargarProductos();

    this.subscriptions.add(this.socketService.onEvent('actualizar_productos').subscribe(() => {
      this.comandaService.cargarProductos();
    }));
    this.subscriptions.add(this.route.queryParamMap.subscribe((params) => {
      const mesaId = Number(params.get('mesaId'));
      const comandaId = Number(params.get('comandaId'));
      this.mesaId = Number.isInteger(mesaId) && mesaId > 0 ? mesaId : 0;
      this.comandaId = Number.isInteger(comandaId) && comandaId > 0 ? comandaId : 0;

      if (this.comandaId > 0) {
        this.comandaService.cargarComandaPorId(this.comandaId);
      } else if (this.mesaId > 0) {
        this.comandaService.cargarComandaActivaPorMesa(this.mesaId);
      } else {
        this.comandaService.limpiarComanda();
      }
    }));
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.comandaService.cancelarCargas();
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
        next: async (res: any) => {
          const pendientes: ElectronPendingPrintJob[] = res?.impresionesPendientes || [];
          const fallos = await this.procesarImpresionesPendientes(pendientes);
          const comandaAfectada = Number(res?.comandaId) || this.comandaId;
          this.comandaParaReintento = comandaAfectada;

          this.notifications.success('Comanda actualizada y enviada a cocina.');
          this.comandaService.limpiarComanda();
          this.mesaService.cargarMesas();
          if (comandaAfectada > 0) this.comandaService.cargarEnvios(comandaAfectada);

          if (fallos > 0) {
            this.notifications.error(
              'Los productos quedaron guardados, pero la impresión USB falló. Reintenta el envío pendiente desde el aviso superior.',
              8000,
            );
            return;
          }

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

  reimprimirEnvio(envioId: number) {
    const comandaId = this.comandaParaReintento || this.comandaId || this.comandaService.comandaIdActiva();
    if (!comandaId) {
      this.notifications.warning('No se pudo identificar la comanda del envío.');
      return;
    }
    this.comandaService.reimprimirEnvio(comandaId, envioId).subscribe({
      next: async (res) => {
        const fallos = await this.procesarImpresionesPendientes(res?.impresionesPendientes || []);
        if (fallos === 0) {
          this.notifications.success('Envío reimpreso correctamente.');
        }
      },
      error: () => this.notifications.error('No se pudo reimprimir el envío.'),
    });
  }

  confirmarEnvio(envioId: number) {
    const comandaId = this.comandaParaReintento || this.comandaId || this.comandaService.comandaIdActiva();
    if (!comandaId) {
      this.notifications.warning('No se pudo identificar la comanda del envío.');
      return;
    }
    this.comandaService.confirmarEnvio(comandaId, envioId).subscribe({
      next: () => this.notifications.success('Envío marcado como impreso.'),
      error: () => this.notifications.error('No se pudo confirmar el envío.'),
    });
  }

  private async procesarImpresionesPendientes(impresionesPendientes: ElectronPendingPrintJob[]): Promise<number> {
    let fallos = 0;
    for (const trabajo of impresionesPendientes) {
      try {
        await this.printerService.printTicketSilently(trabajo);
      } catch (err: unknown) {
        fallos++;
        console.error('Error en impresión USB con Electron:', err);
        const mensaje = err instanceof Error ? err.message : 'No se pudo imprimir la comanda USB automaticamente.';
        this.notifications.error(
          trabajo.itemIds?.length ? `${mensaje} Productos sin confirmar; revise la impresora antes de reintentar.` : mensaje,
          5000,
        );
      }
    }
    return fallos;
  }
}
