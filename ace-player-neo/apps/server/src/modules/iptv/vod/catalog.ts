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
     categorías (`&category_id=X`, 250 ms entre llamadas) y se apunta
     `mode: 'por_categorias'` para empezar por ahí la próxima vez.

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
import { VodTableBuilder, type VodTable } from './table.js';
import {
  shouldFallBackToCategories,
  xtreamVodCategories,
  xtreamVodList,
} from './xtream-vod.js';

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
}

export type VodSyncResult =
  | { readonly state: 'none'; readonly skipped: number }
  | { readonly state: 'ready'; readonly catalog: VodCatalog };

interface KindOutcome {
  readonly table: VodTable;
  readonly none: boolean;
  readonly truncated: boolean;
  readonly skipped: number;
  readonly mode: VodSyncMode;
}

async function syncKind(
  deps: VodSyncDeps,
  kind: VodKind,
  preferred: VodSyncMode,
): Promise<KindOutcome> {
  const { net, credentials, policy, signal, clock } = deps;
  let categories = new Map<string, string>();
  try {
    categories = await xtreamVodCategories(net, credentials, kind, { policy, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    /* Sin nombres de categoría la lista sigue sirviendo (todo «Sin categoría»). */
    deps.logger.warn({ kind }, 'VOD: las categorías no han llegado');
  }
  const max = kind === 'movie' ? VOD_LIMITS.maxMovies : VOD_LIMITS.maxSeries;
  const builder = new VodTableBuilder(max, [...new Set(categories.values())]);
  let skipped = 0;
  const onItem = (item: Record<string, unknown>): boolean => {
    if (builder.full) return false;
    const row = parseListItem(kind, item, categories);
    if (!row) skipped += 1;
    else builder.add(row);
    return !builder.full;
  };
  const byCategories = async (): Promise<{ none: boolean; stopped: boolean }> => {
    if (!categories.size) throw new Error('sin categorías');
    let any = false;
    let first = true;
    for (const categoryId of categories.keys()) {
      if (!/^\d{1,12}$/.test(categoryId)) continue;
      if (!first) await clock.sleep(VOD_LIMITS.byCategory.spacingMs, signal);
      first = false;
      const outcome = await xtreamVodList(net, credentials, kind, onItem, {
        policy,
        signal,
        categoryId,
      });
      skipped += outcome.skipped;
      if (outcome.state === 'ok') any = true;
      if (outcome.stopped || builder.full) return { none: false, stopped: true };
    }
    return { none: !any && builder.size === 0, stopped: false };
  };
  let mode: VodSyncMode = preferred;
  let none: boolean;
  let stopped: boolean;
  if (preferred === 'completo') {
    try {
      const outcome = await xtreamVodList(net, credentials, kind, onItem, { policy, signal });
      skipped += outcome.skipped;
      none = outcome.state === 'none' && builder.size === 0;
      stopped = outcome.stopped;
    } catch (error) {
      if (signal.aborted || !shouldFallBackToCategories(error) || !categories.size) throw error;
      deps.logger.warn(
        { kind, errorCode: (error as { code?: string }).code },
        'VOD: la lista completa ha fallado; se recorre por categorías',
      );
      mode = 'por_categorias';
      const outcome = await byCategories();
      none = outcome.none;
      stopped = outcome.stopped;
    }
  } else {
    try {
      const outcome = await byCategories();
      none = outcome.none;
      stopped = outcome.stopped;
    } catch (error) {
      if (signal.aborted) throw error;
      /* Sin categorías (o fallan): la lista completa, que a lo mejor ya va. */
      mode = 'completo';
      const outcome = await xtreamVodList(net, credentials, kind, onItem, { policy, signal });
      skipped += outcome.skipped;
      none = outcome.state === 'none' && builder.size === 0;
      stopped = outcome.stopped;
    }
  }
  const table = await builder.build();
  return {
    table,
    none,
    truncated: stopped || builder.full,
    skipped: skipped + builder.duplicates,
    mode,
  };
}

/** Descarga y monta el catálogo VOD entero (§4.7). Lanza el código IPTV si falla. */
export async function syncVodCatalog(deps: VodSyncDeps, input: VodSyncInput): Promise<VodSyncResult> {
  const movies = await syncKind(deps, 'movie', input.mode);
  const series = await syncKind(deps, 'series', input.mode);
  const skipped = movies.skipped + series.skipped;
  if (movies.none && series.none) return { state: 'none', skipped };
  const meta: VodCatalogMeta = {
    providerFp: input.providerFp,
    revision: input.revision,
    builtAt: deps.clock.now(),
    truncated: movies.truncated || series.truncated,
    skipped,
    mode: movies.mode === 'por_categorias' || series.mode === 'por_categorias' ? 'por_categorias' : 'completo',
  };
  return {
    state: 'ready',
    catalog: makeVodCatalog(input.providerId, meta, { movie: movies.table, series: series.table }),
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
