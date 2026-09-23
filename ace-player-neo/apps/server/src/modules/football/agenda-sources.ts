/* Las tres fuentes de la agenda y la de muestra, portadas de server.js
   (backend-modulos §3.8): futbolenlatv (2016-2086), EPG de Movistar+
   (2349-2520), TheSportsDB (1862-1908, 1960-1982, 2522-2557) y la demo
   (1910-1953).

   Todo es puro salvo las descargas, que reciben un `TextFetcher` (el cliente
   `net` del servicio, con el plazo global de la agenda, o el de la fachada).
   Cada constructor admite dos sabores:
   - `legacy`: exactamente la 0.6.59 (ids posicionales de futbolenlatv y sin
     `start` en la EPG ni en TheSportsDB). Lo usan las exportaciones antiguas.
   - `stable`: lo nuevo de la v2 (arquitectura §5.10): ids de futbolenlatv por
     hash de fecha, hora, local y visitante, y `start` también en la EPG y en
     TheSportsDB para que marcadores y precalentado funcionen con todas. */

import { createHash } from 'node:crypto';
import type { FootballMatch, FootballSchedule } from '@ace/shared';
import { cleanTitle } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import {
  AGENDA_FETCH_MS,
  EPG_BASE,
  EPG_BATCH,
  EPG_DEMARCATION,
  EPG_MAX_DETAILS,
  EPG_SPORT_CHANNEL,
  FLTV_MAX_BYTES,
  FLTV_URL,
  FOOTBALL_FALLBACK_COMPETITION,
  FOOTBALL_LEAGUE_LOOKUP_BATCH,
  FOOTBALL_LEAGUE_LOOKUP_MAX,
  FOOTBALL_SPAIN,
  FOOTBALL_TIMEZONE,
  THESPORTSDB_BASE,
  THESPORTSDB_PUBLIC_KEY,
} from './constants.js';
import {
  addIsoDays,
  agendaWindow,
  isoDateInMadrid,
  madridClock,
  madridDateTimeWithStart,
} from './time.js';

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose {
  return value && typeof value === 'object' ? (value as Loose) : {};
}

/** Descarga de texto (lanza con el código de `net`: `fetch_timeout`, `http_503`…). */
export type TextFetcher = (
  url: string,
  options?: { readonly maxBytes?: number; readonly totalTimeoutMs?: number },
) => Promise<string>;

export type AgendaFlavor = 'legacy' | 'stable';

/** Lo que necesita cada fuente para construir su agenda. */
export interface AgendaContext {
  /** Instante de la consulta (epoch ms): de él sale "hoy" en Madrid. */
  readonly now: number;
  /** `generatedAt` del resultado (en la 0.6.59, la hora al terminar). */
  readonly generatedAt: () => string;
  /** `FOOTBALL_DAYS` (3 a 14). */
  readonly days: number;
  /** `FOOTBALL_COUNTRY` (TheSportsDB). */
  readonly country: string;
  /** `THESPORTSDB_API_KEY`. */
  readonly apiKey: string;
  readonly flavor: AgendaFlavor;
}

type Source = FootballSchedule['source'];

function schedulePayload(
  ctx: Pick<AgendaContext, 'generatedAt'>,
  fields: {
    readonly source: Source;
    readonly attribution: string;
    readonly demo?: boolean;
    readonly limited?: boolean;
    readonly partial?: boolean;
    readonly days: FootballSchedule['days'];
  },
): FootballSchedule {
  return {
    generatedAt: ctx.generatedAt(),
    timezone: FOOTBALL_TIMEZONE,
    country: FOOTBALL_SPAIN,
    source: fields.source,
    attribution: fields.attribution,
    demo: fields.demo === true,
    limited: fields.limited === true,
    partial: fields.partial === true,
    days: fields.days,
  };
}

