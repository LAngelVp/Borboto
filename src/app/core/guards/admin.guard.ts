/** @deprecated Sin consumidores productivos; app.routes usa roleGuard. No usar en rutas nuevas. */
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  const usuario = authService.usuarioActivo();

  if (usuario && usuario.rol === 'ADMIN') {
    return true;
  }

  // De lo contrario, se notifica y se redirige a mesas
  notifications.warning('Acceso denegado: se requieren privilegios de Administrador.');

  if (usuario) {
    router.navigate(['/mesas']);
  } else {
    router.navigate(['/login']);
  }
  return false;
};
