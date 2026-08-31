// src/modules/printer/printer.config.ts

export interface ConfigImpresora {
  ip?: string;
  puerto?: number;
  tipo: 'RED' | 'USB' | 'SIMULACION'; // SIMULACION para desarrollo sin impresoras físicas
  activa: boolean;
}

export const CONFIG_IMPRESORAS: Record<'COCINA' | 'BARRA' | 'CAJA', ConfigImpresora> = {
  COCINA: {
    ip: process.env.PRINTER_COCINA_IP || '192.168.1.100',
    puerto: 9100,
    tipo: (process.env.PRINTER_COCINA_TIPO as any) || 'SIMULACION',
    activa: true
  },
  BARRA: {
    ip: process.env.PRINTER_BARRA_IP || '192.168.1.101',
    puerto: 9100,
    tipo: (process.env.PRINTER_BARRA_TIPO as any) || 'SIMULACION',
    activa: true
  },
  CAJA: {
    ip: process.env.PRINTER_CAJA_IP || '192.168.1.102',
    puerto: 9100,
    tipo: (process.env.PRINTER_CAJA_TIPO as any) || 'SIMULACION',
    activa: true
  }
};