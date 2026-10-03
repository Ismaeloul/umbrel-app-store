/* Guía TV de ejemplo (docs/iptv.md §20.8). La usan la demo de la web
   (`?demo=1`, sin servidor: el manejador de cada ruta llama a la función
   que toca), los ejemplos de fixtures/ y las pruebas.

   Pura y determinista: la misma hora da la misma guía, y dos trozos que se
   solapan dicen lo mismo. La parrilla de cada canal sale de un generador
   pseudoaleatorio con su número y el día (UTC), así que no cambia al
   desplazarse. El sello (`version`) cambia cada 8 h, como una guía de
   verdad que se vuelve a descargar.

   Todo es inventado salvo la FORMA: 52 canales con nombres como los de una
   IPTV española (y 3 de otros países, que van al final de «Todos»),
   programas de 5 min a 3 h, partidos en directo por la tarde, un canal
   regional que no tiene guía de madrugada (huecos «Sin información»), un
   bloque de relleno de 14 h y un favorito sin guía. Sin logos ni imágenes:
   en la demo no hay proxy (`logo` e `image` van siempre a false).

   Con `{ onlyToday: true }` (último argumento de cada función) es como la
   guía real del panel de Isma (Paso 0 del 3-oct): de ayer a hoy y nada que
   empiece mañana ni pasado; `coveredTo` lo dice. Tiene su propio sello. */

import type {
  IptvGuideChannel,
  IptvGuideNowItem,
  IptvGuideNowResponse,
  IptvGuideProgramme,
  IptvGuideProgrammeDetail,
  IptvGuideProgrammesResponse,
  IptvGuideResponse,
  IptvGuideScope,
} from '../api/v1/guide.js';
import { GUIDE_FLAGS, IPTV_GUIDE_API, IPTV_GUIDE_STORE } from '../constants/guide.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Cada cuánto «se vuelve a descargar» la guía de ejemplo. */
const REFRESH_MS = 8 * HOUR;

type Kind =
  | 'general'
  | 'news'
  | 'sport'
  | 'football'
  | 'movies'
  | 'series'
  | 'kids'
  | 'docs'
  | 'regional'
  | 'music';

interface Seed {
  readonly name: string;
  readonly kind: Kind;
  readonly country?: string;
  readonly favorite?: boolean;
  /** Sin programación de 02:00 a 06:00 UTC (huecos «Sin información»). */
  readonly nightGap?: boolean;
  /** Un bloque de relleno de 14 h al día (`filler`). */
  readonly filler?: boolean;
}

