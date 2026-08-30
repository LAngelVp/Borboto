import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { AjustesService, CategoriaAdmin, ProductoAdmin, MesaAdmin, ZonaAdmin, DatosNegocio, DatosTransferencia, Cliente, Promocion } from '../../core/services/ajustes.service';
import { AuthService, Usuario } from '../../core/services/auth.service';
import { CajaService } from '../../core/services/caja-service';

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
    BillingComponent
  ],
  templateUrl: './ajustes.html',
  styleUrl: './ajustes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AjustesComponent implements OnInit {
  private readonly ajustesService = inject(AjustesService);
  private readonly cajaService = inject(CajaService);
  protected readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly http = inject(HttpClient);

  // URL base del servidor backend Express
  private readonly API_URL = 'http://localhost:3000';

  // Catálogos e inicialización con Signals
  readonly categorias = signal<CategoriaAdmin[]>([]);
  readonly productos = signal<ProductoAdmin[]>([]);
  readonly zonas = signal<ZonaAdmin[]>([]);
  readonly mesas = signal<MesaAdmin[]>([]);
  readonly clientes = signal<Cliente[]>([]);
  readonly empleados = signal<any[]>([]);
  readonly cortesHistory = signal<any[]>([]);

  // Modelos de Creación
  nuevoProducto: ProductoAdmin = {
    categoria_id: 0,
    nombre: '',
    precio: 0,
    disponible: true,
    imagen_url: ''
  };

  nuevaCategoria: CategoriaAdmin = {
    nombre: '',
    icono: 'restaurant',
    orden: 0
  };

  nuevaZonaNombre = signal<string>('');

  nuevaMesa: MesaAdmin = {
    numero: '',
    zona_id: 0,
    capacidad: 4
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
    pesos_por_punto: 10
  };

  datosTransferencia: DatosTransferencia = {
    banco: '',
    titular: '',
    clabe: '',
    email: ''
  };

  nuevoCliente: Cliente = {
    nombre: '',
    telefono: '',
    direccion: '',
    email: '',
    notas: ''
  };

  // Promociones
  readonly promociones = signal<Promocion[]>([]);
  nuevaPromocion: Promocion = {
    nombre: '',
    codigo: '',
    tipo: 'DESCUENTO_PORCENTAJE',
    valor: 0,
    descripcion: '',
    activo: true
  };

  // Empleados
  nuevoEmpleado = {
    nombre: '',
    pin: '',
    rol: 'MESERO',
    activo: true
  };

  // Estados de Edición Activa
  productoEditando = signal<ProductoAdmin | null>(null);
  categoriaEditando = signal<CategoriaAdmin | null>(null);
  mesaEditando = signal<MesaAdmin | null>(null);
  zonaEditando = signal<ZonaAdmin | null>(null);
  clienteEditando = signal<Cliente | null>(null);
  promocionEditando = signal<Promocion | null>(null);
  empleadoEditando = signal<any | null>(null);

  ngOnInit() {
    this.cargarDatosFormularios();
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
  }

  cargarHistorialCortes() {
    this.cajaService.obtenerHistorialCortes().subscribe({
      next: (data) => this.cortesHistory.set(data),
      error: (err) => console.error('Error al cargar historial de cortes:', err)
    });
  }

  // --- MÉTODOS Y MANEJO DE IMÁGENES ---

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
            imagen_url: res.url
          });
        } else {
          this.nuevoProducto.imagen_url = res.url;
        }
        this.snackBar.open('Imagen subida correctamente al servidor.', 'Cerrar', { duration: 2000 });
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Error al subir la imagen al servidor.', 'Cerrar', { duration: 3000 });
      }
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
        imagen_url: ''
      });
    } else {
      this.nuevoProducto.imagen_url = '';
    }
  }

  // --- CARGAS INDIVIDUALES ---

  private cargarCategorias() {
    this.ajustesService.getCategorias().subscribe({
      next: (data) => {
        this.categorias.set(data);
        if (data.length > 0 && !this.nuevoProducto.categoria_id) {
          this.nuevoProducto.categoria_id = data[0].id!;
        }
      },
      error: (err) => console.error('Error al cargar categorías:', err)
    });
  }

  private cargarProductos() {
    this.ajustesService.getAdminProductos().subscribe({
      next: (data) => this.productos.set(data),
      error: (err) => console.error('Error al cargar productos de administración:', err)
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
      error: (err) => console.error('Error al cargar zonas:', err)
    });
  }

  private cargarMesas() {
    this.ajustesService.getAdminMesas().subscribe({
      next: (data) => this.mesas.set(data),
      error: (err) => console.error('Error al cargar mesas:', err)
    });
  }

  private cargarClientes() {
    this.ajustesService.getClientes().subscribe({
      next: (data) => this.clientes.set(data),
      error: (err) => console.error('Error al cargar directorio de clientes:', err)
    });
  }

  private cargarPromociones() {
    this.ajustesService.getPromociones().subscribe({
      next: (data) => this.promociones.set(data),
      error: (err) => console.error('Error al cargar promociones:', err)
    });
  }

  private cargarEmpleados() {
    this.authService.getUsuarios().subscribe({
      next: (data) => this.empleados.set(data),
      error: (err) => console.error('Error al cargar empleados:', err)
    });
  }

  private cargarDatosAdicionales() {
    this.ajustesService.getDatosNegocio().subscribe({
      next: (data) => {
        if (data && data.nombre) {
          this.datosNegocio = { ...data };
        }
      },
      error: (err) => console.error('Error al cargar datos del negocio:', err)
    });

    this.ajustesService.getDatosTransferencia().subscribe({
      next: (data) => {
        if (data && data.banco) {
          this.datosTransferencia = { ...data };
        }
      },
      error: (err) => console.error('Error al cargar datos de transferencia:', err)
    });
  }

  // --- CRUD PRODUCTOS ---

  guardarProducto() {
    this.ajustesService.crearProducto(this.nuevoProducto).subscribe({
      next: (p) => {
        this.snackBar.open(`Producto "${p.nombre}" registrado exitosamente.`, 'Cerrar', { duration: 3000 });
        this.nuevoProducto = {
          categoria_id: this.categorias()[0]?.id || 0,
          nombre: '',
          precio: 0,
          disponible: true,
          imagen_url: ''
        };
        this.cargarProductos();
      },
      error: () => this.snackBar.open('Error al intentar crear el producto.', 'Cerrar', { duration: 3000 })
    });
  }

  // HABILITAR EDICIÓN CON SOPORTE PARA MÚLTIPLES NOMBRES DE CAMPOS EN LA BD/API
  habilitarEdicionProducto(p: any) {
    const imagenNormalizada = p.imagen_url || p.imagen || p.imagenUrl || '';
    this.productoEditando.set({
      ...p,
      imagen_url: imagenNormalizada
    });
  }

  guardarEdicionProducto() {
    const editado = this.productoEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarProducto(editado.id, editado).subscribe({
      next: (p) => {
        this.snackBar.open(`Producto "${p.nombre}" actualizado correctamente.`, 'Cerrar', { duration: 3000 });
        this.productoEditando.set(null);
        this.cargarProductos();
      },
      error: () => this.snackBar.open('Error al intentar actualizar el producto.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarProducto(id: number) {
    if (!confirm('¿Estás seguro de eliminar este producto? En caso de tener historial de ventas, se desactivará del menú.')) return;

    this.ajustesService.eliminarProducto(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 4000 });
        this.cargarProductos();
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Error al intentar eliminar el producto.', 'Cerrar', { duration: 3000 });
      }
    });
  }

  cancelarEdicionProducto() {
    this.productoEditando.set(null);
  }

  // --- CRUD CATEGORÍAS ---

  guardarCategoria() {
    this.ajustesService.crearCategoria(this.nuevaCategoria).subscribe({
      next: (cat) => {
        this.snackBar.open(`Categoría "${cat.nombre}" agregada al sistema.`, 'Cerrar', { duration: 3000 });
        this.nuevaCategoria = {
          nombre: '',
          icono: 'restaurant',
          orden: 0
        };
        this.cargarCategorias();
        this.cargarProductos();
      },
      error: () => this.snackBar.open('Error al intentar dar de alta la categoría.', 'Cerrar', { duration: 3000 })
    });
  }

  habilitarEdicionCategoria(cat: CategoriaAdmin) {
    this.categoriaEditando.set({ ...cat });
  }

  guardarEdicionCategoria() {
    const editado = this.categoriaEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarCategoria(editado.id, editado).subscribe({
      next: (cat) => {
        this.snackBar.open(`Categoría "${cat.nombre}" actualizada.`, 'Cerrar', { duration: 3000 });
        this.categoriaEditando.set(null);
        this.cargarCategorias();
        this.cargarProductos();
      },
      error: () => this.snackBar.open('Error al actualizar la categoría.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarCategoria(id: number) {
    if (!confirm('¿Estás seguro de eliminar esta categoría? Solo se permite si no contiene productos.')) return;

    this.ajustesService.eliminarCategoria(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 3000 });
        this.cargarCategorias();
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Error al intentar eliminar la categoría.', 'Cerrar', { duration: 4000 });
      }
    });
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
        this.snackBar.open(`Zona "${z.nombre}" creada correctamente para el salón.`, 'Cerrar', { duration: 3000 });
        this.nuevaZonaNombre.set('');
        this.cargarZonas();
      },
      error: () => this.snackBar.open('Error al crear la zona. Valida que no esté duplicada.', 'Cerrar', { duration: 3000 })
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
        this.snackBar.open(`Zona actualizada a "${z.nombre}".`, 'Cerrar', { duration: 3000 });
        this.zonaEditando.set(null);
        this.cargarZonas();
        this.cargarMesas();
      },
      error: () => this.snackBar.open('Error al actualizar la zona.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarZona(id: number) {
    if (!confirm('¿Estás seguro de eliminar esta zona? Solo se permite si no hay mesas asignadas a ella.')) return;

    this.ajustesService.eliminarZona(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 3000 });
        this.cargarZonas();
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Error al eliminar zona.', 'Cerrar', { duration: 4000 });
      }
    });
  }

  cancelarEdicionZona() {
    this.zonaEditando.set(null);
  }

  // --- CRUD MESAS ---

  guardarMesa() {
    this.ajustesService.crearMesa(this.nuevaMesa).subscribe({
      next: (m) => {
        this.snackBar.open(`Mesa ${m.numero} dada de alta correctamente.`, 'Cerrar', { duration: 3000 });
        this.nuevaMesa = {
          numero: '',
          zona_id: this.zonas()[0]?.id || 0,
          capacidad: 4
        };
        this.cargarMesas();
      },
      error: () => this.snackBar.open('Error al guardar la mesa. Asegúrate de que no esté duplicada en la misma zona.', 'Cerrar', { duration: 3000 })
    });
  }

  habilitarEdicionMesa(m: MesaAdmin) {
    this.mesaEditando.set({ ...m });
  }

  guardarEdicionMesa() {
    const editado = this.mesaEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarMesa(editado.id, editado).subscribe({
      next: (m) => {
        this.snackBar.open(`Mesa "${m.numero}" guardada exitosamente.`, 'Cerrar', { duration: 3000 });
        this.mesaEditando.set(null);
        this.cargarMesas();
      },
      error: () => this.snackBar.open('Error al modificar la mesa. Valida duplicados.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarMesa(id: number) {
    if (!confirm('¿Estás seguro de eliminar esta mesa del catálogo?')) return;

    this.ajustesService.eliminarMesa(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 3000 });
        this.cargarMesas();
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'La mesa no puede borrarse por historial.', 'Cerrar', { duration: 4000 });
      }
    });
  }

  cancelarEdicionMesa() {
    this.mesaEditando.set(null);
  }

  // --- UPSERTS CONFIGURACIÓN ---

  guardarNegocio() {
    this.ajustesService.guardarDatosNegocio(this.datosNegocio).subscribe({
      next: () => {
        this.snackBar.open('Datos comerciales actualizados en los recibos.', 'Cerrar', { duration: 3000 });
      },
      error: () => this.snackBar.open('No fue posible actualizar la información del negocio.', 'Cerrar', { duration: 3000 })
    });
  }

  guardarTransferencia() {
    this.ajustesService.guardarDatosTransferencia(this.datosTransferencia).subscribe({
      next: () => {
        this.snackBar.open('Ajustes de cuenta de transferencia grabados.', 'Cerrar', { duration: 3000 });
      },
      error: () => this.snackBar.open('Error al guardar la configuración de transferencia.', 'Cerrar', { duration: 3000 })
    });
  }

  // --- CRUD CLIENTES ---

  guardarCliente() {
    this.ajustesService.crearCliente(this.nuevoCliente).subscribe({
      next: (cli) => {
        this.snackBar.open(`Cliente "${cli.nombre}" registrado.`, 'Cerrar', { duration: 3000 });
        this.nuevoCliente = {
          nombre: '',
          telefono: '',
          direccion: '',
          email: '',
          notas: ''
        };
        this.cargarClientes();
      },
      error: () => this.snackBar.open('Error al ingresar el cliente a la libreta.', 'Cerrar', { duration: 3000 })
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
        this.snackBar.open(`Cliente "${cli.nombre}" actualizado en el directorio.`, 'Cerrar', { duration: 3000 });
        this.clienteEditando.set(null);
        this.cargarClientes();
      },
      error: () => this.snackBar.open('No se pudo guardar la información del cliente.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarCliente(id: number) {
    if (!confirm('¿Estás seguro de eliminar este cliente del directorio?')) return;

    this.ajustesService.eliminarCliente(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 3000 });
        this.cargarClientes();
      },
      error: () => this.snackBar.open('Error al eliminar cliente.', 'Cerrar', { duration: 3000 })
    });
  }

  cancelarEdicionCliente() {
    this.clienteEditando.set(null);
  }

  // --- CRUD PROMOCIONES ---

  guardarPromocion() {
    this.ajustesService.crearPromocion(this.nuevaPromocion).subscribe({
      next: (p) => {
        this.snackBar.open(`Promoción "${p.nombre}" guardada con éxito.`, 'Cerrar', { duration: 3000 });
        this.nuevaPromocion = {
          nombre: '',
          codigo: '',
          tipo: 'DESCUENTO_PORCENTAJE',
          valor: 0,
          descripcion: '',
          activo: true
        };
        this.cargarPromociones();
      },
      error: () => this.snackBar.open('Error al guardar la promoción. Valide el código único.', 'Cerrar', { duration: 3000 })
    });
  }

  habilitarEdicionPromocion(p: Promocion) {
    this.promocionEditando.set({ ...p });
  }

  guardarEdicionPromocion() {
    const editado = this.promocionEditando();
    if (!editado || !editado.id) return;

    this.ajustesService.actualizarPromocion(editado.id, editado).subscribe({
      next: (p) => {
        this.snackBar.open(`Promoción "${p.nombre}" actualizada.`, 'Cerrar', { duration: 3000 });
        this.promocionEditando.set(null);
        this.cargarPromociones();
      },
      error: () => this.snackBar.open('No se pudo actualizar la promoción.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarPromocion(id: number) {
    if (!confirm('¿Estás seguro de eliminar esta promoción?')) return;

    this.ajustesService.eliminarPromocion(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 3000 });
        this.cargarPromociones();
      },
      error: () => this.snackBar.open('Error al eliminar promoción.', 'Cerrar', { duration: 3000 })
    });
  }

  cancelarEdicionPromocion() {
    this.promocionEditando.set(null);
  }

  // --- CRUD EMPLEADOS ---

  guardarEmpleado() {
    this.authService.crearUsuario(this.nuevoEmpleado).subscribe({
      next: (emp) => {
        this.snackBar.open(`Empleado "${emp.nombre}" registrado con éxito.`, 'Cerrar', { duration: 3000 });
        this.nuevoEmpleado = {
          nombre: '',
          pin: '',
          rol: 'MESERO',
          activo: true
        };
        this.cargarEmpleados();
      },
      error: (err) => this.snackBar.open(err.error?.error || 'Error al intentar registrar el empleado.', 'Cerrar', { duration: 3000 })
    });
  }

  habilitarEdicionEmpleado(emp: any) {
    this.empleadoEditando.set({ ...emp });
  }

  guardarEdicionEmpleado() {
    const editado = this.empleadoEditando();
    if (!editado || !editado.id) return;

    this.authService.actualizarUsuario(editado.id, editado).subscribe({
      next: (emp) => {
        this.snackBar.open(`Empleado "${emp.nombre}" actualizado correctamente.`, 'Cerrar', { duration: 3000 });
        this.empleadoEditando.set(null);
        this.cargarEmpleados();
      },
      error: (err) => this.snackBar.open(err.error?.error || 'No se pudo guardar la información del empleado.', 'Cerrar', { duration: 3000 })
    });
  }

  eliminarEmpleado(id: number) {
    if (!confirm('¿Estás seguro de eliminar o retirar este empleado?')) return;

    this.authService.eliminarUsuario(id).subscribe({
      next: (res) => {
        this.snackBar.open(res.mensaje, 'Cerrar', { duration: 3000 });
        this.cargarEmpleados();
      },
      error: () => this.snackBar.open('Error al eliminar el empleado.', 'Cerrar', { duration: 3000 })
    });
  }

  cancelarEdicionEmpleado() {
    this.empleadoEditando.set(null);
  }
}