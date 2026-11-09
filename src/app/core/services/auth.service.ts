import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, map } from 'rxjs';
import { RuntimeConfigService } from './runtime-config.service';

export interface Usuario {
  id: number;
  nombre: string;
  rol: 'ADMIN' | 'MESERO' | 'COCINERO' | 'CAJERO';
  token?: string;
  sessionToken?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(RuntimeConfigService);
  private readonly LS_KEY = 'borboto_pos_usuario';

  private get apiUrl() {
    return this.runtimeConfig.apiBaseUrl;
  }

  // 🔹 Inicializa leyendo directamente de localStorage para no perder la sesión con F5
  readonly usuarioActivo = signal<Usuario | null>(this.obtenerUsuarioGuardado());
  readonly estaAutenticado = computed(() => this.usuarioActivo() !== null);

  // Comprobar si hay algún usuario registrado en la base de datos
  getHasUsers(): Observable<boolean> {
    return this.http.get<{ hasUsers: boolean }>(`${this.apiUrl}/auth/has-users`).pipe(map(result => result.hasUsers));
  }

  // Registrar el primer administrador del POS
  registrarPrimerAdmin(nombre: string, pin: string): Observable<Usuario> {
    return this.http
      .post<Usuario>(`${this.apiUrl}/auth/register-first-admin`, { nombre, pin })
      .pipe(
        tap((usuario) => {
          this.guardarSesion(usuario);
        }),
      );
  }

  // Intentar cambiar turno / validar con PIN
  loginConPin(pin: string): Observable<Usuario> {
    return this.http.post<Usuario>(`${this.apiUrl}/auth/login`, { pin }).pipe(
      tap((usuario) => {
        this.guardarSesion(usuario);
      }),
    );
  }

  // 🔹 Guardar usuario en localStorage y actualizar Signal
  private guardarSesion(usuario: Usuario) {
    try {
      localStorage.setItem(this.LS_KEY, JSON.stringify(usuario));
    } catch (e) {
      console.error('Error al guardar sesión en localStorage:', e);
    }
    this.usuarioActivo.set(usuario);
  }

  // 🔹 Leer usuario guardado en localStorage al cargar la app
  private obtenerUsuarioGuardado(): Usuario | null {
    try {
      const data = localStorage.getItem(this.LS_KEY);
      return data ? (JSON.parse(data) as Usuario) : null;
    } catch (e) {
      console.error('Error al recuperar sesión de localStorage:', e);
      localStorage.removeItem(this.LS_KEY);
      return null;
    }
  }

  // 🔹 Cerrar sesión
  cerrarSesion() {
    localStorage.removeItem(this.LS_KEY);
    this.usuarioActivo.set(null);
    this.router.navigate(['/login']);
  }

  // Obtener listado de empleados registrados
  getUsuarios(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/usuarios`);
  }

  // CRUD de empleados en Administración
  crearUsuario(u: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/usuarios`, u);
  }

  actualizarUsuario(id: number, u: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/usuarios/${id}`, u);
  }

  eliminarUsuario(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/usuarios/${id}`);
  }
}