/** Los canales, en el orden del «proveedor». Los de otros países van al final de «Todos». */
const SEEDS: readonly Seed[] = [
  { name: 'La 1', kind: 'general', favorite: true },
  { name: 'La 2', kind: 'docs' },
  { name: 'Antena 3', kind: 'general', favorite: true },
  { name: 'Cuatro', kind: 'general' },
  { name: 'Telecinco', kind: 'general' },
  { name: 'laSexta', kind: 'news' },
  { name: 'UK: Sky Sports Main Event', kind: 'football', country: 'UK' },
  { name: '24 Horas', kind: 'news' },
  { name: 'Teledeporte', kind: 'sport' },
  { name: 'M+ LaLiga TV', kind: 'football', favorite: true },
  { name: 'M+ LaLiga TV 2', kind: 'football' },
  { name: 'DAZN LaLiga', kind: 'football', favorite: true },
  { name: 'DAZN 1', kind: 'football', favorite: true },
  { name: 'DAZN 2', kind: 'sport' },
  { name: 'DE: DAZN 1', kind: 'football', country: 'DE' },
  { name: 'M+ Liga de Campeones', kind: 'football' },
  { name: 'M+ Deportes', kind: 'sport' },
  { name: 'M+ Vamos', kind: 'sport', favorite: true },
  { name: 'Eurosport 1', kind: 'sport' },
  { name: 'Eurosport 2', kind: 'sport' },
  { name: 'Gol Play', kind: 'football' },
  { name: 'M+ Estrenos', kind: 'movies' },
  { name: 'M+ Comedia', kind: 'movies' },
  { name: 'M+ Acción', kind: 'movies' },
  { name: 'Cine Clásico', kind: 'movies' },
  { name: 'Cine de Siempre', kind: 'movies' },
  { name: 'FDF', kind: 'series' },
  { name: 'Neox', kind: 'series' },
  { name: 'Nova', kind: 'series' },
  { name: 'Atreseries', kind: 'series' },
  { name: 'Divinity', kind: 'general' },
  { name: 'Energy', kind: 'series' },
  { name: 'Clan', kind: 'kids' },
  { name: 'Boing', kind: 'kids' },
  { name: 'Canal Infantil', kind: 'kids' },
  { name: 'DMAX', kind: 'docs' },
  { name: 'Naturaleza Viva', kind: 'docs' },
  { name: 'Historia', kind: 'docs' },
  { name: 'Odisea', kind: 'docs', filler: true },
  { name: 'FR: Canal+ Sport', kind: 'sport', country: 'FR' },
  { name: 'Telemadrid', kind: 'regional' },
  { name: 'TV3', kind: 'regional' },
  { name: 'Canal Sur', kind: 'regional', nightGap: true },
  { name: 'À Punt', kind: 'regional' },
  { name: 'EITB', kind: 'regional' },
  { name: 'TVG', kind: 'regional' },
  { name: 'Aragón TV', kind: 'regional' },
  { name: 'Canal Extremadura', kind: 'regional', nightGap: true },
  { name: 'Los Éxitos TV', kind: 'music' },
  { name: 'Radio Hits TV', kind: 'music' },
  { name: 'Real Madrid TV', kind: 'football' },
  { name: 'Barça One', kind: 'football' },
  { name: 'Canal Toros', kind: 'sport' },
  { name: 'Caza y Pesca', kind: 'docs' },
  { name: 'Euronews', kind: 'news' },
];

/** El favorito sin guía (en «Favoritos» sale con la fila entera «Sin información»). */
const FAVORITE_WITHOUT_GUIDE = 'LaLiga+ PPV 1';

// --- Utilidades puras ---

