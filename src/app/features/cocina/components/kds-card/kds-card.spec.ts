import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KdsCardComponent } from './kds-card';

describe('KdsCard', () => {
  let component: KdsCardComponent;
  let fixture: ComponentFixture<KdsCardComponent>;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [KdsCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(KdsCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('ticket', {
      id: 1,
      comandaId: 101,
      mesaNumero: '01',
      mesero: 'Juan',
      minutosTranscurridos: 5,
      estado: 'PENDIENTE',
      items: [
        { id: 1, nombre: 'Taco Al Pastor', cantidad: 3, completado: false }
      ]
    });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should verify all items are completed', () => {
    expect(component.todosCompletados()).toBe(false);

    fixture.componentRef.setInput('ticket', {
      id: 1,
      comandaId: 101,
      mesaNumero: '01',
      mesero: 'Juan',
      minutosTranscurridos: 5,
      estado: 'PENDIENTE',
      items: [
        { id: 1, nombre: 'Taco Al Pastor', cantidad: 3, completado: true }
      ]
    });
    fixture.detectChanges();

    expect(component.todosCompletados()).toBe(true);
  });
});
