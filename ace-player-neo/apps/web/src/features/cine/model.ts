/* Lógica pura de Películas y series (docs/vod.md §12 y §10.3): el estado de
   la URL, columnas de la rejilla por ancho, etiquetas de tiempo y de lo que
   queda, y las reglas de progreso (visto, reanudar, siguiente episodio y el
   botón principal de una serie). Sin React ni red: se prueba sola
   (model.test.ts) con los mismos vectores que usarán el servidor y la app. */

import {
  VOD_PROGRESS,
  VOD_SEARCH,
  VOD_TAGS,
  type VodBrowseQuery,
  type VodKind,
  type VodPlayable,
  type VodSeriesMain,
  type VodTag,
} from '@ace/shared';

// ---- Estado de la URL (§12.2) ----------------------------------------------------------

/** `?cine=peliculas|series` ↔ el tipo del contrato. */
export const KIND_PARAM: Record<VodKind, string> = { movie: 'peliculas', series: 'series' };
export type CineOrder = 'novedades' | 'az';

export interface CineUrlState {
  kind: VodKind;
  /**
   * La rejilla abierta: id de categoría (12 hex o `none`) o `all` (todas). Sin
   * `cinecat` (null) se ve la portada en filas por categoría.
   */
  cat: string | null;
  tag: VodTag | null;
  /** Lo escrito en el buscador, tal cual. */
  q: string;
  order: CineOrder;
}

export const CINE_PARAMS = ['cine', 'cinecat', 'cinetag', 'cineq', 'cineorden'] as const;
const CAT_RE = /^(?:[a-f0-9]{12}|none|all)$/;

export function readCineState(search: string): CineUrlState {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    params = new URLSearchParams();
  }
  const cat = params.get('cinecat');
  const tag = params.get('cinetag');
  return {
    kind: params.get('cine') === KIND_PARAM.series ? 'series' : 'movie',
    cat: cat !== null && CAT_RE.test(cat) ? cat : null,
    tag: tag && (VOD_TAGS as readonly string[]).includes(tag) ? (tag as VodTag) : null,
    q: (params.get('cineq') ?? '').slice(0, 200),
    order: params.get('cineorden') === 'az' ? 'az' : 'novedades',
  };
}

/** La query con el estado nuevo; lo que vale por defecto no se escribe (URLs cortas). */
export function writeCineState(search: string, state: CineUrlState): string {
  const params = new URLSearchParams(search);
  const set = (name: string, value: string | null) => {
    if (value === null || value === '') params.delete(name);
    else params.set(name, value);
  };
  set('cine', state.kind === 'series' ? KIND_PARAM.series : null);
  set('cinecat', state.cat);
  set('cinetag', state.tag);
  set('cineq', state.q);
  set('cineorden', state.order === 'az' ? 'az' : null);
  const text = params.toString().replace(/%2F/gi, '/');
  return text ? `?${text}` : '';
}

export function sameCineState(a: CineUrlState, b: CineUrlState): boolean {
  return (
    a.kind === b.kind && a.cat === b.cat && a.tag === b.tag && a.q === b.q && a.order === b.order
  );
}

// ---- Búsqueda (§6.1 y §12.5) -------------------------------------------------------------

export const QUERY_MIN = 2;
export const QUERY_MAX = 80;

/** Texto listo para mandar: espacios juntos, recortado y a 80. */
export function cleanCineQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
}

export function canSearchCine(value: string): boolean {
  return cleanCineQuery(value).length >= QUERY_MIN;
}

/**
 * ¿Rejilla o portada? La rejilla es otra pantalla (como la lista de una
 * competición frente a la agenda): se llega con una categoría o «Ver todo»
 * (`cinecat`), un distintivo o una búsqueda. Sin nada de eso, la portada en
 * filas por categoría.
 */
export function showsGrid(state: Pick<CineUrlState, 'cat' | 'tag'>, q: string): boolean {
  return q !== '' || state.cat !== null || state.tag !== null;
}

/** La consulta a `vodBrowse` de una pantalla (sin cursor ni límite). */
export function browseQuery(
  state: Pick<CineUrlState, 'kind' | 'cat' | 'tag' | 'order'>,
  q: string,
): Omit<VodBrowseQuery, 'cursor' | 'limit'> {
  const text = canSearchCine(q) ? cleanCineQuery(q) : '';
  return {
    kind: state.kind,
    cat: (state.cat ?? 'all') as VodBrowseQuery['cat'],
    ...(state.tag ? { tag: state.tag } : {}),
    ...(text ? { q: text } : {}),
    sort: state.order === 'az' ? 'name' : 'added',
  };
}

