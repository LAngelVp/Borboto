import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { TicketCobroDialog } from './ticket-cobro-dialog';

describe('TicketCobroDialog', () => {
  let component: TicketCobroDialog;
  let fixture: ComponentFixture<TicketCobroDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TicketCobroDialog],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            transaccion: {
              id: 1234,
              mesaId: 1,
              mesaNumero: '01',
              totalCuenta: 100,
              montoRecibido: 100,
              cambio: 0,
              metodoPago: 'EFECTIVO',
              dividirCuenta: false,
              fecha: new Date()
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TicketCobroDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