/** FNV-1a de 32 bits. */
function fnv(text: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Id de 40 hex inventado y estable para un nombre (con la forma de un id IPTV). */
export function demoGuideChannelId(name: string): string {
  let out = '';
  for (let round = 0; round < 5; round += 1) {
    out += fnv(`iptv-demo|${name}`, round * 0x9e3779b1)
      .toString(16)
      .padStart(8, '0');
  }
  return out;
}

/** Generador pseudoaleatorio (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly T[], next: () => number): T {
  return list[Math.floor(next() * list.length) % list.length] as T;
}

// --- Canales ---

interface DemoChannel extends Omit<IptvGuideChannel, 'guide'> {
  readonly guide: number;
  readonly kind: Kind;
  readonly seed: Seed;
}

let channelCache: readonly DemoChannel[] | null = null;

/** Los canales de la guía de ejemplo en el orden de «Todos» (España y sin país primero). */
function demoChannels(): readonly DemoChannel[] {
  if (channelCache) return channelCache;
  const spanish = SEEDS.filter((seed) => !seed.country);
  const others = SEEDS.filter((seed) => seed.country);
  channelCache = [...spanish, ...others].map((seed, index) => ({
    guide: index + 1,
    id: demoGuideChannelId(seed.name),
    number: index + 1,
    name: seed.name.replace(/^[A-Z]{2}: /, ''),
    country: seed.country ?? null,
    favorite: Boolean(seed.favorite),
    logo: false,
    kind: seed.kind,
    seed,
  }));
  return channelCache;
}

function publicChannel(channel: DemoChannel): IptvGuideChannel {
  return {
    guide: channel.guide,
    id: channel.id,
    number: channel.number,
    name: channel.name,
    country: channel.country,
    favorite: channel.favorite,
    logo: channel.logo,
  };
}

// --- Programas ---

interface Item {
  readonly title: string;
  /** Duración mínima y máxima en minutos (múltiplos de 5). */
  readonly min: number;
  readonly max: number;
  readonly live?: boolean;
  readonly category: string;
  readonly series?: boolean;
  readonly movie?: boolean;
}

const MATCHES = [
  'Real Madrid - Villarreal',
  'Athletic Club - Real Betis',
  'Sevilla - Valencia',
  'Real Sociedad - Girona',
  'Atlético de Madrid - Osasuna',
  'Barcelona - Celta',
  'Rayo Vallecano - Getafe',
  'Mallorca - Espanyol',
];

const ITEMS: Readonly<Record<Kind, readonly Item[]>> = {
  general: [
    { title: 'Noticias 1', min: 45, max: 60, live: true, category: 'Informativo' },
    { title: 'Magacín de la mañana', min: 120, max: 180, live: true, category: 'Magacín' },
    { title: 'Concurso: La gran pregunta', min: 45, max: 60, category: 'Concurso' },
    { title: 'Serie de tarde: Vidas cruzadas', min: 50, max: 60, category: 'Serie', series: true },
    { title: 'Cocina en casa', min: 30, max: 45, category: 'Cocina' },
    { title: 'El tiempo', min: 5, max: 10, category: 'Informativo' },
    { title: 'Cine de noche', min: 100, max: 130, category: 'Película', movie: true },
  ],
  news: [
    { title: 'Noticias en directo', min: 30, max: 60, live: true, category: 'Informativo' },
    { title: 'El tiempo', min: 5, max: 10, category: 'Informativo' },
    { title: 'Entrevista', min: 20, max: 30, live: true, category: 'Informativo' },
    { title: 'Economía hoy', min: 15, max: 30, category: 'Informativo' },
    { title: 'Reportaje', min: 25, max: 45, category: 'Documental' },
  ],
  sport: [
    { title: 'Ciclismo: Vuelta, etapa 12', min: 120, max: 180, live: true, category: 'Deportes' },
    { title: 'Tenis: Torneo de Madrid', min: 90, max: 150, live: true, category: 'Deportes' },
    { title: 'Baloncesto: Liga Endesa', min: 105, max: 120, live: true, category: 'Deportes' },
    { title: 'Motociclismo: Gran Premio', min: 60, max: 90, category: 'Deportes' },
    { title: 'Noticias del deporte', min: 25, max: 30, live: true, category: 'Deportes' },
    { title: 'Pádel: World Tour', min: 90, max: 120, category: 'Deportes' },
  ],
  football: [
    { title: 'Previa del partido', min: 30, max: 45, live: true, category: 'Fútbol' },
    { title: 'Resumen de la jornada', min: 30, max: 60, category: 'Fútbol' },
    { title: 'El día después', min: 60, max: 75, category: 'Fútbol' },
    { title: 'Goles de la jornada', min: 15, max: 30, category: 'Fútbol' },
    { title: 'Tertulia de fútbol', min: 60, max: 90, live: true, category: 'Fútbol' },
  ],
  movies: [
    { title: 'El último verano', min: 95, max: 110, category: 'Drama', movie: true },
    { title: 'Ciudad de cristal', min: 100, max: 125, category: 'Thriller', movie: true },
    { title: 'La sombra del faro', min: 90, max: 105, category: 'Suspense', movie: true },
    { title: 'Operación Atlántico', min: 110, max: 130, category: 'Acción', movie: true },
    { title: 'Noche en Lisboa', min: 95, max: 110, category: 'Romance', movie: true },
    { title: 'Los años dorados', min: 100, max: 120, category: 'Comedia', movie: true },
    { title: 'El caso Valdés', min: 105, max: 120, category: 'Policiaca', movie: true },
    { title: 'Tormenta de arena', min: 115, max: 140, category: 'Aventura', movie: true },
  ],
  series: [
    { title: 'Los Moreno', min: 25, max: 30, category: 'Comedia', series: true },
    { title: 'Comisaría Centro', min: 45, max: 50, category: 'Policiaca', series: true },
    { title: 'Hospital del Norte', min: 45, max: 55, category: 'Drama', series: true },
    { title: 'Vecinos', min: 25, max: 30, category: 'Comedia', series: true },
    { title: 'Misterios del pueblo', min: 40, max: 50, category: 'Suspense', series: true },
  ],
  kids: [
    { title: 'Los Exploradores', min: 10, max: 15, category: 'Infantil', series: true },
    { title: 'Lola y el dragón', min: 10, max: 15, category: 'Infantil', series: true },
    { title: 'Patrulla del bosque', min: 20, max: 25, category: 'Infantil', series: true },
    { title: 'Aprende jugando', min: 5, max: 10, category: 'Infantil' },
  ],
  docs: [
    { title: 'Planeta salvaje', min: 45, max: 60, category: 'Documental', series: true },
    { title: 'Grandes obras de ingeniería', min: 45, max: 55, category: 'Documental' },
    { title: 'Misterios de la historia', min: 50, max: 60, category: 'Documental' },
    { title: 'Pesca extrema', min: 40, max: 45, category: 'Documental', series: true },
    { title: 'Viaje al interior', min: 25, max: 30, category: 'Viajes' },
  ],
  regional: [
    { title: 'Informativo regional', min: 30, max: 45, live: true, category: 'Informativo' },
    { title: 'El tiempo', min: 5, max: 10, category: 'Informativo' },
    { title: 'Aquí, en la plaza', min: 60, max: 90, live: true, category: 'Magacín' },
    { title: 'Cocina de la tierra', min: 30, max: 30, category: 'Cocina' },
    { title: 'Fútbol regional', min: 105, max: 115, live: true, category: 'Fútbol' },
  ],
  music: [
    { title: 'Éxitos de hoy', min: 60, max: 120, category: 'Música' },
    { title: 'Videoclips', min: 30, max: 60, category: 'Música' },
    { title: 'Concierto', min: 90, max: 120, category: 'Música' },
  ],
};

interface DemoProgramme extends IptvGuideProgramme {
  readonly item: Item | null;
  readonly guide: number;
}

/** Día UTC (número) de un instante. */
function dayOf(ms: number): number {
  return Math.floor(ms / DAY);
}

const dayCache = new Map<string, readonly DemoProgramme[]>();

/** La parrilla de un canal en un día UTC (00:00-24:00), siempre la misma. */
function dayProgrammes(channel: DemoChannel, day: number): readonly DemoProgramme[] {
  const key = `${channel.guide}|${day}`;
  const known = dayCache.get(key);
  if (known) return known;
  const next = random(fnv(`${channel.id}|${day}`, 7));
  const items = ITEMS[channel.kind];
  const dayStart = day * DAY;
  const dayEnd = dayStart + DAY;
  const out: DemoProgramme[] = [];
  let at = dayStart;
  /* Un partido en directo por la tarde en los canales de fútbol (de 17:00 a 21:00 UTC). */
  const matchAt =
    channel.kind === 'football' ? dayStart + (17 + Math.floor(next() * 4)) * HOUR : null;
  const fillerFrom = channel.seed.filler ? dayStart + 6 * HOUR : null;
  let matchDone = matchAt === null;
  while (at < dayEnd) {
    if (channel.seed.nightGap && at >= dayStart + 2 * HOUR && at < dayStart + 6 * HOUR) {
      at = dayStart + 6 * HOUR;
      continue;
    }
    if (fillerFrom !== null && at >= fillerFrom && at < fillerFrom + 14 * HOUR) {
      out.push(programme(channel, at, fillerFrom + 14 * HOUR, '', GUIDE_FLAGS.filler, null));
      at = fillerFrom + 14 * HOUR;
      continue;
    }
    if (!matchDone && matchAt !== null && at >= matchAt - 30 * MINUTE) {
      matchDone = true;
      const match = pick(MATCHES, next);
      const end = Math.min(matchAt + 115 * MINUTE, dayEnd);
      const start = Math.max(at, matchAt - 5 * MINUTE);
      if (start > at) {
        const previa: Item = { title: 'Previa del partido', min: 30, max: 30, category: 'Fútbol' };
        out.push(
          programme(
            channel,
            at,
            start,
            previa.title,
            GUIDE_FLAGS.live | GUIDE_FLAGS.detail,
            previa,
          ),
        );
      }
      const item: Item = { title: match, min: 120, max: 120, live: true, category: 'Fútbol' };
      out.push(
        programme(
          channel,
          start,
          end,
          `LaLiga EA Sports: ${match}`,
          GUIDE_FLAGS.live | GUIDE_FLAGS.detail,
          item,
        ),
      );
      at = end;
      continue;
    }
    const item = pick(items, next);
    const steps = Math.max(0, Math.round((item.max - item.min) / 5));
    const minutes = item.min + 5 * Math.floor(next() * (steps + 1));
    let end = Math.min(at + Math.max(5, minutes) * MINUTE, dayEnd);
    if (!matchDone && matchAt !== null && end > matchAt - 30 * MINUTE) {
      end = matchAt - 30 * MINUTE;
    }
    if (channel.seed.nightGap && at < dayStart + 2 * HOUR && end > dayStart + 2 * HOUR) {
      end = dayStart + 2 * HOUR;
    }
    if (fillerFrom !== null && at < fillerFrom && end > fillerFrom) end = fillerFrom;
    if (end <= at) end = Math.min(at + 5 * MINUTE, dayEnd);
    let flags = GUIDE_FLAGS.detail;
    if (item.live) flags |= GUIDE_FLAGS.live;
    else if (next() < 0.15) flags |= GUIDE_FLAGS.new;
    else if (next() < 0.2) flags |= GUIDE_FLAGS.repeat;
    out.push(programme(channel, at, end, item.title, flags, item));
    at = end;
  }
  dayCache.set(key, out);
  if (dayCache.size > 2000) dayCache.delete(dayCache.keys().next().value as string);
  return out;
}

function programme(
  channel: DemoChannel,
  start: number,
  end: number,
  title: string,
  flags: number,
  item: Item | null,
): DemoProgramme {
  return {
    id: `${channel.guide}.${Math.floor(start / MINUTE)}`,
    start,
    end,
    title,
    flags,
    item,
    guide: channel.guide,
  };
}

function strip(programmeItem: DemoProgramme): IptvGuideProgramme {
  return {
    id: programmeItem.id,
    start: programmeItem.start,
    end: programmeItem.end,
    title: programmeItem.title,
    flags: programmeItem.flags,
  };
}

/**
 * Los programas de un canal que se solapan con [from, to) y empiezan antes
 * de `cutoff` (lo último que trae la guía; sin él, todo).
 */
function programmesBetween(
  channel: DemoChannel,
  from: number,
  to: number,
  cutoff = Number.POSITIVE_INFINITY,
): DemoProgramme[] {
  const out: DemoProgramme[] = [];
  const until = Math.min(to, cutoff);
  if (until <= from) return out;
  for (let day = dayOf(from); day <= dayOf(until - 1); day += 1) {
    for (const item of dayProgrammes(channel, day)) {
      if (item.end > from && item.start < until) out.push(item);
    }
  }
  return out;
}

// --- La «descarga» ---

export interface DemoGuideStamp {
  readonly version: string;
  readonly builtAt: number;
  readonly from: number;
  readonly to: number;
}

/** Opciones de la guía de ejemplo. */
export interface DemoGuideOptions {
  /**
   * Como la del panel de Isma (Paso 0 del 3-oct): de 24 h atrás a hoy, sin un
   * solo programa que empiece después del día (UTC) de la «descarga»; mañana
   * y pasado, nada. Para ver la parrilla con una guía que solo cubre hoy.
   */
  readonly onlyToday?: boolean | undefined;
}

/** Sello y ventana de la guía de ejemplo a esta hora (cambian cada 8 h; «solo hoy» tiene su sello). */
export function demoGuideStamp(now: number, options: DemoGuideOptions = {}): DemoGuideStamp {
  const builtAt = Math.floor(now / REFRESH_MS) * REFRESH_MS;
  return {
    version: `${options.onlyToday ? 'h' : 'd'}${Math.floor(builtAt / MINUTE).toString(36)}`,
    builtAt,
    from: builtAt - IPTV_GUIDE_STORE.pastMs,
    to: builtAt + IPTV_GUIDE_STORE.futureMs,
  };
}

/** Lo último que trae la guía: con «solo hoy», nada que empiece después del día de la descarga. */
function cutoffOf(stamp: DemoGuideStamp, options: DemoGuideOptions): number {
  return options.onlyToday ? (dayOf(stamp.builtAt) + 1) * DAY : Number.POSITIVE_INFINITY;
}

/** Hasta dónde llega la programación de esos canales (`coveredFrom`/`coveredTo`, como el servidor). */
function coverageOf(
  channels: readonly DemoChannel[],
  stamp: DemoGuideStamp,
  cutoff: number,
): { from: number; to: number } | null {
  const end = Math.min(stamp.to, cutoff);
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const channel of channels) {
    const head = programmesBetween(channel, stamp.from, stamp.from + 6 * HOUR, cutoff)[0];
    const tail = programmesBetween(channel, end - 6 * HOUR, end, cutoff).at(-1);
    if (head && head.start < from) from = head.start;
    if (tail && tail.end > to) to = tail.end;
  }
  return from < to ? { from: Math.max(from, stamp.from), to: Math.min(to, stamp.to) } : null;
}

