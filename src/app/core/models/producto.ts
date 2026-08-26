export interface Producto {
  id: number;
  nombre: string;
  precio: number;
  categoria: string;
  icono?: string;
  disponible?: boolean;
}

export interface ItemComanda {
  producto: Producto;
  cantidad: number;
  subtotal: number;
  notas?: string;
}