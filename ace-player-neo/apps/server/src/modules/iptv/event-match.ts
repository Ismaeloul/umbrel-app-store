/* Canales de evento de la IPTV con el partido en el nombre (docs/iptv.md
   §4.9, 0.9.9). Puro.

   Las categorías «ES| DAZN PPV», «SOCCER PPV», «MLS PPV», «RFEF PPV», «TV
   FOOTBALL PPV» o «VIX PPV» no tienen un nombre de canal fijo: cada fila es
   un hueco («DAZN PPV 2») cuyo nombre cambia con lo que emite y lleva el
   partido y la hora dentro:

     Next Paynesville FC vs. Down Town FC LFA First Division - Liberia 2026-10-21 16:00 (GMT) 8K EXCLUSIVE ES: DAZN PPV 2
     NEXT CINCINNATI VS. D.C. Thu 22 Oct 01:00 CEST (ES) 8K EXCLUSIVE ES: MLS PPV 1
     RFEF EVENTO 01 1ª RFEF FINALIZADO UD Logroñés VS Cultural Leonesa J8 18/10 19:55
     América vs. Club Tijuana (2026-10-28 22:45:00)
     NO EVENT STREAMING NOW - 8K EXCLUSIVE ES: DAZN PPV 7

   Son justo los partidos que la agenda anuncia como «OneFootball PPV», «TV
   FootballClub», «Apple TV», «Primera Federación» o «DAZN» a secas, que por
   nombre de canal no casan con nada. Aquí se emparejan como la guía: los
   DOS equipos en el nombre (`teamsInText`, con los alias de la guía) y, si
   el nombre trae hora, a menos de 45 min del saque. Una fila «NO EVENT» o
   «FINALIZADO» no cuenta. Solo España o sin país.

   El catálogo se refresca cada 6 h (§3.5): un hueco que cambia de partido
   entre medias no se ve hasta el siguiente refresco. */

import { IPTV_GUIDE_SCORE } from '@ace/shared';
import type { Catalog, CatalogEntry } from './catalog.js';
import { teamCache, teamSearchText, teamsInText } from './guide-match.js';
import { groupMatch, type IptvGroupMatch, type VariantOptions } from './match.js';
import type { IptvProgramInput } from './types.js';

const MINUTE = 60_000;
/** Lo que puede separar la hora del nombre del saque de la agenda. */
export const EVENT_TIME_TOLERANCE_MS = 45 * MINUTE;

/* Categorías y nombres de los huecos de evento. */
const EVENT_GROUP_RE = /(?<![\p{L}\p{N}])(?:ppv|evento|events?)(?![\p{L}\p{N}])/iu;
/* Un hueco vacío o un partido ya acabado. */
const IDLE_RE =
  /(?<![\p{L}\p{N}])(?:no\s+(?:event|match)s?|finalizado|finished|ended|terminado)(?![\p{L}\p{N}])/iu;
/* El nombre del hueco: «DAZN PPV 2», «SOCCER PPV 14», «RFEF EVENTO 01», «LIGA F EVENTO 03». */
const SLOT_TAIL_RE = /((?:[A-Z][A-Z0-9]*\s+){0,3}(?:PPV|EVENTO?)\s*\d{1,3})\s*$/u;
const SLOT_HEAD_RE = /^\s*((?:[A-Z][A-Z0-9]*\s+){0,3}(?:PPV|EVENTO?)\s*\d{1,3})(?![\p{L}\p{N}])/u;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8,
  sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
}; // prettier-ignore

/* «2026-10-21 16:00 (GMT)», «(2026-10-28 22:45:00)». */
const ISO_RE =
  /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*\(?\s*(GMT|UTC|CEST|CET)?\)?/iu;
/* «21-10-2026 14:00 (GMT)». */
const DMY_RE = /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*\(?\s*(GMT|UTC|CEST|CET)?\)?/iu;
/* «Thu 22 Oct 01:00 CEST», «22 Oct 01:00». */
const DAY_MONTH_RE =
  /(?<![\p{L}\p{N}])(\d{1,2})\s+([a-z]{3,4})\.?\s+(\d{1,2}):(\d{2})\s*(GMT|UTC|CEST|CET)?/iu;
/* «18/10 19:55» (RFEF: hora de Madrid, sin año). */
const DM_RE = /(?<![\p{L}\p{N}/])(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?![\p{N}])/u;

const MADRID = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Madrid',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/* Desfase de Madrid respecto a UTC en un instante (ms). */
function madridOffsetAt(ms: number): number {
  const parts = MADRID.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
  );
  return asUtc - ms;
}

/* Una hora local de Madrid a epoch ms. */
function madridToEpoch(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - madridOffsetAt(guess);
  return guess - madridOffsetAt(first);
}

function zoneToEpoch(
  zone: string | undefined,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const upper = (zone ?? '').toUpperCase();
  if (upper === 'GMT' || upper === 'UTC') return Date.UTC(year, month - 1, day, hour, minute);
  if (upper === 'CEST') return Date.UTC(year, month - 1, day, hour - 2, minute);
  if (upper === 'CET') return Date.UTC(year, month - 1, day, hour - 1, minute);
  return madridToEpoch(year, month, day, hour, minute);
}

