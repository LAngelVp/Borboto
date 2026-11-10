import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InventarioService, Insumo, ItemSalida, ModoCaptura, OrigenSalida, errorInventario } from '../../core/services/inventario.service';
interface ReconocimientoVoz {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
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
  private readonly destroyRef = inject(DestroyRef);
  private reconocimiento: ReconocimientoVoz | null = null;
  private solicitudPermiso: object | null = null;
  private permisoConcedido = false;
  private servicioNoDisponible = false;
  private destruido = false;
  private finalizacion?: ReturnType<typeof setTimeout>;
  private readonly notaSalida = viewChild<ElementRef<HTMLTextAreaElement>>('notaSalida');
  readonly dictando = signal(false);
  readonly procesandoDictado = signal(false);
  readonly pidiendoPermiso = signal(false);
  readonly guiaDictado = signal('');
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
    this.destroyRef.onDestroy(() => { this.destruido = true; this.liberarDictado(); });
  }
  iniciarDictadoNota(event: PointerEvent | KeyboardEvent) {
    if ('key' in event && ![' ', 'Enter'].includes(event.key)) return;
    if ('button' in event && event.button !== 0) return;
    event.preventDefault();
    if (this.enviando() || this.procesandoDictado() || this.destruido) return;
    const navegador = window as VentanaVoz;
    const Constructor = navegador.SpeechRecognition ?? navegador.webkitSpeechRecognition;
    if (navegador.isSecureContext === false || !Constructor || this.servicioNoDisponible) { this.usarTeclado(); return; }
    const prefijo = this.formulario.controls.notas.value.trimEnd();
    if (prefijo.length >= 255) { this.usarTeclado('La nota tiene 255 caracteres. Puedes editarla aqui.'); return; }
    const solicitud = {};
    this.solicitudPermiso = solicitud;
    this.guiaDictado.set(''); this.dictando.set(true); this.procesandoDictado.set(true); this.pidiendoPermiso.set(true);
    void this.autorizarDictado(Constructor, prefijo, solicitud);
  }
  private async autorizarDictado(Constructor: new () => ReconocimientoVoz, prefijo: string, solicitud: object) {
    try {
      const media = window.navigator?.mediaDevices;
      if (!this.permisoConcedido && typeof media?.getUserMedia === 'function') {
        const stream = await media.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        this.permisoConcedido = true;
      }
      if (this.destruido || this.solicitudPermiso !== solicitud || !this.dictando()) return;
      this.pidiendoPermiso.set(false);
      const reconocimiento = new Constructor();
      this.reconocimiento = reconocimiento;
      reconocimiento.lang = 'es-MX'; reconocimiento.interimResults = true; reconocimiento.continuous = true;
      reconocimiento.onresult = event => {
        if (this.reconocimiento !== reconocimiento) return;
        const transcripcion = Array.from(event.results, resultado => resultado[0]?.transcript.trim() ?? '').filter(Boolean).join(' ');
        const nota = [prefijo, transcripcion].filter(Boolean).join(' ');
        this.formulario.controls.notas.setValue(nota.slice(0, 255));
        if (nota.length > 255) this.guiaDictado.set('La nota tiene 255 caracteres. Puedes editarla al terminar.');
      };
      reconocimiento.onstart = () => {
        if (this.reconocimiento !== reconocimiento || this.dictando()) return;
        try { reconocimiento.stop(); } catch { this.usarTeclado(); }
      };
      reconocimiento.onend = () => { if (this.reconocimiento === reconocimiento) this.liberarDictado(false); };
      reconocimiento.onerror = event => {
        if (this.reconocimiento !== reconocimiento) return;
        if (event.error === 'aborted') { this.liberarDictado(); return; }
        if (event.error === 'network' || event.error === 'service-not-allowed') this.servicioNoDisponible = true;
        this.usarTeclado(event.error === 'not-allowed' ? 'Puedes escribir la nota o usar el microfono de tu teclado si esta disponible.' : undefined);
      };
      reconocimiento.start();
    } catch (error) {
      if (this.destruido || this.solicitudPermiso !== solicitud) return;
      this.usarTeclado();
    }
  }
  private usarTeclado(guia = 'Escribe aqui o usa el microfono de tu teclado si esta disponible.') {
    this.liberarDictado();
    this.guiaDictado.set(guia);
    this.notaSalida()?.nativeElement.focus();
  }
  detenerDictadoNota(event?: PointerEvent | KeyboardEvent) {
    if (event && 'key' in event && ![' ', 'Enter'].includes(event.key)) return;
    event?.preventDefault();
    if (!this.dictando()) return;
    this.dictando.set(false);
    if (!this.reconocimiento) { this.liberarDictado(false); return; }
    const reconocimiento = this.reconocimiento;
    this.finalizacion = setTimeout(() => { if (this.reconocimiento === reconocimiento) this.usarTeclado(); }, 5000);
    try { reconocimiento.stop(); } catch { this.usarTeclado(); }
  }
  private liberarDictado(abortar = true) {
    const reconocimiento = this.reconocimiento;
    clearTimeout(this.finalizacion);
    this.solicitudPermiso = null;
    this.reconocimiento = null;
    this.dictando.set(false); this.procesandoDictado.set(false); this.pidiendoPermiso.set(false);
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