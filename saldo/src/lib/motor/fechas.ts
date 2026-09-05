// Fechas civiles en formato YYYY-MM-DD: sin hora y sin huso. Toda la
// aritmetica se hace en UTC a proposito, para que un cambio de hora no
// desplace nunca un dia de cobro.

export type Periodo = 'mensual' | 'anual';

export function partes(iso: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return { anio, mes, dia };
}

export function iso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function diasEnMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

export function sumarDias(fecha: string, dias: number): string {
  const { anio, mes, dia } = partes(fecha);
  const d = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Dias enteros de `desde` a `hasta`. Negativo si `hasta` ya paso. */
export function diferenciaDias(desde: string, hasta: string): number {
  const a = partes(desde);
  const b = partes(hasta);
  const ms =
    Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia);
  return Math.round(ms / 86400000);
}

export function esAnterior(a: string, b: string): boolean {
  return a < b;
}

/**
 * El siguiente cobro despues de `actual`.
 *
 * El dia sale SIEMPRE del ancla, nunca de la fecha anterior ya recortada: por
 * eso una suscripcion del 31 cae el 28 en febrero y vuelve al 31 en marzo, en
 * vez de quedarse en el 28 para siempre. Lo mismo con el 29 de febrero, que
 * vuelve a su sitio cada cuatro anios.
 */
export function siguienteCobro(
  actual: string,
  periodo: Periodo,
  anclaDia: number,
  anclaMes: number | null = null
): string {
  const { anio, mes } = partes(actual);

  if (periodo === 'anual') {
    const m = anclaMes ?? mes;
    const a = anio + 1;
    return iso(a, m, Math.min(anclaDia, diasEnMes(a, m)));
  }

  const a = mes === 12 ? anio + 1 : anio;
  const m = mes === 12 ? 1 : mes + 1;
  return iso(a, m, Math.min(anclaDia, diasEnMes(a, m)));
}

/** El ancla se deriva de la fecha del primer cobro y no se mueve luego. */
export function anclaDe(fecha: string, periodo: Periodo): { dia: number; mes: number | null } {
  const { mes, dia } = partes(fecha);
  return { dia, mes: periodo === 'anual' ? mes : null };
}

/**
 * El primer cobro estrictamente posterior a `hoy` que le toca al ancla dada.
 * Se usa al reactivar una suscripcion perdida: vuelve a su sitio, sin arrastrar
 * los cobros que se saltaron.
 */
export function proximoDesde(
  hoy: string,
  periodo: Periodo,
  anclaDia: number,
  anclaMes: number | null = null
): string {
  const { anio, mes } = partes(hoy);

  if (periodo === 'anual') {
    const m = anclaMes ?? mes;
    const esteAnio = iso(anio, m, Math.min(anclaDia, diasEnMes(anio, m)));
    return esteAnio > hoy
      ? esteAnio
      : iso(anio + 1, m, Math.min(anclaDia, diasEnMes(anio + 1, m)));
  }

  const esteMes = iso(anio, mes, Math.min(anclaDia, diasEnMes(anio, mes)));
  return esteMes > hoy ? esteMes : siguienteCobro(esteMes, 'mensual', anclaDia, null);
}
