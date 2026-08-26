import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AjustesService, DatosTransferencia } from '../../../../core/services/ajustes.service';

@Component({
  selector: 'app-datos-transferencia-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './datos-transferencia-dialog.html',
  styleUrl: './datos-transferencia-dialog.scss'
})
export class DatosTransferenciaDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DatosTransferenciaDialogComponent>);
  private readonly ajustesService = inject(AjustesService);

  readonly datos = signal<DatosTransferencia>({
    banco: 'BBVA',
    titular: 'Borboto S.A. de C.V.',
    clabe: '012180001234567890',
    email: 'pagos@borboto.com'
  });

  readonly cargando = signal<boolean>(true);

  ngOnInit() {
    this.ajustesService.getDatosTransferencia().subscribe({
      next: (res) => {
        if (res && res.banco) {
          this.datos.set(res);
        }
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
      }
    });
  }

  copiarClabe() {
    navigator.clipboard.writeText(this.datos().clabe).then(() => {
      // Usar portapapeles con éxito
    });
  }

  cerrar() {
    this.dialogRef.close();
  }
}
