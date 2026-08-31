// src/app/core/services/printer.service.ts

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class PrinterService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = 'http://127.0.0.1:3000/api/impresoras';

  getImpresoras(): Observable<Impresora[]> {
    return this.http.get<Impresora[]>(this.API_URL);
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
}