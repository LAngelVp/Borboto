import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-not-found',
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="not-found-wrapper">
      <div class="not-found-card">
        <div class="emoji-container">
          <mat-icon class="cancel-icon">explore_off</mat-icon>
        </div>
        <h1 class="error-code">404</h1>
        <h2 class="error-title">Ruta No Encontrada</h2>
        <p class="error-description">
          Lo sentimos, la sección o servicio que estás intentando consultar no existe o ha sido reubicada dentro del sistema POS.
        </p>
        <div class="action-buttons">
          <button mat-flat-button color="primary" (click)="irAlInicio()">
            <mat-icon>home</mat-icon>
            Volver al Menú Principal
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .not-found-wrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
      box-sizing: border-box;
      padding: 24px;
    }

    .not-found-card {
      background: var(--color-surface, #ffffff);
      padding: 48px 32px;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      text-align: center;
      max-width: 480px;
      width: 100%;
    }

    .emoji-container {
      display: inline-flex;
      background-color: #fff3e0;
      border-radius: 50%;
      padding: 24px;
      margin-bottom: 24px;

      .cancel-icon {
        font-size: 56px;
        width: 56px;
        height: 56px;
        color: var(--color-primary, #e65100);
      }
    }

    .error-code {
      font-size: 80px;
      margin: 0;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -2px;
      color: var(--color-secondary, #263238);
    }

    .error-title {
      font-size: 24px;
      font-weight: 750;
      margin: 16px 0 12px 0;
      color: #1a202c;
    }

    .error-description {
      font-size: 15px;
      line-height: 1.6;
      color: var(--color-text-muted, #5f6368);
      margin: 0 0 32px 0;
    }

    .action-buttons {
      display: flex;
      justify-content: center;
      gap: 12px;

      button {
        padding: 0 24px;
        height: 48px;
        font-weight: 700;
        border-radius: 10px;
        background-color: var(--color-primary, #e65100) !important;
        color: #ffffff !important;
        box-shadow: 0 4px 12px rgba(230, 81, 0, 0.2);

        mat-icon {
          margin-right: 8px;
        }
      }
    }
  `]
})
export class NotFoundComponent {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  irAlInicio() {
    if (this.authService.usuarioActivo()) {
      // Si el usuario está autenticado, llevarlo a mesas o página principal operativa
      this.router.navigate(['/mesas']);
    } else {
      // Si no, enviarlo a iniciar sesión
      this.router.navigate(['/login']);
    }
  }
}
