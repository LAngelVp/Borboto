import { ChangeDetectionStrategy, Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';

import { CocinaService } from '../../core/services/cocina';
import { SocketService } from '../../core/services/socket.service';
import { KdsCardComponent } from './components/kds-card/kds-card';

@Component({
  selector: 'app-cocina',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatIconModule, KdsCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cocina.html',
  styleUrl: './cocina.scss'
})
export class Cocina implements OnInit, OnDestroy {
  protected readonly cocinaService = inject(CocinaService);
  private readonly socketService = inject(SocketService);
  private socketSub!: Subscription;

  ngOnInit() {
    // 🔹 Ajustamos el filtro por defecto a PENDIENTE al entrar a la pantalla
    this.cocinaService.filtroEstado.set('PENDIENTE');

    this.cocinaService.cargarTickets();
    this.socketSub = this.socketService.onEvent('actualizar_cocina').subscribe(() => {
      this.cocinaService.cargarTickets();
    });
  }

  ngOnDestroy() {
    if (this.socketSub) {
      this.socketSub.unsubscribe();
    }
  }
}