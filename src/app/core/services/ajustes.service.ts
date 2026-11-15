import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RuntimeConfigService } from './runtime-config.service';

export interface CategoriaAdmin {
  id?: number;
  nombre: string;
  icono?: string;
  orden?: number;
  destino_impresion?: 'COCINA' | 'BARRA' | 'CAJA' | 'NINGUNO';
}

export interface ProductoAdmin {
  id?: number;
  categoria_id: number;
  nombre: string;
  precio: number;
  disponible?: boolean;
  imagen_url?: string;
  categoriaNombre?: string;
  clave_sat?: string | null;
}

export interface MesaAdmin {
  id?: number;
  numero: string;
  zona_id: number;
  capacidad: number;
  zona?: string;
}

export interface ZonaAdmin {
  id: number;
  nombre: string;
}

export interface DatosNegocio {
  id?: number;
  nombre: string;
  rfc?: string;
  telefono?: string;
  direccion?: string;
  email?: string;
  mensaje_recibo?: string;
  visitas_requeridas_frecuente?: number;
  puntos_por_cada_diez_pesos?: number;
  pesos_por_punto?: number;
  logo_url?: string | null;
  imprimir_logo?: boolean;
}

export interface DatosTransferencia {
  id?: number;
  banco: string;
  titular: string;
  clabe: string;
  email?: string;
}

export interface Cliente {
  id?: number;
  nombre: string;
  telefono?: string;
  direccion?: string;
  email?: string;
  notas?: string;
  creado_en?: Date;
}

// 🔹 Interfaz Promocion extendida con campos de alcance
export interface Promocion {
  id?: number;
  nombre: string;
  codigo?: string;
  tipo: 'COMBO_PRECIO' | 'DESCUENTO_PORCENTAJE' | 'DESCUENTO_MONTO';
  valor: number;
  aplica_a?: 'TOTAL_ORDEN' | 'CATEGORIA' | 'PRODUCTO';
  categoria_id?: number | null;
  producto_id?: number | null;
  descripcion?: string;
  activo?: boolean;
}

// Interfaz para la configuración de Facturación CFDI 4.0
export interface FacturacionConfig {
  id?: number;
  apiKeyTest: string;
  apiKeyLive?: string;
  modoProduccion: boolean;
  rfcEmisor: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  emailNotificaciones?: string;
  diasVigenciaTicket: number;
  tieneCsd?: boolean;
  tieneApiKeyTest?: boolean;
  tieneApiKeyLive?: boolean;
}

