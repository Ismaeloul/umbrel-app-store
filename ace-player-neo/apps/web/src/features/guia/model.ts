/* Lógica pura de la Guía TV (docs/iptv.md §20, investigación en
   docs/investigacion/guia-tv.md §2-§3): medidas de la parrilla, la línea de
   tiempo que se enseña (de hoy 00:00 a donde llega de verdad la guía), los
   días con datos, las teselas que se piden, los tramos de una fila (programas,
   «Sin información», cargando) y moverse por ella con el teclado. Sin React
   ni red: se prueba sola (model.test.ts). */

import {
  GUIDE_FLAGS,
  IPTV_GUIDE_API,
  type IptvGuideProgramme,
  type IptvGuideScope,
} from '@ace/shared';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** Las marcas de la regla y el ancho de referencia: cada 30 min. */
export const SLOT_MS = 30 * MINUTE;
/** Un hueco de menos de esto no se pinta: el servidor ya los pega al anterior (§20.4). */
export const GAP_MIN_MS = 2 * MINUTE;
/** Hasta dónde tiene que llegar la guía dentro de un día para que salga su chip. */
export const DAY_WITH_DATA_MS = 6 * HOUR;
/** Días que puede enseñar la parrilla: hoy, mañana y pasado. */
export const MAX_DAYS = 3;
/** Filas por bloque de programas pedido (las teselas son de `IPTV_GUIDE_API.tileMs`). */
export const BLOCK_ROWS = IPTV_GUIDE_API.tileRows;
export const TILE_MS = IPTV_GUIDE_API.tileMs;
/** Canales por página de `iptvGuide`. */
export const PAGE_ROWS = IPTV_GUIDE_API.channelsPage;

// ---- Medidas (investigación §2.2) --------------------------------------------------------

export type LayoutKind = 'mobile' | 'tablet' | 'desktop' | 'wide';

export interface Scale {
  /** Píxeles por minuto. */
  ppm: number;
  /** Columna de canales. */
  colW: number;
  rowH: number;
  rulerH: number;
  /** Franja del programa elegido abajo (0 en el móvil: allí es una hoja). */
  stripH: number;
}

export function scaleFor(kind: LayoutKind): Scale {
  switch (kind) {
    case 'wide':
      return { ppm: 200 / 30, colW: 232, rowH: 56, rulerH: 36, stripH: 148 };
    case 'desktop':
      return { ppm: 180 / 30, colW: 208, rowH: 56, rulerH: 36, stripH: 148 };
    case 'tablet':
      return { ppm: 160 / 30, colW: 184, rowH: 56, rulerH: 36, stripH: 132 };
    default:
      return { ppm: 120 / 30, colW: 96, rowH: 64, rulerH: 32, stripH: 0 };
  }
}

// ---- Tiempo ------------------------------------------------------------------------------

