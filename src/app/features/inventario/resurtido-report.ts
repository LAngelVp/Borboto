import * as XLSX from 'xlsx';
import type { Insumo, ListaResurtido, ModoCaptura } from '../../core/services/inventario.service';
export type FiltroResurtido = 'BAJO_GUARDIA' | 'GUARDIA_MAS_MARGEN' | 'CATEGORIA';
export interface FilaResurtido { insumo: Insumo; modo: ModoCaptura; cantidad: number; comprado: boolean }
export function filtrarResurtido(insumos: Insumo[], modo: FiltroResurtido, margen: number, categoria: string) {
  return insumos.filter(insumo => insumo.activo && (categoria === 'TODAS' || insumo.categoria_almacen === categoria) &&
    (modo === 'CATEGORIA' || Math.round(insumo.stock_actual * 100) <= Math.round((insumo.stock_minimo + (modo === 'GUARDIA_MAS_MARGEN' ? margen : 0)) * 100)));
}
export function sugerirResurtido(insumo: Insumo, margen: number): FilaResurtido {
  const faltante = Math.max(1, +(insumo.stock_minimo + margen - insumo.stock_actual).toFixed(2));
  return { insumo, modo: insumo.permite_paquetes ? 'PAQUETE' : 'UNIDAD', cantidad: insumo.permite_paquetes ? Math.ceil(faltante / insumo.factor_paquete) : faltante, comprado: true };
}
export function columnasResurtido(lista: ListaResurtido) {
  return lista.items.map(item => {
    const insumo = item.insumo, factor = item.modo_captura === 'PAQUETE' ? insumo.factor_paquete : 1;
    const unidades = +(item.cantidad_sugerida * factor).toFixed(2);
    const stock = item.stock_actual_snapshot;
    const desglose = insumo.permite_paquetes && insumo.factor_paquete > 1 ? `${Math.floor(stock / insumo.factor_paquete)} ${insumo.nombre_paquete} + ${+(stock % insumo.factor_paquete).toFixed(2)} ${insumo.unidad_base}` : `${stock} ${insumo.unidad_base}`;
    return { 'Folio Lista': lista.folio, 'Código': insumo.codigo ?? '', 'Producto': insumo.nombre, 'Categoría': insumo.categoria_almacen,
      'Ubicación': insumo.ubicacion ?? '', 'Stock Actual': stock, 'Mínimo Guardia': item.stock_minimo_snapshot, 'Desglose Actual': desglose,
      'Presentación de Compra (Pieza/Caja)': item.modo_captura === 'PAQUETE' ? `${insumo.nombre_paquete} x${factor}` : insumo.unidad_base,
      'Cantidad a Comprar': item.cantidad_sugerida, 'Equivalente en Unidad Base': unidades, 'Costo Unitario Est.': insumo.costo_unitario,
      'Subtotal Est.': +(unidades * insumo.costo_unitario).toFixed(2), 'Cantidad Real Comprada (Llenar en compra)': item.cantidad_comprada ?? '', 'Observaciones': lista.notas ?? '' };
  });
}
export function libroResurtido(lista: ListaResurtido) {
  const sheet = XLSX.utils.json_to_sheet(columnasResurtido(lista));
  sheet['!cols'] = [14, 16, 28, 16, 22, 14, 14, 28, 30, 18, 24, 20, 18, 35, 35].map(wch => ({ wch }));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Resurtido'); return book;
}
export function exportarExcelResurtido(lista: ListaResurtido) {
  const fecha = lista.creada_en.slice(0, 10);
  XLSX.writeFile(libroResurtido(lista), `Reporte_Resurtido_${lista.folio}_${fecha}.xlsx`);
}
export function imprimirResurtido(lista: ListaResurtido, ventana: Window) {
  const doc = ventana.document;
  doc.title = `${lista.folio} - Resurtido`;
  const style = doc.createElement('style');
  style.textContent = '@page{size:A4 landscape;margin:12mm}body{font:12px sans-serif;color:#111;background:#fff}h1{font-size:22px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #666;padding:7px;text-align:left}tr{break-inside:avoid}thead{display:table-header-group}.meta{margin-bottom:16px}';
  doc.head.append(style);
  const titulo = doc.createElement('h1'); titulo.textContent = `${lista.folio} - ${lista.nombre}`;
  const meta = doc.createElement('p'); meta.className = 'meta'; meta.textContent = `${lista.creada_en.slice(0, 10)} | Margen: ${lista.margen_guardia} | ${lista.notas ?? ''}`;
  const table = doc.createElement('table'), thead = doc.createElement('thead'), cabecera = doc.createElement('tr');
  for (const text of ['Comprado', 'Codigo / Producto', 'Area / Ubicacion', 'Stock / Guardia', 'Presentacion', 'Cantidad', 'Unidades base', 'Compra real / Observaciones']) { const th = doc.createElement('th'); th.textContent = text; th.scope = 'col'; cabecera.append(th); }
  thead.append(cabecera); table.append(thead);
  const tbody = doc.createElement('tbody');
  lista.items.forEach(item => {
    const insumo = item.insumo, tr = doc.createElement('tr');
    const textos = ['[  ]', `${insumo.codigo ?? ''} ${insumo.nombre}`, `${insumo.categoria_almacen} / ${insumo.ubicacion ?? ''}`, `${item.stock_actual_snapshot} / ${item.stock_minimo_snapshot}`, item.modo_captura === 'PAQUETE' ? `${insumo.nombre_paquete} x${insumo.factor_paquete}` : insumo.unidad_base, String(item.cantidad_sugerida), String(+(item.cantidad_sugerida * (item.modo_captura === 'PAQUETE' ? insumo.factor_paquete : 1)).toFixed(2)), '________________'];
    textos.forEach(text => { const td = doc.createElement('td'); td.textContent = text; tr.append(td); }); tbody.append(tr);
  });
  table.append(tbody); doc.body.replaceChildren(titulo, meta, table); ventana.focus(); ventana.print();
}