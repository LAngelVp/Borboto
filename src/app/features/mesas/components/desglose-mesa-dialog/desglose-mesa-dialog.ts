import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Mesa } from '../../../../core/models/mesa';
import { ItemComanda } from '../../../../core/models/producto';
import { ComandaService } from '../../../../core/services/comanda';
import { MesaService } from '../../../../core/services/mesa';
import { AuthService } from '../../../../core/services/auth.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { CancelComandaDialogComponent } from '../../../../shared/components/cancel-comanda-dialog/cancel-comanda-dialog';

@Component({
  selector: 'app-desglose-mesa-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desglose-mesa-dialog.html',
  styleUrl: './desglose-mesa-dialog.scss',
})
export class DesgloseMesaDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DesgloseMesaDialogComponent>);
  readonly data = inject<{ mesa: Mesa }>(MAT_DIALOG_DATA);
  protected readonly authService = inject(AuthService);
  private readonly comandaService = inject(ComandaService);
  private readonly mesaService = inject(MesaService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);

  items = signal<ItemComanda[]>([]);
  total = signal<number>(0);
  comandaId = signal<number>(0);
  cargando = signal<boolean>(true);

  ngOnInit() {
    this.comandaService.obtenerDesgloseMesa(this.data.mesa.id).subscribe({
      next: (res) => {
        this.items.set(res.items || []);
        this.total.set(res.total || 0);
        this.comandaId.set(res.comandaId || 0);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  cancelarComandaMesa() {
    const dialogRef = this.dialog.open(CancelComandaDialogComponent, {
      width: '420px',
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe((motivo) => {
      if (motivo === undefined) {
        return;
      }

      this.confirmarCancelacionComanda(motivo);
    });
  }

  private confirmarCancelacionComanda(motivo: string) {
    const comId = this.comandaId() || this.data.mesa.comandaId;
    if (!comId) {
      this.notifications.warning('No hay una comanda activa identificada.');
      return;
    }

    const usuarioId = this.authService.usuarioActivo()?.id || 1;

    this.notifications.info('Cancelando comanda...');
    this.mesaService
      .cancelarComanda(comId, usuarioId, motivo || 'Sin motivo especificado')
      .subscribe({
        next: () => {
          this.notifications.success('Comanda cancelada y mesa liberada correctamente.');
          this.mesaService.cargarMesas();
          this.dialogRef.close();
        },
        error: () => {
          this.notifications.error('Error al cancelar la comanda.');
        },
      });
  }
}
