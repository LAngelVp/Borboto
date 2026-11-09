import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { RoleAccessService } from '../../core/services/role-access.service';
import { RuntimeConfigService } from '../../core/services/runtime-config.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSnackBarModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly roleAccess = inject(RoleAccessService);
  private readonly runtimeConfig = inject(RuntimeConfigService);
  readonly errorConexion = signal(false);

  readonly hasUsers = signal<boolean | null>(null);
  readonly registerMode = signal<boolean>(false);

  // Formulario Login
  pin = '';

  // Formulario Registro Primer Admin
  regNombre = '';
  regPin = '';

  ngOnInit() {
    // 🔹 Si ya tiene sesión activa en localStorage, redirigir directo al sistema
    if (this.authService.estaAutenticado()) {
      const usuario = this.authService.usuarioActivo();
      if (!this.roleAccess.canUseCurrentDevice(usuario?.rol)) {
        this.notifications.warning('Este perfil solo puede operar desde la estación principal.');
        this.authService.cerrarSesion();
        return;
      }

      this.router.navigate([this.roleAccess.getDefaultRouteForRole(usuario?.rol)]);
      return;
    }

    this.verificarSistema();
  }

  verificarSistema() {
    this.errorConexion.set(false);
    this.authService.getHasUsers().subscribe({
      next: (existentes) => {
        this.hasUsers.set(existentes);
        if (!existentes) {
          this.registerMode.set(true);
        } else {
          this.registerMode.set(false);
        }
      },
      error: () => {
        this.hasUsers.set(null);
        this.registerMode.set(false);
        this.errorConexion.set(true);
        this.notifications.error('No se pudo conectar al servidor. Reintente la consulta.');
      },
    });
  }

  onSubmitLogin() {
    const p = this.pin.trim();
    if (!p) return;

    this.authService.loginConPin(p).subscribe({
      next: (user) => {
        if (!this.roleAccess.canUseCurrentDevice(user.rol)) {
          this.notifications.warning('Este perfil solo puede operar desde la estación principal.');
          this.authService.cerrarSesion();
          return;
        }

        this.notifications.success(`Hola, ${user.nombre}. Acceso correcto en el POS.`);
        this.router.navigate([this.roleAccess.getDefaultRouteForRole(user.rol)]);
      },
      error: (err) => {
        this.notifications.error(err.error?.error || 'PIN incorrecto. Intente de nuevo.');
        this.pin = '';
      },
    });
  }

  onSubmitRegister() {
    if (this.runtimeConfig.isBrowserClient || this.errorConexion()) {
      this.notifications.warning('El alta inicial requiere la estacion principal y conexion al servidor.');
      return;
    }
    const nom = this.regNombre.trim();
    const p = this.regPin.trim();
    if (!nom || !p) {
      this.notifications.warning('Complete todos los campos del Administrador', 2500);
      return;
    }

    this.authService.registrarPrimerAdmin(nom, p).subscribe({
      next: (user) => {
        if (!this.roleAccess.canUseCurrentDevice(user.rol)) {
          this.notifications.warning(
            'El alta de administrador debe realizarse desde la estación principal.',
          );
          this.authService.cerrarSesion();
          return;
        }

        this.notifications.success(`Administrador "${user.nombre}" registrado. Bienvenido.`, 4000);
        this.router.navigate([this.roleAccess.getDefaultRouteForRole(user.rol)]);
      },
      error: () => {
        this.notifications.error('Error al intentar registrar el primer administrador.');
      },
    });
  }

  tecladoDigitos = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  agregarDigito(d: string) {
    if (this.registerMode()) {
      if (this.regPin.length < 6) this.regPin += d;
    } else {
      if (this.pin.length < 6) this.pin += d;
    }
  }

  borrarDigito() {
    if (this.registerMode()) {
      this.regPin = this.regPin.slice(0, -1);
    } else {
      this.pin = this.pin.slice(0, -1);
    }
  }

  limpiarPin() {
    if (this.registerMode()) {
      this.regPin = '';
    } else {
      this.pin = '';
    }
  }
}
