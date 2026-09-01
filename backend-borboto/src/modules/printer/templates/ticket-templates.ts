// src/modules/printer/templates/ticket-templates.ts

export type AnchoPapel = '58mm' | '80mm';

export interface DatosComandaProduccion {
  folioComanda: number;
  mesa: string;
  zona: string;
  atendidoPor: string;
  fecha: string;
  items: ItemComandaImpresion[];
}

export interface DatosTicketCobro {
  folioComanda: number;
  pagoId: number;
  mesa: string;
  zona: string;
  clienteNombre?: string;
  atendidoPor: string;
  fecha: string;
  metodoPago: string;
  totalCuenta: number;
  montoRecibido: number;
  cambio: number;
  items: ItemComandaImpresion[];
  codigoAutofactura?: string;
  urlAutofactura?: string;
}

export interface ItemComandaImpresion {
  cantidad: number;
  nombre: string;
  precio_unitario?: number;
  subtotal?: number;
  notas?: string;
}

// ─── HELPER DE FORMATEO DINÁMICO SEGÚN ANCHO ──────────────────────────────
function padLine(left: string, right: string, width: number): string {
  const spaceNeeded = width - left.length - right.length;
  if (spaceNeeded <= 0) {
    return left.substring(0, width - right.length - 1) + ' ' + right;
  }
  return left + ' '.repeat(spaceNeeded) + right;
}

function centrarTexto(text: string, width: number): string {
  if (text.length >= width) return text.substring(0, width);
  const leftPadding = Math.floor((width - text.length) / 2);
  return ' '.repeat(leftPadding) + text;
}

// ─── 1. TEMPLATE DE PRODUCCIÓN (COCINA / BARRA) ───────────────────────────
export function generarTemplateProduccion(
  datos: DatosComandaProduccion,
  area: 'COCINA' | 'BARRA',
  anchoPapel: AnchoPapel = '80mm'
): string {
  const maxW = anchoPapel === '58mm' ? 30 : 42;
  const separador = '-'.repeat(maxW);

  let ticket = '';
  ticket += centrarTexto(`*** COMANDA ${area} ***`, maxW) + '\n';
  ticket += separador + '\n';
  ticket += padLine(`FOLIO: #${datos.folioComanda}`, `MESA: ${datos.mesa}`, maxW) + '\n';
  ticket += padLine(`ZONA: ${datos.zona}`, `MESERO: ${datos.atendidoPor}`, maxW) + '\n';
  ticket += padLine(`FECHA: ${datos.fecha}`, '', maxW).trim() + '\n';
  ticket += separador + '\n';
  ticket += padLine('CANT PRODUCTO', '', maxW) + '\n';
  ticket += separador + '\n';

  datos.items.forEach(item => {
    const cantStr = `${item.cantidad}x `;
    const maxNombreW = maxW - cantStr.length;
    let nombre = item.nombre;

    if (nombre.length > maxNombreW) {
      nombre = nombre.substring(0, maxNombreW);
    }

    ticket += `${cantStr}${nombre}\n`;
    if (item.notas) {
      ticket += `   * NOTA: ${item.notas}\n`;
    }
  });

  ticket += separador + '\n\n\n';
  return ticket;
}

// ─── 2. TEMPLATE DE COBRO (CAJA / MOSTRADOR) ──────────────────────────────
export function generarTemplateCobro(
  datos: DatosTicketCobro,
  anchoPapel: AnchoPapel = '80mm'
): string {
  const maxW = anchoPapel === '58mm' ? 30 : 42;
  const separador = '='.repeat(maxW);
  const separadorSuave = '-'.repeat(maxW);

  let ticket = '';
  ticket += centrarTexto('BORBOTO POS', maxW) + '\n';
  ticket += centrarTexto('TICKET DE COBRO', maxW) + '\n';
  ticket += separador + '\n';
  ticket += padLine(`TICKET #: ${datos.pagoId}`, `MESA: ${datos.mesa}`, maxW) + '\n';
  ticket += padLine(`FECHA: ${datos.fecha}`, '', maxW).trim() + '\n';
  ticket += padLine(`ATENDIO: ${datos.atendidoPor}`, '', maxW).trim() + '\n';

  if (datos.clienteNombre) {
    ticket += padLine(`CLIENTE: ${datos.clienteNombre}`, '', maxW).trim() + '\n';
  }

  ticket += separadorSuave + '\n';
  ticket += padLine('CANT DESCRIPCION', 'TOTAL', maxW) + '\n';
  ticket += separadorSuave + '\n';

  datos.items.forEach(item => {
    const cantStr = `${item.cantidad}x `;
    const subtotalStr = `$${(item.subtotal || 0).toFixed(2)}`;
    const maxDescW = maxW - cantStr.length - subtotalStr.length - 1;

    let desc = item.nombre;
    if (desc.length > maxDescW) {
      desc = desc.substring(0, maxDescW);
    }

    ticket += padLine(`${cantStr}${desc}`, subtotalStr, maxW) + '\n';
  });

  ticket += separadorSuave + '\n';
  ticket += padLine('TOTAL:', `$${datos.totalCuenta.toFixed(2)}`, maxW) + '\n';
  ticket += padLine('PAGO (' + datos.metodoPago + '):', `$${datos.montoRecibido.toFixed(2)}`, maxW) + '\n';
  ticket += padLine('CAMBIO:', `$${datos.cambio.toFixed(2)}`, maxW) + '\n';

  if (datos.codigoAutofactura && datos.urlAutofactura) {
    ticket += separadorSuave + '\n';
    ticket += centrarTexto('*** AUTOFACTURACION ***', maxW) + '\n';
    ticket += centrarTexto(`CODIGO: ${datos.codigoAutofactura}`, maxW) + '\n';
    ticket += centrarTexto('INGRESA A LA URL PARA FACTURAR:', maxW) + '\n';
    ticket += centrarTexto(datos.urlAutofactura, maxW) + '\n';
  }

  ticket += separador + '\n';
  ticket += centrarTexto('¡GRACIAS POR SU PREFERENCIA!', maxW) + '\n\n\n';

  return ticket;
}