/** 00:00 del día de `t` en la zona del navegador. */
export function dayStart(t: number): number {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** El mismo reloj `n` días después (respeta los cambios de hora). */
export function addDays(t: number, n: number): number {
  const date = new Date(t);
  date.setDate(date.getDate() + n);
  return date.getTime();
}

export const floorTo = (t: number, step: number): number => Math.floor(t / step) * step;
export const ceilTo = (t: number, step: number): number => Math.ceil(t / step) * step;

const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric' });
const LONG_DAY = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const SHORT_DAY = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export const formatTime = (t: number): string => TIME.format(t);
export const formatRange = (start: number, end: number): string =>
  `${formatTime(start)}-${formatTime(end)}`;
const clean = (text: string): string => text.replace(/\./g, '');
/** «sáb 3 oct». */
export const formatShortDay = (t: number): string => clean(SHORT_DAY.format(t));
/** «sábado, 3 de octubre» → «sábado 3 de octubre». */
export const formatLongDay = (t: number): string => LONG_DAY.format(t).replace(',', '');

/** «Hoy», «Mañana» o «lun 5». */
export function dayLabel(start: number, today: number): string {
  if (start === today) return 'Hoy';
  if (start === addDays(today, 1)) return 'Mañana';
  return clean(WEEKDAY.format(start));
}

/** «Quedan 40 min», «Quedan 1 h 5 min». */
export function remainingText(end: number, now: number): string {
  const minutes = Math.max(1, Math.round((end - now) / MINUTE));
  if (minutes < 60) return `Quedan ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Quedan ${hours} h ${rest} min` : `Quedan ${hours} h`;
}

// ---- La línea de tiempo ------------------------------------------------------------------

export interface GuideDay {
  start: number;
  label: string;
}

export interface Timeline {
  /** Hoy 00:00 (o el inicio de la ventana guardada, si es después). */
  start: number;
  /** Donde acaba la parrilla: hasta donde llega de verdad la guía, redondeado a 30 min. */
  end: number;
  /** Días con programación (siempre al menos hoy). */
  days: GuideDay[];
  /** La guía acaba antes del final del último día: se pinta «Fin de la guía disponible». */
  endsEarly: boolean;
}

export interface Coverage {
  from: number | null;
  to: number | null;
  coveredFrom: number | null;
  coveredTo: number | null;
}

/**
 * De hoy 00:00 hasta donde llega la guía (`coveredTo`, no `to`: la del panel
 * de Isma solo cubre hoy aunque la ventana llegue a +80 h, §20.6), con hoy
 * entero como mínimo y pasado mañana como máximo. Los días son los que tienen
 * algo de programación.
 */
export function buildTimeline(coverage: Coverage, now: number): Timeline {
  const today = dayStart(now);
  const lastEnd = addDays(today, MAX_DAYS);
  const start = coverage.from !== null ? Math.max(today, floorTo(coverage.from, SLOT_MS)) : today;
  const todayEnd = addDays(today, 1);
  let end = todayEnd;
  if (coverage.coveredTo !== null) {
    end = Math.min(lastEnd, ceilTo(coverage.coveredTo, SLOT_MS));
    if (coverage.to !== null) end = Math.min(end, ceilTo(coverage.to, SLOT_MS));
  }
  // Hoy se enseña entero aunque la guía acabe antes: lo que falta es «Sin información».
  end = Math.max(end, todayEnd, start + SLOT_MS);
  const days: GuideDay[] = [];
  for (let index = 0; index < MAX_DAYS; index += 1) {
    const day = addDays(today, index);
    if (day >= end) break;
    // Un día cuenta si la guía llega bien dentro de él, no si solo se asoma un
    // programa que acaba de madrugada (la del panel de Isma acaba hoy, §20.6).
    const hasData =
      index === 0 || (coverage.coveredTo !== null && coverage.coveredTo >= day + DAY_WITH_DATA_MS);
    if (hasData) days.push({ start: day, label: dayLabel(day, today) });
  }
  return { start, end, days, endsEarly: end < lastEnd };
}

/** X (dentro de la zona de programas, sin la columna) de un instante. */
export const xOf = (t: number, timeline: Timeline, scale: Scale): number =>
  ((t - timeline.start) / MINUTE) * scale.ppm;

/** Instante de una x (dentro de la zona de programas). */
export const timeAt = (x: number, timeline: Timeline, scale: Scale): number =>
  timeline.start + (x / scale.ppm) * MINUTE;

/** Las marcas de la regla: cada 30 min de la línea de tiempo. */
export function rulerMarks(timeline: Timeline): number[] {
  const out: number[] = [];
  for (let t = ceilTo(timeline.start, SLOT_MS); t < timeline.end; t += SLOT_MS) out.push(t);
  return out;
}

// ---- Teselas y bloques -------------------------------------------------------------------

/** Las teselas (inicio, alineado en UTC) que tocan [from, to). */
export function tilesBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let tile = floorTo(from, TILE_MS); tile < to; tile += TILE_MS) out.push(tile);
  return out;
}

/** Los bloques de filas que tocan [first, last]. */
export function blocksBetween(first: number, last: number, total: number): number[] {
  if (total <= 0 || last < first) return [];
  const out: number[] = [];
  const end = Math.min(last, total - 1);
  for (
    let block = Math.floor(Math.max(0, first) / BLOCK_ROWS);
    block * BLOCK_ROWS <= end;
    block += 1
  )
    out.push(block);
  return out;
}

/** Las páginas de canales (`iptvGuide`) que hacen falta para las filas [first, last]. */
export function pagesBetween(first: number, last: number, total: number): number[] {
  if (total <= 0 || last < first) return [0];
  const out: number[] = [];
  const end = Math.min(last, total - 1);
  for (let page = Math.floor(Math.max(0, first) / PAGE_ROWS); page * PAGE_ROWS <= end; page += 1)
    out.push(page);
  return out.length ? out : [0];
}

// ---- Tramos de una fila ------------------------------------------------------------------

export type Segment =
  | { kind: 'prog'; start: number; end: number; programme: IptvGuideProgramme }
  /** Hueco, relleno o canal sin guía: «Sin información». */
  | { kind: 'none'; start: number; end: number }
  | { kind: 'loading'; start: number; end: number }
  | { kind: 'error'; start: number; end: number };

export type TileState =
  | { status: 'ok'; programmes: readonly IptvGuideProgramme[] }
  | { status: 'loading' }
  | { status: 'error' };

export const isFiller = (programme: IptvGuideProgramme): boolean =>
  (programme.flags & GUIDE_FLAGS.filler) !== 0 || programme.title.trim() === '';

function push(out: Segment[], segment: Segment): void {
  if (segment.end <= segment.start) return;
  const last = out.at(-1);
  if (last && last.kind === segment.kind && last.kind !== 'prog' && last.end >= segment.start) {
    last.end = Math.max(last.end, segment.end);
    return;
  }
  out.push(segment);
}

/**
 * Los tramos de una fila en [start, end): sus programas (sin repetir los que
 * cruzan dos teselas), «Sin información» en los huecos de 2 min o más y en
 * el relleno, y «cargando» o «error» donde la tesela aún no está. `tiles`
 * dice el estado de cada tesela (por su inicio); `null` es un canal sin guía.
 */
