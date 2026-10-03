/* Parseo tolerante de Películas y series (docs/vod.md §4.3 y §7.2). Puro.

   Los paneles Xtream son PHP y mandan de todo: números como texto, `info`,
   `video` o `episodes` como `[]`, `audio` como objeto suelto, `episodes` como
   `{"1":[…]}` o `[[…],[…]]`, ids de episodio como texto, `releaseDate` o
   `release_date`… Aquí se reduce cada cosa a lo que la app necesita y el
   JSON crudo se tira:
   - `parseListItem`: una película de `get_vod_streams` o una serie de
     `get_series` → una fila de la tabla (o null, que cuenta en `skipped`);
   - `parseMovieInfo` / `parseSeriesInfo`: la ficha de `get_vod_info` /
     `get_series_info`, ya reducida (§7.2), con sus topes.

   Las URLs de carteles, fondos y fotogramas se quedan aquí dentro y en la
   tabla: NUNCA salen del módulo (§14); hacia fuera solo va su sello `v`.
   `direct_source` se ignora siempre. */

import { VOD_EXTENSIONS, VOD_LIMITS, type VodKind, type VodPlayable } from '@ace/shared';
import { looseInt, looseNumber, looseString, streamCategoryId } from '../xtream.js';
import { cleanVodTitle, VOD_YEAR_MAX, VOD_YEAR_MIN } from './titles.js';

/** El mayor id que se acepta (2⁵³ − 1): cabe exacto en un `Float64Array`. */
export const VOD_SOURCE_MAX = Number.MAX_SAFE_INTEGER;
/** Nota desconocida en la tabla (se guarda ×10 en un byte). */
export const RATING_NONE = 255;
/** «Sin categoría» en la tabla. */
export const CAT_NONE = 0xffff;

/** Una película o una serie de las listas, ya reducida (una fila de `VodTable`). */
export interface VodListRow {
  readonly source: number;
  readonly title: string;
  /** 0 = desconocido. */
  readonly year: number;
  /** Nota ×10 (0-100) o `RATING_NONE`. */
  readonly rating: number;
  /** Segundos Unix: `added` (películas) o `last_modified` (series); 0 = desconocido. */
  readonly added: number;
  /** Índice en `VOD_EXTENSIONS` + 1; 0 = desconocida (solo películas). */
  readonly ext: number;
  readonly adult: boolean;
  /** URL del cartel (solo http(s), sin credenciales, ≤ 1 024), o null. */
  readonly poster: string | null;
  /** Bits de `VOD_TAGS`. */
  readonly tags: number;
  /** Nombre de la categoría del proveedor ('' = «Sin categoría»). */
  readonly category: string;
}

/** Categorías de adultos por nombre (§4.3). */
const ADULT_CATEGORY = /\b(xxx|adult[oa]?s?|porn\w*|er[oó]tic\w*)\b|\+18|18\+/i;

/** ¿Es de adultos una categoría por su nombre? */
export function isAdultCategory(name: string): boolean {
  return ADULT_CATEGORY.test(name);
}

/** Caracteres de control (C0, DEL, C1) y separadores de línea Unicode. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/* Entidades con nombre que mandan los paneles PHP (`htmlentities`) y que no
   son una letra con tilde (esas salen de `ACCENT_MARK`). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  iexcl: '¡',
  iquest: '¿',
  ordf: 'ª',
  ordm: 'º',
  laquo: '«',
  raquo: '»',
  middot: '·',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  szlig: 'ß',
  aelig: 'æ',
  AElig: 'Æ',
  oelig: 'œ',
  OElig: 'Œ',
  oslash: 'ø',
  Oslash: 'Ø',
};

/* `&aacute;`, `&Ntilde;`, `&uuml;`…: la letra más su marca combinada (NFC). */
const ACCENT_MARK: Readonly<Record<string, string>> = {
  acute: '́',
  grave: '̀',
  circ: '̂',
  uml: '̈',
  tilde: '̃',
  cedil: '̧',
  ring: '̊',
};

/** Un punto de código que se puede escribir (ni control, ni sustituto, ni fuera de Unicode). */
function printableCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0x20 || code > 0x10ffff) return ' ';
  if ((code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff)) return ' ';
  return String.fromCodePoint(code);
}

