import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';

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
    MatSnackBarModule
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly hasUsers = signal<boolean | null>(null);
  readonly registerMode = signal<boolean>(false);

  // Formulario Login
  pin = '';

  // Formulario Registro Primer Admin
  regNombre = '';
  regPin = '';

  ngOnInit() {
    this.verificarSistema();
  }

  verificarSistema() {
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
        this.hasUsers.set(false);
        this.registerMode.set(true);
      }
    });
  }

  onSubmitLogin() {
    const p = this.pin.trim();
    if (!p) return;

    this.authService.loginConPin(p).subscribe({
      next: (user) => {
        this.snackBar.open(`¡Hola, ${user.nombre}! Acceso correcto en el POS.`, 'Cerrar', { duration: 3000 });
        this.router.navigate(['/mesas']);
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'PIN incorrecto. Intente de nuevo.', 'Cerrar', { duration: 3000 });
        this.pin = '';
      }
    });
  }

  onSubmitRegister() {
    const nom = this.regNombre.trim();
    const p = this.regPin.trim();
    if (!nom || !p) {
      this.snackBar.open('Complete todos los campos del Administrador', 'Cerrar', { duration: 2500 });
      return;
    }

    this.authService.registrarPrimerAdmin(nom, p).subscribe({
      next: (user) => {
        this.snackBar.open(`¡Administrador "${user.nombre}" registrado! Bienvenido.`, 'Cerrar', { duration: 4000 });
        this.router.navigate(['/mesas']);
      },
      error: () => {
        this.snackBar.open('Error al intentar registrar el primer administrador.', 'Cerrar', { duration: 3000 });
      }
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