/** Error de la demo con el código que daría el servidor (el manejador de la web lo pasa a `ApiError`). */
export class DemoGuideError extends Error {
  constructor(
    readonly code: 'guide_stale' | 'not_found' | 'validation_error',
    readonly status: number,
  ) {
    super(code);
    this.name = 'DemoGuideError';
  }
}

function checkVersion(v: string, now: number, options: DemoGuideOptions): DemoGuideStamp {
  const stamp = demoGuideStamp(now, options);
  if (v !== stamp.version) throw new DemoGuideError('guide_stale', 409);
  return stamp;
}

export interface DemoGuideQuery {
  readonly scope?: IptvGuideScope | undefined;
  readonly offset?: number | string | undefined;
  readonly limit?: number | string | undefined;
}

/** `iptvGuide` de la demo: estado, sello y una página de canales («Favoritos» o «Todos»). */
export function demoGuide(
  query: DemoGuideQuery,
  now: number,
  options: DemoGuideOptions = {},
): IptvGuideResponse {
  const stamp = demoGuideStamp(now, options);
  const channels = demoChannels();
  const favorites = channels.filter((channel) => channel.favorite);
  const without: IptvGuideChannel = {
    guide: null,
    id: demoGuideChannelId(FAVORITE_WITHOUT_GUIDE),
    number: null,
    name: FAVORITE_WITHOUT_GUIDE,
    country: null,
    favorite: true,
    logo: false,
  };
  const scope = query.scope ?? 'favorites';
  const rows: IptvGuideChannel[] =
    scope === 'favorites'
      ? [...favorites.map(publicChannel), without]
      : channels.map(publicChannel);
  const offset = Math.max(0, Number(query.offset ?? 0) || 0);
  const limit = Math.min(
    IPTV_GUIDE_API.channelsPageMax,
    Math.max(0, Number(query.limit ?? IPTV_GUIDE_API.channelsPage) || 0),
  );
  const covered = coverageOf(
    scope === 'favorites' ? favorites : channels,
    stamp,
    cutoffOf(stamp, options),
  );
  return {
    state: 'ready',
    version: stamp.version,
    provider: 'IPTV de ejemplo',
    from: stamp.from,
    to: stamp.to,
    coveredFrom: covered?.from ?? null,
    coveredTo: covered?.to ?? null,
    updatedAt: new Date(stamp.builtAt).toISOString(),
    failedAt: null,
    partial: false,
    scope,
    fellBack: false,
    favorites: favorites.length,
    all: channels.length,
    total: rows.length,
    offset,
    channels: rows.slice(offset, offset + limit),
  };
}

