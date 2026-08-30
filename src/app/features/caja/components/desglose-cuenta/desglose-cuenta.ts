import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CajaService } from '../../../../core/services/caja-service';
import { AjustesService, Cliente } from '../../../../core/services/ajustes.service';

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
    FormsModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desglose-cuenta.html',
  styleUrl: './desglose-cuenta.scss'
})
export class DesgloseCuentaComponent implements OnInit {
  protected readonly cajaService = inject(CajaService);
  private readonly ajustesService = inject(AjustesService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly Math = Math;

  codigoPromo = signal<string>('');
  clientes = signal<Cliente[]>([]);
  busquedaCliente = signal<string>('');

  // 🔹 Signal para controlar la cantidad de puntos personalizada que se desea canjear
  puntosAUsarInput = signal<number | null>(null);

  readonly clientesFiltrados = computed(() => {
    const query = this.busquedaCliente().toLowerCase().trim();
    if (!query) return this.clientes();

    return this.clientes().filter(c =>
      c.nombre.toLowerCase().includes(query) ||
      (c.telefono && c.telefono.includes(query))
    );
  });

  ngOnInit() {
    this.cargarClientesAll();
  }

  cargarClientesAll() {
    this.ajustesService.getClientes().subscribe({
      next: (data) => this.clientes.set(data || []),
      error: () => console.error('Error al cargar clientes de cartera')
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
          this.snackBar.open(`Se asoció a ${res.cliente.nombre} a esta cuenta de consumo.`, 'Cerrar', { duration: 3000 });
        }
      },
      error: () => this.snackBar.open('Error al asociar el cliente a la comanda', 'Cerrar', { duration: 3000 })
    });
  }

  registrarRapido() {
    const nombre = prompt('Ingrese el nombre del nuevo cliente:');
    if (!nombre) return;
    const telefono = prompt('Ingrese el teléfono del cliente (opcional):') || '';
    const direccion = prompt('Ingrese la dirección del cliente (opcional):') || '';

    this.ajustesService.crearCliente({ nombre, telefono, direccion }).subscribe({
      next: (cliNuevo) => {
        this.snackBar.open(`¡Cliente ${cliNuevo.nombre} registrado con éxito!`, 'Cerrar', { duration: 3000 });
        this.cargarClientesAll();
        if (cliNuevo.id && this.cajaService.comandaId()) {
          this.onVincularCliente(cliNuevo.id);
        }
      },
      error: () => this.snackBar.open('Error al registrar cliente', 'Cerrar', { duration: 3000 })
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
        this.snackBar.open(`¡Cupón "${promo.nombre}" aplicado con éxito!`, 'Cerrar', { duration: 3000 });
        this.codigoPromo.set('');
      },
      error: () => {
        this.snackBar.open('Código de cupón inválido o expirado.', 'Cerrar', { duration: 3000 });
      }
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
      this.snackBar.open('Ingresa una cantidad de puntos válida superior a 0.', 'Cerrar', { duration: 2500 });
      return;
    }

    if (cantidad > ptsDisponibles) {
      this.snackBar.open(`El cliente solo cuenta con ${ptsDisponibles} puntos disponibles.`, 'Cerrar', { duration: 3000 });
      return;
    }

    if (cantidad > totalCuenta) {
      this.snackBar.open(`No se pueden canjear más puntos ($${cantidad}.00) que el total de la cuenta ($${totalCuenta.toFixed(2)}).`, 'Cerrar', { duration: 3500 });
      return;
    }

    this.cajaService.canjearPuntosLealtad(cantidad);
    this.snackBar.open(`¡Se aplicaron ${cantidad} puntos (-$${cantidad}.00 MXN) a la cuenta!`, 'Cerrar', { duration: 3000 });
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
    this.snackBar.open('Beneficio / Descuento removido.', 'Cerrar', { duration: 2500 });
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
          this.snackBar.open('Se desvinculó al cliente de esta cuenta de consumo.', 'Cerrar', { duration: 3000 });
        }
      },
      error: () => this.snackBar.open('Error al desvincular el cliente.', 'Cerrar', { duration: 3000 })
    });
  }
}