/* Catálogo de Películas y series: sincronizar, guardar y cargar (docs/vod.md
   §4.6-§4.8, D-VOD2).

   Sincronizar (siempre dentro de `runHeavy('vod')`, que nunca coincide con la
   lista en directo ni con la guía):
     las dos listas de categorías → películas en streaming → series en
     streaming → índices por trozos de 5 000 filas → guardar.
   - Cada objeto se reduce a una fila en el callback del troceador: nunca se
     guarda el objeto parseado; la sinopsis y el reparto se tiran.
   - Al llegar a `maxMovies` o `maxSeries` se corta esa descarga y se guarda
     lo leído con `truncated: true`. No es un error.
   - `skipped` suma lo que saltó el troceador (objetos demasiado grandes), lo
     que no se pudo parsear y los ids repetidos (T5).
   - «Sin VOD» en las dos listas es `none`, no un error.
   - Si una lista completa falla por tiempo, tamaño o 5xx, se recorre por
     categorías (`&category_id=X`, 250 ms entre llamadas). Solo si no cabía
     (`iptv_too_large`) se apunta `mode: 'por_categorias'` para empezar por
     ahí la próxima vez: un plazo o un 5xx pueden ser un mal rato del panel,
     y la lista entera son 2 peticiones frente a cientos.
   - En el modo por categorías, lo que no se ha podido leer (una categoría
     que falla, o las que no caben en su tope de tiempo) se queda como
     estaba en el catálogo anterior, y la siguiente vez se empieza por la
     primera que no cupo (rotación): ninguna se queda fuera para siempre.

   `vod.enc` va sellado con `sealBlobBytes` (AAD `ace-iptv-vod|<providerId>`)
   y se carga de forma perezosa, en la primera petición VOD: nunca en el
   arranque, para que su pico no coincida con el del catálogo en directo.
   Si no se puede leer (otro proveedor, otra versión, bytes rotos), se borra
   y se sincroniza de nuevo.

   También aquí, las reglas de cadencia (puras): primera sincronización,
   cada 24 h, aplazar con alguien viendo y esperas tras un fallo. */

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { VOD_LIMITS, VOD_REFRESH_MS, type VodKind } from '@ace/shared';
import type { Clock } from '../../../core/clock.js';
import { AppError, errorCodeOf } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import type { IptvKeys } from '../../../config/keys.js';
import type { IptvFetchPolicy, NetClient } from '../../net/types.js';
import { catalogStamp } from '../browse.js';
import { openBlobBytes, sealBlobBytes, vodAad } from '../crypto.js';
import { writeSecret } from '../store.js';
import type { XtreamCredentials } from '../xtream.js';
import { parseListItem } from './parse.js';
import {
  completeVodTables,
  decodeVodCatalog,
  encodeVodCatalog,
  type VodCatalogMeta,
  type VodSyncMode,
} from './table-codec.js';
import { BUILD_CHUNK, tableRow, VodTableBuilder, yieldThread, type VodTable } from './table.js';
import { shouldFallBackToCategories, xtreamVodCategories, xtreamVodList } from './xtream-vod.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Esperas tras un fallo de la sincronización VOD (§4.7): nunca tocan las del directo. */
export const VOD_RETRY_MS: readonly number[] = [15 * MINUTE, HOUR, 6 * HOUR, 24 * HOUR];
/** La primera sincronización, tras la primera del directo con éxito. */
export const VOD_FIRST_AFTER_LIVE_MS = MINUTE;
/** Al arrancar sin `vod.enc` o con uno de más de 24 h. */
export const VOD_AT_START_MS = 20_000;
/** Con una sesión IPTV o VOD abierta, las periódicas se aplazan (una vez) esto. */
export const VOD_DELAY_WATCHING_MS = HOUR;
/** «Actualizar» en Ajustes sincroniza también el VOD si tiene más de esto. */
export const VOD_MANUAL_MIN_AGE_MS = HOUR;
/**
 * Tope de tiempo del modo por categorías, por tipo (películas y series):
 * antes no tenía y podía tardar horas con un panel lento (fallo 8). Ya no
 * retrasa el directo (el VOD cede el cerrojo, `runHeavy` en service.ts),
 * pero tampoco debe quedarse colgado para siempre. Lo que no cabe se queda
 * como estaba y es lo primero que se lee la vez siguiente (rotación).
 */