export interface DemoGuideProgrammesQuery {
  readonly v: string;
  readonly ch: string;
  readonly from: number | string;
  readonly to: number | string;
}

/** `iptvGuideProgrammes` de la demo. Lanza `DemoGuideError` con un sello viejo o un trozo mal pedido. */
export function demoGuideProgrammes(
  query: DemoGuideProgrammesQuery,
  now: number,
  options: DemoGuideOptions = {},
): IptvGuideProgrammesResponse {
  const stamp = checkVersion(query.v, now, options);
  const cutoff = cutoffOf(stamp, options);
  const from = Math.max(stamp.from, Number(query.from));
  const to = Math.min(stamp.to, Number(query.to));
  if (!Number.isFinite(from) || !Number.isFinite(to) || Number(query.to) <= Number(query.from)) {
    throw new DemoGuideError('validation_error', 400);
  }
  if (Number(query.to) - Number(query.from) > IPTV_GUIDE_API.sliceMaxMs) {
    throw new DemoGuideError('validation_error', 400);
  }
  const byGuide = new Map(demoChannels().map((channel) => [channel.guide, channel]));
  const seen = new Set<number>();
  const out: IptvGuideProgrammesResponse['channels'][number][] = [];
  for (const part of String(query.ch).split(',')) {
    const guide = Number(part);
    if (!Number.isInteger(guide) || guide < 1 || seen.has(guide)) continue;
    seen.add(guide);
    const channel = byGuide.get(guide);
    out.push({
      guide,
      programmes:
        channel && to > from
          ? programmesBetween(channel, from, to, cutoff)
              .slice(0, IPTV_GUIDE_API.sliceProgrammesMax)
              .map(strip)
          : [],
    });
    if (out.length >= IPTV_GUIDE_API.sliceChannelsMax) break;
  }
  return { version: stamp.version, from, to: Math.max(from, to), channels: out };
}