/** `footballDaysFromMatches` (server.js:1910-1915): los `days` días desde `startDate`. */
export function footballDaysFromMatches(
  startDate: string,
  matches: readonly FootballMatch[],
  days: number,
): FootballSchedule['days'] {
  return Array.from({ length: days }, (_, index) => {
    const date = addIsoDays(startDate, index);
    return { date, matches: matches.filter((match) => match.date === date) };
  });
}

/** `footballScheduleMatches` (server.js:2559-2562): todos los partidos de una agenda. */
export function footballScheduleMatches(payload: unknown): Loose[] {
  const days = asRecord(payload).days;
  return (Array.isArray(days) ? days : []).flatMap((day) => {
    const matches = asRecord(day).matches;
    return Array.isArray(matches) ? (matches as Loose[]) : [];
  });
}

// --- Ids estables (arquitectura §5.10; backend-modulos §8.2.10) ---

function teamKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Id de partido que no depende de su posición en la agenda: prefijo de la
 * fuente, fecha de Madrid y 10 hex del sha1 de fecha, hora, local y
 * visitante (sin tildes ni mayúsculas). Cabe en el `matchId` de los informes
 * (`[a-zA-Z0-9_.:-]`, 100 como mucho).
 */
export function stableMatchId(
  prefix: string,
  date: string,
  time: string,
  home: string,
  away: string,
): string {
  const digest = createHash('sha1')
    .update([date, time, teamKey(home), teamKey(away)].join('|'))
    .digest('hex')
    .slice(0, 10);
  return `${prefix}-${date}-${digest}`;
}

/** Si dos partidos dan el mismo id (misma fila repetida), el segundo lleva `-2`, el tercero `-3`… */
function uniqueId(id: string, seen: Map<string, number>): string {
  const count = (seen.get(id) ?? 0) + 1;
  seen.set(id, count);
  return count === 1 ? id : `${id}-${count}`;
}

// --- futbolenlatv (server.js:1994-2086) ---

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  Ccedil: 'Ç',
};

/** `decodeHtml` (server.js:2001-2008). */
export function decodeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) =>
      Object.hasOwn(HTML_ENTITIES, name) ? (HTML_ENTITIES[name] ?? whole) : whole,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una emisión de futbolenlatv antes de convertirse en partido. */
export interface FltvAiring {
  start: number;
  date: string;
  time: string;
  home: string;
  away: string;
  competition: string;
  channels: string[];
}

/**
 * `parseFutbolEnLaTv` (server.js:2016-2050): bloques planos de cabecera de
 * competición y filas; la competición se ancla al `title` del `<img>` (los
 * dos formatos de cabecera), la hora sale de `startDate` en UTC y el dial
 * "(M60 O115)" se recorta. `window` = días que entran (null = todos).
 */
export function parseFutbolEnLaTv(
  html: unknown,
  window: ReadonlySet<string> | null | undefined,
): FltvAiring[] {
  const airings: FltvAiring[] = [];
  let competition = '';
  const blocks =
    /<tr class="cabeceraCompericion">[\s\S]*?title="([^"]+)"|<td class="hora\s*">\s*([\d:]+)\s*<\/td>([\s\S]*?)<\/tr>/g;
  let block: RegExpExecArray | null;
  const text = String(html || '');
  while ((block = blocks.exec(text))) {
    if (block[1]) {
      competition = decodeHtml(block[1]);
      continue;
    }
    const row = block[3] || '';
    const startDate = row.match(/itemprop="startDate" content="([^"]+)"/)?.[1];
    if (!startDate) continue;
    // startDate viene en UTC sin sufijo de zona
    const start = Date.parse(`${startDate}Z`);
    if (!Number.isFinite(start)) continue;
    const date = isoDateInMadrid(start);
    if (window && !window.has(date)) continue;

    const home = decodeHtml(row.match(/<td class="local">[\s\S]*?<span title="([^"]*)"/)?.[1]);
    const away = decodeHtml(row.match(/<td class="visitante">[\s\S]*?<span title="([^"]*)"/)?.[1]);
    if (!home || !away) continue;

    const channels = [...row.matchAll(/<li[^>]*title="([^"]+)"/g)]
      .map((entry) =>
        decodeHtml(entry[1])
          .replace(/\s*\(.*$/, '')
          .trim(),
      )
      .filter(Boolean);

    airings.push({
      start,
      date,
      time: madridClock(start),
      home,
      away,
      competition: competition || FOOTBALL_FALLBACK_COMPETITION,
      channels: [...new Set(channels)],
    });
  }
  return airings;
}

