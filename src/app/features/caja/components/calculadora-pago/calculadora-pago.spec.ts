import { ComponentFixture, TestBed, inject } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { CalculadoraPagoComponent } from './calculadora-pago';

describe('CalculadoraPagoComponent', () => {
  let component: CalculadoraPagoComponent;
  let fixture: ComponentFixture<CalculadoraPagoComponent>;

  beforeEach(async () => {
    // Resetting TestBed to avoid already-instantiated error
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [CalculadoraPagoComponent],
      providers: [
        { provide: MatDialog, useValue: { open: () => {} } },
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CalculadoraPagoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
