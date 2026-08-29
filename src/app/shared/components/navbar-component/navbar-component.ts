import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service'; // Adjust path
import { CambiarTurnoDialogComponent } from '../cambiar-turno-dialog/cambiar-turno-dialog';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatDialogModule
  ],
  templateUrl: './navbar-component.html',
  styleUrl: './navbar-component.scss'
})
export class NavbarComponent {
  protected readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  cambiarTurno() {
    this.dialog.open(CambiarTurnoDialogComponent, {
      width: '320px',
      disableClose: false
    });
  }

  cerrarSesion() {
    this.authService.cerrarSesion();
    this.router.navigate(['/login']);
  }
}