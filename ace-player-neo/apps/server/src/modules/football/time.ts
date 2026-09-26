/* Fechas y horas de la agenda en hora de Madrid (server.js:1818-1860,
   2365-2371). Funciones puras: la hora actual la pasa quien llama (el reloj
   inyectado del servicio o, en la fachada antigua, el del sistema). */

import { FOOTBALL_TIMEZONE } from './constants.js';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: FOOTBALL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: FOOTBALL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: FOOTBALL_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value || '';
}

/** `isoDateInMadrid` (server.js:1818-1827): el día de Madrid de un instante. */
export function isoDateInMadrid(value: number | Date): string {
  const parts = DATE_FORMAT.formatToParts(new Date(value));
  return `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`;
}

/** `addIsoDays` (server.js:1829-1834): suma días a un `YYYY-MM-DD`; "" si no lo es. */
export function addIsoDays(value: unknown, amount: number): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount, 12),
  );
  return date.toISOString().slice(0, 10);
}

/** Los `days` días de la agenda a partir de `startDate`. */
export function agendaWindow(startDate: string, days: number): Set<string> {
  return new Set(Array.from({ length: days }, (_, index) => addIsoDays(startDate, index)));
}

/** `madridClock` (server.js:2365-2371): "HH:MM" de Madrid; "" si no es una fecha. */
export function madridClock(value: unknown): string {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return CLOCK_FORMAT.format(date);
}

/** Resultado de `madridDateTime`, con el instante UTC si la hora era válida (v2, backend-modulos §9.6). */
export interface MadridDateTime {
  readonly date: string;
  readonly time: string;
  /** Epoch ms del saque; solo si la hora era utilizable. */
  readonly start: number | null;
}

/**
 * `madridDateTime` (server.js:1841-1860): TheSportsDB da la hora en UTC y se
 * pasa a Madrid (+2 h en verano, +1 h en invierno; de madrugada cambia de
 * día). Sin hora utilizable, "Por confirmar" con la fecha; fecha no válida,
 * null. La v2 conserva además el instante UTC para marcadores y precalentado.
 */
export function madridDateTimeWithStart(
  dateEvent: unknown,
  strTime: unknown,
): MadridDateTime | null {
  const day = String(dateEvent || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day) return null;
  const sameDay = `${day[1]}-${day[2]}-${day[3]}`;
  const clock = String(strTime || '').match(/^(\d{1,2}):(\d{2})/);
  const hour = clock ? Number(clock[1]) : Number.NaN;
  const minute = clock ? Number(clock[2]) : Number.NaN;
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute > 59
  ) {
    return { date: sameDay, time: 'Por confirmar', start: null };
  }
  const utc = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute));
  if (Number.isNaN(utc.getTime())) return { date: sameDay, time: 'Por confirmar', start: null };
  const parts = DATE_TIME_FORMAT.formatToParts(utc);
  const hh = partOf(parts, 'hour') === '24' ? '00' : partOf(parts, 'hour');
  return {
    date: `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`,
    time: `${hh}:${partOf(parts, 'minute')}`,
    start: utc.getTime(),
  };
}

/** `madridDateTime` con la forma exacta de la 0.6.59 (`{ date, time }` o null). T-016. */
export function madridDateTime(
  dateEvent: unknown,
  strTime: unknown,
): { date: string; time: string } | null {
  const local = madridDateTimeWithStart(dateEvent, strTime);
  return local ? { date: local.date, time: local.time } : null;
}

/**
 * Instante (epoch ms) de una fecha y hora de Madrid («2026-09-26», «18:30»),
 * o null si no se entienden. Lo usa la guía de la IPTV con los partidos que
 * no traen `start` (la agenda de demostración, por ejemplo).
 */
export function madridLocalToEpoch(date: unknown, time: unknown): number | null {
  const day = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const clock = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!day || !clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;
  const naive = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute);
  if (!Number.isFinite(naive)) return null;
  /* Desfase de Madrid en un instante: su hora de pared menos el instante. */
  const offsetAt = (instant: number): number => {
    const parts = DATE_TIME_FORMAT.formatToParts(new Date(instant));
    const wall = Date.UTC(
      Number(partOf(parts, 'year')),
      Number(partOf(parts, 'month')) - 1,
      Number(partOf(parts, 'day')),
      Number(partOf(parts, 'hour')) % 24,
      Number(partOf(parts, 'minute')),
    );
    return wall - instant;
  };
  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}
