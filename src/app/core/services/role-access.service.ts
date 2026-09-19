import { Injectable, computed, inject } from '@angular/core';
import { AuthService, type Usuario } from './auth.service';
import { RuntimeConfigService } from './runtime-config.service';

export type RolUsuario = Usuario['rol'];

export interface NavModuleItem {
  label: string;
  route: string;
  icon: string;
  electronRoles: RolUsuario[];
  browserRoles: RolUsuario[];
  showInNav?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class RoleAccessService {
  private readonly authService = inject(AuthService);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  readonly navItems: NavModuleItem[] = [
    {
      label: 'Mesas',
      route: '/mesas',
      icon: 'grid_view',
      electronRoles: ['ADMIN', 'MESERO', 'CAJERO'],
      browserRoles: ['MESERO'],
      showInNav: true,
    },
    {
      label: 'Comanda',
      route: '/comanda',
      icon: 'restaurant_menu',
      electronRoles: ['ADMIN', 'MESERO', 'CAJERO'],
      browserRoles: ['MESERO'],
      showInNav: false,
    },
    {
      label: 'Cocina',
      route: '/cocina',
      icon: 'soup_kitchen',
      electronRoles: ['ADMIN', 'COCINERO'],
      browserRoles: ['COCINERO'],
      showInNav: true,
    },
    {
      label: 'Caja',
      route: '/caja',
      icon: 'point_of_sale',
      electronRoles: ['ADMIN', 'CAJERO'],
      browserRoles: [],
      showInNav: true,
    },
    {
      label: 'Ventas',
      route: '/dashboard',
      icon: 'trending_up',
      electronRoles: ['ADMIN'],
      browserRoles: [],
      showInNav: true,
    },
    {
      label: 'Ajustes POS',
      route: '/ajustes',
      icon: 'settings',
      electronRoles: ['ADMIN'],
      browserRoles: [],
      showInNav: false,
    },
  ];

  readonly visibleNavItems = computed(() => {
    const usuario = this.authService.usuarioActivo();
    return this.navItems.filter(
      (item) => item.showInNav !== false && this.isAllowed(item, usuario?.rol),
    );
  });

  canAccessRoute(route: string, rol?: RolUsuario | null): boolean {
    const item = this.navItems.find((entry) => entry.route === route);
    if (!item) {
      return false;
    }

    return this.isAllowed(item, rol);
  }

  canUseCurrentDevice(rol?: RolUsuario | null): boolean {
    if (!rol) {
      return false;
    }

    if (this.runtimeConfig.isElectron) {
      return true;
    }

    return rol === 'MESERO' || rol === 'COCINERO';
  }

  getDefaultRouteForRole(rol?: RolUsuario | null): string {
    if (!rol) {
      return '/login';
    }

    if (!this.canUseCurrentDevice(rol)) {
      return '/login';
    }

    if (rol === 'COCINERO') {
      return '/cocina';
    }

    if (
      rol === 'MESERO' ||
      (this.runtimeConfig.isElectron && (rol === 'CAJERO' || rol === 'ADMIN'))
    ) {
      return '/mesas';
    }

    return '/login';
  }

  private isAllowed(item: NavModuleItem, rol?: RolUsuario | null): boolean {
    if (!rol) {
      return false;
    }

    const allowedRoles = this.runtimeConfig.isElectron ? item.electronRoles : item.browserRoles;
    return allowedRoles.includes(rol);
  }
}
