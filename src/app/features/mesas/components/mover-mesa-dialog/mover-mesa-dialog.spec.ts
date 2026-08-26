import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { MoverMesaDialogComponent } from './mover-mesa-dialog';

describe('MoverMesaDialogComponent', () => {
  let component: MoverMesaDialogComponent;
  let fixture: ComponentFixture<MoverMesaDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MoverMesaDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: MAT_DIALOG_DATA, useValue: { mesaOrigen: { id: 1, numero: '01' }, mesasLibres: [] } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MoverMesaDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
