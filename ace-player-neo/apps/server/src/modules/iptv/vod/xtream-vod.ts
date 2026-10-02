/* Las 6 llamadas VOD de `player_api.php` (docs/vod.md §4.2), con la política
   IPTV de siempre (filtro SSRF en cada salto, puerto del relé bloqueado,
   gzip con tope descomprimido y errores sin URL).

   - `get_vod_categories` y `get_series_categories`: `fetchJson` (2 MiB, 20 s).
   - `get_vod_streams` y `get_series`, sin `category_id`: EN STREAMING con el
     troceador y su propio `maxObjectBytes` (64 KiB películas, 256 KiB
     series, T5); 160 MiB y 240 s. Con `category_id` (modo por categorías,
     §4.7), 32 MiB y 60 s.
   - `get_vod_info&vod_id=` y `get_series_info&series_id=`: `fetchJson` con
     512 KiB y 8 MiB (una serie de 748 episodios son ~2 MiB, T6); los pide
     la cola de fichas (details.ts), de una en una.

   Los parámetros van en lista cerrada: la acción es una unión y `extra` solo
   admite `category_id`, `vod_id` y `series_id` con `/^\d{1,12}$/`. No hay
   forma de inyectar parámetros. «Sin VOD» (lo que no es un array, `[]`, `{}`
   o un objeto con `user_info`) NO es un error: `state: 'none'`. */

import { IPTV_USER_AGENT, VOD_LIMITS, type VodKind } from '@ace/shared';
import { AppError, errorCodeOf } from '../../../core/errors.js';
import { NetBadResponseError } from '../../net/client.js';
import type { NetClient } from '../../net/types.js';
import { toIptvError } from '../errors.js';
import { parseJsonArrayStream } from '../json-array.js';
import {
  xtreamApiUrl,
  xtreamCategories,
  type XtreamCallOptions,
  type XtreamCredentials,
} from '../xtream.js';

export type XtreamVodAction =
  | 'get_vod_categories'
  | 'get_series_categories'
  | 'get_vod_streams'
  | 'get_series'
  | 'get_vod_info'
  | 'get_series_info';

type ExtraKey = 'category_id' | 'vod_id' | 'series_id';

const HEADERS = { 'User-Agent': IPTV_USER_AGENT };
const NUMERIC = /^\d{1,12}$/;

/** URL de una llamada VOD con los parámetros en lista cerrada (§4.2). */
export function xtreamVodApiUrl(
  credentials: XtreamCredentials,
  action: XtreamVodAction,
  extra: Partial<Record<ExtraKey, string>> = {},
): string {
  const safe: Record<string, string> = {};
  for (const key of ['category_id', 'vod_id', 'series_id'] as const) {
    const value = extra[key];
    if (value === undefined) continue;
    if (!NUMERIC.test(value)) throw new AppError('validation_error', { detail: key });
    safe[key] = value;
  }
  return xtreamApiUrl(credentials, action, safe);
}

/** Categorías de películas o de series (id → nombre, en el orden del panel). */
export function xtreamVodCategories(
  net: NetClient,
  credentials: XtreamCredentials,
  kind: VodKind,
  options: XtreamCallOptions,
): Promise<Map<string, string>> {
  return xtreamCategories(
    net,
    credentials,
    { ...options, limits: VOD_LIMITS.categories },
    kind === 'movie' ? 'get_vod_categories' : 'get_series_categories',
  );
}

export interface VodListOutcome {
  /** `none`: la respuesta no era un array o venía vacía (panel sin VOD). */
  readonly state: 'ok' | 'none';
  readonly objects: number;
  /** Objetos que el troceador saltó (demasiado grandes o que no son objeto). */
  readonly skipped: number;
  /** Se paró al llegar al tope de títulos (`onItem` devolvió `false`). */
  readonly stopped: boolean;
}

/** Señal propia para cortar la descarga al llegar al tope (no es un error). */
class StopList extends Error {
  constructor() {
    super('tope de títulos');
  }
}

function notAnArray(error: unknown): boolean {
  return (
    error instanceof NetBadResponseError &&
    error.cause instanceof Error &&
    error.cause.message === 'no es un array'
  );
}

/**
 * `get_vod_streams` o `get_series` en streaming. `onItem` recibe cada objeto
 * y devuelve false para parar (tope de títulos): entonces se corta la
 * descarga y `stopped` es true. Lanza el código IPTV de la red.
 */
export async function xtreamVodList(
  net: NetClient,
  credentials: XtreamCredentials,
  kind: VodKind,
  onItem: (item: Record<string, unknown>) => boolean,
  options: XtreamCallOptions & { readonly categoryId?: string },
): Promise<VodListOutcome> {
  const byCategory = options.categoryId !== undefined;
  const limits = kind === 'movie' ? VOD_LIMITS.movies : VOD_LIMITS.series;
  const maxBytes = byCategory ? VOD_LIMITS.byCategory.maxBytes : limits.maxBytes;
  const totalMs = byCategory ? VOD_LIMITS.byCategory.totalMs : limits.totalMs;
  const url = xtreamVodApiUrl(
    credentials,
    kind === 'movie' ? 'get_vod_streams' : 'get_series',
    byCategory ? { category_id: options.categoryId as string } : {},
  );
  let stopped = false;
  try {
    const opened = await net.openStream(url, {
      maxBytes,
      totalMs,
      idleMs: limits.idleMs,
      headers: HEADERS,
      accept: 'application/json',
      iptv: { ...options.policy, maxDecompressedBytes: maxBytes * 3 },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const result = await parseJsonArrayStream(
      opened.body,
      (item) => {
        if (!onItem(item)) {
          stopped = true;
          throw new StopList();
        }
      },
      {
        maxObjectBytes: limits.maxObjectBytes,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    const state = result.objects === 0 && result.skipped === 0 ? 'none' : 'ok';
    return { state, objects: result.objects, skipped: result.skipped, stopped: false };
  } catch (error) {
    if (error instanceof StopList || stopped) {
      return { state: 'ok', objects: 0, skipped: 0, stopped: true };
    }
    if (notAnArray(error)) return { state: 'none', objects: 0, skipped: 0, stopped: false };
    throw toIptvError(error, 'list');
  }
}

/**
 * ¿Merece el fallo de una lista completa pasar al modo por categorías (§4.7)?
 * Por tiempo, por tamaño o por un 5xx.
 */
export function shouldFallBackToCategories(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (code === 'iptv_timeout' || code === 'iptv_too_large') return true;
  const detail = error instanceof AppError ? (error.detail ?? '') : '';
  return code === 'iptv_unreachable' && /^http_5\d\d$/.test(detail);
}

/** `get_vod_info` o `get_series_info` de un título (JSON crudo: lo reduce parse.ts). */
export async function xtreamVodInfo(
  net: NetClient,
  credentials: XtreamCredentials,
  kind: VodKind,
  source: number,
  options: XtreamCallOptions,
): Promise<unknown> {
  const limits = kind === 'movie' ? VOD_LIMITS.movieInfo : VOD_LIMITS.seriesInfo;
  const url =
    kind === 'movie'
      ? xtreamVodApiUrl(credentials, 'get_vod_info', { vod_id: String(source) })
      : xtreamVodApiUrl(credentials, 'get_series_info', { series_id: String(source) });
  try {
    const response = await net.fetchJson(url, {
      maxBytes: limits.maxBytes,
      totalTimeoutMs: limits.totalMs,
      headers: HEADERS,
      iptv: { ...options.policy, maxDecompressedBytes: limits.maxBytes * 3 },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return response.body;
  } catch (error) {
    throw toIptvError(error, 'list');
  }
}
