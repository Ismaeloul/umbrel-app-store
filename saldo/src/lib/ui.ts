// Como se traduce a pantalla lo que dice el motor.

/** Rojo si quedan 30 dias o menos, ambar si 60 o menos, verde por encima. */
export function color(dias: number): string {
  if (dias <= 30) return 'var(--rojo)';
  if (dias <= 60) return 'var(--ambar)';
  return 'var(--verde)';
}

/** La barra se llena sobre un horizonte de 9 meses, para que 28 dias se vea
 *  corto de verdad al lado de 8 meses. */
export function llenado(dias: number): number {
  return Math.max(3, Math.min(100, Math.round((dias / 274) * 100)));
}

/** Debajo de dos meses los dias dicen algo; por encima, cansan. */
export function margen(dias: number, aguantaTodo = false): string {
  if (aguantaTodo) return 'más de 2 años';
  if (dias <= 0) return 'sin saldo';
  if (dias <= 60) return `${dias} ${dias === 1 ? 'día' : 'días'}`;
  const meses = Math.round(dias / 30.44);
  return `${meses} meses`;
}

const CORTA = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const LARGA = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });
const CON_ANIO = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});

function aDate(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function fechaCorta(iso: string): string {
  return CORTA.format(aDate(iso)).replace('.', '');
}

export function fechaLarga(iso: string, hoy?: string): string {
  // El anio solo se enseña cuando aporta: si la fecha cae en otro anio.
  if (hoy && iso.slice(0, 4) !== hoy.slice(0, 4)) return CON_ANIO.format(aDate(iso));
  return LARGA.format(aDate(iso));
}

export function diaDelMes(iso: string): number {
  return Number(iso.slice(8, 10));
}
