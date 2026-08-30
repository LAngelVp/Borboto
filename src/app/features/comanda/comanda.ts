import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { ComandaService } from '../../core/services/comanda';
import { MesaService } from '../../core/services/mesa';
import { AuthService } from '../../core/services/auth.service';
import { OrdenResumenComponent } from './components/orden-resumen/orden-resumen';
import { MenuProductosComponent } from './components/menu-productos/menu-productos';

@Component({
  selector: 'app-comanda',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    OrdenResumenComponent,
    MenuProductosComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './comanda.html',
  styleUrl: './comanda.scss'
})
export class Comanda implements OnInit {
  protected readonly comandaService = inject(ComandaService);
  protected readonly mesaService = inject(MesaService);
  protected readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  comandaId = 0;
  mesaId = 0;

  ngOnInit() {
    this.comandaService.cargarProductos();

    this.route.queryParams.subscribe(params => {
      this.mesaId = Number(params['mesaId']) || 0;
      this.comandaId = Number(params['comandaId']) || 0;

      // 🔹 Al entrar a /comanda?mesaId=X se recuperan y enlistan los productos guardados
      if (this.mesaId > 0) {
        this.comandaService.cargarComandaActivaPorMesa(this.mesaId);
      }
    });
  }

  enviarCocina() {
    if (this.comandaService.itemsComanda().length === 0) {
      this.snackBar.open('Seleccione al menos un producto', 'Cerrar', { duration: 2500 });
      return;
    }

    const usuarioId = this.authService.usuarioActivo()?.id;
    this.comandaService.enviarComandaACocina(this.comandaId, this.mesaId, usuarioId).subscribe({
      next: () => {
        this.snackBar.open('¡Comanda actualizada y enviada a cocina!', 'Cerrar', { duration: 3000 });
        this.comandaService.limpiarComanda();
        this.mesaService.cargarMesas();
        this.router.navigate(['/mesas']);
      },
      error: () => this.snackBar.open('Error al guardar comanda en base de datos', 'Cerrar', { duration: 3000 })
    });
  }
}