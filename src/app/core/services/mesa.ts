import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Mesa, EstadoMesa } from '../models/mesa';
import { Zona } from '../models/zona';

@Injectable({
  providedIn: 'root'
})
export class MesaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:3000/api';

  // Signals de estado
  readonly mesas = signal<Mesa[]>([]);
  readonly zonas = signal<Zona[]>([]);
  readonly mesaActiva = signal<Mesa | null>(null);

  // Signals para Filtros de Mesas de Salón
  readonly filtroEstado = signal<string>('TODOS');
  readonly filtroZona = signal<string>('TODAS');

  // Signals para Filtros de Envíos a Domicilio
  readonly filtroEnvioEstado = signal<string>('ACTIVOS');
  readonly filtroEnvioFecha = signal<string>('TODOS');

  // Signals para Filtros de Pedidos de Mostrador / Para Llevar
  readonly filtroMostradorEstado = signal<string>('ACTIVOS');
  readonly filtroMostradorFecha = signal<string>('TODOS');

  // 🔹 Pedidos a domicilio activos y filtrados
  readonly enviosDomicilio = computed(() => {
    const estado = this.filtroEnvioEstado();
    const fechaFiltro = this.filtroEnvioFecha();

    return this.mesas().filter(mesa => {
      const zonaUpper = (mesa.zona || '').toUpperCase().trim();
      if (zonaUpper !== 'DOMICILIO') return false;

      // 1. Filtro por estado
      let cumpleEstado = true;
      if (estado === 'ACTIVOS') {
        cumpleEstado = mesa.estado !== 'DISPONIBLE';
      } else if (estado !== 'TODOS') {
        cumpleEstado = mesa.estado === estado;
      }

      // 2. Filtro por fecha
      let cumpleFecha = true;
      if (fechaFiltro !== 'TODOS' && mesa.creadoEn) {
        const fechaMesa = new Date(mesa.creadoEn);
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

  // 🔹 Pedidos de Mostrador activos y filtrados (Insensible a Mayúsculas / Minúsculas)
  readonly pedidosMostrador = computed(() => {
    const estado = this.filtroMostradorEstado();
    const fechaFiltro = this.filtroMostradorFecha();

    return this.mesas().filter(mesa => {
      const zonaUpper = (mesa.zona || '').toUpperCase().trim();
      // Acepta tanto 'MOSTRADOR' como 'FRENTE'
      if (zonaUpper !== 'MOSTRADOR' && zonaUpper !== 'FRENTE') return false;

      // 1. Filtro por estado
      let cumpleEstado = true;
      if (estado === 'ACTIVOS') {
        cumpleEstado = mesa.estado !== 'DISPONIBLE';
      } else if (estado !== 'TODOS') {
        cumpleEstado = mesa.estado === estado;
      }

      // 2. Filtro por fecha
      let cumpleFecha = true;
      if (fechaFiltro !== 'TODOS' && mesa.creadoEn) {
        const fechaMesa = new Date(mesa.creadoEn);
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

  // 🔹 Cómputo dinámico de mesas filtradas por Zona y Estado (excluyendo Domicilio y Mostrador)
  readonly mesasFiltradas = computed(() => {
    const estado = this.filtroEstado();
    const zona = this.filtroZona();

    return this.mesas().filter(mesa => {
      const zonaUpper = (mesa.zona || '').toUpperCase().trim();
      // Excluir mesas virtuales del salón
      if (zonaUpper === 'DOMICILIO' || zonaUpper === 'MOSTRADOR' || zonaUpper === 'FRENTE') return false;

      const cumpleEstado = estado === 'TODOS' || mesa.estado === estado;
      const cumpleZona = zona === 'TODAS' || zonaUpper === zona.toUpperCase().trim();
      return cumpleEstado && cumpleZona;
    });
  });

  constructor() {
    this.cargarMesas();
    this.cargarZonas();
  }

  // --- MÉTODOS DE FILTRADO ---
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

  setFiltroMostradorEstado(estado: string) {
    this.filtroMostradorEstado.set(estado);
  }

  setFiltroMostradorFecha(fecha: string) {
    this.filtroMostradorFecha.set(fecha);
  }

  // Cargar mesas desde PostgreSQL
  cargarMesas() {
    this.http.get<Mesa[]>(`${this.apiUrl}/mesas`).subscribe({
      next: (data) => this.mesas.set(data || []),
      error: (err) => console.error('Error cargando mesas:', err)
    });
  }

  // Cargar zonas físicas del establecimiento desde PostgreSQL
  cargarZonas() {
    this.http.get<Zona[]>(`${this.apiUrl}/zonas`).subscribe({
      next: (data) => this.zonas.set(data || []),
      error: (err) => console.error('Error cargando zonas:', err)
    });
  }

  abrirMesa(mesaId: number, comensales: number, usuarioId?: number) {
    return this.http.post<{ ok: boolean; comandaId: number }>(`${this.apiUrl}/mesas/${mesaId}/abrir`, {
      comensales,
      usuarioId: usuarioId || 1
    });
  }

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
    return this.http.post(`${this.apiUrl}/mesas/${origenId}/mover`, { destinoId });
  }

  crearEnvio(usuarioId?: number, clienteId?: number) {
    return this.http.post<{ ok: boolean; mesaId: number; comandaId: number; numero: string }>(
      `${this.apiUrl}/envios/crear`,
      { usuarioId, clienteId }
    );
  }

  crearPedidoMostrador(usuarioId?: number, clienteId?: number) {
    return this.http.post<{ ok: boolean; mesaId: number; comandaId: number; numero: string }>(
      `${this.apiUrl}/mostrador/crear`,
      { usuarioId, clienteId }
    );
  }

  cancelarComanda(comandaId: number, usuarioId: number, notas: string) {
    return this.http.post<{ ok: boolean; mensaje: string }>(
      `${this.apiUrl}/comandas/${comandaId}/cancelar`,
      { usuarioId, notas }
    );
  }
}