export interface PruebaConexionPayload {
  apiKey: string;
  isLive: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AjustesService {
  private readonly http = inject(HttpClient);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  private get apiUrl() {
    return this.runtimeConfig.apiBaseUrl;
  }

  // Categorías
  getCategorias(): Observable<CategoriaAdmin[]> {
    return this.http.get<CategoriaAdmin[]>(`${this.apiUrl}/categorias`);
  }

  crearCategoria(categoria: CategoriaAdmin): Observable<CategoriaAdmin> {
    return this.http.post<CategoriaAdmin>(`${this.apiUrl}/categorias`, categoria);
  }

  actualizarCategoria(id: number, categoria: CategoriaAdmin): Observable<CategoriaAdmin> {
    return this.http.put<CategoriaAdmin>(`${this.apiUrl}/categorias/${id}`, categoria);
  }

  eliminarCategoria(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.apiUrl}/categorias/${id}`);
  }

  // Productos
  getAdminProductos(): Observable<ProductoAdmin[]> {
    return this.http.get<ProductoAdmin[]>(`${this.apiUrl}/admin/productos`);
  }

  crearProducto(producto: ProductoAdmin): Observable<ProductoAdmin> {
    return this.http.post<ProductoAdmin>(`${this.apiUrl}/productos`, producto);
  }

  actualizarProducto(id: number, producto: ProductoAdmin): Observable<ProductoAdmin> {
    return this.http.put<ProductoAdmin>(`${this.apiUrl}/productos/${id}`, producto);
  }

  eliminarProducto(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.apiUrl}/productos/${id}`);
  }

  // Zonas
  getZonas(): Observable<ZonaAdmin[]> {
    return this.http.get<ZonaAdmin[]>(`${this.apiUrl}/zonas`);
  }

  crearZona(zona: { nombre: string }): Observable<ZonaAdmin> {
    return this.http.post<ZonaAdmin>(`${this.apiUrl}/zonas`, zona);
  }

  actualizarZona(id: number, zona: { nombre: string }): Observable<ZonaAdmin> {
    return this.http.put<ZonaAdmin>(`${this.apiUrl}/zonas/${id}`, zona);
  }

  eliminarZona(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.apiUrl}/zonas/${id}`);
  }

  // Mesas
  getAdminMesas(): Observable<MesaAdmin[]> {
    return this.http.get<MesaAdmin[]>(`${this.apiUrl}/admin/mesas`);
  }

  crearMesa(mesa: MesaAdmin): Observable<MesaAdmin> {
    return this.http.post<MesaAdmin>(`${this.apiUrl}/mesas`, mesa);
  }

  actualizarMesa(id: number, mesa: MesaAdmin): Observable<MesaAdmin> {
    return this.http.put<MesaAdmin>(`${this.apiUrl}/mesas/${id}`, mesa);
  }

  eliminarMesa(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.apiUrl}/mesas/${id}`);
  }

  // Datos del Negocio
  getDatosNegocio(): Observable<DatosNegocio> {
    return this.http.get<DatosNegocio>(`${this.apiUrl}/ajustes/negocio`);
  }

  guardarDatosNegocio(datos: DatosNegocio): Observable<DatosNegocio> {
    return this.http.post<DatosNegocio>(`${this.apiUrl}/ajustes/negocio`, datos);
  }

  subirLogoNegocio(archivo: File): Observable<{ ok: boolean; logo_url: string }> {
    const formData = new FormData();
    formData.append('logo', archivo);
    return this.http.post<{ ok: boolean; logo_url: string }>(`${this.apiUrl}/ajustes/negocio/logo`, formData);
  }

  eliminarLogoNegocio(): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.apiUrl}/ajustes/negocio/logo`);
  }

  // Datos de Transferencia
  getDatosTransferencia(): Observable<DatosTransferencia> {
    return this.http.get<DatosTransferencia>(`${this.apiUrl}/ajustes/transferencia`);
  }

  guardarDatosTransferencia(datos: DatosTransferencia): Observable<DatosTransferencia> {
    return this.http.post<DatosTransferencia>(`${this.apiUrl}/ajustes/transferencia`, datos);
  }

  // Clientes
  getClientes(): Observable<Cliente[]> {
    return this.http.get<Cliente[]>(`${this.apiUrl}/clientes`);
  }

  crearCliente(cliente: Cliente): Observable<Cliente> {
    return this.http.post<Cliente>(`${this.apiUrl}/clientes`, cliente);
  }

  actualizarCliente(id: number, cliente: Cliente): Observable<Cliente> {
    return this.http.put<Cliente>(`${this.apiUrl}/clientes/${id}`, cliente);
  }

  eliminarCliente(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.apiUrl}/clientes/${id}`);
  }

  // Promociones
  getPromociones(): Observable<Promocion[]> {
    return this.http.get<Promocion[]>(`${this.apiUrl}/promociones`);
  }

  crearPromocion(promo: Promocion): Observable<Promocion> {
    return this.http.post<Promocion>(`${this.apiUrl}/promociones`, promo);
  }

  actualizarPromocion(id: number, promo: Promocion): Observable<Promocion> {
    return this.http.put<Promocion>(`${this.apiUrl}/promociones/${id}`, promo);
  }

  eliminarPromocion(id: number): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.apiUrl}/promociones/${id}`);
  }

  // Facturación Electrónica (CFDI 4.0)
  getConfiguracionFacturacion(): Observable<FacturacionConfig> {
    return this.http.get<FacturacionConfig>(`${this.apiUrl}/ajustes/facturacion`);
  }

  guardarConfiguracionFacturacion(
    formData: FormData,
  ): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.post<{ ok: boolean; mensaje: string }>(
      `${this.apiUrl}/ajustes/facturacion`,
      formData,
    );
  }

  probarConexionFacturapi(
    payload: PruebaConexionPayload,
  ): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.post<{ ok: boolean; mensaje: string }>(
      `${this.apiUrl}/ajustes/facturacion/test`,
      payload,
    );
  }
}
