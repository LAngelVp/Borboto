import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InventarioService, Insumo, ItemSalida, ModoCaptura, OrigenSalida, errorInventario } from '../../core/services/inventario.service';
import { NotificationService } from '../../core/services/notification.service';

interface ResultadoVoz { results: ArrayLike<ArrayLike<{ transcript: string }>> }
interface ReconocimientoVoz {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: ResultadoVoz) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type VentanaVoz = Window & {
  SpeechRecognition?: new () => ReconocimientoVoz;
  webkitSpeechRecognition?: new () => ReconocimientoVoz;
};

@Component({
  selector: 'app-inventario', imports: [ReactiveFormsModule, DecimalPipe, MatIconModule],
  templateUrl: './inventario.html', styleUrl: './inventario.scss', changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioComponent {
  readonly inventario = inject(InventarioService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private reconocimiento: ReconocimientoVoz | null = null;
  readonly dictando = signal(false);
  readonly procesandoDictado = signal(false);
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
  constructor() {
    this.buscar.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => this.busqueda.set(value));
    this.destroyRef.onDestroy(() => this.liberarDictado());
  }
  iniciarDictadoNota(event: PointerEvent | KeyboardEvent) {
    if ('key' in event && ![' ', 'Enter'].includes(event.key)) return;
    if ('button' in event && event.button !== 0) return;
    event.preventDefault();
    if (this.enviando() || this.reconocimiento) return;
    const navegador = window as VentanaVoz;
    const Constructor = navegador.SpeechRecognition ?? navegador.webkitSpeechRecognition;
    if (!Constructor) { this.notifications.warning('Este navegador no admite dictado. Puedes escribir la nota con el teclado.'); return; }
    const prefijo = this.formulario.controls.notas.value.trimEnd();
    if (prefijo.length >= 255) { this.notifications.warning('La nota alcanzo el limite de 255 caracteres.'); return; }
    try {
      const reconocimiento = new Constructor();
      this.reconocimiento = reconocimiento;
      reconocimiento.lang = 'es-MX'; reconocimiento.interimResults = true; reconocimiento.continuous = true;
      this.dictando.set(true); this.procesandoDictado.set(true);
      let limiteAvisado = false;
      reconocimiento.onresult = event => {
        if (this.reconocimiento !== reconocimiento) return;
        const transcripcion = Array.from(event.results, resultado => resultado[0]?.transcript.trim() ?? '').filter(Boolean).join(' ');
        const nota = [prefijo, transcripcion].filter(Boolean).join(' ');
        this.formulario.controls.notas.setValue(nota.slice(0, 255));
        if (nota.length > 255 && !limiteAvisado) { limiteAvisado = true; this.notifications.warning('La nota alcanzo el limite de 255 caracteres.'); }
      };
      reconocimiento.onstart = () => {
        if (this.reconocimiento !== reconocimiento || this.dictando()) return;
        try { reconocimiento.stop(); } catch { this.liberarDictado(); }
      };
      reconocimiento.onend = () => { if (this.reconocimiento === reconocimiento) this.liberarDictado(false); };
      reconocimiento.onerror = event => {
        if (this.reconocimiento !== reconocimiento) return;
        if (event.error !== 'aborted') this.notifications.warning(event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'No se autorizo el microfono. Puedes escribir la nota con el teclado.'
          : 'No se pudo completar el dictado. Puedes editar la nota con el teclado.');
        this.liberarDictado();
      };
      reconocimiento.start();
    } catch {
      this.liberarDictado();
      this.notifications.warning('No se pudo iniciar el microfono. Puedes escribir la nota con el teclado.');
    }
  }
  detenerDictadoNota(event?: PointerEvent | KeyboardEvent) {
    if (event && 'key' in event && ![' ', 'Enter'].includes(event.key)) return;
    event?.preventDefault();
    if (!this.dictando()) return;
    this.dictando.set(false);
    try { this.reconocimiento?.stop(); } catch { this.liberarDictado(); }
  }
  private liberarDictado(abortar = true) {
    const reconocimiento = this.reconocimiento;
    this.reconocimiento = null;
    this.dictando.set(false); this.procesandoDictado.set(false);
    if (!reconocimiento) return;
    reconocimiento.onresult = null; reconocimiento.onerror = null; reconocimiento.onend = null; reconocimiento.onstart = null;
    if (abortar) { try { reconocimiento.abort(); } catch { } }
  }
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
    if (this.enviando() || this.procesandoDictado() || this.invalido() || this.formulario.invalid) return;
    this.enviando.set(true); this.mensaje.set('');
    const { origen, notas } = this.formulario.getRawValue();
    this.inventario.salida(origen, this.vale(), notas).subscribe({
      next: () => { this.enviando.set(false); this.vale.set([]); this.formulario.controls.notas.setValue(''); this.mensaje.set('Salida registrada'); this.inventario.recargar(); },
      error: error => { this.enviando.set(false); this.mensaje.set(errorInventario(error)); this.inventario.recargar(); },
    });
  }
}