const DESCRIPTIONS: Readonly<Record<Kind, readonly string[]>> = {
  general: [
    'Las noticias del día, el tiempo y la actualidad, con entrevistas y conexiones en directo.',
    'Entretenimiento para toda la familia con invitados, juegos y mucho humor.',
  ],
  news: ['Última hora y análisis de la actualidad nacional e internacional.'],
  sport: ['Toda la emoción del deporte en directo, con comentarios y análisis.'],
  football: [
    'Toda la previa, el partido y el análisis posterior con los protagonistas.',
    'Los goles, las jugadas polémicas y las opiniones de la jornada.',
  ],
  movies: [
    'Un verano en la costa cambia para siempre la vida de dos hermanos que no se hablaban desde hacía años.',
    'Una inspectora recién llegada a la ciudad investiga una desaparición que nadie quiere resolver.',
    'Un equipo de especialistas tiene una sola noche para impedir un golpe que nadie ha visto venir.',
  ],
  series: [
    'Los vecinos del tercero vuelven a meterse en un lío del que solo saldrán con ayuda de toda la familia.',
    'Un caso aparentemente sencillo destapa una trama que llega hasta lo más alto.',
  ],
  kids: ['Aventuras, canciones y juegos para los más pequeños de la casa.'],
  docs: [
    'Un recorrido por los rincones más espectaculares del planeta y los animales que los habitan.',
    'Cómo se construyeron algunas de las obras más impresionantes de la historia.',
  ],
  regional: ['La actualidad de la comunidad, con reportajes, entrevistas y el tiempo.'],
  music: ['Los vídeos más escuchados de la semana, sin parar.'],
};

