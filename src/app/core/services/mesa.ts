import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Mesa, EstadoMesa } from '../models/mesa';
import { Zona } from '../models/zona';
import { RuntimeConfigService } from './runtime-config.service';

@Injectable({
  providedIn: 'root',
})
export class MesaService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  private get apiUrl() {
    return this.runtimeConfig.apiBaseUrl;
  }

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

  private evaluarFiltroFecha(fechaRaw: string | undefined, fechaFiltro: string): boolean {
    if (fechaFiltro === 'TODOS' || !fechaRaw) return true;

    const fechaMesa = new Date(fechaRaw);
    const hoy = new Date();

    if (fechaFiltro === 'HOY') {
      return (
        fechaMesa.getDate() === hoy.getDate() &&
        fechaMesa.getMonth() === hoy.getMonth() &&
        fechaMesa.getFullYear() === hoy.getFullYear()
      );
    }

    if (fechaFiltro === 'AYER') {
      const ayer = new Date();
      ayer.setDate(hoy.getDate() - 1);
      return (
        fechaMesa.getDate() === ayer.getDate() &&
        fechaMesa.getMonth() === ayer.getMonth() &&
        fechaMesa.getFullYear() === ayer.getFullYear()
      );
    }

    if (fechaFiltro === 'ESTE_MES') {
      return (
        fechaMesa.getMonth() === hoy.getMonth() && fechaMesa.getFullYear() === hoy.getFullYear()
      );
    }

    return true;
  }

  // 🔹 Pedidos a domicilio activos y filtrados
  readonly enviosDomicilio = computed(() => {
    const estado = this.filtroEnvioEstado();
    const fechaFiltro = this.filtroEnvioFecha();

    return this.mesas().filter((mesa) => {
      const zonaUpper = (mesa.zona || '').toString().toUpperCase().trim();
      if (zonaUpper !== 'DOMICILIO') return false;

      let cumpleEstado = true;
      if (estado === 'ACTIVOS') {
        cumpleEstado = mesa.estado !== 'DISPONIBLE' && mesa.estado !== 'LIBRE';
      } else if (estado !== 'TODOS') {
        cumpleEstado = mesa.estado === estado;
      }

      return cumpleEstado && this.evaluarFiltroFecha(mesa.creadoEn, fechaFiltro);
    });
  });

  // 🔹 Pedidos de Mostrador activos y filtrados
  readonly pedidosMostrador = computed(() => {
    const estado = this.filtroMostradorEstado();
    const fechaFiltro = this.filtroMostradorFecha();

    return this.mesas().filter((mesa) => {
      const zonaUpper = (mesa.zona || '').toString().toUpperCase().trim();
      if (zonaUpper !== 'MOSTRADOR') return false;

      let cumpleEstado = true;
      if (estado === 'ACTIVOS') {
        cumpleEstado = mesa.estado !== 'DISPONIBLE' && mesa.estado !== 'LIBRE';
      } else if (estado !== 'TODOS') {
        cumpleEstado = mesa.estado === estado;
      }

      return cumpleEstado && this.evaluarFiltroFecha(mesa.creadoEn, fechaFiltro);
    });
  });

  // 🔹 Cómputo dinámico de mesas de salón filtradas
  readonly mesasFiltradas = computed(() => {
    const todasMesas = this.mesas();
    const estadoFiltro = (this.filtroEstado() || 'TODOS').toUpperCase().trim();
    const filtroZonaRaw = (this.filtroZona() || 'TODAS').toString().trim();

    let zonaFiltroNombre = filtroZonaRaw.toUpperCase();
    if (filtroZonaRaw !== 'TODAS' && !isNaN(Number(filtroZonaRaw))) {
      const zonaEncontrada = this.zonas().find((z) => z.id === Number(filtroZonaRaw));
      if (zonaEncontrada) {
        zonaFiltroNombre = zonaEncontrada.nombre.toUpperCase().trim();
      }
    }

    return todasMesas.filter((mesa) => {
      const zonaNombreMesa = (mesa.zona || '').toString().toUpperCase().trim();

      // Descartar SOLO si la zona es explícitamente de envíos a domicilio
      if (zonaNombreMesa === 'DOMICILIO' || zonaNombreMesa === 'DELIVERY') {
        return false;
      }

      const estadoMesa =
        (mesa.estado || 'DISPONIBLE').toString().toUpperCase().trim() === 'LIBRE'
          ? 'DISPONIBLE'
          : (mesa.estado || 'DISPONIBLE').toString().toUpperCase().trim();

      const cumpleEstado = estadoFiltro === 'TODOS' || estadoMesa === estadoFiltro;

      const cumpleZona =
        zonaFiltroNombre === 'TODAS' ||
        zonaNombreMesa === zonaFiltroNombre ||
        ((mesa as any).zonaId && String((mesa as any).zonaId) === filtroZonaRaw);

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

  cargarMesas() {
    this.http.get<Mesa[]>(`${this.apiUrl}/mesas`).subscribe({
      next: (data) => {
        console.log('📡 Mesas cargadas');
        this.mesas.set(data || []);
      },
      error: (err) => console.error('❌ Error cargando mesas:', err),
    });
  }

  cargarZonas() {
    this.http.get<Zona[]>(`${this.apiUrl}/zonas`).subscribe({
      next: (data) => {
        console.log('📡 Zonas cargadas:', data);
        this.zonas.set(data || []);
      },
      error: (err) => console.error('❌ Error cargando zonas:', err),
    });
  }

  abrirMesa(mesaId: number, comensales: number, usuarioId?: number) {
    return this.http.post<{ ok: boolean; comandaId: number }>(
      `${this.apiUrl}/mesas/${mesaId}/abrir`,
      {
        comensales,
        usuarioId: usuarioId || 1,
      },
    );
  }

  liberarMesa(mesaId: number) {
    this.mesas.update((lista) =>
      lista.map((mesa) => {
        if (mesa.id === mesaId) {
          return {
            ...mesa,
            estado: 'LIBRE' as EstadoMesa,
            total: 0,
            comensales: 0,
            minutosAbierta: 0,
          };
        }
        return mesa;
      }),
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
      { usuarioId, clienteId },
    );
  }

  crearPedidoMostrador(usuarioId?: number, clienteId?: number) {
    return this.http.post<{ ok: boolean; mesaId: number; comandaId: number; numero: string }>(
      `${this.apiUrl}/mostrador/crear`,
      { usuarioId, clienteId },
    );
  }

  cancelarComanda(comandaId: number, usuarioId: number, notas: string) {
    return this.http.post<{ ok: boolean; mensaje: string }>(
      `${this.apiUrl}/comandas/${comandaId}/cancelar`,
      { usuarioId, notas },
    );
  }
}
