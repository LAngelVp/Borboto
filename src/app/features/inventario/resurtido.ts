import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { InventarioService, Insumo, ListaResurtido, ModoCaptura, errorInventario } from '../../core/services/inventario.service';
import { SocketService } from '../../core/services/socket.service';
import { filtrarResurtido, sugerirResurtido, exportarExcelResurtido, imprimirResurtido, type FilaResurtido, type FiltroResurtido } from './resurtido-report';

@Component({ selector: 'app-resurtido', imports: [ReactiveFormsModule, MatIconModule, DatePipe, DecimalPipe], templateUrl: './resurtido.html', styleUrl: './resurtido.scss', changeDetection: ChangeDetectionStrategy.OnPush })
export class ResurtidoComponent implements OnInit {
  readonly insumos = input.required<Insumo[]>();
  private readonly inventario = inject(InventarioService);
  private readonly socket = inject(SocketService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly nombreInput = viewChild<ElementRef<HTMLInputElement>>('nombreLista');
  private readonly fb = inject(FormBuilder).nonNullable;
  private lectura?: Subscription;
  readonly abierto = signal(false);
  readonly filas = signal<FilaResurtido[]>([]);
  readonly listas = signal<ListaResurtido[]>([]);
  readonly guardada = signal<ListaResurtido | null>(null);
  readonly recibiendo = signal<ListaResurtido | null>(null);
  readonly compras = signal<FilaResurtido[]>([]);
  readonly ocupado = signal(false);
  readonly mensaje = signal('');
  readonly areas = ['TODAS', 'ALMACEN', 'COCINA', 'BARRA', 'EMPAQUES', 'LIMPIEZA'];
  readonly formulario = this.fb.group({ nombre: ['Lista de Resurtido', [Validators.required, Validators.maxLength(120)]], modo: this.fb.control<FiltroResurtido>('BAJO_GUARDIA'), margen: [0, [Validators.required, Validators.min(0)]], categoria: ['TODAS'], buscar: [''], notas: ['', Validators.maxLength(255)] });
  readonly notaRecepcion = this.fb.control('', Validators.maxLength(255));
  readonly seleccion = signal(this.formulario.getRawValue());
  readonly candidatos = computed(() => filtrarResurtido(this.insumos(), this.seleccion().modo, this.seleccion().margen, this.seleccion().categoria));
  readonly manuales = computed(() => this.insumos().filter(insumo => insumo.activo && `${insumo.nombre} ${insumo.codigo ?? ''}`.toLocaleLowerCase().includes(this.seleccion().buscar.toLocaleLowerCase())));
  readonly pendientes = computed(() => this.listas().filter(lista => lista.estado === 'PENDIENTE'));
  readonly recientes = computed(() => this.listas().filter(lista => lista.estado !== 'PENDIENTE'));
  readonly invalido = computed(() => !this.filas().length || this.filas().some(fila => !this.cantidadValida(fila.cantidad, true)));
  readonly compraInvalida = computed(() => this.compras().some(fila => !this.cantidadValida(fila.cantidad, false)));
  constructor() {
    this.formulario.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const anterior = this.seleccion(), value = this.formulario.getRawValue();
      this.seleccion.set(value);
      if (value.nombre !== anterior.nombre || value.margen !== anterior.margen || value.notas !== anterior.notas) this.guardada.set(null);
    });
    this.destroyRef.onDestroy(() => this.lectura?.unsubscribe());
  }
  ngOnInit() { this.cargar(); this.socket.onEvent<void>('actualizar_inventario').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.cargar()); }
  cargar() {
    this.lectura?.unsubscribe();
    this.lectura = this.inventario.listasResurtido().subscribe({ next: listas => this.listas.set(listas), error: error => this.mensaje.set(errorInventario(error)) });
  }
  private cantidadValida(cantidad: number, positiva: boolean) { return Number.isFinite(cantidad) && cantidad >= (positiva ? 0.01 : 0) && cantidad <= 9999999999.99 && Math.abs(cantidad * 100 - Math.round(cantidad * 100)) < 0.0001; }
  abrir() { this.abierto.set(true); this.mensaje.set(''); afterNextRender(() => this.nombreInput()?.nativeElement.focus(), { injector: this.injector }); }
  agregarFiltrados() { if (this.formulario.controls.margen.invalid) return; this.candidatos().forEach(insumo => this.agregar(insumo)); }
  agregar(insumo: Insumo, recepcion = false) {
    const target = recepcion ? this.compras : this.filas;
    if (this.ocupado() || target().some(fila => fila.insumo.id === insumo.id) || target().length >= 200) return;
    const margen = this.seleccion().modo === 'GUARDIA_MAS_MARGEN' ? this.seleccion().margen : 0;
    target.update(filas => [...filas, sugerirResurtido(insumo, margen)]); this.guardada.set(null);
  }
  cambiar(id: number, cambio: Partial<Pick<FilaResurtido, 'modo' | 'cantidad' | 'comprado'>>, recepcion = false) {
    const target = recepcion ? this.compras : this.filas;
    target.update(filas => filas.map(fila => fila.insumo.id === id ? { ...fila, ...cambio } : fila)); if (!recepcion) this.guardada.set(null);
  }
  quitar(id: number) { this.filas.update(filas => filas.filter(fila => fila.insumo.id !== id)); this.guardada.set(null); }
  equivalente(fila: FilaResurtido) { return +(fila.cantidad * (fila.modo === 'PAQUETE' ? fila.insumo.factor_paquete : 1)).toFixed(2); }
  guardar(accion: 'GUARDAR' | 'EXCEL' | 'PDF') {
    if (this.ocupado() || this.formulario.invalid || this.invalido()) { this.formulario.markAllAsTouched(); return; }
    const popup = accion === 'PDF' ? window.open('', '_blank', 'width=1000,height=700') : null;
    if (accion === 'PDF' && !popup) { this.mensaje.set('El navegador bloqueo la ventana de impresion.'); return; }
    if (popup) popup.opener = null;
    const exportar = (lista: ListaResurtido) => {
      try { if (accion === 'EXCEL') exportarExcelResurtido(lista); if (popup) imprimirResurtido(lista, popup); this.mensaje.set(`${lista.folio} guardada para recibir despues`); }
      catch { popup?.close(); this.mensaje.set(`${lista.folio} esta guardada, pero no se pudo exportar. Puedes reintentar.`); }
    };
    const guardada = this.guardada();
    if (guardada) { exportar(guardada); return; }
    const value = this.formulario.getRawValue();
    this.ocupado.set(true);
    this.inventario.guardarResurtido({ nombre: value.nombre, margenGuardia: value.margen, notas: value.notas,
      items: this.filas().map(fila => ({ insumoId: fila.insumo.id, modoCaptura: fila.modo, cantidadSugerida: fila.cantidad })) }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: lista => { this.ocupado.set(false); this.guardada.set(lista); this.cargar(); exportar(lista); },
      error: error => { this.ocupado.set(false); popup?.close(); this.mensaje.set(errorInventario(error)); },
    });
  }
  revisar(lista: ListaResurtido) {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.inventario.detalleResurtido(lista.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: detalle => { this.ocupado.set(false); this.recibiendo.set(detalle); this.notaRecepcion.setValue(''); this.compras.set(detalle.items.map(item => ({ insumo: item.insumo, modo: item.modo_captura, cantidad: item.cantidad_sugerida, comprado: true }))); },
      error: error => { this.ocupado.set(false); this.mensaje.set(errorInventario(error)); },
    });
  }
  recibir(lista: ListaResurtido, modo: 'TODO' | 'PARCIAL') {
    if (this.ocupado() || (modo === 'PARCIAL' && (this.compraInvalida() || this.notaRecepcion.invalid))) return;
    this.ocupado.set(true);
    this.inventario.recibirResurtido(lista.id, modo === 'TODO' ? { modo } : { modo, notas: this.notaRecepcion.value,
      items: this.compras().map(fila => ({ insumoId: fila.insumo.id, comprado: fila.comprado, modoCaptura: fila.modo, cantidadComprada: fila.cantidad })) }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.ocupado.set(false); this.recibiendo.set(null); this.mensaje.set(`${lista.folio}: compra recibida`); this.cargar(); this.inventario.recargar(); },
      error: error => { this.ocupado.set(false); this.mensaje.set(errorInventario(error)); this.cargar(); },
    });
  }
  cancelar(lista: ListaResurtido) {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.inventario.cancelarResurtido(lista.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.ocupado.set(false); this.mensaje.set(`${lista.folio} cancelada`); this.cargar(); }, error: error => { this.ocupado.set(false); this.mensaje.set(errorInventario(error)); },
    });
  }
}