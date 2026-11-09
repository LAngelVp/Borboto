import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { CajaService } from '../../../../core/services/caja-service';
import { AuthService } from '../../../../core/services/auth.service';
import { Router } from '@angular/router';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-corte-caja-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './corte-caja-dialog.html',
  styleUrl: './corte-caja-dialog.scss',
})
export class CorteCajaDialog implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<CorteCajaDialog>);
  private readonly cajaService = inject(CajaService);
  private readonly authService = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  loading = signal<boolean>(true);
  readonly errorCarga = signal(false);
  readonly guardando = signal(false);
  usuarioId = signal<number>(1);
  usuarioNombre = signal<string>('');

  fechaApertura = signal<string | null>(null);
  fondoApertura = signal<number>(0);
  efectivoReal = signal<number>(0);

  efectivoCalculado = signal<number>(0);
  tarjetaCalculado = signal<number>(0);
  transferenciaCalculado = signal<number>(0);
  ventasTotales = signal<number>(0);
  pagosCount = signal<number>(0);
  notas = signal<string>('');

  efectivoEsperado = computed(() => {
    return Number(this.fondoApertura()) + Number(this.efectivoCalculado());
  });

  diferencia = computed(() => {
    return Number(this.efectivoReal()) - Number(this.efectivoEsperado());
  });

  ngOnInit() {
    const user = this.authService.usuarioActivo();
    if (!user) {
      this.notifications.warning('Inicie sesión para realizar corte de caja');
      this.dialogRef.close();
      return;
    }

    this.usuarioId.set(user.id);
    this.usuarioNombre.set(user.nombre);

    this.cajaService.obtenerCorteActual(user.id).subscribe({
      next: (res) => {
        this.fechaApertura.set(res.fechaUltimoCorte);
        this.efectivoCalculado.set(res.efectivoCalculado);
        this.tarjetaCalculado.set(res.tarjetaCalculado);
        this.transferenciaCalculado.set(res.transferenciaCalculado);
        this.ventasTotales.set(res.ventasTotales);
        this.pagosCount.set(res.pagosCount);
        this.efectivoReal.set(res.efectivoCalculado);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorCarga.set(true);
        console.error(err);
        this.notifications.error('Error al obtener datos del corte de caja');
        this.loading.set(false);
      },
    });
  }

  confirmarCorte() {
    if (this.loading() || this.errorCarga() || this.guardando()) return;
    this.guardando.set(true);
    const payload = {
      usuarioId: this.usuarioId(),
      fechaApertura: this.fechaApertura(),
      fondoApertura: Number(this.fondoApertura()),
      efectivoReal: Number(this.efectivoReal()),
      efectivoCalculado: Number(this.efectivoCalculado()),
      tarjetaCalculado: Number(this.tarjetaCalculado()),
      transferenciaCalculado: Number(this.transferenciaCalculado()),
      ventasTotales: Number(this.ventasTotales()),
      diferencia: Number(this.diferencia()),
      notas: this.notas(),
    };

    this.cajaService.guardarCorte(payload).subscribe({
      next: () => {
        this.notifications.success('Corte de caja registrado con éxito. Sesión cerrada.', 4000);
        this.authService.cerrarSesion();
        this.dialogRef.close(true);
        this.router.navigate(['/login']);
      },
      error: () => {
        this.guardando.set(false);
        this.notifications.error('Error al registrar corte de caja');
      },
    });
  }

  cerrar() {
    this.dialogRef.close(false);
  }
}
