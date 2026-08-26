import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface Usuario {
  id: number;
  nombre: string;
  rol: 'ADMIN' | 'MESERO' | 'COCINERO' | 'CAJERO';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://127.0.0.1:3000/api';

  // Usuario activo por defecto (Juan Mesero con ID de prueba = 1)
  readonly usuarioActivo = signal<Usuario | null>(null);

  // Comprobar si hay algún usuario registrado en la base de datos
  getHasUsers(): Observable<boolean> {
    return new Observable<boolean>(observer => {
      this.http.get<any[]>(`${this.apiUrl}/usuarios`).subscribe({
        next: (users) => {
          observer.next(users && users.length > 0);
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
  }

  // Registrar el primer administrador del POS
  registrarPrimerAdmin(nombre: string, pin: string): Observable<Usuario> {
    return this.http.post<Usuario>(`${this.apiUrl}/auth/register-first-admin`, { nombre, pin }).pipe(
      tap(usuario => {
        this.usuarioActivo.set(usuario);
      })
    );
  }

  // Cerrar sesión
  cerrarSesion() {
    this.usuarioActivo.set(null);
  }

  // Intentar cambiar turno / validar con PIN
  loginConPin(pin: string): Observable<Usuario> {
    return this.http.post<Usuario>(`${this.apiUrl}/auth/login`, { pin }).pipe(
      tap(usuario => {
        this.usuarioActivo.set(usuario);
      })
    );
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
