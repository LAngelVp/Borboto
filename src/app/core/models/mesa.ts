export type EstadoMesa = 'DISPONIBLE' | 'PENDIENTE' | 'EN COCINA' | 'LISTO PARA SERVIR' | 'SERVIDO' | 'LIBRE';

export interface Mesa {
  id: number;
  numero: string;
  zona: string;
  capacidad: number;
  estado: EstadoMesa;
  comensales?: number;
  minutosAbierta?: number;
  total?: number;
  comandaId?: number;
  clienteId?: number;
  clienteNombre?: string;
  clienteDireccion?: string;
  mesero?: string;
  creadoEn?: string;
}