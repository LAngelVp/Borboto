import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './shared/components/navbar-component/navbar-component';
import { AuthService } from './core/services/auth.service';
import { NotificationService } from './core/services/notification.service';

declare const window: Window & {
  require?: (moduleName: string) => any;
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, NavbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly authService = inject(AuthService);
  protected readonly title = signal('borboto');
  private readonly notifications = inject(NotificationService);
  private consoleBridgeInstalled = false;

  constructor() {
    this.installRendererConsoleBridge();
    this.installGlobalErrorHandlers();

    if (!window.require) {
      return;
    }

    try {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.on(
        'app-notification',
        (_event: unknown, payload: { level?: string; message?: string }) => {
          if (!payload?.message) {
            return;
          }

          switch (payload.level) {
            case 'success':
              this.notifications.success(payload.message);
              break;
            case 'warning':
              this.notifications.warning(payload.message);
              break;
            case 'error':
              this.notifications.error(payload.message);
              break;
            default:
              this.notifications.info(payload.message);
          }
        },
      );
    } catch (error) {
      console.error('No se pudo registrar el canal de notificaciones Electron:', error);
    }
  }

  private installRendererConsoleBridge() {
    if (
      this.consoleBridgeInstalled ||
      typeof window === 'undefined' ||
      typeof console === 'undefined'
    ) {
      return;
    }

    this.consoleBridgeInstalled = true;
    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      if (this.shouldNotifyConsoleMessage('info', args)) {
        this.forwardConsoleMessage('info', args);
      }
    };

    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      if (this.shouldNotifyConsoleMessage('warning', args)) {
        this.forwardConsoleMessage('warning', args);
      }
    };

    console.error = (...args: unknown[]) => {
      originalError(...args);
      if (this.shouldNotifyConsoleMessage('error', args)) {
        this.forwardConsoleMessage('error', args);
      }
    };
  }

  private installGlobalErrorHandlers() {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('error', (event: ErrorEvent) => {
      const message = event.error?.message || event.message || 'Error inesperado en la aplicación.';
      this.notifications.error(message);
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason?.message || String(reason || 'Promesa rechazada sin manejar.');
      this.notifications.error(message);
    });
  }

  private forwardConsoleMessage(level: 'info' | 'warning' | 'error', args: unknown[]) {
    const message = this.formatConsoleArgs(args);
    if (!message) {
      return;
    }

    switch (level) {
      case 'warning':
        this.notifications.warning(message);
        break;
      case 'error':
        this.notifications.error(message);
        break;
      default:
        this.notifications.info(message);
    }
  }

  private shouldNotifyConsoleMessage(
    level: 'info' | 'warning' | 'error',
    args: unknown[],
  ): boolean {
    const message = this.formatConsoleArgs(args);
    if (!message) {
      return false;
    }

    const isDebug = message.includes('[PRINT]') || message.includes('[DEBUG]');
    if (isDebug) {
      return false;
    }

    return level !== 'info';
  }

  private formatConsoleArgs(args: unknown[]): string {
    return args
      .map((value) => {
        if (value instanceof Error) {
          return value.message;
        }

        if (typeof value === 'string') {
          return value;
        }

        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(' ')
      .trim();
  }
}
