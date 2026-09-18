import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  OnDestroy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Subscription } from 'rxjs';

import { MesaService } from '../../core/services/mesa';
import { SocketService } from '../../core/services/socket.service';
import { AuthService } from '../../core/services/auth.service';
import { MesaFiltrosComponent } from './components/mesa-filtros/mesa-filtros';
import { MesaCardComponent, AccionMesa } from './components/mesa-card/mesa-card';
import { AbrirMesaDialogComponent } from './components/abrir-mesa-dialog/abrir-mesa-dialog';
import { MoverMesaDialogComponent } from './components/mover-mesa-dialog/mover-mesa-dialog';
import { DesgloseMesaDialogComponent } from './components/desglose-mesa-dialog/desglose-mesa-dialog';
import { CrearEnvioDialogComponent } from './components/crear-envio-dialog/crear-envio-dialog';
import { Mesa } from '../../core/models/mesa';
import { CrearMostradorDialogComponent } from './components/crear-mostrador-dialog/crear-mostrador-dialog';
import { FormatoNumeroMesaPipe } from '../../core/pipes/formato-numero-mesa.pipe';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatSnackBarModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MesaFiltrosComponent,
    MesaCardComponent,
    FormatoNumeroMesaPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mesas.html',
  styleUrl: './mesas.scss',
})
export class MesasComponent implements OnInit, OnDestroy {
  protected readonly mesaService = inject(MesaService);
  private readonly socketService = inject(SocketService);
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  // Controla la pestaña activa del panel derecho ('MOSTRADOR' o 'DOMICILIO')
  readonly vistaEspecial = signal<'MOSTRADOR' | 'DOMICILIO'>('MOSTRADOR');

  private socketSub!: Subscription;

  ngOnInit() {
    this.mesaService.cargarMesas();

    this.socketSub = this.socketService.onEvent('actualizar_mesas').subscribe(() => {
      this.mesaService.cargarMesas();
    });
  }

  ngOnDestroy() {
    if (this.socketSub) {
      this.socketSub.unsubscribe();
    }
  }

