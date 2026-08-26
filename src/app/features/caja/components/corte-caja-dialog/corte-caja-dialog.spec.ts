import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { CorteCajaDialog } from './corte-caja-dialog';
import { CajaService } from '../../../../core/services/caja-service';
import { AuthService } from '../../../../core/services/auth.service';

describe('CorteCajaDialog', () => {
  let component: CorteCajaDialog;
  let fixture: ComponentFixture<CorteCajaDialog>;

  const mockCajaService = {
    obtenerCorteActual: () => of({
      ok: true,
      fechaUltimoCorte: '2026-08-25T12:00:00Z',
      efectivoCalculado: 250.00,
      tarjetaCalculado: 120.00,
      transferenciaCalculado: 80.00,
      ventasTotales: 450.00,
      pagosCount: 3,
      pagos: []
    }),
    guardarCorte: () => of({ ok: true, corteId: 1 })
  };

  const mockAuthService = {
    usuarioActivo: signal({
      id: 2,
      nombre: 'María Cajera',
      rol: 'CAJERO'
    }),
    cerrarSesion: () => {}
  };

  const mockDialogRef = {
    close: () => {}
  };

  const mockRouter = {
    navigate: () => Promise.resolve(true)
  };

  const mockSnackBar = {
    open: () => {}
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CorteCajaDialog, BrowserAnimationsModule],
      providers: [
        { provide: CajaService, useValue: mockCajaService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: Router, useValue: mockRouter },
        { provide: MatSnackBar, useValue: mockSnackBar }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CorteCajaDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create and load corte de caja details', () => {
    expect(component).toBeTruthy();
    expect(component.usuarioNombre()).toBe('María Cajera');
    expect(component.efectivoCalculado()).toBe(250.00);
    expect(component.ventasTotales()).toBe(450.00);
    expect(component.loading()).toBe(false);
  });

  it('should dynamically calculate expected cash and difference', () => {
    component.fondoApertura.set(100); // 100 fund
    component.efectivoReal.set(340); // 340 physical cash counted
    // expected = 100 (fund) + 250 (calculated cash) = 350
    // difference = 340 - 350 = -10
    expect(component.efectivoEsperado()).toBe(350);
    expect(component.diferencia()).toBe(-10);
  });
});
