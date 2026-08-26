import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrdenResumenComponent } from './orden-resumen';

describe('OrdenResumenComponent', () => {
  let component: OrdenResumenComponent;
  let fixture: ComponentFixture<OrdenResumenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdenResumenComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdenResumenComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
