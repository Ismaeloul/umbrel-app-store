/* Ventana útil de la guía XMLTV (docs/iptv.md §3.6). Solo por dentro: nada
   de esto se enseña, salvo la línea de estado de Ajustes (canales con guía y
   fecha).

   Qué se guarda (en `guia.enc` y en memoria, `Map<tvgId, programas>`):
   - solo la ventana de ahora a +48 h;
   - solo programas de canales del catálogo que pasan el filtro de país;
   - solo lo que parece un evento: texto con un separador de enfrentamiento
     entre dos grupos de palabras, o categoría deportiva;
   - 60 000 programas como mucho (los más cercanos). */

import type { Readable } from 'node:stream';
import { IPTV_GUIDE_LIMITS } from '@ace/shared';
import type { GuideProgramme } from './guide-match.js';
import { normalizeGuideText } from './guide-match.js';
import { parseXmltvStream, type XmltvProgramme } from './xmltv.js';

/** Programa guardado, con su canal (`tvg-id` en minúsculas). */
export interface StoredProgramme extends GuideProgramme {
  readonly channel: string;
}

export interface GuideWindow {
  /** Epoch ms de la descarga. */
  readonly builtAt: number;
  /** Programas por `tvg-id` (minúsculas), ordenados por hora. */
  readonly byChannel: ReadonlyMap<string, readonly StoredProgramme[]>;
  readonly programmes: number;
}

/** Lo que se guarda en `guia.enc`. */
export interface StoredGuide {
  readonly v: 1;
  readonly providerId: string;
  readonly builtAt: number;
  /** `[canal, inicio, fin, título, subtítulo, descripción, categorías, flags]` (flags: 1 repetido, 2 directo). */
  readonly items: readonly (readonly [
    string,
    number,
    number,
    string,
    string,
    string,
    readonly string[],
    number,
  ])[];
}

const MATCHUP_RE = /[a-z0-9]{2,}[a-z0-9 .'()]*\s(?:-|vs\.?|v|x|contra|\/)\s[a-z0-9]{2,}/;
const SPORT_RE = /\b(?:sport|sports|deporte|deportes|futbol|football|soccer)\b/;

/** ¿Parece un evento? (enfrentamiento en el texto o categoría deportiva). */
export function looksLikeEvent(
  programme: Pick<XmltvProgramme, 'title' | 'subTitle' | 'desc' | 'categories'>,
): boolean {
  for (const field of [programme.title, programme.subTitle, programme.desc]) {
    if (MATCHUP_RE.test(normalizeGuideText(field))) return true;
  }
  return programme.categories.some((category) => SPORT_RE.test(normalizeGuideText(category)));
}

export interface GuideBuildOptions {
  readonly now: number;
  /** `tvg-id` (minúsculas) de los canales que valen, con su `tvg-shift` en horas. */
  readonly channels: ReadonlyMap<string, number>;
  readonly signal?: AbortSignal;
  readonly windowMs?: number;
  readonly maxProgrammes?: number;
}

/** Construye la ventana útil desde el cuerpo (ya descomprimido) de una guía XMLTV. */
export async function buildGuideWindow(
  body: Readable,
  options: GuideBuildOptions,
): Promise<GuideWindow> {
  const windowEnd = options.now + (options.windowMs ?? IPTV_GUIDE_LIMITS.windowMs);
  const max = options.maxProgrammes ?? IPTV_GUIDE_LIMITS.maxProgrammes;
  const kept: StoredProgramme[] = [];
  await parseXmltvStream(
    body,
    {
      onProgramme(programme) {
        const channel = programme.channel.trim().toLowerCase();
        const shift = options.channels.get(channel);
        if (shift === undefined) return;
        if (programme.start === null || programme.stop === null) return;
        const offset = programme.naiveTime ? shift * 3_600_000 : 0;
        const start = programme.start + offset;
        const stop = programme.stop + offset;
        if (stop <= options.now || start >= windowEnd || stop <= start) return;
        if (!looksLikeEvent(programme)) return;
        kept.push({
          channel,
          start,
          stop,
          title: programme.title,
          subTitle: programme.subTitle,
          desc: programme.desc,
          categories: programme.categories,
          previouslyShown: programme.previouslyShown,
          live: programme.live,
        });
        /* Tope: se quedan los más cercanos a ahora (se poda de vez en cuando). */
        if (kept.length > max * 2) prune(kept, options.now, max);
      },
    },
    options.signal ? { signal: options.signal } : {},
  );
  prune(kept, options.now, max);
  return windowFrom(kept, options.now);
}

function prune(list: StoredProgramme[], now: number, max: number): void {
  if (list.length <= max) return;
  list.sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now));
  list.length = max;
}

/** Ventana desde una lista de programas (ordena y agrupa por canal). */
export function windowFrom(list: readonly StoredProgramme[], builtAt: number): GuideWindow {
  const byChannel = new Map<string, StoredProgramme[]>();
  for (const programme of list) {
    let bucket = byChannel.get(programme.channel);
    if (!bucket) {
      bucket = [];
      byChannel.set(programme.channel, bucket);
    }
    bucket.push(programme);
  }
  for (const bucket of byChannel.values()) bucket.sort((a, b) => a.start - b.start);
  return { builtAt, byChannel, programmes: list.length };
}

/** Quita lo que ya ha terminado (la ventana se mueve con el tiempo). */
export function trimWindow(window: GuideWindow, now: number): GuideWindow {
  const list: StoredProgramme[] = [];
  for (const bucket of window.byChannel.values()) {
    for (const programme of bucket) if (programme.stop > now) list.push(programme);
  }
  return list.length === window.programmes ? window : windowFrom(list, window.builtAt);
}

export function guideToStored(window: GuideWindow, providerId: string): StoredGuide {
  const items: StoredGuide['items'][number][] = [];
  for (const bucket of window.byChannel.values()) {
    for (const p of bucket) {
      items.push([
        p.channel,
        p.start,
        p.stop,
        p.title,
        p.subTitle,
        p.desc,
        p.categories,
        (p.previouslyShown ? 1 : 0) | (p.live ? 2 : 0),
      ]);
    }
  }
  return { v: 1, providerId, builtAt: window.builtAt, items };
}

export function guideFromStored(value: unknown, providerId: string): GuideWindow | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredGuide>;
  if (stored.v !== 1 || stored.providerId !== providerId || !Array.isArray(stored.items))
    return null;
  const list: StoredProgramme[] = [];
  for (const item of stored.items) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
    const [channel, start, stop, title, subTitle, desc, categories, flags] = item;
    if (typeof start !== 'number' || typeof stop !== 'number') continue;
    list.push({
      channel,
      start,
      stop,
      title: String(title ?? ''),
      subTitle: String(subTitle ?? ''),
      desc: String(desc ?? ''),
      categories: Array.isArray(categories) ? categories.map(String) : [],
      previouslyShown: (Number(flags) & 1) === 1,
      live: (Number(flags) & 2) === 2,
    });
  }
  return windowFrom(list, typeof stored.builtAt === 'number' ? stored.builtAt : 0);
}
