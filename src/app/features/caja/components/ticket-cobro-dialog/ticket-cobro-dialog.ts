import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TransaccionPago } from '../../../../core/models/pago';
import { AjustesService, DatosNegocio } from '../../../../core/services/ajustes.service';

@Component({
  selector: 'app-ticket-cobro-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './ticket-cobro-dialog.html',
  styleUrl: './ticket-cobro-dialog.scss'
})
export class TicketCobroDialog implements OnInit {
  readonly dialogRef = inject(MatDialogRef<TicketCobroDialog>);
  readonly data = inject<{ transaccion: TransaccionPago }>(MAT_DIALOG_DATA);
  private readonly ajustesService = inject(AjustesService);

  readonly negocio = signal<DatosNegocio>({
    nombre: 'Borboto Taquería',
    rfc: 'XAXX010101000',
    telefono: '5512345678',
    direccion: 'Av. Principal 123, CDMX',
    email: 'contacto@borboto.com',
    mensaje_recibo: '¡Gracias por su preferencia!'
  });

  ngOnInit() {
    this.ajustesService.getDatosNegocio().subscribe({
      next: (res) => {
        if (res && res.nombre) {
          this.negocio.set(res);
        }
      },
      error: (err) => console.error('Error fetching dynamic business details:', err)
    });
  }

  imprimirTicket() {
    window.print();
  }

  cerrar() {
    this.dialogRef.close(true);
  }
}