export const VOD_BY_CATEGORY_TOTAL_MS = 30 * MINUTE;
/** Fallos SEGUIDOS de categorías tras los que el modo por categorías se rinde (el panel no está). */
export const VOD_CATEGORY_FAILURES_IN_A_ROW = 5;
/** Parte de las categorías que puede fallar sin rendirse (si son más de 5). */
export const VOD_CATEGORY_FAILURES_RATIO = 0.2;

/** Un catálogo VOD en memoria. */
export interface VodCatalog {
  readonly providerId: string;
  readonly meta: VodCatalogMeta;
  readonly tables: Readonly<Record<VodKind, VodTable>>;
  /** Sello de los cursores (`builtAt` + revisión). */
  readonly stamp: string;
}

export function makeVodCatalog(
  providerId: string,
  meta: VodCatalogMeta,
  tables: Readonly<Record<VodKind, VodTable>>,
): VodCatalog {
  return {
    providerId,
    meta,
    tables,
    stamp: catalogStamp({ builtAt: meta.builtAt, revision: meta.revision }),
  };
}

export interface VodSyncDeps {
  readonly net: NetClient;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly credentials: XtreamCredentials;
  readonly policy: IptvFetchPolicy;
  readonly signal: AbortSignal;
}

export interface VodSyncInput {
  readonly providerId: string;
  readonly providerFp: string;
  readonly revision: number;
  /** El modo con el que empezar (el de la última vez). */
  readonly mode: VodSyncMode;
  /** Tope del modo por categorías por tipo (por defecto `VOD_BY_CATEGORY_TOTAL_MS`; los tests lo bajan). */
  readonly byCategoryTotalMs?: number;
  /**
   * Por qué categoría empezar el modo por categorías, por tipo: la primera
   * que no cupo la vez anterior (rotación). Si ya no existe, por la primera.
   */
  readonly resumeFrom?: Readonly<Partial<Record<VodKind, string>>>;
  /**
   * El catálogo guardado de este proveedor, si hay (se pide solo si hace
   * falta): en el modo por categorías, lo que no se ha podido leer se queda
   * como estaba en él.
   */
  readonly previous?: () => Promise<VodCatalog | null>;
}

export type VodSyncResult =
  | { readonly state: 'none'; readonly skipped: number }
  | {
      readonly state: 'ready';
      readonly catalog: VodCatalog;
      /** Por qué categoría empezar la próxima vez, por tipo (solo los que se cortaron por tiempo). */
      readonly resumeFrom: Readonly<Partial<Record<VodKind, string>>>;
    };

interface KindOutcome {
  readonly table: VodTable;
  readonly none: boolean;
  readonly truncated: boolean;
  readonly skipped: number;
  /** El modo con el que empezar la próxima vez. */
  readonly mode: VodSyncMode;
  /** La primera categoría que no cupo en el tope de tiempo, o null. */
  readonly resumeFrom: string | null;
}

/** Lo que devuelve un recorrido de la lista (entera o por categorías). */
interface ListOutcome {
  readonly none: boolean;
  /** Se ha quedado a medias: por el tope de títulos, o por el de tiempo sin catálogo anterior. */
  readonly stopped: boolean;
  readonly resumeFrom: string | null;
}

/** Códigos que tumban la sincronización entera aunque sea de una sola categoría (la cuenta). */
const FATAL_CODES: ReadonlySet<string> = new Set(['iptv_auth_failed', 'iptv_account_expired']);

/**
 * ¿Hay que rendirse en el modo por categorías? Con 5 fallos SEGUIDOS (el
 * panel no está) o con más de max(5, 20 %) de las categorías fallidas.
 */
export function vodCategoriesGiveUp(failed: number, inARow: number, total: number): boolean {
  return (
    inARow >= VOD_CATEGORY_FAILURES_IN_A_ROW ||
    failed >
      Math.max(VOD_CATEGORY_FAILURES_IN_A_ROW, Math.ceil(total * VOD_CATEGORY_FAILURES_RATIO))
  );
}

/** Lo que `syncKind` saca de `VodSyncInput` para un tipo. */
interface KindInput {
  readonly preferred: VodSyncMode;
  readonly byCategoryTotalMs: number;
  readonly resumeFrom: string | null;
  /** La tabla de ese tipo en el catálogo guardado (se carga solo si hace falta), o null. */
  readonly previous: () => Promise<VodTable | null>;
}

