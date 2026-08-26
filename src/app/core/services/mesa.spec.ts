import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

import { MesaService } from './mesa';
import { Mesa } from '../models/mesa';

describe('MesaService', () => {
  let service: MesaService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MesaService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(MesaService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should be created and load mesas', () => {
    const req = httpTestingController.expectOne('http://127.0.0.1:3000/api/mesas');
    expect(req.request.method).toBe('GET');
    req.flush([]);
    expect(service).toBeTruthy();
  });

  it('should filter enviosDomicilio by status and date correctly', () => {
    const req = httpTestingController.expectOne('http://127.0.0.1:3000/api/mesas');
    const mockMesas: Mesa[] = [
      {
        id: 1,
        numero: 'Envío #1',
        zona: 'Domicilio',
        capacidad: 1,
        estado: 'PENDIENTE',
        comensales: 1,
        minutosAbierta: 2,
        total: 150.00,
        creadoEn: new Date().toISOString() // Hoy
      },
      {
        id: 2,
        numero: 'Envío #2',
        zona: 'Domicilio',
        capacidad: 1,
        estado: 'DISPONIBLE', // Closed/completed
        comensales: 1,
        minutosAbierta: 2,
        total: 150.00,
        creadoEn: new Date().toISOString() // Hoy
      },
      {
        id: 3,
        numero: 'Envío #3',
        zona: 'Domicilio',
        capacidad: 1,
        estado: 'EN COCINA',
        comensales: 1,
        minutosAbierta: 2,
        total: 200.00,
        creadoEn: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Ayer
      }
    ];

    req.flush(mockMesas);

    // Default status: 'ACTIVOS'
    // Default date: 'TODOS'
    // Should return Active and Kuching/cocinando ones (excluding DISPONIBLE)
    let envios = service.enviosDomicilio();
    expect(envios.length).toBe(2);
    expect(envios[0].numero).toBe('Envío #1');
    expect(envios[1].numero).toBe('Envío #3');

    // Change status to 'TODOS'
    service.setFiltroEnvioEstado('TODOS');
    envios = service.enviosDomicilio();
    expect(envios.length).toBe(3);

    // Filter by specific status: 'EN COCINA'
    service.setFiltroEnvioEstado('EN COCINA');
    envios = service.enviosDomicilio();
    expect(envios.length).toBe(1);
    expect(envios[0].numero).toBe('Envío #3');

    // Filter by date: 'HOY' (status is 'EN COCINA', so none should match since Envío #3 was yesterday)
    service.setFiltroEnvioFecha('HOY');
    envios = service.enviosDomicilio();
    expect(envios.length).toBe(0);

    // Reset status to 'TODOS' and date to 'HOY'
    service.setFiltroEnvioEstado('TODOS');
    service.setFiltroEnvioFecha('HOY');
    envios = service.enviosDomicilio();
    expect(envios.length).toBe(2); // Envío #1 and Envío #2

    // Filter by date: 'AYER'
    service.setFiltroEnvioFecha('AYER');
    envios = service.enviosDomicilio();
    expect(envios.length).toBe(1);
    expect(envios[0].numero).toBe('Envío #3');
  });
});
