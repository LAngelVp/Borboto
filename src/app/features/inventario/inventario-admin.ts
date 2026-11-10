import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, forkJoin } from 'rxjs';
import { InventarioService, Insumo, ModoCaptura, MovimientoInventario, AjusteInventario, errorInventario } from '../../core/services/inventario.service';
import { SocketService } from '../../core/services/socket.service';

@Component({
  selector: 'app-inventario-admin', imports: [ReactiveFormsModule, DatePipe, DecimalPipe, MatIconModule],
  templateUrl: './inventario-admin.html', styleUrl: './inventario-admin.scss', changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioAdminComponent implements OnInit {
  readonly inventario = inject(InventarioService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly destroyRef = inject(DestroyRef);
  private readonly socket = inject(SocketService);
  private lectura?: Subscription;
  readonly insumos = signal<Insumo[]>([]);
  readonly movimientos = signal<MovimientoInventario[]>([]);
  readonly editando = signal<number | undefined>(undefined);
  readonly seleccionado = signal<Insumo | null>(null);
  readonly accion = signal<'ENTRADA_COMPRA' | 'REINVENTARIO_AJUSTE'>('ENTRADA_COMPRA');
  readonly ocupado = signal(false);
  readonly cargando = signal(false);
  readonly mensaje = signal('');
  readonly soloFaltantes = signal(false);
  readonly areas = ['ALMACEN', 'COCINA', 'BARRA', 'EMPAQUES', 'LIMPIEZA'];
  readonly unidades = ['PIEZA', 'BOTELLA', 'LITRO', 'KG', 'BOLSA', 'LATA'];
  readonly paquetes = ['CAJA', 'PAQUETE', 'SIX', 'COSTAL'];
  readonly tipos = ['SALIDA_COCINA', 'SALIDA_ALMACEN', 'SALIDA_BARRA', 'MERMA', 'ENTRADA_COMPRA', 'REINVENTARIO_AJUSTE'];
  readonly configuracion = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(120)]], codigo: ['', Validators.maxLength(40)],
    categoria_almacen: ['ALMACEN'], unidad_base: ['PIEZA'], permite_paquetes: [false], nombre_paquete: ['CAJA'],
    factor_paquete: [1, [Validators.required, Validators.min(0.01)]], stock_minimo: [0, [Validators.required, Validators.min(0)]],
    costo_unitario: [0, [Validators.required, Validators.min(0)]], ubicacion: ['', Validators.maxLength(80)], activo: [true],
    stock_inicial: [0, [Validators.required, Validators.min(0)]],
  });
  readonly ajuste = this.fb.group({
    modoCaptura: this.fb.control<ModoCaptura>('UNIDAD'), cantidad: [1, [Validators.required, Validators.min(0.01)]],
    conteo: ['DESGLOSE'], nuevoStockFisico: [0, [Validators.required, Validators.min(0)]],
    paquetesContados: [0, [Validators.required, Validators.min(0)]], unidadesSueltasContadas: [0, [Validators.required, Validators.min(0)]],
    notas: ['', Validators.maxLength(255)],
  });
  readonly filtros = this.fb.group({ insumoId: [''], tipoMovimiento: [''] });
  constructor() {
    this.sincronizarPaquetes();
    this.configuracion.controls.permite_paquetes.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.sincronizarPaquetes());
  }
  private sincronizarPaquetes() {
    const { permite_paquetes, nombre_paquete, factor_paquete } = this.configuracion.controls;
    if (permite_paquetes.value) {
      nombre_paquete.enable({ emitEvent: false });
      factor_paquete.enable({ emitEvent: false });
    } else {
      nombre_paquete.setValue('CAJA', { emitEvent: false });
      factor_paquete.setValue(1, { emitEvent: false });
      nombre_paquete.disable({ emitEvent: false });
      factor_paquete.disable({ emitEvent: false });
    }
  }
  ngOnInit() {
    this.cargar();
    this.socket.onEvent<void>('actualizar_inventario').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cargar());
    this.destroyRef.onDestroy(() => this.lectura?.unsubscribe());
  }
  cargar() {
    this.lectura?.unsubscribe(); this.cargando.set(true);
    const filtro = this.filtros.getRawValue();
    this.lectura = forkJoin({ insumos: this.inventario.listarTodos(), movimientos: this.inventario.movimientos(filtro.insumoId, filtro.tipoMovimiento) }).subscribe({
      next: result => { this.insumos.set(result.insumos); this.movimientos.set(result.movimientos); this.cargando.set(false); },
      error: error => { this.mensaje.set(errorInventario(error)); this.cargando.set(false); },
    });
  }
  editar(insumo: Insumo) {
    this.editando.set(insumo.id);
    this.configuracion.reset({ ...insumo, codigo: insumo.codigo ?? '', ubicacion: insumo.ubicacion ?? '', stock_inicial: 0 });
    this.sincronizarPaquetes();
    this.mensaje.set('');
  }
  nuevo() { this.editando.set(undefined); this.configuracion.reset(); this.sincronizarPaquetes(); }
  guardar() {
    this.sincronizarPaquetes();
    if (this.ocupado() || this.configuracion.invalid) { this.configuracion.markAllAsTouched(); return; }
    this.ocupado.set(true); this.mensaje.set('');
    this.inventario.guardar(this.configuracion.getRawValue(), this.editando()).subscribe({
      next: () => { this.ocupado.set(false); this.nuevo(); this.mensaje.set('Insumo guardado'); this.cargar(); this.inventario.recargar(); },
      error: error => { this.ocupado.set(false); this.mensaje.set(errorInventario(error)); },
    });
  }
  preparar(insumo: Insumo, tipo: 'ENTRADA_COMPRA' | 'REINVENTARIO_AJUSTE') {
    this.seleccionado.set(insumo); this.accion.set(tipo); this.ajuste.reset();
    this.ajuste.patchValue({ nuevoStockFisico: insumo.stock_actual, paquetesContados: insumo.desglose_paquetes?.paquetesCompletos ?? 0,
      unidadesSueltasContadas: insumo.desglose_paquetes?.unidadesSueltas ?? insumo.stock_actual });
    this.mensaje.set('');
  }
  registrarAjuste() {
    const insumo = this.seleccionado();
    if (!insumo || this.ocupado() || this.ajuste.invalid) return;
    const value = this.ajuste.getRawValue();
    const body: AjusteInventario = this.accion() === 'ENTRADA_COMPRA'
      ? { tipoMovimiento: 'ENTRADA_COMPRA', modoCaptura: value.modoCaptura, cantidad: value.cantidad, notas: value.notas }
      : value.conteo === 'TOTAL' ? { tipoMovimiento: 'REINVENTARIO_AJUSTE', nuevoStockFisico: value.nuevoStockFisico, notas: value.notas }
      : { tipoMovimiento: 'REINVENTARIO_AJUSTE', paquetesContados: value.paquetesContados, unidadesSueltasContadas: value.unidadesSueltasContadas, notas: value.notas };
    this.ocupado.set(true); this.mensaje.set('');
    this.inventario.ajustar(insumo.id, body).subscribe({
      next: () => { this.ocupado.set(false); this.seleccionado.set(null); this.mensaje.set('Movimiento registrado'); this.cargar(); this.inventario.recargar(); },
      error: error => { this.ocupado.set(false); this.mensaje.set(errorInventario(error)); this.cargar(); },
    });
  }
}