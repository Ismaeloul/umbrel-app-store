/* Formato de fechas y textos en español (sin librerías). */

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function dayLabel(ms: number, nowMs: number): { rel: 'ayer' | 'hoy' | 'mañana' | null; short: string; long: string; num: number } {
  const d = new Date(ms);
  const today = new Date(nowMs);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((a - b) / 86400000);
  const rel = diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff === -1 ? 'ayer' : null;
  return { rel, short: DAYS_SHORT[d.getDay()], long: DAYS[d.getDay()], num: d.getDate() };
}

export function longDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function relativeTime(ms: number, nowMs: number): string {
  const diff = nowMs - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  return `hace ${d} días`;
}

/** «En 48 min», «En 1 h 18 min», «En 2 días». */
export function untilText(ms: number, nowMs: number): string {
  const diff = ms - nowMs;
  const min = Math.ceil(diff / 60000);
  if (min <= 0) return 'Ahora';
  if (min < 60) return `En ${min} min`;
  if (min < 6 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `En ${h} h ${m} min` : `En ${h} h`;
  }
  const dayDiff = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(nowMs).setHours(0, 0, 0, 0)) / 86400000);
  if (dayDiff === 0) return `Hoy, ${hhmm(ms)}`;
  if (dayDiff === 1) return `Mañana, ${hhmm(ms)}`;
  return `${DAYS_SHORT[new Date(ms).getDay()]}, ${hhmm(ms)}`;
}

export function secondsText(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function kbps(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} Mbit/s` : `${v} kbit/s`;
}

export function shortHash(h: string, n = 8): string {
  return h.slice(0, n);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