export function buildSegments(
  tiles: ReadonlyMap<number, TileState> | null,
  start: number,
  end: number,
): Segment[] {
  const out: Segment[] = [];
  if (tiles === null) {
    push(out, { kind: 'none', start, end });
    return out;
  }
  let cursor = start;
  const seen = new Set<string>();
  for (const tile of tilesBetween(start, end)) {
    const from = Math.max(tile, start);
    const to = Math.min(tile + TILE_MS, end);
    if (to <= cursor) continue;
    const state = tiles.get(tile) ?? { status: 'loading' };
    if (state.status !== 'ok') {
      push(out, { kind: state.status, start: Math.max(from, cursor), end: to });
      cursor = to;
      continue;
    }
    for (const programme of state.programmes) {
      if (programme.end <= cursor || programme.start >= to || seen.has(programme.id)) continue;
      seen.add(programme.id);
      if (programme.start - cursor >= GAP_MIN_MS)
        push(out, { kind: 'none', start: Math.max(cursor, from), end: programme.start });
      if (isFiller(programme)) {
        push(out, {
          kind: 'none',
          start: Math.max(programme.start, cursor),
          end: Math.min(programme.end, end),
        });
      } else {
        // Un programa que empezó antes se ve desde el principio de la línea de tiempo.
        out.push({
          kind: 'prog',
          start: Math.max(programme.start, start),
          end: Math.min(programme.end, end),
          programme,
        });
      }
      cursor = Math.min(programme.end, end);
    }
    if (cursor < to) {
      push(out, { kind: 'none', start: cursor, end: to });
      cursor = to;
    }
  }
  return out;
}

/** Índice del primer tramo que acaba después de `t` (búsqueda binaria). */
export function firstEndingAfter(segments: readonly Segment[], t: number): number {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((segments[mid]?.end ?? 0) <= t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Los tramos que se ven entre `from` y `to` (con lo que asome por los bordes). */
export function visibleSegments(segments: readonly Segment[], from: number, to: number): Segment[] {
  const out: Segment[] = [];
  for (let index = firstEndingAfter(segments, from); index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || segment.start >= to) break;
    out.push(segment);
  }
  return out;
}

/** El tramo que cubre `t`, o el más cercano. */
export function segmentAt(segments: readonly Segment[], t: number): Segment | null {
  if (!segments.length) return null;
  const index = Math.min(firstEndingAfter(segments, t), segments.length - 1);
  return segments[index] ?? null;
}

/** El tramo anterior o siguiente al que cubre `t` (para ←/→), o null si no hay. */
export function stepSegment(
  segments: readonly Segment[],
  t: number,
  direction: -1 | 1,
): Segment | null {
  const current = Math.min(firstEndingAfter(segments, t), segments.length - 1);
  return segments[current + direction] ?? null;
}

// ---- Programa elegido --------------------------------------------------------------------

export type Airing = 'live' | 'past' | 'future';

export function airingOf(start: number, end: number, now: number): Airing {
  if (end <= now) return 'past';
  if (start > now) return 'future';
  return 'live';
}

/** 0..1 de lo emitido. */
export function progressOf(start: number, end: number, now: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** Lo que dice el lector de pantalla de un bloque. */
export function segmentLabel(segment: Segment, now: number): string {
  if (segment.kind === 'loading') return 'Cargando la programación';
  if (segment.kind === 'error') return 'No se pudo cargar la programación';
  const range = `de ${formatTime(segment.start)} a ${formatTime(segment.end)}`;
  if (segment.kind === 'none') return `Sin información, ${range}`;
  const { programme } = segment;
  const airing = airingOf(programme.start, programme.end, now);
  const tail =
    airing === 'live'
      ? `, en emisión, ${remainingText(programme.end, now).toLowerCase()}`
      : airing === 'past'
        ? ', ya emitido'
        : '';
  return `${programme.title}, de ${formatTime(programme.start)} a ${formatTime(programme.end)}${tail}`;
}

// ---- Ámbito («Favoritos | Todos») --------------------------------------------------------

export const SCOPE_PARAM = 'ambito';
export const SCOPE_URL: Record<IptvGuideScope, string> = { favorites: 'favoritos', all: 'todos' };

export function scopeFromUrl(value: string | null | undefined): IptvGuideScope | null {
  if (value === SCOPE_URL.all) return 'all';
  if (value === SCOPE_URL.favorites) return 'favorites';
  return null;
}

// ---- Teclear el número de un canal (como el mando) ---------------------------------------

export const NUMBER_TYPING_MS = 1200;

/** Fila del canal con ese número o, si no está, la del primero que lo pase. */
export function rowForNumber(
  numbers: ReadonlyArray<number | null | undefined>,
  wanted: number,
): number | null {
  let best: number | null = null;
  let bestNumber = Number.POSITIVE_INFINITY;
  numbers.forEach((number, index) => {
    if (number === null || number === undefined || number < wanted) return;
    if (number < bestNumber) {
      best = index;
      bestNumber = number;
    }
  });
  return best;
}
