import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';

import { DesgloseCuentaComponent } from './desglose-cuenta';

describe('DesgloseCuentaComponent', () => {
  let component: DesgloseCuentaComponent;
  let fixture: ComponentFixture<DesgloseCuentaComponent>;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [DesgloseCuentaComponent, BrowserAnimationsModule],
      providers: [
        { provide: MatSnackBar, useValue: { open: () => {} } },
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DesgloseCuentaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