/** Entidades HTML: con nombre, de letra con tilde y numéricas (decimales y hex). Una sola pasada. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[A-Za-z]{2,8});/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      return printableCodePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    const named = NAMED_ENTITIES[body];
    if (named !== undefined) return named;
    const mark = ACCENT_MARK[body.slice(1)];
    if (mark && /^[A-Za-z]$/.test(body[0] as string)) return `${body[0]}${mark}`.normalize('NFC');
    return entity;
  });
}

/** Recorta a `max` unidades sin partir un par sustituto (un emoji, un ideograma raro). */
function sliceSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/* Etiquetas que separan («<br>», «</p>»…): un espacio. Las demás («<b>»),
   nada: «PEL<b>Í</b>CULAS» es una palabra. Solo lo que parece una etiqueta:
   «nota < 5 y > 3» no es HTML. */
const BLOCK_TAG = /<\/?(?:br|p|div|li|ul|ol|tr|td|h[1-6])\b[^<>]{0,200}>/gi;
const INLINE_TAG = /<\/?[A-Za-z!][^<>]{0,200}>/g;

/**
 * Texto del panel limpio: sin etiquetas HTML ni caracteres de control, con
 * las entidades decodificadas (también `&aacute;` y `&#233;`), espacios
 * juntados y recortado a `max` sin partir un carácter.
 */
export function cleanText(value: unknown, max: number): string {
  const text = looseString(value);
  if (!text) return '';
  const clean = decodeEntities(text.replace(BLOCK_TAG, ' ').replace(INLINE_TAG, ''))
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sliceSafe(clean, max).trim();
}

/** Id del proveedor: entero en [1, 2⁵³). */
export function sourceOf(value: unknown): number | null {
  const number = looseNumber(value);
  if (number === null || !Number.isInteger(number) || number < 1 || number > VOD_SOURCE_MAX) {
    return null;
  }
  return number;
}

function yearOf(value: unknown): number | null {
  const text = looseString(value);
  const match = /^(\d{4})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= VOD_YEAR_MIN && year <= VOD_YEAR_MAX ? year : null;
}

/** Nota 0-10: `rating`, o `rating_5based` × 2. null si no hay o no vale. */
export function ratingOf(item: Record<string, unknown>): number | null {
  const direct = looseNumber(item.rating);
  if (direct !== null && direct > 0 && direct <= 10) return Math.round(direct * 10) / 10;
  const five = looseNumber(item.rating_5based);
  if (five !== null && five > 0 && five <= 5) return Math.round(five * 20) / 10;
  return null;
}

/** Índice de la extensión (1-7) o 0 si no está en la lista cerrada. */
export function extIndex(value: unknown): number {
  const ext = looseString(value).toLowerCase().replace(/^\./, '');
  const index = (VOD_EXTENSIONS as readonly string[]).indexOf(ext);
  return index < 0 ? 0 : index + 1;
}

/** La extensión de un índice (o null). */
export function extName(index: number): string | null {
  return index > 0 ? (VOD_EXTENSIONS[index - 1] ?? null) : null;
}