/** Partidos de futbolenlatv (server.js:2058-2073), ordenados por hora de saque. */
export function fltvMatches(airings: readonly FltvAiring[], flavor: AgendaFlavor): FootballMatch[] {
  const seen = new Map<string, number>();
  return [...airings]
    .sort((a, b) => a.start - b.start)
    .map((airing, index) => {
      /* La 0.6.59 usaba la posición en toda la agenda (`fltv-<fecha>-<índice>`):
         al aparecer un partido anterior, todos los ids se corrían. */
      const id =
        flavor === 'legacy'
          ? `fltv-${airing.date}-${index}`
          : uniqueId(
              stableMatchId('fltv', airing.date, airing.time, airing.home, airing.away),
              seen,
            );
      return {
        id,
        date: airing.date,
        time: airing.time,
        start: airing.start,
        title: `${airing.home} - ${airing.away}`,
        home: airing.home,
        away: airing.away,
        competition: airing.competition,
        country: FOOTBALL_SPAIN,
        channels: airing.channels.map((name, position) => ({
          id: flavor === 'legacy' ? `fltv-${index}-${position}` : `${id}-${position}`,
          name,
        })),
      };
    });
}

/** `fetchFutbolEnLaTvSchedule` (server.js:2052-2086). Lanza `fltv_empty` si no hay partidos. */
export async function fetchFutbolEnLaTvSchedule(
  fetchText: TextFetcher,
  ctx: AgendaContext,
): Promise<FootballSchedule> {
  const startDate = isoDateInMadrid(ctx.now);
  const window = agendaWindow(startDate, ctx.days);
  const html = await fetchText(FLTV_URL, {
    maxBytes: FLTV_MAX_BYTES,
    totalTimeoutMs: AGENDA_FETCH_MS,
  });
  const airings = parseFutbolEnLaTv(html, window);
  if (!airings.length) throw new AppError('fltv_empty');
  return schedulePayload(ctx, {
    source: 'futbolenlatv',
    attribution: 'futbolenlatv.com',
    days: footballDaysFromMatches(startDate, fltvMatches(airings, ctx.flavor), ctx.days),
  });
}

// --- EPG de Movistar+ (server.js:2349-2520) ---

async function epgJson(fetchText: TextFetcher, url: string): Promise<unknown> {
  const text = await fetchText(url);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('epg_bad_response');
  }
}

