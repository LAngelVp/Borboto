export type EstadoTicketCocina = 'PENDIENTE' | 'PREPARANDO' | 'LISTO';

export interface ItemTicketCocina {
  id: number;
  nombre: string;
  cantidad: number;
  notas?: string;
  completado: boolean;
}

export interface TicketCocina {
  id: number;
  comandaId: number;
  mesaNumero: string;
  mesero: string;
  minutosTranscurridos: number;
  estado: EstadoTicketCocina;
  items: ItemTicketCocina[];
}