import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InventarioService, Insumo, ItemSalida, ModoCaptura, OrigenSalida, errorInventario } from '../../core/services/inventario.service';

@Component({
  selector: 'app-inventario', imports: [ReactiveFormsModule, DecimalPipe, MatIconModule],
  templateUrl: './inventario.html', styleUrl: './inventario.scss', changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioComponent {
  readonly inventario = inject(InventarioService);
  readonly areas = ['TODOS', 'ALMACEN', 'COCINA', 'BARRA', 'EMPAQUES', 'LIMPIEZA'];
  readonly area = signal('TODOS');
  readonly guardia = signal(false);
  readonly busqueda = signal('');
  readonly vale = signal<ItemSalida[]>([]);
  readonly enviando = signal(false);
  readonly mensaje = signal('');
  readonly etiquetas = { OK: 'OK', PRECAUCION: 'En precaucion', BAJO_GUARDIA: 'Bajo guardia', SIN_STOCK: 'Agotado' };
  readonly formulario = new FormGroup({
    origen: new FormControl<OrigenSalida>('SALIDA_COCINA', { nonNullable: true }),
    notas: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(255)] }),
  });
  readonly buscar = new FormControl('', { nonNullable: true });
  readonly visibles = computed(() => this.inventario.insumos().filter(insumo =>
    (this.area() === 'TODOS' || insumo.categoria_almacen === this.area()) &&
    (!this.guardia() || insumo.estado_guardia !== 'OK') &&
    `${insumo.nombre} ${insumo.codigo ?? ''}`.toLocaleLowerCase().includes(this.busqueda().trim().toLocaleLowerCase())));
  readonly lineas = computed(() => this.vale().map(item => ({ ...item, insumo: this.inventario.insumos().find(insumo => insumo.id === item.insumoId) })));
  readonly invalido = computed(() => !this.vale().length || this.lineas().some(item => !item.insumo || !Number.isFinite(item.cantidad) || item.cantidad <= 0 || this.restante(item.insumo) < 0));
  constructor() { this.buscar.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.busqueda.set(value)); }
  agregar(insumo: Insumo, modo: ModoCaptura, cantidad = 1) {
    if (this.enviando() || !Number.isFinite(cantidad) || cantidad <= 0) return;
    this.vale.update(items => {
      const existente = items.find(item => item.insumoId === insumo.id && item.modoCaptura === modo);
      return existente ? items.map(item => item === existente ? { ...item, cantidad: +(item.cantidad + cantidad).toFixed(2) } : item)
        : [...items, { insumoId: insumo.id, modoCaptura: modo, cantidad }];
    });
    this.mensaje.set('');
  }
  cambiar(item: ItemSalida, value: string) {
    this.vale.update(items => items.map(row => row.insumoId === item.insumoId && row.modoCaptura === item.modoCaptura ? { ...row, cantidad: Number(value) } : row));
  }
  quitar(item: ItemSalida) { this.vale.update(items => items.filter(row => row.insumoId !== item.insumoId || row.modoCaptura !== item.modoCaptura)); }
  restante(insumo: Insumo) {
    return +(insumo.stock_actual - this.vale().filter(item => item.insumoId === insumo.id).reduce((total, item) => total + item.cantidad * (item.modoCaptura === 'PAQUETE' ? insumo.factor_paquete : 1), 0)).toFixed(2);
  }
  confirmar() {
    if (this.enviando() || this.invalido() || this.formulario.invalid) return;
    this.enviando.set(true); this.mensaje.set('');
    const { origen, notas } = this.formulario.getRawValue();
    this.inventario.salida(origen, this.vale(), notas).subscribe({
      next: () => { this.enviando.set(false); this.vale.set([]); this.formulario.controls.notas.setValue(''); this.mensaje.set('Salida registrada'); this.inventario.recargar(); },
      error: error => { this.enviando.set(false); this.mensaje.set(errorInventario(error)); this.inventario.recargar(); },
    });
  }
}