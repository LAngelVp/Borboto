import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MesaFiltrosComponent } from './mesa-filtros';

describe('MesaFiltrosComponent', () => {
  let component: MesaFiltrosComponent;
  let fixture: ComponentFixture<MesaFiltrosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MesaFiltrosComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MesaFiltrosComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
