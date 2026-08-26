import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KdsCardComponent } from './kds-card';

describe('KdsCard', () => {
  let component: KdsCardComponent;
  let fixture: ComponentFixture<KdsCardComponent>;

  beforeEach(async () => {
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
      items: []
    });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