export const PAGE_SIZE = VOD_SEARCH.pageDefault;

// ---- Rejilla (§12.4) ---------------------------------------------------------------------

/**
 * Columnas de carteles por el ancho de la rejilla: 2 hasta 479 px, 3 de 480 a
 * 767, 4 de 768 a 1023, 5 de 1024 a 1279 y 6 desde 1280. Una menos que en la
 * primera versión: Isma pidió «la carátula grande y el título bien visibles»
 * (en el iPhone, carteles de unos 170 px en vez de 110).
 */
export function columnsFor(width: number): number {
  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  if (width >= 480) return 3;
  return 2;
}

/** Filas de `n` en `n` (la última puede ir corta). */
export function chunk<T>(items: readonly T[], n: number): T[][] {
  const size = Math.max(1, Math.floor(n));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// ---- Tiempos y datos ---------------------------------------------------------------------

/** «2 h 15 min», «45 min», «1 h». Menos de un minuto cuenta como 1 min. */
export function durationText(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** «Quedan 12 min», «Quedan 1 h 12 min». */
export function remainingText(posS: number, durS: number): string | null {
  const left = durS - posS;
  if (!Number.isFinite(left) || durS <= 0) return null;
  return `Quedan ${durationText(Math.max(60, left))}`;
}

/** «7,3»: una cifra decimal, con coma. Un 0 es «sin nota» en los paneles Xtream: no se enseña. */
export function ratingText(rating: number | null | undefined): string | null {
  if (rating === null || rating === undefined || !Number.isFinite(rating) || rating <= 0)
    return null;
  return rating.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** «+13» (la edad del proveedor; si ya trae el «+» o no es un número, tal cual). «0» o vacío, nada. */
export function ageText(age: string | null | undefined): string | null {
  const text = (age ?? '').trim();
  if (!text || /^0+$/.test(text)) return null;
  return /^\d{1,2}$/.test(text) ? `+${text}` : text;
}

/** «43:12» o «1:05:09»: una posición dentro del vídeo, como en el reproductor. */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** «Termina a las 23:47»: la hora a la que acabaría si se empieza ahora (como Jellyfin). */
export function endsAtText(remainingS: number | null | undefined, now: number): string | null {
  if (remainingS === null || remainingS === undefined || !(remainingS > 0)) return null;
  const end = new Date(now + remainingS * 1000);
  const time = end.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `Termina a las ${time}`;
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** «2023-05-12» → «12 de mayo de 2023» (sin pasar por la zona horaria). */
export function releasedText(date: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return null;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name || Number(day) < 1 || Number(day) > 31) return null;
  return `${Number(day)} de ${name} de ${year}`;
}

/**
 * Géneros de TMDB que muchos paneles mandan en inglés («Action, Drama»), a su
 * nombre en español. Lo que no está en la tabla (o ya viene en español) se
 * queda como está.
 */
const GENRES_ES: Record<string, string> = {
  action: 'Acción',
  adventure: 'Aventura',
  animation: 'Animación',
  comedy: 'Comedia',
  crime: 'Crimen',
  documentary: 'Documental',
  drama: 'Drama',
  family: 'Familia',
  fantasy: 'Fantasía',
  history: 'Historia',
  horror: 'Terror',
  music: 'Música',
  musical: 'Musical',
  mystery: 'Misterio',
  romance: 'Romance',
  'science fiction': 'Ciencia ficción',
  'sci-fi': 'Ciencia ficción',
  'sci-fi & fantasy': 'Ciencia ficción y fantasía',
  'tv movie': 'Película de TV',
  thriller: 'Suspense',
  war: 'Bélica',
  'war & politics': 'Bélica y política',
  western: 'Western',
  'action & adventure': 'Acción y aventura',
  kids: 'Infantil',
  news: 'Noticias',
  reality: 'Realidad',
  soap: 'Telenovela',
  talk: 'Entrevistas',
};

export function spanishGenre(name: string): string {
  const text = name.trim();
  return GENRES_ES[text.toLowerCase()] ?? text;
}

/** Los géneros en español y sin repetir (dos nombres en inglés pueden dar el mismo). */
export function spanishGenres(names: readonly string[]): string[] {
  return [...new Set(names.map(spanishGenre).filter(Boolean))];
}

let regionNames: Intl.DisplayNames | null | undefined;

/** «US» → «Estados Unidos»; un nombre ya escrito se queda como está. */
export function spanishCountry(name: string | null | undefined): string | null {
  const text = (name ?? '').trim();
  if (!text) return null;
  if (!/^[A-Za-z]{2}$/.test(text)) return text;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['es'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(text.toUpperCase()) ?? text;
  } catch {
    return text;
  }
}

/** Línea de datos de la ficha: «2023 · 2 h 15 min · 7,3 · +13». */
export function metaLine(input: {
  year: number | null;
  durationS?: number | null;
  rating: number | null;
  ageRating?: string | null;
}): string {
  return [
    input.year === null ? null : String(input.year),
    durationText(input.durationS),
    ratingText(input.rating),
    ageText(input.ageRating),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** «2023 · 7,3» bajo el cartel. */
export function cardMeta(card: { year: number | null; rating: number | null }): string {
  return metaLine({ year: card.year, rating: card.rating });
}

/** «Temporada 3» o «Especiales» (la 0, que va al final). */
export function seasonLabel(n: number): string {
  return n === 0 ? 'Especiales' : `Temporada ${n}`;
}

/** Lo que los paneles mandan para «Temporada N»: «Season 2», «s02», «2 сезон», «Temporada 2»… */
const GENERIC_SEASON_RE =
  /^(?:(?:season|temporada|saison|staffel|stagione|seizoen|series|s|t)\s*[-.:]?\s*0*\d+|0*\d+\s*(?:сезон|season|temporada))$/i;

/**
 * El nombre de una temporada en pantalla: «Temporada N» (o «Especiales»)
 * salvo que el proveedor le dé un nombre de verdad («Parte 1», «Libro uno»),
 * que se respeta.
 */
export function seasonName(n: number, provider: string | null | undefined): string {
  const text = (provider ?? '').replace(/\s+/g, ' ').trim();
  if (!text || GENERIC_SEASON_RE.test(text)) return seasonLabel(n);
  if (n === 0 && /^(?:specials?|especial(?:es)?|extras?)$/i.test(text)) return seasonLabel(0);
  return text;
}

// ---- Progreso (§10.3, D-VOD18) ------------------------------------------------------------

export type ProgressKind = 'movie' | 'episode';

/**
 * ¿Visto? Película: quedan ≤ max(180 s, 5 %). Episodio: quedan ≤ max(60 s,
 * 4 %). Umbrales distintos porque los créditos de una película son más largos.
 */
export function isWatched(kind: ProgressKind, posS: number, durS: number): boolean {
  if (!(durS > 0)) return false;
  const rule = kind === 'movie' ? VOD_PROGRESS.watchedMovie : VOD_PROGRESS.watchedEpisode;
  return durS - posS <= Math.max(rule.tailS, rule.ratio * durS);
}

/** Dónde se reanuda: desde 30 s y sin ver, 5 s antes de donde se dejó; si no, desde el principio. */
export function resumeAt(posS: number, watched: boolean): number {
  if (watched || posS < VOD_PROGRESS.resumeMinS) return 0;
  return Math.max(0, posS - VOD_PROGRESS.resumeBackS);
}

/** Parte vista (0-1) para la barra; null si no hay nada que enseñar. */
export function progressRatio(progress: { posS: number; durS: number } | null): number | null {
  if (!progress || !(progress.durS > 0) || progress.posS <= 0) return null;
  return Math.min(1, Math.max(0, progress.posS / progress.durS));
}

export interface EpisodeRef {
  id: string;
  season: number;
  n: number;
}

/**
 * Siguiente episodio: el siguiente de la temporada; si no hay, el primero de
 * la siguiente temporada. «Especiales» (la 0) solo si ya se está en ella.
 * `episodes` puede venir en cualquier orden.
 */
export function nextEpisode(
  episodes: readonly EpisodeRef[],
  current: Pick<EpisodeRef, 'season' | 'n'>,
): EpisodeRef | null {
  const sameSeason = episodes
    .filter((e) => e.season === current.season && e.n > current.n)
    .sort((a, b) => a.n - b.n);
  if (sameSeason[0]) return sameSeason[0];
  if (current.season === 0) return null;
  const later = episodes
    .filter((e) => e.season > current.season)
    .sort((a, b) => a.season - b.season || a.n - b.n);
  return later[0] ?? null;
}

/** «T2:E3» (en botones) y «T2 · E3» (en líneas de texto). */
export function episodeCode(season: number, n: number, separator: ':' | ' · ' = ':'): string {
  return `T${season}${separator}E${n}`;
}

export interface EpisodeProgressRef extends EpisodeRef {
  progress: { posS: number; durS: number; watched: boolean } | null;
}

/**
 * Botón principal de una serie (§10.3), la misma regla que el servidor:
 * sin progreso, «Ver T1:E1»; el último tocado a medias, «Reanudar T2:E3»; el
 * último visto con siguiente, «Siguiente: T2:E4»; todo visto, «Volver a ver
 * T1:E1». `lastId` es el episodio tocado más recientemente (o null).
 */
export function seriesMain(
  episodes: readonly EpisodeProgressRef[],
  lastId: string | null,
): VodSeriesMain | null {
  const ordered = [...episodes].sort(
    (a, b) =>
      (a.season === 0 ? 1 : 0) - (b.season === 0 ? 1 : 0) || a.season - b.season || a.n - b.n,
  );
  const first = ordered[0];
  if (!first) return null;
  const main = (episode: EpisodeRef, action: VodSeriesMain['action'], posS = 0): VodSeriesMain => {
    const code = episodeCode(episode.season, episode.n);
    const label =
      action === 'start'
        ? `Ver ${code}`
        : action === 'resume'
          ? `Reanudar ${code}`
          : action === 'next'
            ? `Siguiente: ${code}`
            : `Volver a ver ${code}`;
    return { episodeId: episode.id, action, label, posS };
  };
  const last = lastId ? ordered.find((e) => e.id === lastId) : undefined;
  if (!last || !last.progress) return main(first, 'start');
  if (!last.progress.watched) return main(last, 'resume', resumeAt(last.progress.posS, false));
  const next = nextEpisode(ordered, last);
  if (next) return main(next, 'next');
  return main(first, 'rewatch');
}

/**
 * «Marcar hasta aquí como visto»: ese episodio y todos los anteriores de la
 * serie (las temporadas anteriores enteras; «Especiales» no cuenta salvo que
 * se marque dentro de ella). Como mucho `markThroughMax`.
 */
export function episodesThrough(
  episodes: readonly EpisodeRef[],
  target: Pick<EpisodeRef, 'season' | 'n'>,
): EpisodeRef[] {
  const before = (e: EpisodeRef) =>
    target.season === 0
      ? e.season === 0 && e.n <= target.n
      : e.season !== 0 &&
        (e.season < target.season || (e.season === target.season && e.n <= target.n));
  return episodes.filter(before).slice(0, VOD_PROGRESS.markThroughMax);
}

/** «T2 · E3», o «Especial 2» en la temporada 0. */
export function episodeTag(season: number, n: number): string {
  return season === 0 ? `Especial ${n}` : episodeCode(season, n, ' · ');
}

/**
 * El texto del botón principal de una serie, por su acción (§10.3): «Ver
 * T1 · E1», «Continuar T2 · E3», «Siguiente capítulo: T2 · E4» o «Volver a
 * ver T1 · E1». El servidor manda también su `label`, que queda de respaldo si
 * la web no encuentra el episodio.
 */
export function seriesPlayLabel(
  action: VodSeriesMain['action'],
  season: number,
  n: number,
): string {
  const code = episodeTag(season, n);
  switch (action) {
    case 'start':
      return `Ver ${code}`;
    case 'resume':
      return `Continuar ${code}`;
    case 'next':
      return `Siguiente capítulo: ${code}`;
    default:
      return `Volver a ver ${code}`;
  }
}

// ---- ¿Se puede reproducir aquí? (§12.6) ---------------------------------------------------

export type PlayBlock = { reason: 'hevc' } | { reason: 'formato'; ext: string | null } | null;

/**
 * La pista del proveedor (`playable`) contra lo que decodifica este
 * navegador. Manda el índice al abrir (VOD-5); esto solo evita ofrecer un
 * botón que seguro falla.
 */
export function playBlock(
  playable: VodPlayable,
  hevcOk: boolean,
  container: string | null | undefined = null,
): PlayBlock {
  if (playable === 'hevc' && !hevcOk) return { reason: 'hevc' };
  if (playable === 'no') return { reason: 'formato', ext: container?.trim() || null };
  return null;
}

/** Los distintivos en su orden fijo (`VOD_TAGS`), sin repetir. */
export function orderedTags(tags: readonly VodTag[]): VodTag[] {
  return VOD_TAGS.filter((tag) => tags.includes(tag));
}