/** `epgTitleKey` (server.js:2373-2382). */
export function epgTitleKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/-->.*$/, ' ')
    .replace(/[*#]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `epgSplitTeams` (server.js:2384-2390): "Sevilla - Rayo" → equipos; sin guion, null. T-013. */
export function epgSplitTeams(value: unknown): { home: string; away: string } | null {
  const parts = String(value || '').split(/\s+[-–—]\s+/);
  if (parts.length !== 2) return null;
  const home = cleanTitle(parts[0], '');
  const away = cleanTitle(parts[1], '');
  return home && away ? { home, away } : null;
}

export interface EpgChannel {
  readonly id: string;
  readonly name: string;
}

/** Una emisión de la rejilla (`airing` de server.js:2486-2495), con su ficha si la hubo. */
export interface EpgAiring {
  readonly channel: EpgChannel;
  readonly row: Loose;
  readonly date: string;
  readonly start: number;
  readonly time: string;
  detail?: { readonly teams: string; readonly competition: string } | null;
}

async function epgFootballChannels(fetchText: TextFetcher): Promise<EpgChannel[]> {
  const channels = await epgJson(
    fetchText,
    `${EPG_BASE}/OTT/contents/channels?mdrm=true&tlsstream=true&demarcation=${EPG_DEMARCATION}&version=8`,
  );
  if (!Array.isArray(channels)) throw new AppError('epg_bad_response');
  return channels
    .map(asRecord)
    .filter((channel) => EPG_SPORT_CHANNEL.test(String(channel.Nombre || '')))
    .map((channel) => ({
      id: String(channel.CodCadenaTv || ''),
      name: cleanTitle(channel.Nombre, ''),
    }))
    .filter((channel) => channel.id && channel.name);
}

async function epgChannelGrid(
  fetchText: TextFetcher,
  channel: EpgChannel,
  from: string,
  span: number,
): Promise<Loose[]> {
  const rows = await epgJson(
    fetchText,
    `${EPG_BASE}/OTT/epg?from=${from}T00:00:00&span=${span}&channel=${encodeURIComponent(channel.id)}` +
      `&version=8&mdrm=true&tlsstream=true&demarcation=${EPG_DEMARCATION}`,
  );
  return Array.isArray(rows) ? rows.map(asRecord) : [];
}

/* La rejilla solo trae títulos genéricos ("LALIGA EA SPORTS"); los equipos y
   la competición están en la ficha, a una petición por emisión. */
async function epgAiringDetails(
  fetchText: TextFetcher,
  airing: EpgAiring,
): Promise<{ teams: string; competition: string } | null> {
  const id = String(airing.row.Ficha || '').match(/contents\/(\d+)\/details/)?.[1];
  if (!id) return null;
  const data = asRecord(
    await epgJson(
      fetchText,
      `${EPG_BASE}/contents/${id}/details?mediaType=FOTOV&profile=OTT&mode=VODREJILLA` +
        `&channels=${encodeURIComponent(airing.channel.id)}&version=8&tlsStream=true&mdrm=true` +
        `&catalog=events&showNonRated=true`,
    ),
  );
  return {
    teams: cleanTitle(data.TituloEpisodio, ''),
    competition: cleanTitle(asRecord(data.Contenedor).TituloSerie, ''),
  };
}

type EpgMatch = FootballMatch & { start: number };

/**
 * `normalizeEpgAirings` (server.js:2430-2465): agrupa por día y título (un
 * partido que va por dos cadenas es uno), con la hora más temprana y los
 * canales sin repetir. La 0.6.59 quitaba `start`; con `keepStart` (v2) se
 * conserva. T-014, T-015.
 */
export function normalizeEpgAirings(
  airings: readonly EpgAiring[],
  options: { readonly keepStart?: boolean } = {},
): FootballMatch[] {
  const grouped = new Map<string, EpgMatch>();
  for (const airing of airings) {
    const teams = epgSplitTeams(airing.detail?.teams);
    const title =
      cleanTitle(airing.detail?.teams, '') ||
      cleanTitle(airing.row?.Titulo, 'Partido por confirmar');
    const key = `${airing.date}|${epgTitleKey(title)}`;
    let match = grouped.get(key);
    if (!match) {
      match = {
        id: `epg-${String(airing.row?.ShowId || airing.row?.CodEventoRejilla || epgTitleKey(key))}`.slice(
          0,
          80,
        ),
        date: airing.date,
        time: airing.time,
        title,
        home: teams?.home || title,
        away: teams?.away || '',
        competition:
          cleanTitle(airing.detail?.competition, '') ||
          cleanTitle(airing.row?.Titulo, FOOTBALL_FALLBACK_COMPETITION),
        country: FOOTBALL_SPAIN,
        channels: [],
        start: airing.start,
      };
      grouped.set(key, match);
    }
    if (airing.start < match.start) {
      match.start = airing.start;
      match.time = airing.time;
    }
    const name = airing.channel?.name || '';
    if (
      name &&
      !match.channels.some((channel) => channel.name.toLowerCase() === name.toLowerCase())
    ) {
      match.channels.push({ id: airing.channel.id, name });
    }
  }
  return [...grouped.values()]
    .map(({ start, ...match }) =>
      options.keepStart && Number.isFinite(start) ? { ...match, start } : match,
    )
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

/** `fetchEpgFootballSchedule` (server.js:2467-2520). Lanza `epg_unavailable`, `epg_empty` o `epg_bad_response`. */
export async function fetchEpgFootballSchedule(
  fetchText: TextFetcher,
  ctx: AgendaContext,
): Promise<FootballSchedule> {
  const startDate = isoDateInMadrid(ctx.now);
  const window = agendaWindow(startDate, ctx.days);
  const channels = await epgFootballChannels(fetchText);
  if (!channels.length) throw new AppError('epg_unavailable');

  // span cubre toda la ventana: una sola petición de rejilla por canal
  const grids: { channel: EpgChannel; rows: Loose[] }[] = [];
  for (let index = 0; index < channels.length; index += EPG_BATCH) {
    const batch = channels.slice(index, index + EPG_BATCH);
    const settled = await Promise.allSettled(
      batch.map((channel) => epgChannelGrid(fetchText, channel, startDate, ctx.days)),
    );
    settled.forEach((result, offset) => {
      const channel = batch[offset];
      if (result.status === 'fulfilled' && channel) grids.push({ channel, rows: result.value });
    });
  }
  if (!grids.length) throw new AppError('epg_unavailable');

  const airings: EpgAiring[] = [];
  for (const { channel, rows } of grids) {
    for (const row of rows) {
      if (row.Directo !== true) continue;
      if (!/f[úu]tbol/i.test(String(row.GeneroComAntena || ''))) continue;
      const start = Number(row.FechaHoraInicio);
      if (!Number.isFinite(start)) continue;
      const date = isoDateInMadrid(start);
      if (!window.has(date)) continue;
      airings.push({ channel, row, date, start, time: madridClock(start) });
    }
  }
  if (!airings.length) throw new AppError('epg_empty');

  airings.sort((a, b) => a.start - b.start);
  const detailed = airings.slice(0, EPG_MAX_DETAILS);
  for (let index = 0; index < detailed.length; index += EPG_BATCH) {
    const batch = detailed.slice(index, index + EPG_BATCH);
    const settled = await Promise.allSettled(
      batch.map((airing) => epgAiringDetails(fetchText, airing)),
    );
    settled.forEach((result, offset) => {
      const airing = batch[offset];
      if (result.status === 'fulfilled' && result.value && airing) airing.detail = result.value;
    });
  }

  return schedulePayload(ctx, {
    source: 'movistarplus',
    attribution: 'EPG de Movistar Plus+',
    partial: grids.length !== channels.length || airings.length > detailed.length,
    days: footballDaysFromMatches(
      startDate,
      normalizeEpgAirings(airings, { keepStart: ctx.flavor === 'stable' }),
      ctx.days,
    ),
  });
}

// --- TheSportsDB (server.js:1862-1908, 1960-1982, 2522-2557) ---

/** `splitFootballEvent` (server.js:1862-1870): "Barcelona vs Valencia" → equipos. */
export function splitFootballEvent(value: unknown): { title: string; home: string; away: string } {
  const title = cleanTitle(value, 'Partido por confirmar');
  const match = title.match(/^(.*?)\s+(?:vs\.?|v)\s+(.*?)$/i);
  return {
    title,
    home: cleanTitle(match?.[1], title),
    away: cleanTitle(match?.[2], ''),
  };
}

/**
 * `normalizeFootballRows` (server.js:1872-1908): agrupa las filas de un mismo
 * evento, pasa la hora de UTC a Madrid y junta los canales sin repetir.
 * Con `withStart` (v2) añade el saque en epoch ms si la hora era válida. T-006.
 */
export function normalizeFootballRows(
  rows: unknown,
  options: { readonly country: string; readonly withStart?: boolean },
): FootballMatch[] {
  const grouped = new Map<string, FootballMatch>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = asRecord(raw);
    const sport = String(row.strSport || 'Soccer').toLowerCase();
    if (!sport.includes('soccer') && !sport.includes('football')) continue;
    const local = madridDateTimeWithStart(row.dateEvent, row.strTime);
    if (!local) continue;
    const { date, time } = local;
    const event = splitFootballEvent(row.strEvent);
    const rawId = String(row.idEvent || row.id || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 80);
    const id =
      rawId ||
      `${date}-${time}-${event.title}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 80);
    const key = `${id}|${date}|${time}`;
    let match = grouped.get(key);
    if (!match) {
      match = {
        id,
        date,
        time,
        ...(options.withStart && local.start !== null ? { start: local.start } : {}),
        title: event.title,
        home: event.home,
        away: event.away,
        competition: cleanTitle(row.strLeague || row.strCompetition, FOOTBALL_FALLBACK_COMPETITION),
        country: cleanTitle(row.strCountry, options.country),
        channels: [],
      };
      grouped.set(key, match);
    }
    const name = cleanTitle(row.strChannel, '');
    if (
      name &&
      !match.channels.some((channel) => channel.name.toLowerCase() === name.toLowerCase())
    ) {
      match.channels.push({
        id: String(row.idChannel || '')
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 80),
        name,
      });
    }
  }
  return [...grouped.values()].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
}

/** `lookupFootballLeague` (server.js:1963-1968): liga de un evento; "" si no la trae. */
export async function lookupFootballLeague(
  fetchText: TextFetcher,
  apiKey: string,
  idEvent: string,
): Promise<string> {
  const url = `${THESPORTSDB_BASE}/${apiKey}/lookupevent.php?id=${encodeURIComponent(idEvent)}`;
  const data = asRecord(JSON.parse(await fetchText(url)) as unknown);
  const event = Array.isArray(data.events) ? asRecord(data.events[0]) : {};
  return cleanTitle(event.strLeague, '');
}

/**
 * `enrichFootballLeagues` (server.js:1970-1982): pide la liga solo de los
 * partidos con "Fútbol" genérico e id numérico, 40 como mucho, en tandas de
 * 5; un fallo deja "Fútbol". T-023.
 */
export async function enrichFootballLeagues<T extends { id: string; competition: string }>(
  matches: T[],
  lookup: (idEvent: string) => Promise<string>,
): Promise<T[]> {
  const pending = matches
    .filter(
      (match) => match.competition === FOOTBALL_FALLBACK_COMPETITION && /^\d+$/.test(match.id),
    )
    .slice(0, FOOTBALL_LEAGUE_LOOKUP_MAX);
  for (let index = 0; index < pending.length; index += FOOTBALL_LEAGUE_LOOKUP_BATCH) {
    const batch = pending.slice(index, index + FOOTBALL_LEAGUE_LOOKUP_BATCH);
    const settled = await Promise.allSettled(batch.map((match) => lookup(match.id)));
    settled.forEach((result, offset) => {
      const match = batch[offset];
      if (result.status === 'fulfilled' && result.value && match) match.competition = result.value;
    });
  }
  return matches;
}

/** `fetchFootballSchedule` (server.js:2522-2557): último recurso. Lanza `football_unavailable`. */
export async function fetchTheSportsDbSchedule(
  fetchText: TextFetcher,
  ctx: AgendaContext,
): Promise<FootballSchedule> {
  const startDate = isoDateInMadrid(ctx.now);
  /* Madrid va por delante de UTC: un partido de madrugada aparece en el día
     UTC anterior. Se pide un día extra por detrás (server.js:2524-2527). */
  const dates = Array.from({ length: ctx.days + 1 }, (_, index) =>
    addIsoDays(startDate, index - 1),
  );
  const settled = await Promise.allSettled(
    dates.map(async (date) => {
      const params = new URLSearchParams({ d: date, s: 'Soccer', a: ctx.country });
      const text = await fetchText(`${THESPORTSDB_BASE}/${ctx.apiKey}/eventstv.php?${params}`);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AppError('football_unavailable');
      }
      const events = asRecord(data).tvevents;
      return Array.isArray(events) ? (events as unknown[]) : [];
    }),
  );
  const successful = settled.filter(
    (result): result is PromiseFulfilledResult<unknown[]> => result.status === 'fulfilled',
  );
  if (!successful.length) throw new AppError('football_unavailable');
  const rows = successful.flatMap((result) => result.value);
  const matches = await enrichFootballLeagues(
    normalizeFootballRows(rows, { country: ctx.country, withStart: ctx.flavor === 'stable' }),
    (idEvent) => lookupFootballLeague(fetchText, ctx.apiKey, idEvent),
  );
  return schedulePayload(ctx, {
    source: 'thesportsdb',
    attribution: 'TheSportsDB',
    limited: ctx.apiKey === THESPORTSDB_PUBLIC_KEY,
    partial: successful.length !== dates.length,
    days: footballDaysFromMatches(startDate, matches, ctx.days),
  });
}

// --- Demo (server.js:1917-1953) ---

const DEMO_SAMPLES = [
  {
    offset: 0,
    time: '20:00',
    home: 'FC Barcelona',
    away: 'Juventus',
    competition: 'Amistoso',
    channels: ['DAZN'],
  },
  {
    offset: 0,
    time: '20:15',
    home: 'Barcelona SC',
    away: 'Emelec',
    competition: 'Amistoso',
    channels: ['Zapping'],
  },
  {
    offset: 0,
    time: '22:00',
    home: 'España',
    away: 'Marruecos',
    competition: 'Amistoso',
    channels: ['La 1 HD'],
  },
  {
    offset: 0,
    time: '18:30',
    home: 'Real Sociedad',
    away: 'Villarreal',
    competition: 'LaLiga',
    channels: ['DAZN LaLiga'],
  },
  {
    offset: 0,
    time: '21:00',
    home: 'Real Madrid',
    away: 'Manchester City',
    competition: 'Champions League',
    channels: ['M+ Liga de Campeones'],
  },
  {
    offset: 1,
    time: '19:00',
    home: 'Real Betis',
    away: 'Athletic Club',
    competition: 'LaLiga',
    channels: ['GOL Play'],
  },
  {
    offset: 1,
    time: '21:30',
    home: 'Barcelona',
    away: 'Atlético de Madrid',
    competition: 'LaLiga',
    channels: ['DAZN LaLiga 2'],
  },
  {
    offset: 2,
    time: '20:45',
    home: 'Inter',
    away: 'AC Milan',
    competition: 'Champions League',
    channels: ['M+ Liga de Campeones'],
  },
  {
    offset: 2,
    time: '21:00',
    home: 'España',
    away: 'Portugal',
    competition: 'Nations League',
    channels: ['La 1 HD'],
  },
  {
    offset: 3,
    time: '18:30',
    home: 'Arsenal',
    away: 'Liverpool',
    competition: 'Premier League',
    channels: ['DAZN'],
  },
] as const;

/**
 * `buildFootballDemoSchedule` (server.js:1917-1953): agenda de desarrollo sin
 * servicios externos (`FOOTBALL_DEMO_ONLY`). Ids `demo-N`, título
 * "Local vs Visitante" y sin `start`, como la 0.6.59. T-020, T-024.
 */
export function buildFootballDemoSchedule(
  startDate: string,
  ctx: Pick<AgendaContext, 'generatedAt' | 'days'>,
): FootballSchedule {
  const matches: FootballMatch[] = DEMO_SAMPLES.map((sample, index) => ({
    id: `demo-${index + 1}`,
    date: addIsoDays(startDate, sample.offset),
    time: sample.time,
    title: `${sample.home} vs ${sample.away}`,
    home: sample.home,
    away: sample.away,
    competition: sample.competition,
    country: FOOTBALL_SPAIN,
    channels: sample.channels.map((name, channelIndex) => ({
      id: `demo-channel-${index}-${channelIndex}`,
      name,
    })),
  }));
  return schedulePayload(ctx, {
    source: 'demo',
    attribution: 'Datos de muestra',
    demo: true,
    days: footballDaysFromMatches(startDate, matches, ctx.days),
  });
}
