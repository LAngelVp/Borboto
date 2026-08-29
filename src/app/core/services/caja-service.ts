import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ItemComanda } from '../models/producto';
import { MetodoPago } from '../models/pago';

@Injectable({
  providedIn: 'root'
})
export class CajaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:3000/api';

  readonly mesaId = signal<number>(0);
  readonly comandaId = signal<number>(0);
  readonly numeroMesa = signal<string>('');

  // ALIAS PÚBLICO PARA RETROCOMPATIBILIDAD CON LA PLANTILLA HTML
  readonly mesaNumero = this.numeroMesa;

  readonly totalCuentaOriginal = signal<number>(0);
  readonly totalCuenta = signal<number>(0);
  readonly descuentoAplicado = signal<number>(0);
  readonly promocionIdAplicada = signal<number | null>(null);
  readonly promocionNombreAplicada = signal<string>('');
  readonly items = signal<ItemComanda[]>([]);
  readonly itemsComanda = this.items;

  // Estado de Facturación
  readonly solicitaFactura = signal<boolean>(false);

  // Datos del Cliente y Puntos de Lealtad
  readonly clienteId = signal<number | null>(null);
  readonly clienteNombre = signal<string>('');
  readonly clientePuntos = signal<number>(0);
  readonly clienteEsFrecuente = signal<boolean>(false);
  readonly clienteVisitas = signal<number>(0);
  readonly puntosCanjeados = signal<number>(0);

  readonly puntosPorGanar = computed(() => {
    return Math.floor(this.totalCuenta() / 10);
  });

  readonly metodoPago = signal<MetodoPago>('EFECTIVO');
  readonly montoRecibido = signal<number>(0);
  readonly numeroPartes = signal<number>(1);

  readonly totalPorPersona = computed(() => {
    const partes = this.numeroPartes();
    return partes > 0 ? this.totalCuenta() / partes : this.totalCuenta();
  });

  readonly cambio = computed(() => {
    const aPagar = this.numeroPartes() > 1 ? this.totalPorPersona() : this.totalCuenta();
    const diff = this.montoRecibido() - aPagar;
    return diff > 0 ? diff : 0;
  });

  readonly cambioCalculado = this.cambio;

  readonly pagoSuficiente = computed(() => {
    const total = this.numeroPartes() > 1 ? this.totalPorPersona() : this.totalCuenta();
    if (total <= 0) return false;

    if (this.metodoPago() === 'EFECTIVO') {
      return this.montoRecibido() >= total;
    }
    return true;
  });

  setMetodoPago(metodo: MetodoPago) {
    this.metodoPago.set(metodo);
  }

  setMontoRecibido(monto: number) {
    this.montoRecibido.set(monto);
  }

  setNumeroPartes(partes: number) {
    this.numeroPartes.set(partes);
  }

  setSolicitaFactura(solicita: boolean) {
    this.solicitaFactura.set(solicita);
  }

  cargarCuentaMesa(mesaId: number) {
    this.mesaId.set(mesaId);
    this.descuentoAplicado.set(0);
    this.promocionIdAplicada.set(null);
    this.promocionNombreAplicada.set('');
    this.clienteId.set(null);
    this.clienteNombre.set('');
    this.clientePuntos.set(0);
    this.clienteEsFrecuente.set(false);
    this.clienteVisitas.set(0);
    this.puntosCanjeados.set(0);
    this.solicitaFactura.set(false);

    this.http.get<{
      comandaId: number;
      mesaNumero: string;
      total: number;
      clienteId?: number | null;
      clienteNombre?: string;
      clientePuntos?: number;
      clienteEsFrecuente?: boolean;
      clienteVisitas?: number;
    }>(`${this.apiUrl}/caja/mesa/${mesaId}`).subscribe({
      next: (res) => {
        this.comandaId.set(res.comandaId);
        this.numeroMesa.set(String(res.mesaNumero));
        this.totalCuentaOriginal.set(Number(res.total));
        this.totalCuenta.set(Number(res.total));
        this.montoRecibido.set(Number(res.total));

        if (res.clienteId) {
          this.clienteId.set(res.clienteId);
          this.clienteNombre.set(res.clienteNombre || '');
          this.clientePuntos.set(res.clientePuntos || 0);
          this.clienteEsFrecuente.set(!!res.clienteEsFrecuente);
          this.clienteVisitas.set(res.clienteVisitas || 0);
        }
      },
      error: (err) => console.error('Error al obtener cuenta de caja:', err)
    });

    this.http.get<{ items: ItemComanda[] }>(`${this.apiUrl}/comandas/activa/${mesaId}`).subscribe({
      next: (res) => this.items.set(res.items || []),
      error: (err) => console.error('Error al obtener ítems:', err)
    });
  }

  cobrarYCerrarMesa(usuarioId?: number) {
    const payload = {
      comandaId: this.comandaId(),
      mesaId: this.mesaId(),
      usuarioId: usuarioId || 1,
      metodoPago: this.metodoPago(),
      totalCuenta: this.totalCuenta(),
      montoRecibido: this.montoRecibido(),
      cambio: this.cambio(),
      dividirCuenta: this.numeroPartes() > 1,
      partesIguales: this.numeroPartes(),
      descuento: this.descuentoAplicado(),
      promocionId: this.promocionIdAplicada(),
      puntosCanjeados: this.puntosCanjeados(),
      solicitaFactura: this.solicitaFactura()
    };

    return this.http.post<{ ok: boolean; ticketId: number; autofactura?: any }>(`${this.apiUrl}/caja/cobrar`, payload);
  }

  vincularClienteAComanda(comandaId: number, clienteId: number | null) {
    return this.http.patch<{
      ok: boolean;
      cliente: {
        id: number;
        nombre: string;
        clientePuntos: number;
        clienteEsFrecuente: boolean;
        clienteVisitas: number;
      } | null;
    }>(`${this.apiUrl}/comandas/${comandaId}/cliente`, { clienteId });
  }

  validarCupon(codigo: string) {
    return this.http.get<{
      id: number;
      nombre: string;
      codigo: string;
      tipo: 'COMBO_PRECIO' | 'DESCUENTO_PORCENTAJE' | 'DESCUENTO_MONTO';
      valor: number;
      descripcion: string;
    }>(`${this.apiUrl}/promociones/validar/${codigo}`);
  }

  aplicarDescuento(promo: { id: number; nombre: string; tipo: string; valor: number }) {
    this.promocionIdAplicada.set(promo.id);
    this.promocionNombreAplicada.set(promo.nombre);

    const subtotal = this.totalCuentaOriginal();
    let desc = 0;

    if (promo.tipo === 'DESCUENTO_PORCENTAJE') {
      desc = (subtotal * promo.valor) / 100;
    } else if (promo.tipo === 'DESCUENTO_MONTO') {
      desc = promo.valor;
    }

    if (desc > subtotal) desc = subtotal;

    this.descuentoAplicado.set(desc);
    this.totalCuenta.set(subtotal - desc);
    this.montoRecibido.set(subtotal - desc);
  }

  canjearPuntosLealtad(puntos: number) {
    const subtotalActual = this.totalCuentaOriginal();

    // 1. Validar que no intente canjear más puntos de los que tiene el cliente
    if (puntos > this.clientePuntos()) {
      puntos = this.clientePuntos();
    }

    // 2. 🔹 NUEVA LÓGICA: Si el cliente tiene más puntos que el costo de la cuenta,
    // solo canjear el equivalente estricto al valor de la cuenta
    const puntosNecesarios = Math.ceil(subtotalActual);
    if (puntos > puntosNecesarios) {
      puntos = puntosNecesarios;
    }

    this.puntosCanjeados.set(puntos);

    // 1 punto = $1 peso de descuento
    const descPuntos = puntos;

    this.descuentoAplicado.set(descPuntos);
    const nuevoTotal = subtotalActual - descPuntos > 0 ? subtotalActual - descPuntos : 0;

    this.totalCuenta.set(nuevoTotal);
    this.montoRecibido.set(nuevoTotal);
    this.promocionIdAplicada.set(null);
    this.promocionNombreAplicada.set(`Canje de ${puntos} pts`);
  }

  limpiarSeleccion() {
    this.mesaId.set(0);
    this.comandaId.set(0);
    this.numeroMesa.set('');
    this.totalCuentaOriginal.set(0);
    this.totalCuenta.set(0);
    this.descuentoAplicado.set(0);
    this.promocionIdAplicada.set(null);
    this.promocionNombreAplicada.set('');
    this.clienteId.set(null);
    this.clienteNombre.set('');
    this.clientePuntos.set(0);
    this.clienteEsFrecuente.set(false);
    this.clienteVisitas.set(0);
    this.puntosCanjeados.set(0);
    this.solicitaFactura.set(false);
    this.items.set([]);
    this.metodoPago.set('EFECTIVO');
    this.montoRecibido.set(0);
    this.numeroPartes.set(1);
  }

  obtenerCorteActual(usuarioId: number) {
    return this.http.get<{
      ok: boolean;
      fechaUltimoCorte: string | null;
      pagosCount: number;
      efectivoCalculado: number;
      tarjetaCalculado: number;
      transferenciaCalculado: number;
      ventasTotales: number;
      pagos: Array<{ id: number; total: string; metodo: string; fecha: string; mesa: string }>;
    }>(`${this.apiUrl}/caja/corte/actual/${usuarioId}`);
  }

  guardarCorte(payload: {
    usuarioId: number;
    fechaApertura: string | null;
    fondoApertura: number;
    efectivoReal: number;
    efectivoCalculado: number;
    tarjetaCalculado: number;
    transferenciaCalculado: number;
    ventasTotales: number;
    diferencia: number;
    notas: string;
  }) {
    return this.http.post<{ ok: boolean; corteId: number }>(`${this.apiUrl}/caja/corte`, payload);
  }

  obtenerHistorialCortes() {
    return this.http.get<any[]>(`${this.apiUrl}/caja/cortes/historial`);
  }
}