function valid(month: number, day: number, hour: number, minute: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59;
}

/**
 * La hora que trae el nombre del hueco (epoch ms), o null si no trae
 * ninguna. Sin año («18/10 19:55», «Thu 22 Oct 01:00») se toma el del saque
 * de la agenda. Sin zona, hora de Madrid.
 */
export function eventStart(title: string, kickoff: number): number | null {
  const text = String(title ?? '');
  const year = new Date(kickoff).getUTCFullYear();
  let match = ISO_RE.exec(text);
  if (match) {
    const [, y, m, d, h, min, zone] = match;
    if (valid(Number(m), Number(d), Number(h), Number(min)))
      return zoneToEpoch(zone, Number(y), Number(m), Number(d), Number(h), Number(min));
  }
  match = DMY_RE.exec(text);
  if (match) {
    const [, d, m, y, h, min, zone] = match;
    if (valid(Number(m), Number(d), Number(h), Number(min)))
      return zoneToEpoch(zone, Number(y), Number(m), Number(d), Number(h), Number(min));
  }
  match = DAY_MONTH_RE.exec(text);
  if (match) {
    const [, d, monthName, h, min, zone] = match;
    const m = MONTHS[(monthName ?? '').toLowerCase()];
    if (m && valid(m, Number(d), Number(h), Number(min)))
      return zoneToEpoch(zone, year, m, Number(d), Number(h), Number(min));
  }
  match = DM_RE.exec(text);
  if (match) {
    const [, d, m, h, min] = match;
    if (valid(Number(m), Number(d), Number(h), Number(min)))
      return madridToEpoch(year, Number(m), Number(d), Number(h), Number(min));
  }
  return null;
}

/** ¿Es un hueco de evento (por su categoría o por su nombre)? */
export function isEventChannel(title: string, group: string | null | undefined): boolean {
  return EVENT_GROUP_RE.test(String(group ?? '')) || EVENT_GROUP_RE.test(String(title ?? ''));
}

/** ¿Está el hueco vacío o el partido acabado («NO EVENT STREAMING», «FINALIZADO»)? */
export function isIdleEvent(title: string): boolean {
  return IDLE_RE.test(String(title ?? ''));
}

/** El nombre corto del hueco («DAZN PPV 2», «RFEF EVENTO 01»), o el nombre entero si no se reconoce. */
export function eventChannelLabel(title: string): string {
  const text = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const tail = SLOT_TAIL_RE.exec(text)?.[1];
  if (tail) return tail.replace(/\s+/g, ' ').trim();
  const head = SLOT_HEAD_RE.exec(text)?.[1];
  if (head) return head.replace(/\s+/g, ' ').trim();
  return text;
}

/* Los huecos de evento de un catálogo, una vez por catálogo. */
const EVENT_ENTRIES = new WeakMap<Catalog, readonly CatalogEntry[]>();

export function eventEntries(catalog: Catalog): readonly CatalogEntry[] {
  let entries = EVENT_ENTRIES.get(catalog);
  if (!entries) {
    entries = catalog.entries.filter(
      (entry) =>
        (entry.country === null || entry.country === 'ES') &&
        isEventChannel(entry.title, entry.group),
    );
    EVENT_ENTRIES.set(catalog, entries);
  }
  return entries;
}

/**
 * Los huecos de evento que dan este partido: los dos equipos en el nombre
 * y, si trae hora, a menos de 45 min del saque. Un hueco una vez (sus
 * variantes de calidad van juntas, como en cualquier canal), con la
 * puntuación de la guía y el nombre corto del hueco como canal emparejado.
 */
export function matchEventChannels(
  catalog: Catalog,
  program: IptvProgramInput,
  options: VariantOptions = {},
): IptvGroupMatch[] {
  if (program.start === null || !program.home.trim() || !program.away.trim()) return [];
  const cache = teamCache({ home: program.home, away: program.away });
  if (!cache.home.length || !cache.away.length) return [];
  const kickoff = program.start;
  const seen = new Set<string>();
  const out: IptvGroupMatch[] = [];
  for (const entry of eventEntries(catalog)) {
    if (seen.has(entry.key) || isIdleEvent(entry.title)) continue;
    const text = teamSearchText(entry.title);
    /* Antes de las expresiones regulares, la cuenta barata: algún alias de cada equipo dentro. */
    if (
      !cache.home.some((alias) => text.includes(alias)) ||
      !cache.away.some((alias) => text.includes(alias)) ||
      !teamsInText(text, cache.home, cache.away)
    ) {
      continue;
    }
    const start = eventStart(entry.title, kickoff);
    if (start !== null && Math.abs(start - kickoff) > EVENT_TIME_TOLERANCE_MS) continue;
    seen.add(entry.key);
    const match = groupMatch(
      entry.key,
      entry.bucket,
      catalog.channelOf(entry),
      {
        score: IPTV_GUIDE_SCORE,
        matchedChannel: eventChannelLabel(entry.title),
        guide: false,
        event: true,
      },
      options,
    );
    if (match) out.push(match);
  }
  return out.sort((a, b) => a.best.order - b.best.order);
}
