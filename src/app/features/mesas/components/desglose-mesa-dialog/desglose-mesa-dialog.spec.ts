import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { DesgloseMesaDialogComponent } from './desglose-mesa-dialog';
import { AuthService } from '../../../../core/services/auth.service';

describe('DesgloseMesaDialogComponent', () => {
  let component: DesgloseMesaDialogComponent;
  let fixture: ComponentFixture<DesgloseMesaDialogComponent>;
  let httpTestingController: HttpTestingController;

  const mockAuthService = {
    usuarioActivo: signal({ id: 1, nombre: 'Juan Mesero', rol: 'ADMIN' })
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DesgloseMesaDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: MAT_DIALOG_DATA, useValue: { mesa: { id: 1, numero: '3', estado: 'PENDIENTE' } } },
        { provide: AuthService, useValue: mockAuthService },
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DesgloseMesaDialogComponent);
    component = fixture.componentInstance;
    httpTestingController = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should create and load comanda desglose', () => {
    // Expect the initial load of mesas in MesaService constructor
    const mesasReq = httpTestingController.expectOne('http://127.0.0.1:3000/api/mesas');
    expect(mesasReq.request.method).toBe('GET');
    mesasReq.flush([]);

    const req = httpTestingController.expectOne('http://127.0.0.1:3000/api/comandas/activa/1');
    expect(req.request.method).toBe('GET');
    req.flush({ comandaId: 10, total: 120.00, items: [] });

    expect(component).toBeTruthy();
    expect(component.total()).toBe(120.00);
    expect(component.comandaId()).toBe(10);
    expect(component.cargando()).toBe(false);
  });
});
