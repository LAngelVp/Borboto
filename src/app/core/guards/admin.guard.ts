import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MatSnackBar } from '@angular/material/snack-bar';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);

  const usuario = authService.usuarioActivo();

  if (usuario && usuario.rol === 'ADMIN') {
    return true;
  }

  // De lo contrario, se notifica y se redirige a mesas
  snackBar.open('Acceso denegado: Se requieren privilegios de Administrador.', 'Cerrar', {
    duration: 3000,
    panelClass: ['warn-snackbar']
  });

  if (usuario) {
    router.navigate(['/mesas']);
  } else {
    router.navigate(['/login']);
  }
  return false;
};
