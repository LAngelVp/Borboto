import { ApplicationConfig, provideZoneChangeDetection, inject } from '@angular/core';
import { provideRouter, withPreloading, PreloadAllModules, withHashLocation } from '@angular/router'; // 👈 Importación corregida
import { provideHttpClient, withInterceptors, HttpInterceptorFn } from '@angular/common/http';
import { AuthService } from './core/services/auth.service';
import { RuntimeConfigService } from './core/services/runtime-config.service';
import { catchError, throwError } from 'rxjs';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const token = auth.usuarioActivo()?.token;
  const base = inject(RuntimeConfigService).apiBaseUrl.replace(/\/$/, '');
  if (token && (request.url === base || request.url.startsWith(`${base}/`))) {
    return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(catchError(error => {
      if (error.status === 401 && !request.url.endsWith('/auth/login')) auth.cerrarSesion();
      return throwError(() => error);
    }));
  }
  return next(request);
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withHashLocation(),
      withPreloading(PreloadAllModules) // 👈 Configuración correcta para Angular
    ),
    provideHttpClient(withInterceptors([sessionInterceptor])),
    provideAnimationsAsync()
  ]
};