import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
  NgZone,
  SecurityContext,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { BillingComponent } from '../../features/billing-component/billing-component';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import {
  AjustesService,
  CategoriaAdmin,
  ProductoAdmin,
  MesaAdmin,
  ZonaAdmin,
  DatosNegocio,
  DatosTransferencia,
  Cliente,
  Promocion,
} from '../../core/services/ajustes.service';
import { AuthService } from '../../core/services/auth.service';
import { CajaService } from '../../core/services/caja-service';
import { NotificationService } from '../../core/services/notification.service';
import { PrinterService, Impresora, WindowsPrinterInfo } from '../../core/services/printer.service';
import { RuntimeConfigService } from '../../core/services/runtime-config.service';
import { UpdateService } from '../../core/services/update.service';
import * as XLSX from 'xlsx';
import { InventarioAdminComponent } from '../inventario/inventario-admin';

declare var window: any;

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSnackBarModule,
    MatProgressBarModule,
    BillingComponent,
    InventarioAdminComponent,
  ],
  templateUrl: './ajustes.html',
  styleUrl: './ajustes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AjustesComponent implements OnInit {
  private readonly ajustesService = inject(AjustesService);
  private readonly cajaService = inject(CajaService);
  protected readonly authService = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly http = inject(HttpClient);
  private readonly printerService = inject(PrinterService);
  private readonly runtimeConfig = inject(RuntimeConfigService);
  private readonly updateService = inject(UpdateService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly zone = inject(NgZone); // 👈 Forzar actualización fuera del evento IPC

  private get API_URL() {
    return this.runtimeConfig.apiBaseUrl.replace(/\/api$/, '');
  }

  readonly categorias = signal<CategoriaAdmin[]>([]);
  readonly productos = signal<ProductoAdmin[]>([]);
  readonly zonas = signal<ZonaAdmin[]>([]);
  readonly mesas = signal<MesaAdmin[]>([]);
  readonly clientes = signal<Cliente[]>([]);
  readonly empleados = signal<any[]>([]);
  readonly cortesHistory = signal<any[]>([]);
  readonly impresoras = signal<Impresora[]>([]);
  readonly impresorasWindows = signal<WindowsPrinterInfo[]>([]);

  // 🔹 ESTADOS Y SIGNALS DE LICENCIA
  readonly infoLicencia = signal<{
    valida: boolean;
    cliente?: string;
    vencimiento?: string;
    diasRestantes?: number;
    motivo?: string;
  } | null>(null);

  readonly hardwareIdLocal = signal<string>('OBTENIENDO...');
  nuevaClaveLicencia: string = '';
  cargandoLicencia: boolean = false;

  // 🔹 ESTADO DEL ACTUALIZADOR AUTOMÁTICO
  readonly updateState = this.updateService.state;
  readonly updateDisponibleEnElectron = this.updateService.isElectron;
  readonly actualizacionEnProceso = this.updateService.busy;
  readonly canCheck = this.updateService.canCheck;
  readonly canDownload = this.updateService.canDownload;
  readonly canInstall = this.updateService.canInstall;

  // Las notas de GitHub llegan como HTML (<h3>, <ul>, <strong>, <code>...).
  // Se sanitizan antes de exponerlas a [innerHTML] para eliminar contenido inseguro.
  readonly releaseNotesHtml = computed<string | null>(() => {
    const notas = this.updateState().releaseNotes;
    if (!notas) {
      return null;
    }

    return this.sanitizer.sanitize(SecurityContext.HTML, notas);
  });

  nuevaImpresora: Impresora = {
    nombre: '',
    destino: 'COCINA',
    tipo: 'SIMULACION',
    ip_o_puerto: '192.168.1.100',
    puerto_tcp: 9100,
    ancho_papel: '80mm',
    es_termica: false,
    corte_tipo: 'NINGUNO',
    tamano_fuente: 'NORMAL',
    activa: true,
  };

  nuevoProducto: ProductoAdmin = {
    categoria_id: 0,
    nombre: '',
    precio: 0,
    disponible: true,
    imagen_url: '',
    clave_sat: '',
  };

  nuevaCategoria: CategoriaAdmin = {
    nombre: '',
    icono: 'restaurant',
    orden: 0,
    destino_impresion: 'COCINA',
  };

  nuevaZonaNombre = signal<string>('');

  nuevaMesa: MesaAdmin = {
    numero: '',
    zona_id: 0,
    capacidad: 4,
  };

  datosNegocio: DatosNegocio = {
    nombre: '',
    rfc: '',
    telefono: '',
    direccion: '',
    email: '',
    mensaje_recibo: '',
    visitas_requeridas_frecuente: 5,
    puntos_por_cada_diez_pesos: 1,
    pesos_por_punto: 10,
    logo_url: null,
    imprimir_logo: false,
  };

  datosTransferencia: DatosTransferencia = {
    banco: '',
    titular: '',
    clabe: '',
    email: '',
  };

  nuevoCliente: Cliente = {
    nombre: '',
    telefono: '',
    direccion: '',
    email: '',
    notas: '',
  };

  readonly promociones = signal<Promocion[]>([]);
  nuevaPromocion: Promocion = {
    nombre: '',
    codigo: '',
    tipo: 'DESCUENTO_PORCENTAJE',
    valor: 0,
    aplica_a: 'TOTAL_ORDEN',
    categoria_id: null,
    producto_id: null,
    descripcion: '',
    activo: true,
  };

  nuevoEmpleado = {
    nombre: '',
    pin: '',
    rol: 'MESERO',
    activo: true,
  };

  productoEditando = signal<ProductoAdmin | null>(null);
  categoriaEditando = signal<CategoriaAdmin | null>(null);
  mesaEditando = signal<MesaAdmin | null>(null);
  zonaEditando = signal<ZonaAdmin | null>(null);
  clienteEditando = signal<Cliente | null>(null);
  promocionEditando = signal<Promocion | null>(null);
  empleadoEditando = signal<any | null>(null);
  impresoraEditando = signal<Impresora | null>(null);

  ngOnInit() {
    this.cargarDatosFormularios();
    this.cargarImpresorasWindows();
    this.consultarEstadoLicencia();
  }

  private cargarDatosFormularios() {
    this.cargarCategorias();
    this.cargarProductos();
    this.cargarZonas();
    this.cargarMesas();
    this.cargarClientes();
    this.cargarPromociones();
    this.cargarEmpleados();
    this.cargarHistorialCortes();
    this.cargarDatosAdicionales();
    this.cargarImpresoras();
  }

  // 🔹 CONTROL Y RENOVACIÓN DE LICENCIA (IPC + NGZONE)
  async consultarEstadoLicencia() {
    if (window.borbotoElectron || window.require) {
      try {
        const ipcRenderer = window.borbotoElectron || window.require('electron').ipcRenderer;

        // 1. Consultar Hardware ID y Estado
        const hwId = await ipcRenderer.invoke('get-hardware-id');
        const status = await ipcRenderer.invoke('get-license-status');

        // 2. 💡 Forzar renderizado inmediato dentro de NgZone
        this.zone.run(() => {
          this.hardwareIdLocal.set(hwId || 'NO_DISPONIBLE');
          this.infoLicencia.set(status);
        });
      } catch (err) {
        console.error('Error al conectar con Electron IPC:', err);
      }
    } else {
      this.zone.run(() => {
        this.hardwareIdLocal.set('NO_DISPONIBLE');
        this.infoLicencia.set({
          valida: false,
          motivo: 'Consulte la licencia en la estacion principal',
        });
      });
    }
  }

  renovarLicencia() {
    const clave = this.nuevaClaveLicencia.trim();
    if (!clave) {
      this.notifications.warning('Ingresa una clave de licencia válida.');
      return;
    }

    if (!window.borbotoElectron && !window.require) {
      this.notifications.warning('Esta función requiere ejecutarse dentro de Electron.');
      return;
    }

    this.cargandoLicencia = true;
    const ipcRenderer = window.borbotoElectron || window.require('electron').ipcRenderer;

    ipcRenderer.once(
      'submit-license-key-response',
      (_: any, res: { success: boolean; error?: string }) => {
        this.zone.run(() => {
          this.cargandoLicencia = false;
          if (res.success) {
            this.notifications.success('Licencia renovada y activada correctamente.', 5000);
            this.nuevaClaveLicencia = '';
            this.consultarEstadoLicencia();
          } else {
            this.notifications.error(
              `Fallo al aplicar la licencia: ${res.error || 'Clave inválida'}`,
              6000,
            );
          }
        });
      },
    );

    ipcRenderer.send('submit-license-key', clave);
  }

  copiarHardwareId() {
    navigator.clipboard.writeText(this.hardwareIdLocal());
    this.notifications.info('Hardware ID copiado al portapapeles.', 2000);
  }

  // 🔹 ACTUALIZACIONES DEL SISTEMA

  async buscarActualizaciones() {
    console.log('[UPDATER] Acción de UI: buscar actualizaciones');
    const resultado = await this.updateService.checkForUpdates();
    console.log('[UPDATER] Resultado de UI al buscar actualizaciones', {
      ok: resultado.ok,
      status: this.updateState().status,
      message: resultado.message,
      detail: resultado.detail,
    });

    if (resultado.ok === false) {
      this.notifications.warning(
        resultado.message || 'No se pudo buscar actualizaciones en este momento.',
        5000,
      );
      return;
    }

    const estado = this.updateState();
    if (estado.status === 'available') {
      this.notifications.info(
        `Nueva versión disponible: ${estado.availableVersion || 'desconocida'}.`,
        5000,
      );
    } else if (estado.status === 'not-available') {
      this.notifications.success('Ya tienes instalada la versión más reciente del sistema.', 4000);
    }
  }

  async descargarActualizacion() {
    console.log('[UPDATER] Acción de UI: descargar actualización');
    const resultado = await this.updateService.downloadUpdate();
    console.log('[UPDATER] Resultado de UI al descargar actualización', {
      ok: resultado.ok,
      status: this.updateState().status,
      message: resultado.message,
      detail: resultado.detail,
    });

    if (resultado.ok === false) {
      this.notifications.warning(
        resultado.message || 'No se pudo descargar la actualización.',
        5000,
      );
      return;
    }

    if (this.updateState().status === 'downloaded') {
      this.notifications.success('Actualización descargada y lista para instalarse.', 4000);
    }
  }

  reiniciarYActualizar() {
    console.log('[UPDATER] Acción de UI: reiniciar y actualizar');
    this.notifications.confirmAction(
      'La aplicación se cerrará para instalar la actualización. ¿Deseas continuar?',
      'Reiniciar y actualizar',
      () => {
        void this.ejecutarInstalacion();
      },
    );
  }

  private async ejecutarInstalacion() {
    console.log('[UPDATER] Confirmación aceptada: iniciando instalación');
    const resultado = await this.updateService.quitAndInstall();
    if (resultado.ok === false) {
      console.warn('[UPDATER] No se pudo iniciar la instalación', {
        message: resultado.message,
        detail: resultado.detail,
      });
      this.notifications.error(
        resultado.message || 'No se pudo iniciar la instalación de la actualización.',
        5000,
      );
    }
  }

  progresoActualizacion(): number {
    const progreso = this.updateState().progress;
    return Math.min(100, Math.max(0, Math.round(progreso?.percent ?? 0)));
  }

  formatearTamano(bytes: number | undefined): string {
    const valor = Number(bytes) || 0;
    if (valor <= 0) return '0 MB';
    const mb = valor / (1024 * 1024);
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  }

  etiquetaVersionDisponible(): string {
    const estado = this.updateState();
    if (estado.availableVersion) return estado.availableVersion;
    if (estado.status === 'not-available') return 'Sin novedades';
    if (estado.status === 'error') return 'No disponible';
    return 'Sin comprobar';
  }

  etiquetaEstadoActualizacion(): string {
    switch (this.updateState().status) {
      case 'checking':
        return 'Buscando actualizaciones...';
      case 'available':
        return 'Actualización disponible';
      case 'not-available':
        return 'Sistema actualizado';
      case 'downloading':
        return 'Descargando actualización...';
      case 'downloaded':
        return 'Lista para instalar';
      case 'error':
        return 'Error de actualización';
      case 'unavailable':
        return 'No disponible';
      default:
        return 'Listo para comprobar';
    }
  }

  cargarHistorialCortes() {
    this.cajaService.obtenerHistorialCortes().subscribe({
      next: (data) => this.cortesHistory.set(data),
      error: (err) => console.error('Error al cargar historial de cortes:', err),
    });
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('imagen', file);

    this.http.post<{ url: string }>(`${this.API_URL}/api/productos/upload`, formData).subscribe({
      next: (res) => {
        const prod = this.productoEditando();
        if (prod) {
          this.productoEditando.set({
            ...prod,
            imagen_url: res.url,
          });
        } else {
          this.nuevoProducto.imagen_url = res.url;
        }
        this.notifications.success('Imagen subida correctamente al servidor.', 2000);
      },
      error: (err) => {
        this.notifications.error(err.error?.error || 'Error al subir la imagen al servidor.');
      },
    });
  }

  obtenerUrlImagen(url?: string | null): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  limpiarImagen() {
    const editando = this.productoEditando();
    if (editando) {
      this.productoEditando.set({
        ...editando,
        imagen_url: '',
      });
    } else {
      this.nuevoProducto.imagen_url = '';
    }
  }

  private cargarCategorias() {
    this.ajustesService.getCategorias().subscribe({
      next: (data) => {
        this.categorias.set(data);
        if (data.length > 0 && !this.nuevoProducto.categoria_id) {
          this.nuevoProducto.categoria_id = data[0].id!;
        }
      },
      error: (err) => {
        const mensaje = err?.error?.error || 'Error al cargar las categorías.';
        this.notifications.error(mensaje);
        console.error('Error al cargar categorías:', err);
      },
    });
  }

  private cargarProductos() {
    this.ajustesService.getAdminProductos().subscribe({
      next: (data) => this.productos.set(data),
      error: (err) => {
        const mensaje = err?.error?.error || 'Error al cargar los productos de administración.';
        this.notifications.error(mensaje);
        console.error('Error al cargar productos de administración:', err);
      },
    });
  }

  private cargarZonas() {
    this.ajustesService.getZonas().subscribe({
      next: (data) => {
        this.zonas.set(data);
        if (data.length > 0 && !this.nuevaMesa.zona_id) {
          this.nuevaMesa.zona_id = data[0].id!;
        }
      },
      error: (err) => console.error('Error al cargar zonas:', err),
    });
  }

  private cargarMesas() {
    this.ajustesService.getAdminMesas().subscribe({
      next: (data) => this.mesas.set(data.filter(mesa =>
        Number.isInteger(mesa.id) && (mesa.id ?? 0) > 0 && Number.isInteger(mesa.zona_id) && mesa.zona_id > 0,
      )),
      error: (err) => console.error('Error al cargar mesas:', err),
    });
  }

  private cargarClientes() {
    this.ajustesService.getClientes().subscribe({
      next: (data) => this.clientes.set(data),
      error: (err) => console.error('Error al cargar directorio de clientes:', err),
    });
  }

  private cargarPromociones() {
    this.ajustesService.getPromociones().subscribe({
      next: (data) => this.promociones.set(data),
      error: (err) => console.error('Error al cargar promociones:', err),
    });
  }

  private cargarEmpleados() {
    this.authService.getUsuarios().subscribe({
      next: (data) => this.empleados.set(data),
      error: (err) => console.error('Error al cargar empleados:', err),
    });
  }

  private cargarDatosAdicionales() {
    this.ajustesService.getDatosNegocio().subscribe({
      next: (data) => {
        if (data && data.nombre) {
          this.datosNegocio = { ...data };
        }
      },
      error: (err) => console.error('Error al cargar datos del negocio:', err),
    });

    this.ajustesService.getDatosTransferencia().subscribe({
      next: (data) => {
        if (data && data.banco) {
          this.datosTransferencia = { ...data };
        }
      },
      error: (err) => console.error('Error al cargar datos de transferencia:', err),
    });
  }

  onFileSelectedImportarProductos(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const file = target.files[0];
    const reader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const productosRaw: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (productosRaw.length === 0) {
          this.notifications.warning('El archivo no contiene registros.');
          return;
        }

        const productosProcesados = productosRaw
          .map((row) => ({
            nombre: row.Nombre || row.nombre || '',
            categoria: row.Categoria || row.categoria || 'General',
            precio: Number(row.Precio || row.precio || 0),
            disponible:
              row.Disponible !== undefined
                ? String(row.Disponible).toLowerCase() !== 'false' && row.Disponible !== 0
                : true,
            clave_sat: row.ClaveSAT || row.clave_sat || null,
          }))
          .filter((p) => p.nombre.trim().length > 0 && p.precio >= 0);

        if (productosProcesados.length === 0) {
          this.notifications.warning('No se encontraron productos válidos en el archivo.');
          return;
        }

        this.importarProductosLote(productosProcesados);
      } catch (err) {
        console.error('Error leyendo archivo Excel/CSV:', err);
        this.notifications.error(
          'Error al leer el archivo. Asegúrate de que sea un formato válido (.xlsx, .csv).',
          4000,
        );
      } finally {
        target.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  }

  private importarProductosLote(productos: any[]) {
    this.http
      .post<{ agregados: number }>(`${this.API_URL}/api/productos/importar-lote`, {
        productos,
      })
      .subscribe({
        next: (res) => {
          this.notifications.success(`Se importaron ${res.agregados} productos con éxito.`, 4000);
          this.cargarProductos();
        },
        error: (err) => {
          console.error('Error al importar lote:', err);
          this.notifications.error(
            'Error al guardar los productos importados en la base de datos.',
            4000,
          );
        },
      });
  }

  descargarPlantillaEjemplo() {
    const contenidoCsv =
      'Nombre,Categoria,Precio,Disponible,ClaveSAT\nTacos al Pastor,Entradas,25.00,true,01010101\nRefresco 600ml,Bebidas,30.00,true,01010101';
    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_productos_borboto.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- CRUD PRODUCTOS ---

  guardarProducto() {
    this.ajustesService.crearProducto(this.nuevoProducto).subscribe({
      next: (p) => {
        this.notifications.success(`Producto "${p.nombre}" registrado exitosamente.`);
        this.nuevoProducto = {
          categoria_id: this.categorias()[0]?.id || 0,
          nombre: '',
          precio: 0,
          disponible: true,
          imagen_url: '',
          clave_sat: '',
        };
        this.cargarProductos();
      },
      error: (err) =>
        this.notifications.error(
          err?.error?.error || 'Error al intentar crear el producto.',
          6000,
        ),
    });
  }

  habilitarEdicionProducto(p: any) {
    const imagenNormalizada = p.imagen_url || p.imagen || p.imagenUrl || '';
    this.productoEditando.set({
      ...p,
      imagen_url: imagenNormalizada,
    });
  }

  guardarEdicionProducto() {
    const editado = this.productoEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarProducto(editado.id, editado).subscribe({
      next: (p) => {
        this.notifications.success(`Producto "${p.nombre}" actualizado correctamente.`);
        this.productoEditando.set(null);
        this.cargarProductos();
      },
      error: (err) =>
        this.notifications.error(
          err?.error?.error || 'Error al intentar actualizar el producto.',
          6000,
        ),
    });
  }

  eliminarProducto(id: number) {
    this.notifications.confirmAction(
      'Eliminar producto. Si tiene historial, se desactivará del menú.',
      'Eliminar',
      () => {
        this.ajustesService.eliminarProducto(id).subscribe({
          next: (res) => {
            this.notifications.success(res.mensaje);
            this.cargarProductos();
          },
          error: (err) => {
            this.notifications.error(err.error?.error || 'Error al intentar eliminar el producto.');
          },
        });
      },
    );
  }

  cancelarEdicionProducto() {
    this.productoEditando.set(null);
  }

  // --- CRUD CATEGORÍAS ---

  guardarCategoria() {
    this.ajustesService.crearCategoria(this.nuevaCategoria).subscribe({
      next: (cat) => {
        this.notifications.success(`Categoría "${cat.nombre}" agregada al sistema.`);
        this.nuevaCategoria = {
          nombre: '',
          icono: 'restaurant',
          orden: 0,
          destino_impresion: 'COCINA',
        };
        this.cargarCategorias();
        this.cargarProductos();
      },
      error: () => this.notifications.error('Error al intentar dar de alta la categoría.'),
    });
  }

  habilitarEdicionCategoria(cat: CategoriaAdmin) {
    this.categoriaEditando.set({
      ...cat,
      destino_impresion: cat.destino_impresion || 'COCINA',
    });
  }

  guardarEdicionCategoria() {
    const editado = this.categoriaEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarCategoria(editado.id, editado).subscribe({
      next: (cat) => {
        this.notifications.success(`Categoría "${cat.nombre}" actualizada.`);
        this.categoriaEditando.set(null);
        this.cargarCategorias();
        this.cargarProductos();
      },
      error: () => this.notifications.error('Error al actualizar la categoría.'),
    });
  }

  eliminarCategoria(id: number) {
    this.notifications.confirmAction(
      'Eliminar categoría. Solo procede si no contiene productos.',
      'Eliminar',
      () => {
        this.ajustesService.eliminarCategoria(id).subscribe({
          next: (res) => {
            this.notifications.success(res.mensaje);
            this.cargarCategorias();
          },
          error: (err) => {
            this.notifications.error(
              err.error?.error || 'Error al intentar eliminar la categoría.',
            );
          },
        });
      },
    );
  }

  cancelarEdicionCategoria() {
    this.categoriaEditando.set(null);
  }

  // --- CRUD ZONAS ---

  guardarZona() {
    const nombre = this.nuevaZonaNombre().trim();
    if (!nombre) return;

    this.ajustesService.crearZona({ nombre }).subscribe({
      next: (z) => {
        this.notifications.success(`Zona "${z.nombre}" creada correctamente para el salón.`);
        this.nuevaZonaNombre.set('');
        this.cargarZonas();
      },
      error: () =>
        this.notifications.error('Error al crear la zona. Valida que no esté duplicada.'),
    });
  }

  habilitarEdicionZona(z: ZonaAdmin) {
    this.zonaEditando.set({ ...z });
  }

  guardarEdicionZona() {
    const editado = this.zonaEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarZona(editado.id, { nombre: editado.nombre }).subscribe({
      next: (z) => {
        this.notifications.success(`Zona actualizada a "${z.nombre}".`);
        this.zonaEditando.set(null);
        this.cargarZonas();
        this.cargarMesas();
      },
      error: () => this.notifications.error('Error al actualizar la zona.'),
    });
  }

  eliminarZona(id: number) {
    this.notifications.confirmAction(
      'Eliminar zona. Solo procede si no tiene mesas asignadas.',
      'Eliminar',
      () => {
        this.ajustesService.eliminarZona(id).subscribe({
          next: (res) => {
            this.notifications.success(res.mensaje);
            this.cargarZonas();
          },
          error: (err) => {
            this.notifications.error(err.error?.error || 'Error al eliminar zona.');
          },
        });
      },
    );
  }

  cancelarEdicionZona() {
    this.zonaEditando.set(null);
  }

  // --- CRUD MESAS ---

  guardarMesa() {
    this.ajustesService.crearMesa(this.nuevaMesa).subscribe({
      next: (m) => {
        this.notifications.success(`Mesa ${m.numero} dada de alta correctamente.`);
        this.nuevaMesa = {
          numero: '',
          zona_id: this.zonas()[0]?.id || 0,
          capacidad: 4,
        };
        this.cargarMesas();
      },
      error: () =>
        this.notifications.error(
          'Error al guardar la mesa. Asegúrate de que no esté duplicada en la misma zona.',
        ),
    });
  }

  habilitarEdicionMesa(m: MesaAdmin) {
    if (!m.id || m.id <= 0 || !Number.isInteger(m.zona_id) || m.zona_id <= 0) return;
    this.mesaEditando.set({ ...m });
  }

  guardarEdicionMesa() {
    const editado = this.mesaEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarMesa(editado.id, editado).subscribe({
      next: (m) => {
        this.notifications.success(`Mesa "${m.numero}" guardada exitosamente.`);
        this.mesaEditando.set(null);
        this.cargarMesas();
      },
      error: () => this.notifications.error('Error al modificar la mesa. Valida duplicados.'),
    });
  }

  eliminarMesa(id: number) {
    this.notifications.confirmAction('Eliminar mesa del catálogo.', 'Eliminar', () => {
      this.ajustesService.eliminarMesa(id).subscribe({
        next: (res) => {
          this.notifications.success(res.mensaje);
          this.cargarMesas();
        },
        error: (err) => {
          this.notifications.error(err.error?.error || 'La mesa no puede borrarse por historial.');
        },
      });
    });
  }

  cancelarEdicionMesa() {
    this.mesaEditando.set(null);
  }

  // --- UPSERTS CONFIGURACIÓN ---

  guardarNegocio() {
    this.ajustesService.guardarDatosNegocio(this.datosNegocio).subscribe({
      next: () => {
        this.notifications.success('Datos comerciales actualizados en los recibos.');
      },
      error: () =>
        this.notifications.error('No fue posible actualizar la información del negocio.'),
    });
  }

  urlLogoNegocio(): string {
    const url = this.datosNegocio.logo_url;
    return url ? `${this.API_URL}${url}` : '';
  }

  subirLogoNegocio(event: Event) {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    if (!['image/png', 'image/jpeg'].includes(archivo.type)) {
      this.notifications.error('El logotipo debe ser PNG o JPG.');
      input.value = '';
      return;
    }
    if (archivo.size > 2 * 1024 * 1024) {
      this.notifications.error('El logotipo no debe superar 2 MB.');
      input.value = '';
      return;
    }

    this.ajustesService.subirLogoNegocio(archivo).subscribe({
      next: (res) => {
        this.datosNegocio.logo_url = res.logo_url;
        this.datosNegocio.imprimir_logo = true;
        this.guardarNegocio();
        this.notifications.success('Logotipo cargado correctamente.');
      },
      error: (err) => {
        this.notifications.error(err?.error?.error || 'No se pudo cargar el logotipo.');
      },
    });
    input.value = '';
  }

  eliminarLogoNegocio() {
    this.ajustesService.eliminarLogoNegocio().subscribe({
      next: () => {
        this.datosNegocio.logo_url = null;
        this.datosNegocio.imprimir_logo = false;
        this.notifications.success('Logotipo eliminado.');
      },
      error: () => this.notifications.error('No se pudo eliminar el logotipo.'),
    });
  }

  guardarTransferencia() {
    this.ajustesService.guardarDatosTransferencia(this.datosTransferencia).subscribe({
      next: () => {
        this.notifications.success('Ajustes de cuenta de transferencia grabados.');
      },
      error: () => this.notifications.error('Error al guardar la configuración de transferencia.'),
    });
  }

  // --- CRUD CLIENTES ---

  guardarCliente() {
    this.ajustesService.crearCliente(this.nuevoCliente).subscribe({
      next: (cli) => {
        this.notifications.success(`Cliente "${cli.nombre}" registrado.`);
        this.nuevoCliente = {
          nombre: '',
          telefono: '',
          direccion: '',
          email: '',
          notas: '',
        };
        this.cargarClientes();
      },
      error: () => this.notifications.error('Error al ingresar el cliente a la libreta.'),
    });
  }

  habilitarEdicionCliente(cli: Cliente) {
    this.clienteEditando.set({ ...cli });
  }

  guardarEdicionCliente() {
    const editado = this.clienteEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarCliente(editado.id, editado).subscribe({
      next: (cli) => {
        this.notifications.success(`Cliente "${cli.nombre}" actualizado en el directorio.`);
        this.clienteEditando.set(null);
        this.cargarClientes();
      },
      error: () => this.notifications.error('No se pudo guardar la información del cliente.'),
    });
  }

  eliminarCliente(id: number) {
    this.notifications.confirmAction('Eliminar cliente del directorio.', 'Eliminar', () => {
      this.ajustesService.eliminarCliente(id).subscribe({
        next: (res) => {
          this.notifications.success(res.mensaje);
          this.cargarClientes();
        },
        error: () => this.notifications.error('Error al eliminar cliente.'),
      });
    });
  }

  cancelarEdicionCliente() {
    this.clienteEditando.set(null);
  }

  // --- CRUD PROMOCIONES ---

  guardarPromocion() {
    this.ajustesService.crearPromocion(this.nuevaPromocion).subscribe({
      next: (p) => {
        this.notifications.success(`Promoción "${p.nombre}" guardada con éxito.`);
        this.nuevaPromocion = {
          nombre: '',
          codigo: '',
          tipo: 'DESCUENTO_PORCENTAJE',
          valor: 0,
          aplica_a: 'TOTAL_ORDEN',
          categoria_id: null,
          producto_id: null,
          descripcion: '',
          activo: true,
        };
        this.cargarPromociones();
      },
      error: () =>
        this.notifications.error('Error al guardar la promoción. Valide el código único.'),
    });
  }

  habilitarEdicionPromocion(p: Promocion) {
    this.promocionEditando.set({
      ...p,
      aplica_a: 'TOTAL_ORDEN',
      categoria_id: null,
      producto_id: null,
    });
  }

  guardarEdicionPromocion() {
    const editado = this.promocionEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarPromocion(editado.id, editado).subscribe({
      next: (p) => {
        this.notifications.success(`Promoción "${p.nombre}" actualizada.`);
        this.promocionEditando.set(null);
        this.cargarPromociones();
      },
      error: () => this.notifications.error('No se pudo actualizar la promoción.'),
    });
  }

  eliminarPromocion(id: number) {
    this.notifications.confirmAction('Eliminar promoción.', 'Eliminar', () => {
      this.ajustesService.eliminarPromocion(id).subscribe({
        next: (res) => {
          this.notifications.success(res.mensaje);
          this.cargarPromociones();
        },
        error: () => this.notifications.error('Error al eliminar promoción.'),
      });
    });
  }

  cancelarEdicionPromocion() {
    this.promocionEditando.set(null);
  }

  // --- CRUD EMPLEADOS ---

  guardarEmpleado() {
    if (!this.nuevoEmpleado.nombre.trim() || !/^\d{4,6}$/.test(this.nuevoEmpleado.pin)) {
      this.notifications.warning('El nombre y un PIN de 4 a 6 digitos son obligatorios.');
      return;
    }
    this.authService.crearUsuario(this.nuevoEmpleado).subscribe({
      next: (emp) => {
        this.notifications.success(`Empleado "${emp.nombre}" registrado con éxito.`);
        this.nuevoEmpleado = {
          nombre: '',
          pin: '',
          rol: 'MESERO',
          activo: true,
        };
        this.cargarEmpleados();
      },
      error: (err) =>
        this.notifications.error(err.error?.error || 'Error al intentar registrar el empleado.'),
    });
  }

  habilitarEdicionEmpleado(emp: any) {
    this.empleadoEditando.set({ ...emp, pin: '' });
  }

  guardarEdicionEmpleado() {
    const editado = this.empleadoEditando();
    if (!editado || !editado.id) return;

    this.authService.actualizarUsuario(editado.id, editado).subscribe({
      next: (emp) => {
        this.notifications.success(`Empleado "${emp.nombre}" actualizado correctamente.`);
        this.empleadoEditando.set(null);
        this.cargarEmpleados();
      },
      error: (err) =>
        this.notifications.error(
          err.error?.error || 'No se pudo guardar la información del empleado.',
        ),
    });
  }

  eliminarEmpleado(id: number) {
    this.notifications.confirmAction('Eliminar o retirar empleado.', 'Eliminar', () => {
      this.authService.eliminarUsuario(id).subscribe({
        next: (res) => {
          this.notifications.success(res.mensaje);
          this.cargarEmpleados();
        },
        error: () => this.notifications.error('Error al eliminar el empleado.'),
      });
    });
  }

  cancelarEdicionEmpleado() {
    this.empleadoEditando.set(null);
  }

  // --- IMPRESORAS ---

  cargarImpresoras() {
    this.printerService.getImpresoras().subscribe({
      next: (data) => this.impresoras.set(data),
      error: (err) => console.error('Error al cargar impresoras:', err),
    });
  }

  cargarImpresorasWindows() {
    void this.cargarImpresorasWindowsDesdeElectron();
  }

  obtenerEtiquetaImpresoraWindows(printer: WindowsPrinterInfo): string {
    const extras: string[] = [];

    if (printer.description) {
      extras.push(printer.description);
    }

    if (printer.isDefault) {
      extras.push('Predeterminada');
    }

    return extras.length > 0 ? `${printer.name} - ${extras.join(' - ')}` : printer.name;
  }

  guardarImpresora() {
    this.printerService.crearImpresora(this.nuevaImpresora).subscribe({
      next: (imp) => {
        this.notifications.success(`Impresora "${imp.nombre}" guardada.`);
        this.nuevaImpresora = {
          nombre: '',
          destino: 'COCINA',
          tipo: 'SIMULACION',
          ip_o_puerto: '192.168.1.100',
          puerto_tcp: 9100,
          es_termica: false,
          corte_tipo: 'NINGUNO',
          tamano_fuente: 'NORMAL',
          activa: true,
        };
        this.cargarImpresoras();
      },
      error: () => this.notifications.error('Error al guardar la impresora.'),
    });
  }

  habilitarEdicionImpresora(imp: Impresora) {
    this.impresoraEditando.set({ ...imp });
  }

  guardarEdicionImpresora() {
    const editado = this.impresoraEditando();
    if (!editado || !editado.id) return;

    this.printerService.actualizarImpresora(editado.id, editado).subscribe({
      next: (imp) => {
        this.notifications.success(`Impresora "${imp.nombre}" actualizada.`);
        this.impresoraEditando.set(null);
        this.cargarImpresoras();
      },
      error: () => this.notifications.error('Error al actualizar la impresora.'),
    });
  }

  eliminarImpresora(id: number) {
    this.notifications.confirmAction('Eliminar configuración de impresora.', 'Eliminar', () => {
      this.printerService.eliminarImpresora(id).subscribe({
        next: () => {
          this.notifications.success('Impresora eliminada.');
          this.cargarImpresoras();
        },
        error: () => this.notifications.error('Error al eliminar impresora.'),
      });
    });
  }

  probarImpresora(id: number) {
    const impresora = this.impresoras().find((item) => item.id === id);
    if (!impresora) {
      this.notifications.warning('Impresora no encontrada.');
      return;
    }

    if (impresora.tipo === 'USB') {
      void this.probarImpresoraUsb(impresora);
      return;
    }

    this.printerService.probarImpresora(id).subscribe({
      next: (res) => this.notifications.info(res.mensaje, 4000),
      error: (err) =>
        this.notifications.error(err.error?.error || 'Error al probar impresora.', 4000),
    });
  }

  cancelarEdicionImpresora() {
    this.impresoraEditando.set(null);
  }

  private async cargarImpresorasWindowsDesdeElectron() {
    try {
      const data = await this.printerService.getSystemPrinters();
      this.impresorasWindows.set(data);
    } catch (err) {
      console.error('Error al consultar impresoras Windows:', err);
      this.impresorasWindows.set([]);
    }
  }

  private async probarImpresoraUsb(impresora: Impresora) {
    try {
      const payload = {
        tipo: 'USB',
        printerName: impresora.ip_o_puerto,
        contenido: [
          'BORBOTO POS',
          'PRUEBA DE IMPRESION USB',
          '------------------------------',
          `Impresora: ${impresora.nombre}`,
          `Cola: ${impresora.ip_o_puerto}`,
          `Fecha: ${new Date().toLocaleString('es-MX')}`,
          '------------------------------',
          'Si ves este ticket, Electron pudo imprimir en modo silencioso.',
          '',
        ].join('\n'),
        titulo: 'Prueba de Impresion USB',
        anchoPapel: impresora.ancho_papel || '80mm',
        esTermica: impresora.es_termica === true,
        corteTipo: impresora.corte_tipo || 'NINGUNO',
      } as const;
      await this.printerService.printTicketSilently(payload);

      this.notifications.success(`Prueba de impresión enviada a "${impresora.nombre}".`, 4000);
    } catch (err: any) {
      this.notifications.error(err?.message || 'Error al probar impresora USB.', 5000);
    }
  }
}
