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
  onerror: ((event: { error: string; mensaje?: string }) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type VentanaVoz = Window & {
  SpeechRecognition?: new () => ReconocimientoVoz;
  webkitSpeechRecognition?: new () => ReconocimientoVoz;
};

interface PuenteDictado {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, callback: (event: unknown, payload: unknown) => void): () => void;
}
class ReconocimientoWindows implements ReconocimientoVoz {
  private static secuencia = 0;
  private readonly id = `voz-${Date.now()}-${++ReconocimientoWindows.secuencia}`;
  private retirarListener?: () => void;
  private activo = false;
  lang = 'es-MX'; interimResults = true; continuous = true;
  onresult: ReconocimientoVoz['onresult'] = null;
  onerror: ReconocimientoVoz['onerror'] = null;
  onend: ReconocimientoVoz['onend'] = null;
  onstart: ReconocimientoVoz['onstart'] = null;
  constructor(private readonly puente: PuenteDictado) {}
  start() {
    this.activo = true;
    this.retirarListener = this.puente.on('dictado-resultado', (_event, payload) => {
      if (!this.activo || !payload || typeof payload !== 'object' || !('id' in payload) || payload.id !== this.id || !('tipo' in payload)) return;
      if (payload.tipo === 'listo') this.onstart?.();
      else if (payload.tipo === 'texto' && 'texto' in payload && typeof payload.texto === 'string') this.onresult?.({ results: [[{ transcript: payload.texto }]] });
      else if (payload.tipo === 'error') this.fallar('error' in payload && typeof payload.error === 'string' ? payload.error : 'El motor local no pudo completar el dictado.');
      else if (payload.tipo === 'fin') { this.finalizar(); this.onend?.(); }
    });
    this.invocar('dictado-iniciar');
  }
  stop() { if (this.activo) this.invocar('dictado-detener'); }
  abort() {
    const activo = this.activo;
    this.finalizar();
    if (activo) void this.puente.invoke('dictado-cancelar', { id: this.id }).catch(() => {});
  }
  private invocar(canal: string) {
    void this.puente.invoke(canal, { id: this.id }).then(result => {
      if (!this.activo) return;
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) this.fallar(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'El puente de dictado local no esta disponible. Actualiza la aplicacion instalada.');
    }).catch(() => { if (this.activo) this.fallar('No se pudo comunicar con el motor local. Actualiza la aplicacion instalada.'); });
  }
  private fallar(mensaje: string) {
    this.onerror?.({ error: 'native', mensaje });
    this.abort();
  }
  private finalizar() { this.activo = false; this.retirarListener?.(); this.retirarListener = undefined; }
}

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
    const puente = navegador.borbotoElectron;
    if (!puente && navegador.isSecureContext === false) {
      this.notifications.warning('El dictado requiere HTTPS o localhost. En una direccion HTTP de la red local puedes seguir escribiendo con el teclado.');
      return;
    }
    const Constructor = navegador.SpeechRecognition ?? navegador.webkitSpeechRecognition;
    if (!puente && !Constructor) { this.notifications.warning('Este navegador no admite dictado. Puedes escribir la nota con el teclado.'); return; }
    const prefijo = this.formulario.controls.notas.value.trimEnd();
    if (prefijo.length >= 255) { this.notifications.warning('La nota alcanzo el limite de 255 caracteres.'); return; }
    try {
      const reconocimiento: ReconocimientoVoz = puente ? new ReconocimientoWindows(puente) : new Constructor!();
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
        if (event.error !== 'aborted') this.notifications.warning(event.error === 'native' && event.mensaje ? event.mensaje : this.mensajeErrorDictado(event.error));
        this.liberarDictado();
      };
      reconocimiento.start();
    } catch (error) {
      this.liberarDictado();
      const nombre = error instanceof Error ? error.name : '';
      this.notifications.warning(nombre === 'NotAllowedError' ? this.mensajeErrorDictado('not-allowed')
        : nombre === 'NotFoundError' || nombre === 'NotReadableError' ? this.mensajeErrorDictado('audio-capture')
        : 'No se pudo iniciar el microfono. Puedes escribir la nota con el teclado.');
    }
  }
  private mensajeErrorDictado(codigo: string): string {
    switch (codigo) {
      case 'network': return 'El servicio de dictado no esta disponible. Revisa Internet; en Electron puede no estar habilitado. Prueba en Chrome o Edge con HTTPS o localhost.';
      case 'audio-capture': return 'No se pudo acceder al microfono. Revisa que este conectado, seleccionado y disponible en los ajustes de audio del dispositivo.';
      case 'no-speech': return 'No se detecto voz. Manten presionado el microfono y habla cerca de el; despues suelta para terminar.';
      case 'not-allowed': return 'No se autorizo el microfono. Habilita su permiso en el navegador y en los ajustes de privacidad del dispositivo, o usa el teclado.';
      case 'service-not-allowed': return 'El navegador no permite usar el servicio de dictado. Prueba en Chrome o Edge con HTTPS o localhost; puedes seguir usando el teclado.';
      case 'language-not-supported': return 'El servicio de dictado no admite es-MX en este dispositivo. Puedes escribir la nota con el teclado.';
      default: return `No se pudo completar el dictado (${codigo.replace(/[^a-z-]/g, '').slice(0, 40) || 'error desconocido'}). Puedes editar la nota con el teclado.`;
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