  // 🔹 REGISTRAR MOSTRADOR / PARA LLEVAR
  registrarPedidoMostrador() {
    const dialogRef = this.dialog.open(CrearMostradorDialogComponent, {
      width: '460px',
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result && result.confirmado) {
        const usuarioActivo = this.authService.usuarioActivo();
        const usuarioId = result.usuarioId || usuarioActivo?.id || 1;
        const usuarioNombre = result.usuarioNombre || usuarioActivo?.nombre || 'Atención Caja';
        const clienteId = result.clienteId;

        this.mesaService.crearPedidoMostrador(usuarioId, clienteId).subscribe({
          next: (res) => {
            const numeroLimpio = res.numero ? res.numero.split('-')[0] : '';

            const mesaVirtual: Mesa = {
              id: res.mesaId,
              numero: res.numero,
              zona: 'Mostrador', // 👈 Asignación estricta de zona Mostrador
              capacidad: 1,
              estado: 'PENDIENTE',
              comensales: 1,
              minutosAbierta: 1,
              total: 0,
              clienteNombre: result.nombre || 'Cliente Mostrador',
              mesero: usuarioNombre,
            };

            this.mesaService.seleccionarMesaActiva(mesaVirtual);
            this.notifications.success(`Pedido #${numeroLimpio} registrado con éxito.`);

            this.router.navigate(['/comanda'], {
              queryParams: { mesaId: res.mesaId, comandaId: res.comandaId },
            });
            this.mesaService.cargarMesas();
          },
          error: () => this.notifications.error('Error al crear la orden de mostrador'),
        });
      }
    });
  }

  // REGISTRAR ENVÍO A DOMICILIO
  registrarEnvioDomicilio() {
    const dialogRef = this.dialog.open(CrearEnvioDialogComponent, {
      width: '480px',
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result && result.confirmado) {
        const usuarioActivo = this.authService.usuarioActivo();
        const usuarioId = result.usuarioId || usuarioActivo?.id || 1;
        const usuarioNombre = result.usuarioNombre || usuarioActivo?.nombre || 'Atención Caja';
        const clienteId = result.clienteId;

        this.mesaService.crearEnvio(usuarioId, clienteId).subscribe({
          next: (res) => {
            const numeroLimpio = res.numero ? res.numero.split('-')[0] : '';

            const mesaVirtual: Mesa = {
              id: res.mesaId,
              numero: res.numero,
              zona: 'Domicilio',
              capacidad: 1,
              estado: 'PENDIENTE',
              comensales: 1,
              minutosAbierta: 1,
              total: 0,
              mesero: usuarioNombre,
            };
            this.mesaService.seleccionarMesaActiva(mesaVirtual);
            this.notifications.success(`Envío #${numeroLimpio} registrado con éxito.`);
            this.router.navigate(['/comanda'], {
              queryParams: { mesaId: res.mesaId, comandaId: res.comandaId },
            });
            this.mesaService.cargarMesas();
          },
          error: () => this.notifications.error('Error al crear el envío a domicilio'),
        });
      }
    });
  }

  onAccionMesa(event: { tipo: AccionMesa; mesa: Mesa }) {
    const { tipo, mesa } = event;

    switch (tipo) {
      case 'ABRIR':
        this.abrirMesaModal(mesa);
        break;

      case 'VER_DETALLE':
        this.dialog.open(DesgloseMesaDialogComponent, {
          width: '450px',
          data: { mesa },
        });
        break;

      case 'AGREGAR_COMANDA':
        this.mesaService.seleccionarMesaActiva(mesa);
        this.router.navigate(['/comanda'], { queryParams: { mesaId: mesa.id } });
        break;

      case 'IMPRIMIR_PRECUENTA':
        this.notifications.info(`Imprimiendo precuenta de ${mesa.numero}...`);
        break;

      case 'MOVER_MESA':
        this.moverMesaModal(mesa);
        break;

      case 'COBRAR':
        this.mesaService.seleccionarMesaActiva(mesa);
        this.router.navigate(['/caja'], { queryParams: { mesaId: mesa.id } });
        break;
    }
  }

  moverMesaModal(mesaOrigen: Mesa) {
    const mesasLibres = this.mesaService
      .mesas()
      .filter(
        (m) =>
          m.estado === 'DISPONIBLE' &&
          m.zona !== 'Domicilio' &&
          m.zona !== 'Mostrador' &&
          m.id !== mesaOrigen.id,
      );

    if (mesasLibres.length === 0) {
      this.notifications.warning(
        'No hay mesas de salón disponibles para realizar la transferencia.',
      );
      return;
    }

    const dialogRef = this.dialog.open(MoverMesaDialogComponent, {
      width: '420px',
      data: { mesaOrigen, mesasLibres },
    });

    dialogRef.afterClosed().subscribe((res) => {
      if (res?.confirmado && res.destinoId) {
        this.mesaService.moverMesa(mesaOrigen.id, res.destinoId).subscribe({
          next: () => {
            this.notifications.success(
              `El pedido de ${mesaOrigen.numero} se transfirió exitosamente a la mesa seleccionada.`,
            );
            this.mesaService.cargarMesas();
          },
          error: () =>
            this.notifications.error('Error al transferir el pedido en la base de datos'),
        });
      }
    });
  }

  private abrirMesaModal(mesa: Mesa) {
    const dialogRef = this.dialog.open(AbrirMesaDialogComponent, {
      width: '420px',
      data: { mesa },
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe((res) => {
      if (res?.confirmado) {
        const usuarioActivo = this.authService.usuarioActivo();
        const usuarioId = usuarioActivo?.id || 1;
        this.mesaService.abrirMesa(mesa.id, res.comensales, usuarioId).subscribe({
          next: (respuesta) => {
            const mesaActualizada: Mesa = {
              ...mesa,
              estado: 'PENDIENTE',
              comensales: res.comensales,
              minutosAbierta: 1,
              mesero: usuarioActivo?.nombre || 'Atención',
            };

            this.mesaService.seleccionarMesaActiva(mesaActualizada);
            this.router.navigate(['/comanda'], {
              queryParams: { mesaId: mesa.id, comandaId: respuesta.comandaId },
            });
          },
          error: () => this.notifications.error('Error al abrir la mesa en base de datos'),
        });
      }
    });
  }
}
