import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { CajaService } from '../../../../core/services/caja-service';
import { AjustesService, Cliente } from '../../../../core/services/ajustes.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  QuickClientDialogComponent,
  QuickClientDialogResult,
} from '../../../../shared/components/quick-client-dialog/quick-client-dialog';

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
    MatSelectModule,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desglose-cuenta.html',
  styleUrl: './desglose-cuenta.scss',
})
export class DesgloseCuentaComponent implements OnInit {
  protected readonly cajaService = inject(CajaService);
  private readonly ajustesService = inject(AjustesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);

  protected readonly Math = Math;

  codigoPromo = signal<string>('');
  clientes = signal<Cliente[]>([]);
  busquedaCliente = signal<string>('');

  // 🔹 Signal para controlar la cantidad de puntos personalizada que se desea canjear
  puntosAUsarInput = signal<number | null>(null);

  readonly clientesFiltrados = computed(() => {
    const query = this.busquedaCliente().toLowerCase().trim();
    if (!query) return this.clientes();

    return this.clientes().filter(
      (c) => c.nombre.toLowerCase().includes(query) || (c.telefono && c.telefono.includes(query)),
    );
  });

  readonly encabezadoCuenta = computed(() => {
    if (this.cajaService.tipoOrigen() === 'MESA' && this.cajaService.mesaNumero()) {
      return `Cuenta Mesa ${this.cajaService.mesaNumero()}`;
    }

    return `Cuenta ${this.cajaService.folioOrigen() || this.cajaService.mesaNumero() || 'Pedido'}`;
  });

  ngOnInit() {
    this.cargarClientesAll();
  }

  cargarClientesAll() {
    this.ajustesService.getClientes().subscribe({
      next: (data) => this.clientes.set(data || []),
      error: () => console.error('Error al cargar clientes de cartera'),
    });
  }

  alAbrirSelect(abierto: boolean) {
    if (!abierto) {
      this.busquedaCliente.set('');
    }
  }

  onVincularCliente(clienteId: number) {
    const comId = this.cajaService.comandaId();
    if (!comId) return;

    this.cajaService.vincularClienteAComanda(comId, clienteId).subscribe({
      next: (res) => {
        if (res.ok && res.cliente) {
          this.cajaService.clienteId.set(res.cliente.id);
          this.cajaService.clienteNombre.set(res.cliente.nombre);
          this.cajaService.clientePuntos.set(res.cliente.clientePuntos || 0);
          this.cajaService.clienteEsFrecuente.set(!!res.cliente.clienteEsFrecuente);
          this.cajaService.clienteVisitas.set(res.cliente.clienteVisitas || 0);
          this.notifications.success(`Se asoció a ${res.cliente.nombre} a esta cuenta de consumo.`);
        }
      },
      error: () => this.notifications.error('Error al asociar el cliente a la comanda'),
    });
  }

  registrarRapido() {
    const dialogRef = this.dialog.open(QuickClientDialogComponent, {
      width: '420px',
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe((result?: QuickClientDialogResult) => {
      if (!result?.nombre) {
        return;
      }

      this.notifications.info('Registrando cliente...');
      this.ajustesService.crearCliente(result).subscribe({
        next: (cliNuevo) => {
          this.notifications.success(`Cliente ${cliNuevo.nombre} registrado con éxito.`);
          this.cargarClientesAll();
          if (cliNuevo.id && this.cajaService.comandaId()) {
            this.onVincularCliente(cliNuevo.id);
          }
        },
        error: () => this.notifications.error('Error al registrar cliente'),
      });
    });
  }

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
        this.notifications.success(`Cupón "${promo.nombre}" aplicado con éxito.`);
        this.codigoPromo.set('');
      },
      error: () => {
        this.notifications.warning('Código de cupón inválido o expirado.');
      },
    });
  }

  // 🔹 Canje del Máximo de Puntos Permitidos
  canjearPuntos() {
    const pts = this.cajaService.clientePuntos();
    if (pts <= 0) return;
    this.cajaService.canjearPuntosLealtad(pts);
    this.puntosAUsarInput.set(null);
  }

  // 🔹 Canje Personalizado de Puntos
  canjearPuntosPersonalizado() {
    const cantidad = Number(this.puntosAUsarInput());
    const ptsDisponibles = this.cajaService.clientePuntos();
    const totalCuenta = this.cajaService.totalCuentaOriginal();

    if (!cantidad || cantidad <= 0) {
      this.notifications.warning('Ingresa una cantidad de puntos válida superior a 0.', 2500);
      return;
    }

    if (cantidad > ptsDisponibles) {
      this.notifications.warning(
        `El cliente solo cuenta con ${ptsDisponibles} puntos disponibles.`,
      );
      return;
    }

    if (cantidad > totalCuenta) {
      this.notifications.warning(
        `No se pueden canjear más puntos ($${cantidad}.00) que el total de la cuenta ($${totalCuenta.toFixed(2)}).`,
        3500,
      );
      return;
    }

    this.cajaService.canjearPuntosLealtad(cantidad);
    this.notifications.success(
      `Se aplicaron ${cantidad} puntos (-$${cantidad}.00 MXN) a la cuenta.`,
    );
    this.puntosAUsarInput.set(null);
  }

  quitarDescuento() {
    this.cajaService.descuentoAplicado.set(0);
    this.cajaService.promocionIdAplicada.set(null);
    this.cajaService.promocionNombreAplicada.set('');
    this.cajaService.puntosCanjeados.set(0);
    this.cajaService.totalCuenta.set(this.cajaService.totalCuentaOriginal());
    this.cajaService.montoRecibido.set(this.cajaService.totalCuentaOriginal());
    this.puntosAUsarInput.set(null);
    this.notifications.info('Beneficio / Descuento removido.', 2500);
  }

  quitarCliente() {
    const comId = this.cajaService.comandaId();
    if (!comId) return;

    this.cajaService.vincularClienteAComanda(comId, null).subscribe({
      next: (res) => {
        if (res.ok) {
          this.cajaService.clienteId.set(null);
          this.cajaService.clienteNombre.set('');
          this.cajaService.clientePuntos.set(0);
          this.cajaService.clienteEsFrecuente.set(false);
          this.cajaService.clienteVisitas.set(0);
          this.cajaService.puntosCanjeados.set(0);
          this.cajaService.descuentoAplicado.set(0);
          this.cajaService.totalCuenta.set(this.cajaService.totalCuentaOriginal());
          this.cajaService.montoRecibido.set(this.cajaService.totalCuentaOriginal());
          this.puntosAUsarInput.set(null);
          this.notifications.info('Se desvinculó al cliente de esta cuenta de consumo.');
        }
      },
      error: () => this.notifications.error('Error al desvincular el cliente.'),
    });
  }
}
