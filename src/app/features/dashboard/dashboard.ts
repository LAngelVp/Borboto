import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NotificationService } from '../../core/services/notification.service';
import { PrinterService, ElectronPendingPrintJob } from '../../core/services/printer.service';
import { RuntimeConfigService } from '../../core/services/runtime-config.service';
import { TicketModal } from '../ticket-modal/ticket-modal';

export interface ResumenSales {
  totalVentas: number;
  totalOrdenes: number;
  ticketPromedio: number;
}

export interface PagoMetodo {
  metodo: string;
  total: number;
  cantidad: number;
}

export interface CategoriaSale {
  categoria: string;
  total: number;
}

export interface TicketSale {
  folio: number;
  fecha: string;
  cliente: string;
  total: number;
  metodo: string;
  usuario: string;
  estatus: string;
  mesa: string;
}

export interface DashboardData {
  resumen: ResumenSales;
  pagosMetodo: PagoMetodo[];
  categorias: CategoriaSale[];
  tickets: TicketSale[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSnackBarModule,
    MatDialogModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);
  private readonly printerService = inject(PrinterService);
  private readonly runtimeConfig = inject(RuntimeConfigService);
  private readonly dialog = inject(MatDialog);

  private get baseUrl() {
    return `${this.runtimeConfig.apiBaseUrl}/dashboard/stats`;
  }

  private get ticketsUrl() {
    return `${this.runtimeConfig.apiBaseUrl}/dashboard/tickets`;
  }

  readonly cargando = signal<boolean>(true);
  readonly data = signal<DashboardData | null>(null);
  readonly tickets = signal<TicketSale[]>([]);
  readonly reimprimiendo = signal<number | null>(null);

  // Filtros de fecha
  filtroRango = 'HOY'; // HOY, PERSONALIZADO
  fechaInicio = '';
  fechaFin = '';
  filtroFolio = '';
  filtroCliente = '';

  ngOnInit() {
    this.establecerRangoPredeterminado();
  }

  establecerRangoPredeterminado() {
    const hoyStr = new Date().toISOString().split('T')[0];
    this.fechaInicio = hoyStr;
    this.fechaFin = hoyStr;
    this.cargarEstadisticas();
  }

  cambioRango() {
    if (this.filtroRango === 'HOY') {
      this.establecerRangoPredeterminado();
    }
  }

  cargarEstadisticas() {
    this.cargando.set(true);
    let paramsUrl = '';

    if (this.filtroRango === 'PERSONALIZADO' && this.fechaInicio) {
      paramsUrl += `?fechaInicio=${this.fechaInicio}`;
      if (this.fechaFin) {
        paramsUrl += `&fechaFin=${this.fechaFin}`;
      }
    }

    this.http.get<DashboardData>(`${this.baseUrl}${paramsUrl}`).subscribe({
      next: (resp) => {
        this.data.set(resp);
        this.tickets.set(resp.tickets || []);
        this.cargando.set(false);
      },
      error: (err) => {
        console.error('Error cargando stats de ventas:', err);
        this.cargando.set(false);
      },
    });
  }

  cargarTickets() {
    const params = new URLSearchParams();
    if (this.filtroRango === 'PERSONALIZADO' && this.fechaInicio) {
      params.set('fechaInicio', this.fechaInicio);
      if (this.fechaFin) {
        params.set('fechaFin', this.fechaFin);
      }
    } else if (this.fechaInicio) {
      params.set('fechaInicio', this.fechaInicio);
    }

    if (this.filtroFolio.trim()) {
      params.set('folio', this.filtroFolio.trim());
    }

    if (this.filtroCliente.trim()) {
      params.set('cliente', this.filtroCliente.trim());
    }

    const query = params.toString();
    this.http.get<TicketSale[]>(`${this.ticketsUrl}${query ? `?${query}` : ''}`).subscribe({
      next: (rows) => this.tickets.set(rows || []),
      error: (err) => {
        console.error('Error cargando tickets para reimpresión:', err);
        this.notifications.error('No se pudo consultar el historial de tickets.');
      },
    });
  }

  reimprimirTicket(ticket: TicketSale) {
    this.reimprimiendo.set(ticket.folio);
    this.notifications.info(`Reimprimiendo ticket #${ticket.folio}...`, 2500);

    this.http.post<any>(`${this.ticketsUrl}/${ticket.folio}/reprint`, {}).subscribe({
      next: async (res) => {
        try {
          await this.procesarImpresionesPendientes(res?.impresionesPendientes || []);

          if (res?.ticketTexto) {
            this.dialog.open(TicketModal, {
              width: '360px',
              data: {
                contenidoTicket: res.ticketTexto,
                titulo: `Reimpresión Ticket #${ticket.folio}`,
              },
            });
          }

          this.notifications.success(`Ticket #${ticket.folio} enviado a impresión.`);
        } catch (err: any) {
          this.notifications.error(err?.message || 'Error al reimprimir ticket.');
        } finally {
          this.reimprimiendo.set(null);
        }
      },
      error: (err) => {
        this.reimprimiendo.set(null);
        this.notifications.error(err.error?.error || 'Error al reimprimir ticket.');
      },
    });
  }

  private async procesarImpresionesPendientes(impresionesPendientes: ElectronPendingPrintJob[]) {
    for (const trabajo of impresionesPendientes) {
      await this.printerService.printTicketSilently(trabajo);
    }
  }

  getMetodoIcon(metodo: string): string {
    switch (metodo) {
      case 'EFECTIVO':
        return 'payments';
      case 'TARJETA':
        return 'credit_card';
      case 'TRANSFERENCIA':
        return 'account_balance';
      default:
        return 'payment';
    }
  }

  getMetodoColor(metodo: string): string {
    switch (metodo) {
      case 'EFECTIVO':
        return '#2e7d32'; // Verde
      case 'TARJETA':
        return '#1565c0'; // Azul
      case 'TRANSFERENCIA':
        return '#ef6c00'; // Naranja
      default:
        return '#5f6368';
    }
  }
}