async function syncKind(deps: VodSyncDeps, kind: VodKind, input: KindInput): Promise<KindOutcome> {
  const { net, credentials, policy, signal, clock, logger } = deps;
  let categories = new Map<string, string>();
  try {
    categories = await xtreamVodCategories(net, credentials, kind, { policy, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    /* Sin nombres de categoría la lista sigue sirviendo (todo «Sin categoría»). */
    logger.warn({ kind }, 'VOD: las categorías no han llegado');
  }
  const max = kind === 'movie' ? VOD_LIMITS.maxMovies : VOD_LIMITS.maxSeries;
  const order = [...new Set(categories.values())];
  /* Un `builder` y un `skipped` por intento: al cambiar de modo a mitad (la
     lista entera murió tras leer decenas de miles de filas) se empieza de
     cero, o todo lo leído contaría como repetido (fallo 2). */
  let builder = new VodTableBuilder(max, order);
  let skipped = 0;
  const restart = (): void => {
    builder = new VodTableBuilder(max, order);
    skipped = 0;
  };
  const onItem = (item: Record<string, unknown>): boolean => {
    if (builder.full) return false;
    const row = parseListItem(kind, item, categories);
    if (!row) skipped += 1;
    else builder.add(row);
    return !builder.full;
  };
  const onSkip = (): void => {
    skipped += 1;
  };
  /* Lo que no se ha podido leer en el modo por categorías (las que fallan y
     las que no caben en el tope de tiempo) se queda como estaba en el
     catálogo anterior: antes desaparecía 24 h, y las que nunca cabían no
     salían NUNCA. true si había catálogo anterior. */
  const carryOver = async (ids: readonly string[]): Promise<boolean> => {
    if (!ids.length) return false;
    const previous = await input.previous();
    if (!previous) return false;
    const names = new Set(ids.map((id) => categories.get(id) ?? ''));
    let rows = 0;
    for (let row = 0; row < previous.n && !builder.full; row += 1) {
      if (row % BUILD_CHUNK === BUILD_CHUNK - 1) await yieldThread(signal);
      if (names.has(previous.categoryName(row)) && builder.carry(tableRow(previous, row))) {
        rows += 1;
      }
    }
    logger.info(
      { kind, categories: ids.length, rows },
      'VOD: las categorías que no se han podido leer se quedan como estaban',
    );
    return true;
  };
  /* Por categorías: una mala se salta y se cuenta (fallo 3); con 5 seguidas
     o más del 20 % se rinde. Tope total de 30 min (fallo 8): lo que no cabe
     se queda como estaba y la próxima vez se empieza por ahí (rotación). */
  const byCategories = async (): Promise<ListOutcome> => {
    const all = [...categories.keys()].filter((id) => /^\d{1,12}$/.test(id));
    if (!all.length) throw new Error('sin categorías');
    const start = input.resumeFrom === null ? 0 : Math.max(0, all.indexOf(input.resumeFrom));
    const ids = start ? [...all.slice(start), ...all.slice(0, start)] : all;
    const deadline = clock.now() + input.byCategoryTotalMs;
    const unread: string[] = [];
    let any = false;
    let failed = 0;
    let inARow = 0;
    let lastError: unknown = null;
    let cutAt = -1;
    for (const [index, categoryId] of ids.entries()) {
      if (index > 0) await clock.sleep(VOD_LIMITS.byCategory.spacingMs, signal);
      if (clock.now() >= deadline) {
        cutAt = index;
        break;
      }
      try {
        const outcome = await xtreamVodList(net, credentials, kind, onItem, {
          policy,
          signal,
          categoryId,
          onSkip,
        });
        inARow = 0;
        if (outcome.state === 'ok') any = true;
        if (outcome.stopped || builder.full)
          return { none: false, stopped: true, resumeFrom: null };
      } catch (error) {
        if (signal.aborted) throw error;
        const code = errorCodeOf(error) ?? 'desconocido';
        if (FATAL_CODES.has(code)) throw error;
        failed += 1;
        inARow += 1;
        lastError = error;
        unread.push(categoryId);
        logger.warn({ kind, errorCode: code, failed }, 'VOD: una categoría ha fallado; se salta');
        if (vodCategoriesGiveUp(failed, inARow, ids.length)) throw error;
      }
    }
    if (failed) {
      logger.warn({ kind, failed, total: ids.length }, 'VOD: categorías que no se han podido leer');
      /* Con fallos y sin un solo título no es «sin VOD»: es el panel, que
         no está. Con 4 categorías o menos nunca se llega a rendir (5
         seguidas), y devolver `none` vaciaba ese tipo del catálogo guardado
         (o el catálogo entero) en un mal rato del panel. Se lanza el fallo:
         se queda el catálogo de antes y se reintenta en 15 min. */
      if (builder.size === 0) throw lastError;
    }
    let resumeFrom: string | null = null;
    if (cutAt >= 0) {
      const left = ids.slice(cutAt);
      resumeFrom = left[0] ?? null;
      logger.warn(
        { kind, done: cutAt, total: ids.length, rows: builder.size },
        'VOD: el modo por categorías ha pasado de su tope de tiempo; lo que falta se queda como estaba',
      );
      if (!builder.size) throw new AppError('iptv_timeout', { detail: 'vod_por_categorias' });
      unread.push(...left);
    }
    const carried = await carryOver(unread);
    /* Cortado por tiempo y sin catálogo anterior (la primera vez): faltan categorías de verdad. */
    return { none: !any && builder.size === 0, stopped: cutAt >= 0 && !carried, resumeFrom };
  };
  const whole = async (): Promise<ListOutcome> => {
    const outcome = await xtreamVodList(net, credentials, kind, onItem, { policy, signal, onSkip });
    return {
      none: outcome.state === 'none' && builder.size === 0,
      stopped: outcome.stopped,
      resumeFrom: null,
    };
  };
  /* El modo con el que empezar la próxima vez. */
  let next: VodSyncMode = input.preferred;
  let outcome: ListOutcome;
  if (input.preferred === 'completo') {
    try {
      outcome = await whole();
    } catch (error) {
      if (signal.aborted || !shouldFallBackToCategories(error) || !categories.size) throw error;
      const code = errorCodeOf(error);
      logger.warn(
        { kind, errorCode: code, rows: builder.size },
        'VOD: la lista completa ha fallado; se recorre por categorías',
      );
      /* Solo se recuerda si no cabe, que no cambia de un día para otro. Un
         plazo o un 5xx pueden ser un mal rato del panel, y la lista entera
         son 2 peticiones frente a cientos (444 + 384 categorías en el de
         Isma, que la da entera en 4 s). */
      next = code === 'iptv_too_large' ? 'por_categorias' : 'completo';
      restart();
      outcome = await byCategories();
    }
  } else {
    try {
      outcome = await byCategories();
    } catch (error) {
      if (signal.aborted) throw error;
      if (FATAL_CODES.has(errorCodeOf(error) ?? '')) throw error;
      /* Sin categorías (o fallan): la lista completa, que a lo mejor ya va. */
      next = 'completo';
      restart();
      outcome = await whole();
    }
  }
  if (signal.aborted) throw signal.reason;
  const table = await builder.build(signal);
  return {
    table,
    none: outcome.none,
    truncated: outcome.stopped || builder.full,
    skipped: skipped + builder.duplicates,
    mode: next,
    resumeFrom: outcome.resumeFrom,
  };
}

/** Descarga y monta el catálogo VOD entero (§4.7). Lanza el código IPTV si falla. */
export async function syncVodCatalog(
  deps: VodSyncDeps,
  input: VodSyncInput,
): Promise<VodSyncResult> {
  const totalMs = input.byCategoryTotalMs ?? VOD_BY_CATEGORY_TOTAL_MS;
  /* El catálogo anterior se carga una vez y solo si hace falta (una
     categoría que falla o el tope de tiempo del modo por categorías). */
  let previous: Promise<VodCatalog | null> | null = null;
  const kindInput = (kind: VodKind): KindInput => ({
    preferred: input.mode,
    byCategoryTotalMs: totalMs,
    resumeFrom: input.resumeFrom?.[kind] ?? null,
    previous: async () => {
      if (!input.previous) return null;
      previous ??= input.previous().catch(() => null);
      const catalog = await previous;
      return catalog && catalog.providerId === input.providerId ? catalog.tables[kind] : null;
    },
  });
  const movies = await syncKind(deps, 'movie', kindInput('movie'));
  if (deps.signal.aborted) throw deps.signal.reason;
  const series = await syncKind(deps, 'series', kindInput('series'));
  const skipped = movies.skipped + series.skipped;
  if (movies.none && series.none) return { state: 'none', skipped };
  const meta: VodCatalogMeta = {
    providerFp: input.providerFp,
    revision: input.revision,
    builtAt: deps.clock.now(),
    truncated: movies.truncated || series.truncated,
    skipped,
    mode:
      movies.mode === 'por_categorias' || series.mode === 'por_categorias'
        ? 'por_categorias'
        : 'completo',
  };
  const resumeFrom: Partial<Record<VodKind, string>> = {};
  if (movies.resumeFrom) resumeFrom.movie = movies.resumeFrom;
  if (series.resumeFrom) resumeFrom.series = series.resumeFrom;
  return {
    state: 'ready',
    catalog: makeVodCatalog(input.providerId, meta, { movie: movies.table, series: series.table }),
    resumeFrom,
  };
}

/** Guarda `vod.enc` (sellado, atómico, 0600). */
export async function saveVodCatalog(
  file: string,
  keys: Pick<IptvKeys, 'secrets'>,
  catalog: VodCatalog,
): Promise<void> {
  const parts = encodeVodCatalog(catalog.meta, catalog.tables);
  const blob = await sealBlobBytes(keys.secrets, vodAad(catalog.providerId), parts);
  await writeSecret(file, path.dirname(file), blob);
}

/** Borra `vod.enc` y su resto `.tmp` (nunca lanza). */
export async function removeVodCatalogFile(file: string): Promise<void> {
  for (const target of [file, `${file}.tmp`]) {
    await rm(target, { force: true }).catch(() => undefined);
  }
}

/**
 * Carga `vod.enc` de ese proveedor, o null. Si existe pero no se puede leer
 * (AAD de otro proveedor, otra versión o bytes rotos), se borra: toca
 * sincronizar de nuevo.
 */
export async function loadVodCatalog(
  file: string,
  keys: Pick<IptvKeys, 'secrets'>,
  providerId: string,
  providerFp: string,
  logger: Logger,
): Promise<VodCatalog | null> {
  let blob: Buffer | null;
  try {
    blob = await readFile(file);
  } catch {
    return null;
  }
  try {
    let body: Buffer | null = await openBlobBytes(keys.secrets, vodAad(providerId), blob);
    /* Se sueltan las copias intermedias en cuanto sobran (pico de la carga, §4.6). */
    blob = null;
    const decoded = decodeVodCatalog(body);
    body = null;
    if (decoded.meta.providerFp !== providerFp) throw new Error('otro proveedor');
    return makeVodCatalog(providerId, decoded.meta, await completeVodTables(decoded.raw));
  } catch {
    logger.warn({ errorCode: 'iptv_secret_unreadable' }, 'catálogo VOD ilegible: se descarta');
    await rm(file, { force: true }).catch(() => undefined);
    return null;
  }
}

// --- Cadencia (§4.7), pura ---

/** Espera tras `failures` fallos seguidos (15 min, 1 h, 6 h y 24 h). */
export function vodRetryDelay(failures: number): number {
  const index = Math.min(VOD_RETRY_MS.length - 1, Math.max(0, failures - 1));
  return VOD_RETRY_MS[index] as number;
}

/** Cuánto falta para la siguiente periódica (24 h desde `builtAt`). */
export function vodPeriodicDelay(builtAt: number, now: number): number {
  return Math.max(0, builtAt + VOD_REFRESH_MS - now);
}

/**
 * ¿Qué hacer cuando toca sincronizar? La PRIMERA no se aplaza aunque alguien
 * esté viendo algo (solo son llamadas a la API y no ocupan la plaza); las
 * siguientes, con una sesión IPTV o VOD abierta, se aplazan una vez 1 h.
 */
export function vodDueAction(input: {
  readonly first: boolean;
  readonly busy: boolean;
  readonly delayedOnce: boolean;
}): 'run' | 'delay' {
  if (input.first || !input.busy || input.delayedOnce) return 'run';
  return 'delay';
}

/** ¿Hay que sincronizar al arrancar? (sin `vod.enc` o con uno de más de 24 h). */
export function vodDueAtStart(builtAt: number | null, now: number): boolean {
  return builtAt === null || now - builtAt >= VOD_REFRESH_MS;
}
