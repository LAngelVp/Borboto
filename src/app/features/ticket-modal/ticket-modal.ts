// src/app/features/ticket-modal/ticket-modal.ts

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface DatosDialogTicket {
  contenidoTicket: string;
  titulo?: string;
  anchoPapel?: '58mm' | '80mm'; // 👈 Recibir opcionalmente el ancho
}

@Component({
  selector: 'app-ticket-modal',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './ticket-modal.html',
  styles: [`
    .ticket-papel-termico {
      margin: 0 auto;
      padding: 16px;
      background-color: #fffef0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
      font-family: 'Courier New', Courier, monospace;
      color: #000;
      border-top: 4px solid #333;
      transition: width 0.3s ease;
    }
    /* Estilos dinámicos de ancho */
    .papel-80mm {
      width: 300px;
    }
    .papel-58mm {
      width: 220px;
    }

    .ticket-header {
      text-align: center;
      border-bottom: 1px dashed #666;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .ticket-header h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: bold;
    }
    .ticket-header p {
      margin: 4px 0 0 0;
      font-size: 0.75rem;
      color: #d84315;
      font-weight: bold;
    }
    .ticket-texto-monospaced {
      font-size: 0.8rem;
      line-height: 1.25;
      white-space: pre-wrap;
      margin: 0;
    }
  `]
})
export class TicketModal {
  readonly dialogRef = inject(MatDialogRef<TicketModal>);
  readonly data = inject<DatosDialogTicket>(MAT_DIALOG_DATA);

  imprimirConNavegador() {
    window.print();
  }
}