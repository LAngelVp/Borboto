import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-cancel-comanda-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Cancelar comanda</h2>
    <mat-dialog-content>
      <p>Esta acción liberará la mesa y no se puede deshacer.</p>
      <mat-form-field appearance="outline" class="w-full">
        <mat-label>Motivo de cancelación</mat-label>
        <textarea matInput rows="3" [(ngModel)]="motivo"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancelar</button>
      <button mat-flat-button color="warn" (click)="confirmar()">Confirmar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      color: var(--color-text-main);
      --mdc-outlined-text-field-input-text-color: var(--color-text-main);
      --mdc-outlined-text-field-label-text-color: var(--color-text-muted);
      --mdc-outlined-text-field-focus-label-text-color: var(--color-primary);
      --mdc-outlined-text-field-outline-color: var(--color-border);
      --mdc-outlined-text-field-hover-outline-color: var(--color-primary);
      --mdc-outlined-text-field-focus-outline-color: var(--color-primary);
      --mdc-outlined-text-field-caret-color: var(--color-primary);
      --mat-form-field-outlined-input-text-color: var(--color-text-main);
      --mat-form-field-outlined-label-text-color: var(--color-text-muted);
      --mat-form-field-outlined-focus-label-text-color: var(--color-primary);
    }

    h2[mat-dialog-title],
    p {
      color: var(--color-text-main);
    }

    .w-full {
      width: 100%;
      margin-top: 8px;
    }

    textarea[matInput] {
      color: var(--color-text-main) !important;
      background-color: transparent !important;
      caret-color: var(--color-primary);
    }

    ::ng-deep {
      .mat-mdc-form-field .mdc-text-field--outlined:not(.mdc-text-field--disabled) {
        background-color: transparent;
      }

      .mat-mdc-form-field .mdc-text-field__input {
        color: var(--color-text-main) !important;
      }

      .mat-mdc-form-field .mat-mdc-floating-label,
      .mat-mdc-form-field .mdc-floating-label {
        color: var(--color-text-muted) !important;
      }

      .mat-mdc-form-field .mdc-notched-outline__leading,
      .mat-mdc-form-field .mdc-notched-outline__notch,
      .mat-mdc-form-field .mdc-notched-outline__trailing {
        border-color: var(--color-border) !important;
      }

      .mat-mdc-form-field.mat-focused .mdc-notched-outline__leading,
      .mat-mdc-form-field.mat-focused .mdc-notched-outline__notch,
      .mat-mdc-form-field.mat-focused .mdc-notched-outline__trailing {
        border-color: var(--color-primary) !important;
      }

      .mat-mdc-form-field .mat-mdc-form-field-focus-overlay {
        background-color: transparent !important;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancelComandaDialogComponent {
  readonly dialogRef = inject(MatDialogRef<CancelComandaDialogComponent, string | undefined>);
  motivo = '';

  confirmar() {
    this.dialogRef.close(this.motivo.trim() || 'Sin motivo especificado');
  }
}
