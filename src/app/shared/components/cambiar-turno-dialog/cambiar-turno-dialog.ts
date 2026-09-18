import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService, Usuario } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-cambiar-turno-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cambiar-turno-dialog.html',
  styleUrl: './cambiar-turno-dialog.scss',
})
export class CambiarTurnoDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<CambiarTurnoDialogComponent>);
  private readonly authService = inject(AuthService);
  private readonly notifications = inject(NotificationService);

  readonly pinText = signal<string>('');

  tecladoDigitos = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  agregarDigito(digito: string) {
    if (this.pinText().length < 6) {
      this.pinText.update((p) => p + digito);
    }
  }

  borrarDigito() {
    this.pinText.update((p) => p.slice(0, -1));
  }

  limpiarPin() {
    this.pinText.set('');
  }

  confirmarTurno() {
    const pinString = this.pinText();
    if (!pinString) {
      this.notifications.warning('Por favor ingrese su PIN de seguridad', 2500);
      return;
    }

    this.authService.loginConPin(pinString).subscribe({
      next: (usuario: Usuario) => {
        this.notifications.success(`Turno cambiado con éxito. Bienvenido, ${usuario.nombre}.`);
        this.dialogRef.close(true);
      },
      error: (err: any) => {
        this.notifications.error(err.error?.error || 'PIN incorrecto. Intente de nuevo.');
        this.limpiarPin();
      },
    });
  }

  cancelar() {
    this.dialogRef.close(false);
  }
}
