import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
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
    MesaCardComponent
  ],
  templateUrl: './mesas.html',
  styleUrl: './mesas.scss'
})
export class MesasComponent implements OnInit, OnDestroy {
  protected readonly mesaService = inject(MesaService);
  private readonly socketService = inject(SocketService);
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private socketSub!: Subscription;

  ngOnInit() {
    this.socketSub = this.socketService.onEvent('actualizar_mesas').subscribe(() => {
      this.mesaService.cargarMesas();
    });
  }

  ngOnDestroy() {
    if (this.socketSub) {
      this.socketSub.unsubscribe();
    }
  }

  registrarEnvioDomicilio() {
    const dialogRef = this.dialog.open(CrearEnvioDialogComponent, {
      width: '480px',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result && result.confirmado) {
        const usuarioId = this.authService.usuarioActivo()?.id || 1;
        const clienteId = result.clienteId;

        this.mesaService.crearEnvio(usuarioId, clienteId).subscribe({
          next: (res) => {
            const mesaVirtual: Mesa = {
              id: res.mesaId,
              numero: res.numero,
              zona: 'Domicilio',
              capacidad: 1,
              estado: 'PENDIENTE',
              comensales: 1,
              minutosAbierta: 1,
              total: 0
            };
            this.mesaService.seleccionarMesaActiva(mesaVirtual);
            this.snackBar.open(`¡${res.numero} registrado con éxito!`, 'Cerrar', { duration: 3000 });
            this.router.navigate(['/comanda'], {
              queryParams: { mesaId: res.mesaId, comandaId: res.comandaId }
            });
            this.mesaService.cargarMesas();
          },
          error: () => this.snackBar.open('Error al crear el envío a domicilio', 'Cerrar', { duration: 3000 })
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

      // 1. VER DESGLOSE: Solo lectura de productos consumidos
      case 'VER_DETALLE':
        this.dialog.open(DesgloseMesaDialogComponent, {
          width: '450px',
          data: { mesa }
        });
        break;

      // 2. AGREGAR MÁS PRODUCTOS: Navega a la pantalla de comandero
      case 'AGREGAR_COMANDA':
        this.mesaService.seleccionarMesaActiva(mesa);
        this.router.navigate(['/comanda'], { queryParams: { mesaId: mesa.id } });
        break;

      case 'IMPRIMIR_PRECUENTA':
        this.snackBar.open(`Imprimiendo precuenta de Mesa ${mesa.numero}...`, 'Cerrar', { duration: 3000 });
        break;

      case 'MOVER_MESA':
        this.moverMesaModal(mesa);
        break;

      // 3. COBRAR: Pasa a pantalla de caja
      case 'COBRAR':
        this.mesaService.seleccionarMesaActiva(mesa);
        this.router.navigate(['/caja'], { queryParams: { mesaId: mesa.id } });
        break;
    }
  }

  private moverMesaModal(mesaOrigen: Mesa) {
  // Corregido: Filtramos solo las mesas en estado DISPONIBLE
  const mesasLibres = this.mesaService.mesas().filter(m =>
    m.estado === 'DISPONIBLE' && m.id !== mesaOrigen.id
  );

  if (mesasLibres.length === 0) {
    this.snackBar.open('No hay mesas disponibles para realizar el cambio.', 'Cerrar', { duration: 3000 });
    return;
  }

  const dialogRef = this.dialog.open(MoverMesaDialogComponent, {
    width: '420px',
    data: { mesaOrigen, mesasLibres }
  });

  dialogRef.afterClosed().subscribe(res => {
    if (res?.confirmado && res.destinoId) {
      this.mesaService.moverMesa(mesaOrigen.id, res.destinoId).subscribe({
        next: () => {
          this.snackBar.open(`Mesa ${mesaOrigen.numero} movida exitosamente.`, 'Cerrar', { duration: 3000 });
          this.mesaService.cargarMesas();
        },
        error: () => this.snackBar.open('Error al transferir la mesa en base de datos', 'Cerrar', { duration: 3000 })
      });
    }
  });
}

  private abrirMesaModal(mesa: Mesa) {
    const dialogRef = this.dialog.open(AbrirMesaDialogComponent, {
      width: '420px',
      data: { mesa },
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(res => {
      if (res?.confirmado) {
        const usuarioId = this.authService.usuarioActivo()?.id || 1;
        this.mesaService.abrirMesa(mesa.id, res.comensales, usuarioId).subscribe({
          next: (respuesta) => {
            const mesaActualizada: Mesa = {
              ...mesa,
              estado: 'PENDIENTE',
              comensales: res.comensales,
              minutosAbierta: 1
            };

            this.mesaService.seleccionarMesaActiva(mesaActualizada);
            this.router.navigate(['/comanda'], {
              queryParams: { mesaId: mesa.id, comandaId: respuesta.comandaId }
            });
          },
          error: () => this.snackBar.open('Error al abrir la mesa en base de datos', 'Cerrar', { duration: 3000 })
        });
      }
    });
  }
}