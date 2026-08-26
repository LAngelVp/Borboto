import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { AbrirMesaDialogComponent } from './abrir-mesa-dialog';

describe('AbrirMesaDialogComponent', () => {
  let component: AbrirMesaDialogComponent;
  let fixture: ComponentFixture<AbrirMesaDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AbrirMesaDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: MAT_DIALOG_DATA, useValue: { mesa: { id: 1, numero: '01', zona: 'Comedor', capacidad: 4, estado: 'LIBRE', total: 0 } } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AbrirMesaDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