const RATINGS = ['TP', '+7', '+12', '+16', '+18'] as const;
const ACTORS = [
  'Lucía Ferrer',
  'Javier Ortega',
  'Marta Ibáñez',
  'Pablo Serrano',
  'Elena Castro',
  'Andrés Molina',
  'Carmen Ruiz',
  'Diego Navarro',
];

/** `iptvGuideProgramme` de la demo. Lanza `DemoGuideError` si no existe o el sello es viejo. */
export function demoGuideProgramme(
  id: string,
  query: { readonly v: string },
  now: number,
  options: DemoGuideOptions = {},
): IptvGuideProgrammeDetail {
  const stamp = checkVersion(query.v, now, options);
  const match = /^(\d+)\.(\d+)$/.exec(id);
  const channel = match ? demoChannels().find((item) => item.guide === Number(match[1])) : null;
  const start = match ? Number(match[2]) * MINUTE : 0;
  const found = channel
    ? dayProgrammes(channel, dayOf(start)).find((item) => item.id === id)
    : undefined;
  if (
    !channel ||
    !found ||
    found.end <= stamp.from ||
    found.start >= stamp.to ||
    found.start >= cutoffOf(stamp, options)
  ) {
    throw new DemoGuideError('not_found', 404);
  }
  const next = random(fnv(id, 11));
  const item = found.item;
  const filler = (found.flags & GUIDE_FLAGS.filler) !== 0;
  const series = Boolean(item?.series);
  const movie = Boolean(item?.movie);
  return {
    version: stamp.version,
    ...strip(found),
    guide: channel.guide,
    subTitle: series ? `Capítulo ${1 + Math.floor(next() * 20)}` : null,
    description: filler ? null : pick(DESCRIPTIONS[channel.kind], next),
    categories: item ? [item.category] : [],
    season: series ? 1 + Math.floor(next() * 6) : null,
    episode: series ? 1 + Math.floor(next() * 20) : null,
    episodeText: null,
    year: movie ? 1985 + Math.floor(next() * 40) : null,
    rating: filler ? null : movie || series ? pick(RATINGS, next) : 'TP',
    stars: movie ? `${1 + Math.floor(next() * 5)}/5` : null,
    directors: movie ? [pick(ACTORS, next)] : [],
    actors: movie || series ? [pick(ACTORS, next), pick(ACTORS, next)] : [],
  };
}

