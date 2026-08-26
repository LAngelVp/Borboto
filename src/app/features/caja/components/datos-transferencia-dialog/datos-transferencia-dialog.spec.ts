import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { DatosTransferenciaDialogComponent } from './datos-transferencia-dialog';

describe('DatosTransferenciaDialogComponent', () => {
  let component: DatosTransferenciaDialogComponent;
  let fixture: ComponentFixture<DatosTransferenciaDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatosTransferenciaDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DatosTransferenciaDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
