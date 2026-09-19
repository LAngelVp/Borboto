import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'mesas',
    loadComponent: () => import('./features/mesas/mesas').then((m) => m.MesasComponent),
    canActivate: [authGuard, roleGuard],
  },
  {
    path: 'comanda',
    loadComponent: () => import('./features/comanda/comanda').then((m) => m.Comanda),
    canActivate: [authGuard, roleGuard],
  },
  {
    path: 'cocina',
    loadComponent: () => import('./features/cocina/cocina').then((m) => m.Cocina),
    canActivate: [authGuard, roleGuard],
  },
  {
    path: 'caja',
    loadComponent: () => import('./features/caja/caja').then((m) => m.Caja),
    canActivate: [authGuard, roleGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.DashboardComponent),
    canActivate: [authGuard, roleGuard],
  },
  {
    path: 'ajustes',
    loadComponent: () => import('./features/ajustes/ajustes').then((m) => m.AjustesComponent),
    canActivate: [authGuard, roleGuard],
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFoundComponent),
  },
];
