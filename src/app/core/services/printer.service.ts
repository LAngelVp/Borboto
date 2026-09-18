// src/app/core/services/printer.service.ts

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

declare const window: {
  require?: (moduleName: string) => any;
};

export interface Impresora {
  id?: number;
  nombre: string;
  destino: 'COCINA' | 'BARRA' | 'CAJA';
  tipo: 'RED' | 'USB' | 'SIMULACION';
  ip_o_puerto: string;
  puerto_tcp?: number;
  ancho_papel?: '58mm' | '80mm';
  activa: boolean;
}

export interface WindowsPrinterInfo {
  name: string;
  displayName: string;
  description?: string;
  status?: number;
  isDefault: boolean;
}

export interface ElectronPendingPrintJob {
  tipo: 'USB';
  printerName: string;
  contenido: string;
  titulo: string;
  anchoPapel?: '58mm' | '80mm';
}

@Injectable({
  providedIn: 'root',
})
export class PrinterService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = 'http://127.0.0.1:3000/api/impresoras';

  getImpresoras(): Observable<Impresora[]> {
    return this.http.get<Impresora[]>(this.API_URL);
  }

  async getSystemPrinters(): Promise<WindowsPrinterInfo[]> {
    const ipcRenderer = this.getIpcRenderer();
    if (!ipcRenderer) {
      return [];
    }

    return ipcRenderer.invoke('get-system-printers');
  }

  crearImpresora(impresora: Impresora): Observable<Impresora> {
    return this.http.post<Impresora>(this.API_URL, impresora);
  }

  actualizarImpresora(id: number, impresora: Impresora): Observable<Impresora> {
    return this.http.put<Impresora>(`${this.API_URL}/${id}`, impresora);
  }

  eliminarImpresora(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.API_URL}/${id}`);
  }

  probarImpresora(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.post<{ ok: boolean; mensaje: string }>(`${this.API_URL}/${id}/test`, {});
  }

  async printTicketSilently(job: ElectronPendingPrintJob): Promise<void> {
    const ipcRenderer = this.getIpcRenderer();
    if (!ipcRenderer) {
      throw new Error('La impresión silenciosa solo está disponible dentro de Electron.');
    }

    await ipcRenderer.invoke('print-ticket-silent', job);
  }

  private getIpcRenderer(): any | null {
    if (!window.require) {
      return null;
    }

    try {
      const { ipcRenderer } = window.require('electron');
      return ipcRenderer || null;
    } catch {
      return null;
    }
  }
}