/** `iptvGuideNow` de la demo: «ahora / después» de los ids pedidos (los de la demo; los demás, sin guía). */
export function demoGuideNow(
  query: { readonly ids: string },
  now: number,
  options: DemoGuideOptions = {},
): IptvGuideNowResponse {
  const stamp = demoGuideStamp(now, options);
  const cutoff = cutoffOf(stamp, options);
  const byId = new Map(demoChannels().map((channel) => [channel.id, channel]));
  const seen = new Set<string>();
  const items: IptvGuideNowItem[] = [];
  for (const id of String(query.ids).split(',')) {
    if (!/^[a-f0-9]{40}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const channel = byId.get(id);
    if (!channel) {
      items.push({ id, guide: null, now: null, next: null });
      continue;
    }
    const around = programmesBetween(channel, now - 6 * HOUR, now + 12 * HOUR, cutoff);
    const current = around.find((item) => item.start <= now && item.end > now) ?? null;
    const following = around.find((item) => item.start >= (current?.end ?? now)) ?? null;
    items.push({
      id,
      guide: channel.guide,
      now: current ? strip(current) : null,
      next: following ? strip(following) : null,
    });
    if (items.length >= IPTV_GUIDE_API.nowIdsMax) break;
  }
  return { available: true, version: stamp.version, items };
}

/** Los canales de la demo (para las pruebas y para casar ids de la pestaña IPTV de ejemplo). */
export function demoGuideChannels(): readonly IptvGuideChannel[] {
  return demoChannels().map(publicChannel);
}
