export type MetodoPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';

export interface TransaccionPago {
  id?: number;
  mesaId: number;
  mesaNumero: string;
  totalCuenta: number;
  montoRecibido: number;
  cambio: number;
  metodoPago: MetodoPago;
  dividirCuenta: boolean;
  partesIguales?: number;
  montoPorPersona?: number;
  fecha: Date;
}