/** URL de imagen aceptable: http(s), sin `usuario:clave@`, ≤ 1 024 caracteres. */
export function imageUrl(value: unknown): string | null {
  const text = looseString(value);
  if (!text || text.length > 1024 || !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function unixSeconds(value: unknown): number {
  const number = looseNumber(value);
  if (number === null || number <= 0 || number >= 2 ** 32) return 0;
  return Math.floor(number);
}

function isAdultFlag(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

/**
 * Una película de `get_vod_streams` o una serie de `get_series` → fila.
 * null si se salta (sin id válido, sin título, o un canal en directo): quien
 * llama lo cuenta en `skipped`. `categories` es id → nombre del panel.
 */
export function parseListItem(
  kind: VodKind,
  item: Record<string, unknown>,
  categories: ReadonlyMap<string, string>,
): VodListRow | null {
  if (kind === 'movie') {
    const type = looseString(item.stream_type).toLowerCase();
    if (type && type !== 'movie') return null;
  }
  const source = sourceOf(kind === 'movie' ? item.stream_id : item.series_id);
  if (source === null) return null;
  const rawTitle = cleanText(item.name, VOD_LIMITS.titleMax) || cleanText(item.title, 200);
  if (!rawTitle) return null;
  const categoryId = streamCategoryId(item);
  const category = categoryId ? (categories.get(categoryId) ?? '') : '';
  const clean = cleanVodTitle(rawTitle, category);
  const listYear = yearOf(item.year);
  const year =
    listYear ?? clean.year ?? yearOf(item.releaseDate) ?? yearOf(item.release_date) ?? null;
  const rating = ratingOf(item);
  return {
    source,
    title: clean.title,
    year: year ?? 0,
    rating: rating === null ? RATING_NONE : Math.round(rating * 10),
    added: unixSeconds(kind === 'movie' ? item.added : (item.last_modified ?? item.added)),
    ext: kind === 'movie' ? extIndex(item.container_extension) : 0,
    adult: isAdultFlag(item.is_adult) || isAdultCategory(category),
    poster: imageUrl(kind === 'movie' ? item.stream_icon : item.cover),
    tags: clean.tags,
    category,
  };
}

// --- Fichas (§7.2) ---

/** Pista técnica de la ficha: lo que dice el proveedor (manda el índice al reproducir). */
export interface VodVideoHint {
  readonly codec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly bitDepth: number | null;
}

export interface VodAudioHint {
  readonly codec: string | null;
  readonly channels: number | null;
  readonly lang: string | null;
}

/** Textos comunes de película y serie. */
export interface VodInfoTexts {
  readonly title: string | null;
  readonly originalTitle: string | null;
  readonly year: number | null;
  readonly plot: string | null;
  readonly genres: readonly string[];
  readonly cast: readonly string[];
  readonly director: string | null;
  readonly country: string | null;
  readonly ageRating: string | null;
  readonly rating: number | null;
  /** URL del fondo (nunca sale del módulo). */
  readonly backdrop: string | null;
  /** URL del cartel grande de la ficha, si la lista no traía. */
  readonly cover: string | null;
}

export interface VodMovieInfo extends VodInfoTexts {
  readonly kind: 'movie';
  readonly durationS: number | null;
  readonly video: VodVideoHint;
  readonly audio0: VodAudioHint | null;
  /** Índice de extensión (como en la tabla). */
  readonly ext: number;
  readonly added: number;
}

export interface VodEpisodeInfo {
  /** `episode_id`. */
  readonly source: number;
  readonly number: number;
  readonly title: string;
  readonly plot: string | null;
  readonly durationS: number | null;
  /** URL del fotograma. */
  readonly still: string | null;
  readonly ext: number;
  readonly codec: string | null;
  readonly bitDepth: number | null;
}

export interface VodSeasonInfo {
  readonly number: number;
  readonly name: string;
  readonly episodes: readonly VodEpisodeInfo[];
}

export interface VodSeriesInfo extends VodInfoTexts {
  readonly kind: 'series';
  readonly seasons: readonly VodSeasonInfo[];
  readonly truncated: boolean;
  /** Episodios que no se pueden reproducir (id que no es entero, series_id > 2³²). */
  readonly skippedEpisodes: number;
}

export type VodInfo = VodMovieInfo | VodSeriesInfo;

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function listOf(value: unknown, max: number, itemMax: number): string[] {
  const raw = Array.isArray(value) ? value.map((part) => looseString(part)).join(',') : value;
  const text = cleanText(raw, 4000);
  if (!text) return [];
  const out: string[] = [];
  for (const part of text.split(/\s*[,/|;]\s*/)) {
    const clean = part.trim().slice(0, itemMax).trim();
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function firstText(record: Record<string, unknown>, keys: readonly string[], max: number) {
  for (const key of keys) {
    const text = cleanText(record[key], max);
    if (text) return text;
  }
  return null;
}

function firstImage(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageUrl(item);
      if (url) return url;
    }
    return null;
  }
  return imageUrl(value);
}

/** Duración en segundos: `duration_secs`, o `duration` en `HH:MM:SS`. */
export function durationOf(record: Record<string, unknown>): number | null {
  const secs = looseNumber(record.duration_secs);
  if (secs !== null && secs > 0 && secs < 86_400) return Math.round(secs);
  const text = looseString(record.duration);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (match) {
    const total =
      match[3] === undefined
        ? Number(match[1]) * 3600 + Number(match[2]) * 60
        : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return total > 0 && total < 86_400 ? total : null;
  }
  const minutes = looseNumber(record.episode_run_time ?? record.runtime);
  if (minutes !== null && minutes > 0 && minutes < 1_440) return Math.round(minutes * 60);
  return null;
}

function videoOf(value: unknown): VodVideoHint {
  const video = objectOf(value);
  const codec = looseString(video.codec_name).toLowerCase().slice(0, 16) || null;
  const pix = looseString(video.pix_fmt).toLowerCase();
  const bits = looseInt(video.bits_per_raw_sample);
  const bitDepth =
    bits && bits > 0 && bits <= 16 ? bits : /10le|10be|p010/.test(pix) ? 10 : pix ? 8 : null;
  const width = looseInt(video.width);
  const height = looseInt(video.height);
  return {
    codec,
    width: width && width < 20_000 ? width : null,
    height: height && height < 20_000 ? height : null,
    bitDepth,
  };
}

function audioOf(value: unknown): VodAudioHint | null {
  const first = Array.isArray(value) ? value[0] : value;
  const audio = objectOf(first);
  if (!Object.keys(audio).length) return null;
  const tags = objectOf(audio.tags);
  const channels = looseInt(audio.channels);
  const lang = looseString(tags.language).toLowerCase();
  return {
    codec: looseString(audio.codec_name).toLowerCase().slice(0, 16) || null,
    channels: channels && channels <= 16 ? channels : null,
    lang: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(lang) ? lang : null,
  };
}

function textsOf(info: Record<string, unknown>): VodInfoTexts {
  const plot = firstText(info, ['plot', 'description'], VOD_LIMITS.plotMax);
  const age = cleanText(info.mpaa_rating ?? info.age ?? info.certification, 16);
  return {
    title: firstText(info, ['name', 'title'], VOD_LIMITS.titleMax),
    originalTitle: firstText(info, ['o_name', 'original_name', 'original_title'], 200),
    year:
      yearOf(info.year) ??
      yearOf(info.releasedate) ??
      yearOf(info.releaseDate) ??
      yearOf(info.release_date),
    plot,
    genres: listOf(info.genre ?? info.genres, 8, 40),
    cast: listOf(info.cast ?? info.actors, 12, 80),
    director: firstText(info, ['director', 'directors'], 200),
    country: firstText(info, ['country'], 80),
    ageRating: age || null,
    rating: ratingOf(info),
    backdrop: firstImage(info.backdrop_path) ?? firstImage(info.backdrop),
    cover: firstImage(info.cover_big) ?? firstImage(info.movie_image) ?? firstImage(info.cover),
  };
}

/** `get_vod_info` → ficha reducida de una película. */
export function parseMovieInfo(body: unknown): VodMovieInfo {
  const root = objectOf(body);
  const info = objectOf(root.info);
  const data = objectOf(root.movie_data);
  return {
    kind: 'movie',
    ...textsOf(info),
    durationS: durationOf(info),
    video: videoOf(info.video),
    audio0: audioOf(info.audio),
    ext: extIndex(data.container_extension ?? info.container_extension),
    added: unixSeconds(data.added),
  };
}

const EPISODE_PREFIX = /^.*?\bS\d{1,3}\s*[.\-_ ]?\s*E\d{1,4}\b\s*[-:|–.]?\s*/i;

/** Título de un episodio sin «Serie - S01E03 - »; si no queda nada, «Episodio N». */
export function episodeTitle(raw: unknown, number: number): string {
  const text = cleanText(raw, VOD_LIMITS.titleMax);
  const stripped = text.replace(EPISODE_PREFIX, '').trim();
  return stripped || `Episodio ${number}`;
}

function episodesByKey(value: unknown): Array<[string | null, unknown[]]> {
  if (Array.isArray(value)) {
    if (value.every((item) => Array.isArray(item))) {
      return (value as unknown[][]).map((list) => [null, list]);
    }
    return [[null, value]];
  }
  const record = objectOf(value);
  return Object.entries(record).map(([key, list]) => [key, Array.isArray(list) ? list : []]);
}

/**
 * `get_series_info` → ficha reducida de una serie, con temporadas y
 * episodios ordenados y sus topes (100 temporadas, 500 por temporada y 3 000
 * en total). Las temporadas se deducen de los episodios si `seasons` viene
 * vacío; la 0 es «Especiales» y va al final.
 */
export function parseSeriesInfo(body: unknown): VodSeriesInfo {
  const root = objectOf(body);
  const info = objectOf(root.info);
  const names = new Map<number, string>();
  if (Array.isArray(root.seasons)) {
    for (const season of root.seasons) {
      const record = objectOf(season);
      const number = looseInt(record.season_number);
      const name = cleanText(record.name, 80);
      if (number !== null && number < 1000 && name) names.set(number, name);
    }
  }
  const bySeason = new Map<number, VodEpisodeInfo[]>();
  let skippedEpisodes = 0;
  for (const [key, list] of episodesByKey(root.episodes)) {
    for (const item of list) {
      const record = objectOf(item);
      if (!Object.keys(record).length) continue;
      const source = sourceOf(record.id);
      const seasonNumber = looseInt(record.season) ?? (key === null ? null : looseInt(key)) ?? 1;
      if (source === null || seasonNumber > 999) {
        skippedEpisodes += 1;
        continue;
      }
      const episodeInfo = objectOf(record.info);
      const number = Math.min(9_999, looseInt(record.episode_num) ?? 0);
      const video = videoOf(episodeInfo.video);
      const episode: VodEpisodeInfo = {
        source,
        number,
        title: episodeTitle(record.title, number),
        plot: firstText(episodeInfo, ['plot', 'description'], VOD_LIMITS.episodePlotMax),
        durationS: durationOf(episodeInfo),
        still: firstImage(episodeInfo.movie_image) ?? firstImage(episodeInfo.cover_big),
        ext: extIndex(record.container_extension),
        codec: video.codec,
        bitDepth: video.bitDepth,
      };
      const season = bySeason.get(seasonNumber) ?? [];
      season.push(episode);
      bySeason.set(seasonNumber, season);
    }
  }
  const order = [...bySeason.keys()].sort((a, b) => {
    if (a === 0) return 1;
    if (b === 0) return -1;
    return a - b;
  });
  let truncated = false;
  let total = 0;
  const seasons: VodSeasonInfo[] = [];
  for (const number of order) {
    if (seasons.length >= VOD_LIMITS.seasonsMax) {
      truncated = true;
      break;
    }
    const episodes = (bySeason.get(number) ?? []).sort(
      (a, b) => a.number - b.number || a.source - b.source,
    );
    let kept = episodes;
    if (kept.length > VOD_LIMITS.episodesPerSeasonMax) {
      kept = kept.slice(0, VOD_LIMITS.episodesPerSeasonMax);
      truncated = true;
    }
    if (total + kept.length > VOD_LIMITS.episodesMax) {
      kept = kept.slice(0, Math.max(0, VOD_LIMITS.episodesMax - total));
      truncated = true;
    }
    total += kept.length;
    if (kept.length) {
      seasons.push({
        number,
        name: names.get(number) ?? (number === 0 ? 'Especiales' : `Temporada ${number}`),
        episodes: kept,
      });
    }
    if (total >= VOD_LIMITS.episodesMax) {
      if (order.indexOf(number) < order.length - 1) truncated = true;
      break;
    }
  }
  return { kind: 'series', ...textsOf(info), seasons, truncated, skippedEpisodes };
}

/**
 * ¿Se podrá reproducir? (§7.2): una PISTA por el códec que dice el
 * proveedor y la extensión; la decisión la toma el índice al abrir.
 */
export function playableHint(
  codec: string | null,
  bitDepth: number | null,
  ext: number,
): VodPlayable {
  const name = extName(ext);
  if (name === 'avi' || name === 'ts') return 'no';
  if (!codec) return 'unknown';
  if (codec === 'h264' || codec === 'avc' || codec === 'avc1')
    return bitDepth && bitDepth > 8 ? 'no' : 'yes';
  if (codec === 'hevc' || codec === 'h265') return 'hevc';
  if (
    /^(?:mpeg4|mpeg2video|mpeg1video|vc1|wmv\d|msmpeg4\w*|h263|divx|xvid|vp8|theora)$/.test(codec)
  ) {
    return 'no';
  }
  return 'unknown';
}

/** Si una lista es «sin VOD» (§4.2): `[]`, `{}`, un objeto con `user_info` o lo que no es un array. */
export function looksLikeNoVod(body: unknown): boolean {
  if (!Array.isArray(body)) return true;
  return body.length === 0;
}
