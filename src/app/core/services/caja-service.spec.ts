import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

import { CajaService } from './caja-service';

describe('CajaService', () => {
  let service: CajaService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CajaService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(CajaService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should follow the loyalty points accumulation & redemption flow correctly', () => {
    // 1. Iniciamos cargando la cuenta de una mesa con cliente asociado
    service.cargarCuentaMesa(5);

    // 2. Simulamos las respuestas mockeadas del Backend
    const mainReq = httpTestingController.expectOne('http://127.0.0.1:3000/api/caja/mesa/5');
    expect(mainReq.request.method).toBe('GET');
    mainReq.flush({
      comandaId: 44,
      mesaNumero: '05',
      total: 350.00,
      clienteId: 9,
      clienteNombre: 'Carlos Ramos',
      clientePuntos: 80,
      clienteEsFrecuente: true,
      clienteVisitas: 12
    });

    const itemsReq = httpTestingController.expectOne('http://127.0.0.1:3000/api/comandas/activa/5');
    expect(itemsReq.request.method).toBe('GET');
    itemsReq.flush({ items: [] });

    // 3. Verificamos que el cliente, puntos y visitas se cargaron en los Signals
    expect(service.clienteId()).toBe(9);
    expect(service.clienteNombre()).toBe('Carlos Ramos');
    expect(service.clientePuntos()).toBe(80);
    expect(service.clienteEsFrecuente()).toBe(true);
    expect(service.clienteVisitas()).toBe(12);

    // 4. Verificamos el cálculo automático de puntos por ganar (1 pt por cada $10 consumidos)
    // Con $350 de total, debe ganar 35 puntos.
    expect(service.puntosPorGanar()).toBe(35);

    // 5. Aplicamos canje de puntos de lealtad (Se canjean 50 puntos por $50 de descuento directo)
    service.canjearPuntosLealtad(50);
    expect(service.puntosCanjeados()).toBe(50);
    expect(service.descuentoAplicado()).toBe(50);
    expect(service.totalCuenta()).toBe(300.00); // 350 - 50 = 300
    expect(service.montoRecibido()).toBe(300.00);

    // 6. Al recuperar la comanda de cobro y cerrarla, debe enviar el payload con puntos canjeados
    service.cobrarYCerrarMesa(1).subscribe();

    const postReq = httpTestingController.expectOne('http://127.0.0.1:3000/api/caja/cobrar');
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body.puntosCanjeados).toBe(50);
    expect(postReq.request.body.descuento).toBe(50);
    expect(postReq.request.body.totalCuenta).toBe(300.00);
    postReq.flush({ ok: true });
  });
});
