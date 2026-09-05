import { config } from './config';

// EL UNICO sitio de toda la app que mira el reloj de verdad. La logica de
// negocio recibe «hoy» por parametro; asi los tests pueden congelarlo.

/** El dia de hoy en el huso de la app, como YYYY-MM-DD. */
export function hoy(momento: Date = new Date()): string {
  // `en-CA` da exactamente YYYY-MM-DD, que es lo que guardamos.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(momento);
}

/** La hora local (0-23) en el huso de la app. */
export function horaLocal(momento: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.zona,
      hour: '2-digit',
      hour12: false
    }).format(momento)
  );
}
