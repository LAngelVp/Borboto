// src/modules/printer/templates/ticket-templates.ts

export type AnchoPapel = '58mm' | '80mm';
export type TipoCorte = 'NINGUNO' | 'PARCIAL' | 'TOTAL';

export interface DatosEmpresaTicket {
  nombre?: string;
  razonSocial?: string;
  rfc?: string;
  direccion?: string;
  telefono?: string;
  email?: string;
  regimenFiscal?: string;
  codigoPostal?: string;
  mensajeRecibo?: string;
}

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
  datosEmpresa?: DatosEmpresaTicket;
}

export interface ItemComandaImpresion {
  cantidad: number;
  nombre: string;
  precio_unitario?: number;
  subtotal?: number;
  notas?: string;
}

const MARGEN_INFERIOR_LINEAS = 4;

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

function agregarLineaSiExiste(lineas: string[], valor: string | undefined, width: number): void {
  if (valor && valor.trim()) {
    lineas.push(centrarTexto(valor.trim(), width));
  }
}

function agregarRemateFinal(lineas: string[], ancho: number): void {
  const separadorSuave = '-'.repeat(ancho);
  for (let index = 0; index < MARGEN_INFERIOR_LINEAS; index += 1) {
    lineas.push(separadorSuave);
  }
}

// ─── 1. TEMPLATE DE PRODUCCIÓN (COCINA / BARRA) ───────────────────────────
export function generarTemplateProduccion(
  datos: DatosComandaProduccion,
  area: 'COCINA' | 'BARRA',
  anchoPapel: AnchoPapel = '80mm',
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

  datos.items.forEach((item) => {
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

  ticket += separador + '\n';
  ticket += (separador + '\n').repeat(MARGEN_INFERIOR_LINEAS);
  return ticket;
}

// ─── 2. TEMPLATE DE COBRO (CAJA / MOSTRADOR) ──────────────────────────────
export function generarTemplateCobro(
  datos: DatosTicketCobro,
  anchoPapel: AnchoPapel = '80mm',
): string {
  const maxW = anchoPapel === '58mm' ? 30 : 42;
  const separador = '='.repeat(maxW);
  const separadorSuave = '-'.repeat(maxW);

  const lineas: string[] = [''];
  agregarLineaSiExiste(lineas, datos.datosEmpresa?.nombre || 'BORBOTO POS', maxW);
  agregarLineaSiExiste(lineas, datos.datosEmpresa?.razonSocial, maxW);
  agregarLineaSiExiste(
    lineas,
    datos.datosEmpresa?.rfc ? `RFC: ${datos.datosEmpresa.rfc}` : undefined,
    maxW,
  );
  agregarLineaSiExiste(lineas, datos.datosEmpresa?.direccion, maxW);
  agregarLineaSiExiste(lineas, datos.datosEmpresa?.telefono, maxW);
  agregarLineaSiExiste(lineas, datos.datosEmpresa?.email, maxW);

  if (datos.datosEmpresa?.regimenFiscal || datos.datosEmpresa?.codigoPostal) {
    lineas.push(
      centrarTexto(
        [
          datos.datosEmpresa?.regimenFiscal ? `Reg. ${datos.datosEmpresa.regimenFiscal}` : '',
          datos.datosEmpresa?.codigoPostal ? `CP ${datos.datosEmpresa.codigoPostal}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        maxW,
      ),
    );
  }

  lineas.push(separador);
  lineas.push(centrarTexto('TICKET DE COBRO', maxW));
  lineas.push(separadorSuave);
  lineas.push(padLine(`TICKET: ${datos.pagoId}`, `MESA: ${datos.mesa}`, maxW));
  lineas.push(padLine(`FECHA: ${datos.fecha}`, '', maxW).trim());
  lineas.push(padLine(`ATENDIO: ${datos.atendidoPor}`, '', maxW).trim());

  if (datos.clienteNombre) {
    lineas.push(padLine(`CLIENTE: ${datos.clienteNombre}`, '', maxW).trim());
  }

  lineas.push(separadorSuave);
  lineas.push(padLine('CANT DESCRIPCION', 'TOTAL', maxW));
  lineas.push(separadorSuave);

  datos.items.forEach((item) => {
    const cantStr = `${item.cantidad}x `;
    const subtotalStr = `$${(item.subtotal || 0).toFixed(2)}`;
    const maxDescW = maxW - cantStr.length - subtotalStr.length - 1;

    let desc = item.nombre;
    if (desc.length > maxDescW) {
      desc = desc.substring(0, maxDescW);
    }

    lineas.push(padLine(`${cantStr}${desc}`, subtotalStr, maxW));
    if (item.notas) {
      lineas.push(`  * ${item.notas.substring(0, maxW - 4)}`);
    }
  });

  lineas.push(separadorSuave);
  lineas.push(padLine('TOTAL:', `$${datos.totalCuenta.toFixed(2)}`, maxW));
  lineas.push(padLine(`PAGO (${datos.metodoPago}):`, `$${datos.montoRecibido.toFixed(2)}`, maxW));
  lineas.push(padLine('CAMBIO:', `$${datos.cambio.toFixed(2)}`, maxW));

  if (datos.codigoAutofactura && datos.urlAutofactura) {
    lineas.push(separadorSuave);
    lineas.push(centrarTexto('*** AUTOFACTURACION ***', maxW));
    lineas.push(centrarTexto(`CODIGO: ${datos.codigoAutofactura}`, maxW));
    lineas.push(centrarTexto('INGRESA A LA URL PARA FACTURAR:', maxW));
    lineas.push(centrarTexto(datos.urlAutofactura, maxW));
  }

  if (datos.datosEmpresa?.mensajeRecibo) {
    lineas.push(separadorSuave);
    lineas.push(centrarTexto(datos.datosEmpresa.mensajeRecibo, maxW));
  }

  lineas.push(separador);
  agregarRemateFinal(lineas, maxW);

  return lineas.join('\n') + '\n';
}
