import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { RoleAccessService } from '../services/role-access.service';

export const roleGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const notifications = inject(NotificationService);
  const roleAccess = inject(RoleAccessService);

  const usuario = authService.usuarioActivo();
  const routePath = route.routeConfig?.path ? `/${route.routeConfig.path}` : '';

  if (!usuario) {
    router.navigate(['/login']);
    return false;
  }

  if (roleAccess.canAccessRoute(routePath, usuario.rol)) {
    return true;
  }

  notifications.warning('Acceso denegado para este módulo.');
  router.navigate([roleAccess.getDefaultRouteForRole(usuario.rol)]);
  return false;
};
