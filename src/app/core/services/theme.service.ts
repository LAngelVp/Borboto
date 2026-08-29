import { Injectable, signal, computed, effect } from '@angular/core';

export type Tema = 'claro' | 'oscuro';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly LS_THEME_KEY = 'borboto_pos_tema';

  // Signal con el tema activo (recupera de localStorage o del SO)
  readonly temaActual = signal<Tema>(this.obtenerTemaInicial());
  readonly esOscuro = computed(() => this.temaActual() === 'oscuro');

  constructor() {
    // Escucha cambios en 'temaActual' y aplica los cambios al HTML y localStorage
    effect(() => {
      const tema = this.temaActual();
      this.aplicarTemaAlDOM(tema);
      localStorage.setItem(this.LS_THEME_KEY, tema);
    });
  }

  // Alternar entre Claro y Oscuro
  toggleTema() {
    this.temaActual.update(actual => (actual === 'claro' ? 'oscuro' : 'claro'));
  }

  // Establecer un tema específico
  setTema(tema: Tema) {
    this.temaActual.set(tema);
  }

  private aplicarTemaAlDOM(tema: Tema) {
    const root = document.documentElement; // Etiqueta <html>

    if (tema === 'oscuro') {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme');
    } else {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme');
    }
  }

  private obtenerTemaInicial(): Tema {
    const guardado = localStorage.getItem(this.LS_THEME_KEY) as Tema | null;
    if (guardado === 'claro' || guardado === 'oscuro') {
      return guardado;
    }
    // Si no hay preferencia guardada, usa la configuración del sistema operativo
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  }
}