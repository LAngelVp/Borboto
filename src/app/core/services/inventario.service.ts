import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Subscription, forkJoin } from 'rxjs';
import { SocketService } from './socket.service';
import { RuntimeConfigService } from './runtime-config.service';
import { AuthService } from './auth.service';

export type ModoCaptura = 'UNIDAD' | 'PAQUETE';
export type OrigenSalida = 'SALIDA_COCINA' | 'SALIDA_ALMACEN' | 'SALIDA_BARRA' | 'MERMA';
export interface ConfiguracionInsumo {
  codigo: string | null; nombre: string; categoria_almacen: string; unidad_base: string;
  permite_paquetes: boolean; nombre_paquete: string; factor_paquete: number;
  stock_minimo: number; costo_unitario: number; ubicacion: string | null; activo: boolean;
}
export interface Insumo extends ConfiguracionInsumo {
  id: number; stock_actual: number; actualizado_en: string;
  estado_guardia: 'OK' | 'PRECAUCION' | 'BAJO_GUARDIA' | 'SIN_STOCK';
  desglose_paquetes: { paquetesCompletos: number; unidadesSueltas: number } | null;
  faltante_sugerido: number;
}
export interface ResumenInventario {
  totalInsumos: number; sinStock: number; bajoGuardia: number; enPrecaucion: number; itemsCriticos: Insumo[];
}
export interface MovimientoInventario {
  id: number; insumo_id: number; insumo_nombre: string; tipo_movimiento: string; modo_captura: ModoCaptura;
  cantidad_capturada: number; factor_aplicado: number; delta_unidad_base: number; stock_resultante: number;
  usuario_nombre: string | null; fecha: string;
}
export interface ItemSalida { insumoId: number; modoCaptura: ModoCaptura; cantidad: number }
export type AjusteInventario = { tipoMovimiento: 'ENTRADA_COMPRA'; modoCaptura: ModoCaptura; cantidad: number; notas?: string }
  | { tipoMovimiento: 'REINVENTARIO_AJUSTE'; nuevoStockFisico: number; notas?: string }
  | { tipoMovimiento: 'REINVENTARIO_AJUSTE'; paquetesContados: number; unidadesSueltasContadas: number; notas?: string };
export function errorInventario(error: unknown): string {
  return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
    ? error.error.error : 'No se pudo completar la operacion. Verifica el inventario antes de reenviar.';
}
@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly socket = inject(SocketService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly url = `${inject(RuntimeConfigService).apiBaseUrl}/inventario`;
  private lectura?: Subscription;
  readonly insumos = signal<Insumo[]>([]);
  readonly resumen = signal<ResumenInventario>({ totalInsumos: 0, sinStock: 0, bajoGuardia: 0, enPrecaucion: 0, itemsCriticos: [] });
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly criticos = computed(() => this.resumen().sinStock + this.resumen().bajoGuardia);
  constructor() {
    const eventos = this.socket.onEvent<void>('actualizar_inventario').subscribe(() => this.recargar());
    effect(() => {
      const usuario = this.auth.usuarioActivo();
      this.lectura?.unsubscribe();
      this.insumos.set([]);
      this.resumen.set({ totalInsumos: 0, sinStock: 0, bajoGuardia: 0, enPrecaucion: 0, itemsCriticos: [] });
      if (usuario) this.recargar();
    });
    this.destroyRef.onDestroy(() => { eventos.unsubscribe(); this.lectura?.unsubscribe(); });
  }
  recargar() {
    if (!this.auth.usuarioActivo()) return;
    this.lectura?.unsubscribe();
    this.cargando.set(true);
    this.error.set('');
    this.lectura = forkJoin({ insumos: this.http.get<Insumo[]>(`${this.url}/insumos`), resumen: this.http.get<ResumenInventario>(`${this.url}/resumen-alertas`) }).subscribe({
      next: result => { this.insumos.set(result.insumos); this.resumen.set(result.resumen); this.cargando.set(false); },
      error: error => { this.error.set(errorInventario(error)); this.cargando.set(false); },
    });
  }
  listarTodos() { return this.http.get<Insumo[]>(`${this.url}/insumos?incluirInactivos=true`); }
  guardar(config: ConfiguracionInsumo & { stock_inicial?: number }, id?: number) {
    return id ? this.http.put<Insumo>(`${this.url}/insumos/${id}`, config) : this.http.post<Insumo>(`${this.url}/insumos`, config);
  }
  salida(origen: OrigenSalida, items: ItemSalida[], notas: string) { return this.http.post<{ ok: boolean }>(`${this.url}/salidas-lote`, { origen, items, notas }); }
  ajustar(id: number, body: AjusteInventario) { return this.http.post<{ ok: boolean }>(`${this.url}/insumos/${id}/ajuste`, body); }
  movimientos(insumoId = '', tipoMovimiento = '', limite = 100) {
    return this.http.get<MovimientoInventario[]>(`${this.url}/movimientos`, { params: { ...(insumoId ? { insumoId } : {}), ...(tipoMovimiento ? { tipoMovimiento } : {}), limite } });
  }
}