import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip'; // <-- Importación añadida

import { AjustesService, FacturacionConfig } from '../../core/services/ajustes.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-billing-component',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule, // <-- Añadido al arreglo imports
  ],
  templateUrl: './billing-component.html',
  styleUrl: './billing-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ajustesService = inject(AjustesService);
  private readonly notifications = inject(NotificationService);

  billingForm!: FormGroup;
  archivoCer: File | null = null;
  archivoKey: File | null = null;

  readonly probandoConexion = signal<boolean>(false);
  readonly guardando = signal<boolean>(false);
  readonly tieneApiKeyTest = signal(false);
  readonly tieneApiKeyLive = signal(false);

  readonly RegimenesFiscales = [
    { clave: '601', descripcion: '601 - General de Ley Personas Morales' },
    { clave: '603', descripcion: '603 - Personas Morales con Fines no Lucrativos' },
    { clave: '605', descripcion: '605 - Sueldos y Salarios e Ingresos Asimilados a Salarios' },
    { clave: '606', descripcion: '606 - Arrendamiento' },
    {
      clave: '612',
      descripcion: '612 - Personas Físicas con Actividades Empresariales y Profesionales',
    },
    { clave: '621', descripcion: '621 - Incorporación Fiscal' },
    { clave: '626', descripcion: '626 - Régimen Simplificado de Confianza (RESICO)' },
  ];

  ngOnInit(): void {
    this.inicializarFormulario();
    this.cargarConfiguracionFiscal();
  }

  private inicializarFormulario(): void {
    this.billingForm = this.fb.group({
      apiKeyTest: ['', [Validators.required]],
      apiKeyLive: [''],
      modoProduccion: [false],
      rfcEmisor: [
        '',
        [Validators.required, Validators.pattern('^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$')],
      ],
      razonSocial: ['', [Validators.required]],
      regimenFiscal: ['601', [Validators.required]],
      codigoPostal: ['', [Validators.required, Validators.pattern('^[0-9]{5}$')]],
      emailNotificaciones: ['', [Validators.email]],
      csdPassword: [''],
      diasVigenciaTicket: [7, [Validators.required, Validators.min(1), Validators.max(30)]],
    });
  }

  private cargarConfiguracionFiscal(): void {
    this.ajustesService.getConfiguracionFacturacion().subscribe({
      next: (config: FacturacionConfig) => {
        if (config) {
          this.tieneApiKeyTest.set(Boolean(config.tieneApiKeyTest));
          this.tieneApiKeyLive.set(Boolean(config.tieneApiKeyLive));
          const testControl = this.billingForm.get('apiKeyTest');
          testControl?.setValidators(config.tieneApiKeyTest ? [] : [Validators.required]);
          this.billingForm.patchValue(config);
          testControl?.updateValueAndValidity();
        }
      },
      error: () => console.log('Sin configuración previa de facturación registrada.'),
    });
  }

  onFileSelected(event: Event, type: 'cer' | 'key'): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      if (type === 'cer') {
        this.archivoCer = input.files[0];
      } else {
        this.archivoKey = input.files[0];
      }
    }
  }

  probarConexionAPI(): void {
    const isLive = Boolean(this.billingForm.get('modoProduccion')?.value);
    const key = isLive
      ? this.billingForm.get('apiKeyLive')?.value
      : this.billingForm.get('apiKeyTest')?.value;
    if (!key && !(isLive ? this.tieneApiKeyLive() : this.tieneApiKeyTest())) {
      this.notifications.warning('Ingresa una API Key para el modo seleccionado.');
      return;
    }
    this.probandoConexion.set(true);

    this.ajustesService.probarConexionFacturapi({ apiKey: key || '', isLive }).subscribe({
      next: () => {
        this.probandoConexion.set(false);
        this.notifications.success('Conexión exitosa con el servidor de facturación.', 4000);
      },
      error: (err) => {
        this.probandoConexion.set(false);
        this.notifications.error(
          `Fallo de autenticación: ${err.error?.error || 'API Key inválida'}`,
          4000,
        );
      },
    });
  }

  guardarConfiguracion(): void {
    if (this.billingForm.invalid) {
      this.billingForm.markAllAsTouched();
      this.notifications.warning('Por favor completa todos los campos requeridos.');
      return;
    }

    this.guardando.set(true);

    const formData = new FormData();
    Object.keys(this.billingForm.value).forEach((key) => {
      formData.append(key, this.billingForm.value[key]);
    });

    if (this.archivoCer) formData.append('csdCer', this.archivoCer);
    if (this.archivoKey) formData.append('csdKey', this.archivoKey);

    this.ajustesService.guardarConfiguracionFacturacion(formData).subscribe({
      next: () => {
        this.guardando.set(false);
        this.notifications.success('Ajustes de facturación CFDI 4.0 guardados correctamente.');
        this.cargarConfiguracionFiscal();
      },
      error: (err) => {
        this.guardando.set(false);
        this.notifications.error(
          `Error al guardar datos fiscales: ${err.error?.error || 'Error interno'}`,
          4000,
        );
      },
    });
  }
}
