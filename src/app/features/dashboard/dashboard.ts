import { Component, inject, OnInit, signal } from '@angular/core';
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
  id: number;
  total: number;
  metodo: string;
  duracionMinutos: number;
  mesaNombre: string;
  hora: string;
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
    MatSelectModule
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://127.0.0.1:3000/api/dashboard/stats';

  readonly cargando = signal<boolean>(true);
  readonly data = signal<DashboardData | null>(null);

  // Filtros de fecha
  filtroRango = 'HOY'; // HOY, PERSONALIZADO
  fechaInicio = '';
  fechaFin = '';

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
        this.cargando.set(false);
      },
      error: (err) => {
        console.error('Error cargando stats de ventas:', err);
        this.cargando.set(false);
      }
    });
  }

  getMetodoIcon(metodo: string): string {
    switch (metodo) {
      case 'EFECTIVO': return 'payments';
      case 'TARJETA': return 'credit_card';
      case 'TRANSFERENCIA': return 'account_balance';
      default: return 'payment';
    }
  }

  getMetodoColor(metodo: string): string {
    switch (metodo) {
      case 'EFECTIVO': return '#2e7d32'; // Verde
      case 'TARJETA': return '#1565c0';   // Azul
      case 'TRANSFERENCIA': return '#ef6c00'; // Naranja
      default: return '#5f6368';
    }
  }
}
