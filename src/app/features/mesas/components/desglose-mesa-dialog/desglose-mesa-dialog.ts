import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Mesa } from '../../../../core/models/mesa';
import { ItemComanda } from '../../../../core/models/producto';
import { ComandaService } from '../../../../core/services/comanda';
import { MesaService } from '../../../../core/services/mesa';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-desglose-mesa-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './desglose-mesa-dialog.html',
  styleUrl: './desglose-mesa-dialog.scss'
})
export class DesgloseMesaDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DesgloseMesaDialogComponent>);
  readonly data = inject<{ mesa: Mesa }>(MAT_DIALOG_DATA);
  protected readonly authService = inject(AuthService);
  private readonly comandaService = inject(ComandaService);
  private readonly mesaService = inject(MesaService);
  private readonly snackBar = inject(MatSnackBar);

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
      error: () => this.cargando.set(false)
    });
  }

  cancelarComandaMesa() {
    const isConfirmed = confirm('¿Está seguro de CANCELAR esta comanda y liberar la mesa? Esta acción no se puede deshacer.');
    if (!isConfirmed) return;

    const motivo = prompt('Por favor, especifique el motivo de la cancelación:');
    if (motivo === null) return; // canceló el prompt

    const comId = this.comandaId() || this.data.mesa.comandaId;
    if (!comId) {
      this.snackBar.open('No hay una comanda activa identificada.', 'Cerrar', { duration: 3000 });
      return;
    }

    const usuarioId = this.authService.usuarioActivo()?.id || 1;

    this.mesaService.cancelarComanda(comId, usuarioId, motivo || 'Sin motivo especificado').subscribe({
      next: () => {
        this.snackBar.open('¡Comanda cancelada y mesa liberada correctamente!', 'Cerrar', { duration: 3000 });
        this.mesaService.cargarMesas();
        this.dialogRef.close();
      },
      error: () => {
        this.snackBar.open('Error al cancelar la comanda.', 'Cerrar', { duration: 3000 });
      }
    });
  }
}