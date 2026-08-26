import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MesaCardComponent } from './mesa-card';

describe('MesaCardComponent', () => {
  let component: MesaCardComponent;
  let fixture: ComponentFixture<MesaCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MesaCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MesaCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('mesa', {
      id: 1,
      numero: '01',
      zona: 'Comedor',
      capacidad: 4,
      estado: 'LIBRE',
      total: 0
    });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
