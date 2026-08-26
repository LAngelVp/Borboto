import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DesgloseCuentaComponent } from './desglose-cuenta';

describe('DesgloseCuentaComponent', () => {
  let component: DesgloseCuentaComponent;
  let fixture: ComponentFixture<DesgloseCuentaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DesgloseCuentaComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DesgloseCuentaComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
