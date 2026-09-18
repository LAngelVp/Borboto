import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly recentMessages = new Map<string, number>();

  success(message: string, duration = 3000) {
    this.open(message, 'Cerrar', duration, 'success-snackbar');
  }

  info(message: string, duration = 3000) {
    this.open(message, 'Cerrar', duration, 'info-snackbar');
  }

  warning(message: string, duration = 4000) {
    this.open(message, 'Cerrar', duration, 'warn-snackbar');
  }

  error(message: string, duration = 4500) {
    this.open(message, 'Cerrar', duration, 'error-snackbar');
  }

  confirmAction(
    message: string,
    actionLabel = 'Confirmar',
    onConfirm?: () => void,
    duration = 7000,
  ) {
    const ref = this.snackBar.open(message, actionLabel, {
      duration,
      panelClass: ['warn-snackbar', 'action-snackbar'],
    });

    ref.onAction().subscribe(() => onConfirm?.());
    return ref;
  }

  private open(message: string, action: string, duration: number, panelClass: string) {
    const normalizedMessage = this.normalizeMessage(message);
    if (!normalizedMessage || this.isDuplicate(panelClass, normalizedMessage)) {
      return null;
    }

    return this.snackBar.open(message, action, {
      duration,
      panelClass: [panelClass],
    });
  }

  private normalizeMessage(message: string): string {
    return String(message || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  }

  private isDuplicate(level: string, message: string): boolean {
    const key = `${level}:${message}`;
    const now = Date.now();
    const lastSeen = this.recentMessages.get(key) || 0;

    if (now - lastSeen < 2500) {
      return true;
    }

    this.recentMessages.set(key, now);

    if (this.recentMessages.size > 120) {
      for (const [storedKey, timestamp] of this.recentMessages.entries()) {
        if (now - timestamp > 30000) {
          this.recentMessages.delete(storedKey);
        }
      }
    }

    return false;
  }
}
