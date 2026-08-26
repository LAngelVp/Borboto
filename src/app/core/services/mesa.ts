import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Mesa, EstadoMesa } from '../models/mesa';

@Injectable({
  providedIn: 'root'
})
export class MesaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:3000/api/mesas';

  // Signals de estado
  readonly mesas = signal<Mesa[]>([]);
  readonly mesaActiva = signal<Mesa | null>(null);

  // Signals para Filtros
  readonly filtroEstado = signal<string>('TODOS');
  readonly filtroZona = signal<string>('TODAS');

  // Signals para Filtros de Envíos a Domicilio
  readonly filtroEnvioEstado = signal<string>('ACTIVOS');
  readonly filtroEnvioFecha = signal<string>('TODOS');

  // Pedidos a domicilio activos y filtrados
  readonly enviosDomicilio = computed(() => {
    const estado = this.filtroEnvioEstado();
    const fechaFiltro = this.filtroEnvioFecha();

    return this.mesas().filter(mesa => {
      if (mesa.zona !== 'Domicilio') return false;

      // 1. Filtro por estado
      let cumpleEstado = true;
      if (estado === 'ACTIVOS') {
        cumpleEstado = mesa.estado !== 'DISPONIBLE';
      } else if (estado !== 'TODOS') {
        cumpleEstado = mesa.estado === estado;
      }

      // 2. Filtro por fecha
      let cumpleFecha = true;
      if (fechaFiltro !== 'TODOS') {
        const fechaMesa = mesa.creadoEn ? new Date(mesa.creadoEn) : new Date();
        const hoy = new Date();

        if (fechaFiltro === 'HOY') {
          cumpleFecha = fechaMesa.getDate() === hoy.getDate() &&
                        fechaMesa.getMonth() === hoy.getMonth() &&
                        fechaMesa.getFullYear() === hoy.getFullYear();
        } else if (fechaFiltro === 'AYER') {
          const ayer = new Date();
          ayer.setDate(hoy.getDate() - 1);
          cumpleFecha = fechaMesa.getDate() === ayer.getDate() &&
                        fechaMesa.getMonth() === ayer.getMonth() &&
                        fechaMesa.getFullYear() === ayer.getFullYear();
        } else if (fechaFiltro === 'ESTE_MES') {
          cumpleFecha = fechaMesa.getMonth() === hoy.getMonth() &&
                        fechaMesa.getFullYear() === hoy.getFullYear();
        }
      }

      return cumpleEstado && cumpleFecha;
    });
  });

  // Cómputo dinámico de mesas filtradas (excluyendo domicilio)
  readonly mesasFiltradas = computed(() => {
    const estado = this.filtroEstado();
    const zona = this.filtroZona();

    return this.mesas().filter(mesa => {
      if (mesa.zona === 'Domicilio') return false; // Excluir de las mesas físicas habituales
      const cumpleEstado = estado === 'TODOS' || mesa.estado === estado;
      const cumpleZona = zona === 'TODAS' || mesa.zona === zona;
      return cumpleEstado && cumpleZona;
    });
  });

  constructor() {
    this.cargarMesas();
  }

  // --- MÉTODOS DE FILTRADO (Resuelven error TS2551) ---
  setFiltroZona(zona: string) {
    this.filtroZona.set(zona);
  }

  setFiltroEstado(estado: string) {
    this.filtroEstado.set(estado);
  }

  setFiltroEnvioEstado(estado: string) {
    this.filtroEnvioEstado.set(estado);
  }

  setFiltroEnvioFecha(fecha: string) {
    this.filtroEnvioFecha.set(fecha);
  }
  // --------------------------------------------------

  // Cargar mesas desde PostgreSQL
  cargarMesas() {
    this.http.get<Mesa[]>(this.apiUrl).subscribe({
      next: (data) => this.mesas.set(data),
      error: (err) => console.error('Error cargando mesas:', err)
    });
  }

  // Abrir mesa en la base de datos
  abrirMesa(mesaId: number, comensales: number, usuarioId?: number) {
    return this.http.post<{ ok: boolean; comandaId: number }>(`${this.apiUrl}/${mesaId}/abrir`, {
      comensales,
      usuarioId: usuarioId || 1
    });
  }

  // Liberar mesa
  liberarMesa(mesaId: number) {
    this.mesas.update(lista =>
      lista.map(mesa => {
        if (mesa.id === mesaId) {
          return {
            ...mesa,
            estado: 'LIBRE' as EstadoMesa,
            total: 0,
            comensales: 0,
            minutosAbierta: 0
          };
        }
        return mesa;
      })
    );
    this.cargarMesas();
  }

  seleccionarMesaActiva(mesa: Mesa) {
    this.mesaActiva.set(mesa);
  }

  moverMesa(origenId: number, destinoId: number) {
    return this.http.post(`${this.apiUrl}/${origenId}/mover`, { destinoId });
  }

  crearEnvio(usuarioId?: number, clienteId?: number) {
    return this.http.post<{ ok: boolean; mesaId: number; comandaId: number; numero: string }>(
      'http://127.0.0.1:3000/api/envios/crear',
      { usuarioId, clienteId }
    );
  }

  cancelarComanda(comandaId: number, usuarioId: number, notas: string) {
    return this.http.post<{ ok: boolean; mensaje: string }>(
      `http://127.0.0.1:3000/api/comandas/${comandaId}/cancelar`,
      { usuarioId, notas }
    );
  }
}