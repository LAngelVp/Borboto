// src/app/core/services/printer.service.ts

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { RuntimeConfigService } from './runtime-config.service';

declare const window: {
  borbotoElectron?: Window['borbotoElectron'];
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
  es_termica?: boolean;
  corte_tipo?: 'NINGUNO' | 'PARCIAL' | 'TOTAL';
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
  itemIds?: number[];
  envioId?: number;
  printerName: string;
  contenido: string;
  titulo: string;
  anchoPapel?: '58mm' | '80mm';
  esTermica?: boolean;
  corteTipo?: 'NINGUNO' | 'PARCIAL' | 'TOTAL';
}

interface ElectronPrintPayload {
  printerName: string;
  content: string;
  title: string;
  anchoPapel?: '58mm' | '80mm';
  tipo?: 'USB';
  ticketData?: unknown;
  empresaData?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class PrinterService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  private get API_URL() {
    return `${this.runtimeConfig.apiBaseUrl}/impresoras`;
  }

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

  imprimirUsbRaw(job: ElectronPendingPrintJob): Observable<{ ok: boolean; mensaje?: string }> {
    return this.http.post<{ ok: boolean; mensaje?: string }>(`${this.API_URL}/usb/raw-print`, {
      printerName: job.printerName,
      contenido: job.contenido,
      anchoPapel: job.anchoPapel,
      corteTipo: job.corteTipo,
    });
  }

  async printTicketSilently(job: ElectronPendingPrintJob): Promise<void> {
    try {
      await this.enviarTrabajo(job);
    } catch (err) {
      await this.reportarError(job);
      throw err;
    }
  }

  private async enviarTrabajo(job: ElectronPendingPrintJob): Promise<void> {
    let rawExitoso = false;
    if (job.esTermica === true && job.corteTipo && job.corteTipo !== 'NINGUNO') {
      try {
        await new Promise<void>((resolve, reject) => {
          this.imprimirUsbRaw(job).subscribe({
            next: (res) => res?.ok ? resolve() : reject(new Error('Impresion RAW rechazada')),
            error: (err) => reject(err),
          });
        });
        rawExitoso = true;
      } catch {
        // Fallback a Electron print cuando RAW no esté disponible o falle.
      }
    }
    if (rawExitoso) {
      await this.confirmarTrabajo(job);
      return;
    }
    const ipcRenderer = this.getIpcRenderer();
    if (!ipcRenderer) throw new Error('La impresion silenciosa requiere Electron o RAW disponible.');

    const payload: ElectronPrintPayload = {
      tipo: job.tipo,
      printerName: job.printerName,
      content: job.contenido,
      title: job.titulo,
      anchoPapel: job.anchoPapel,
      ticketData: job,
      empresaData: undefined,
    };

    const resultado = await ipcRenderer.invoke('print-ticket-silent', payload);
    if (resultado?.ok === false || resultado?.success === false) throw new Error('Impresion USB rechazada');
    await this.confirmarTrabajo(job);
  }

  private async confirmarTrabajo(job: ElectronPendingPrintJob): Promise<void> {
    if (!job.itemIds?.length) return;
    const resultado = await firstValueFrom(this.http.post<{ ok: boolean }>(`${this.API_URL}/confirmar-impresion`, {
      itemIds: job.itemIds,
      envioId: job.envioId,
    }));
    if (!resultado?.ok) throw new Error('No se pudo confirmar la impresion');
  }

  private async reportarError(job: ElectronPendingPrintJob): Promise<void> {
    if (!job.itemIds?.length) return;
    try {
      await firstValueFrom(this.http.post(`${this.API_URL}/error-impresion`, {
        itemIds: job.itemIds,
        envioId: job.envioId,
        mensaje: 'Fallo la impresión USB desde Electron',
      }));
    } catch {
      // El error original es el que importa al usuario; no ocultarlo por el reporte.
    }
  }

  private getIpcRenderer(): any | null {
    if (window.borbotoElectron) return window.borbotoElectron;
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
