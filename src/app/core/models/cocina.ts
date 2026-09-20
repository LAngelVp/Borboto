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
  mesaId?: number;
  mesaNumero: string;
  tipoOrigen?: 'MESA' | 'MOSTRADOR' | 'ENVIO';
  folioOrigen?: string;
  mesero: string;
  minutosTranscurridos: number;
  estado: EstadoTicketCocina;
  items: ItemTicketCocina[];
}
