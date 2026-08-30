// core/pipes/formato-numero-mesa.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatoNumeroMesa',
  standalone: true // Importante para usarlo en componentes standalone
})
export class FormatoNumeroMesaPipe implements PipeTransform {

  /**
   * Transforma "1-20260829" en "1"
   * @param value El valor guardado en la columna 'numero' de la BD
   * @param mostrarSufijo Opcional: si es true, devuelve el valor original
   */
  transform(value: string | number | undefined, mostrarSufijo: boolean = false): string {
    if (value === null || value === undefined) return '';

    const stringValue = value.toString();

    // Si el usuario explícitamente pide ver todo el sufijo de fecha (ej: auditoría)
    if (mostrarSufijo) {
      return stringValue;
    }

    // Opción 2: Formato Único con Sufijo de Fecha.
    // Hacemos el .split('-') y tomamos la primera parte [0].
    // Si no tiene guion (mesas físicas tradicionales), devolverá el valor original.
    return stringValue.split('-')[0];
  }

}