/* Cliente de Xtream Codes (`player_api.php`, docs/iptv.md §3.3).

   Todas las llamadas son `GET {server}/player_api.php?username=U&password=P
   [&action=…]` por `net` con el filtro de la IPTV. NUNCA se escribe la URL
   (lleva las credenciales): los errores salen con código del catálogo y, como
   mucho, el host.

   - Sin `action`: `user_info` y `server_info` (256 KiB, 8 s).
   - `get_live_categories`: nombre de la categoría de cada `category_id`.
   - `get_live_streams`: EN STREAMING con el troceador del array JSON
     (json-array.ts), 48 MiB y 90 s con 20 s de inactividad; el tope de
     canales se aplica mientras se lee.
   - `get_short_epg`: guía de respaldo, con `title`/`description` en base64.
   - Los números llegan a menudo como texto (`"1"`): se aceptan los dos.
   - `auth: 0` o un 401/403 dan `iptv_auth_failed`; `status` distinto de
     `Active`, `iptv_account_expired`. Una respuesta sin `user_info` es
     `iptv_unreachable` con `detail: sin_user_info` (§16.8), no un fallo de
     contraseña.
   - `get_live_categories` da también el ORDEN de las categorías (la pestaña
     IPTV las enseña así, §16.3); un canal con `category_ids` usa el primero.
   - URL de stream: `{server}/live/{U}/{P}/{stream_id}.{ext}` con `ts` si está
     en `allowed_output_formats` (o si viene vacía) y si no `m3u8`. No se usa
     `direct_source` ni `server_info.url`: manda el servidor que escribió Isma. */

import {
  IPTV_MAX_CHANNELS,
  IPTV_USER_AGENT,
  IPTV_XTREAM_LIMITS,
  type IptvAccountStatus,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { IptvFetchPolicy, NetClient } from '../net/types.js';
import { parseJsonArrayStream } from './json-array.js';
import { toIptvError } from './errors.js';

export interface XtreamCredentials {
  /** Origen más la ruta base si la hay, sin barra final. */
  readonly server: string;
  readonly username: string;
  readonly password: string;
}

export interface XtreamAccount {
  readonly status: IptvAccountStatus;
  /** `auth` del panel (false = usuario o contraseña que no valen). */
  readonly auth: boolean;
  readonly expiresAt: string | null;
  readonly maxConnections: number | null;
  readonly activeConnections: number | null;
  readonly allowedOutputFormats: readonly string[];
}

export interface XtreamStream {
  readonly streamId: string;
  readonly name: string;
  readonly epgChannelId: string;
  readonly categoryId: string;
}

export interface XtreamShortEpgItem {
  readonly title: string;
  readonly description: string;
  readonly start: number;
  readonly stop: number;
}

export interface XtreamCallOptions {
  readonly policy: IptvFetchPolicy;
  readonly signal?: AbortSignal;
}

const HEADERS = { 'User-Agent': IPTV_USER_AGENT };

/** Número tolerante: acepta `1`, `"1"` y devuelve null para lo demás. */
export function looseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function looseInt(value: unknown): number | null {
  const number = looseNumber(value);
  return number === null || number < 0 ? null : Math.floor(number);
}

function looseString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** `{server}/player_api.php?username=…&password=…[&action=…]`. */
export function xtreamApiUrl(
  credentials: XtreamCredentials,
  action?: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(`${credentials.server}/player_api.php`);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  if (action) url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

/** `{server}/xmltv.php?username=…&password=…` (guía). */
export function xtreamGuideUrl(credentials: XtreamCredentials): string {
  const url = new URL(`${credentials.server}/xmltv.php`);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  return url.toString();
}

/** Extensión de los streams: `ts` si el panel lo permite (o no dice nada), si no `m3u8`. */
export function xtreamExtension(allowed: readonly string[]): 'ts' | 'm3u8' {
  if (!allowed.length) return 'ts';
  return allowed.map((format) => format.toLowerCase()).includes('ts') ? 'ts' : 'm3u8';
}

/** `{server}/live/{U}/{P}/{stream_id}.{ext}`. */
export function xtreamStreamUrl(
  credentials: XtreamCredentials,
  streamId: string,
  ext: 'ts' | 'm3u8',
): string {
  const segment = (value: string) => encodeURIComponent(value);
  return `${credentials.server}/live/${segment(credentials.username)}/${segment(
    credentials.password,
  )}/${segment(streamId)}.${ext}`;
}

function accountStatus(auth: boolean, raw: string): IptvAccountStatus {
  if (!auth) return 'disabled';
  const status = raw.toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'expired') return 'expired';
  if (status === 'banned') return 'banned';
  if (status === 'disabled') return 'disabled';
  return status ? 'unknown' : 'active';
}

function expiryOf(value: unknown): string | null {
  const seconds = looseNumber(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Lee `user_info` de la respuesta sin `action`. No lanza por la cuenta: eso lo decide quien llama. */
export function parseUserInfo(body: unknown): XtreamAccount {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const info =
    root.user_info && typeof root.user_info === 'object'
      ? (root.user_info as Record<string, unknown>)
      : null;
  if (!info) {
    return {
      status: 'unknown',
      auth: false,
      expiresAt: null,
      maxConnections: null,
      activeConnections: null,
      allowedOutputFormats: [],
    };
  }
  const authValue = looseNumber(info.auth);
  const auth = info.auth === true || (authValue !== null && authValue > 0);
  const formats = Array.isArray(info.allowed_output_formats)
    ? info.allowed_output_formats.map((format) => looseString(format)).filter(Boolean)
    : [];
  return {
    status: accountStatus(auth, looseString(info.status)),
    auth,
    expiresAt: expiryOf(info.exp_date),
    maxConnections: looseInt(info.max_connections),
    activeConnections: looseInt(info.active_cons),
    allowedOutputFormats: formats,
  };
}

/** Lanza el código de la cuenta si no sirve (`iptv_auth_failed` o `iptv_account_expired`). */
export function assertAccountUsable(account: XtreamAccount): void {
  if (!account.auth) throw new AppError('iptv_auth_failed');
  if (account.status !== 'active' && account.status !== 'unknown') {
    throw new AppError('iptv_account_expired');
  }
}

/** `user_info` (256 KiB, 8 s). Lanza el código IPTV de la red; la cuenta la mira quien llama. */
export async function xtreamUserInfo(
  net: NetClient,
  credentials: XtreamCredentials,
  options: XtreamCallOptions,
): Promise<XtreamAccount> {
  let body: unknown;
  try {
    const response = await net.fetchJson(xtreamApiUrl(credentials), {
      maxBytes: IPTV_XTREAM_LIMITS.userInfo.maxBytes,
      totalTimeoutMs: IPTV_XTREAM_LIMITS.userInfo.totalMs,
      headers: HEADERS,
      iptv: options.policy,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    body = response.body;
  } catch (error) {
    throw toIptvError(error, 'account');
  }
  /* Sin `user_info` («[]», «{}», una portada en JSON) el panel no ha contestado
     bien: NO es «usuario y contraseña que no valen» (§16.8). Solo `auth: 0`,
     un 401 o un 403 lo son. */
  if (!hasUserInfo(body)) {
    throw new AppError('iptv_unreachable', { detail: 'sin_user_info' });
  }
  return parseUserInfo(body);
}

/** ¿Trae la respuesta sin `action` un objeto `user_info`? */
export function hasUserInfo(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const info = (body as Record<string, unknown>).user_info;
  return Boolean(info && typeof info === 'object' && !Array.isArray(info));
}

/**
 * `get_live_categories`: id → nombre, en el orden del panel (el `Map`
 * conserva el de inserción). Un fallo aquí no tumba la sincronización.
 */
export async function xtreamCategories(
  net: NetClient,
  credentials: XtreamCredentials,
  options: XtreamCallOptions,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const response = await net.fetchJson(xtreamApiUrl(credentials, 'get_live_categories'), {
      maxBytes: IPTV_XTREAM_LIMITS.liveCategories.maxBytes,
      totalTimeoutMs: IPTV_XTREAM_LIMITS.liveCategories.totalMs,
      headers: HEADERS,
      iptv: options.policy,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (Array.isArray(response.body)) {
      for (const item of response.body as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const id = looseString(record.category_id);
        const name = looseString(record.category_name);
        if (id && name) out.set(id, name.slice(0, 200));
      }
    }
  } catch (error) {
    throw toIptvError(error, 'list');
  }
  return out;
}

/**
 * Categoría de un canal de `get_live_streams`: `category_id` o, si falta,
 * el primero de `category_ids` (hay paneles que mandan la lista; §16.3).
 */
export function streamCategoryId(item: Record<string, unknown>): string {
  const direct = looseString(item.category_id);
  if (direct) return direct;
  const list = Array.isArray(item.category_ids) ? (item.category_ids as unknown[]) : [];
  for (const value of list) {
    const id = looseString(value);
    if (id) return id;
  }
  return '';
}

/**
 * Nombres de las categorías en el orden de `get_live_categories`, sin
 * repetir (dos categorías con el mismo nombre se juntan en una, §16.3).
 */
export function categoryOrder(categories: ReadonlyMap<string, string>): string[] {
  return [...new Set(categories.values())];
}

/**
 * `get_live_streams` en streaming: llama a `onStream` con cada canal en
 * directo. Lanza `iptv_too_large` al pasar de `maxChannels` (sin terminar de
 * leer).
 */
export async function xtreamLiveStreams(
  net: NetClient,
  credentials: XtreamCredentials,
  onStream: (stream: XtreamStream) => void,
  options: XtreamCallOptions & { readonly maxChannels?: number },
): Promise<number> {
  const max = options.maxChannels ?? IPTV_MAX_CHANNELS;
  let count = 0;
  try {
    const opened = await net.openStream(xtreamApiUrl(credentials, 'get_live_streams'), {
      maxBytes: IPTV_XTREAM_LIMITS.liveStreams.maxBytes,
      totalMs: IPTV_XTREAM_LIMITS.liveStreams.totalMs,
      idleMs: IPTV_XTREAM_LIMITS.liveStreams.idleMs,
      headers: HEADERS,
      accept: 'application/json',
      iptv: {
        ...options.policy,
        maxDecompressedBytes: IPTV_XTREAM_LIMITS.liveStreams.maxBytes * 3,
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await parseJsonArrayStream(
      opened.body,
      (item) => {
        const type = looseString(item.stream_type).toLowerCase();
        /* Solo directo (sin tipo también vale: hay paneles que no lo mandan). */
        if (type && type !== 'live' && type !== 'created_live') return;
        const streamId = looseString(item.stream_id);
        const name = looseString(item.name);
        if (!streamId || !/^[A-Za-z0-9_-]{1,40}$/.test(streamId) || !name) return;
        count += 1;
        if (count > max) throw new AppError('iptv_too_large');
        onStream({
          streamId,
          name: name.slice(0, 200),
          epgChannelId: looseString(item.epg_channel_id).slice(0, 200),
          categoryId: streamCategoryId(item),
        });
      },
      { maxObjectBytes: IPTV_XTREAM_LIMITS.maxObjectBytes },
    );
  } catch (error) {
    throw toIptvError(error, 'list');
  }
  return count;
}

function base64Text(value: unknown): string {
  const text = looseString(value);
  if (!text) return '';
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    /* Si no era base64 de verdad, sale basura con caracteres de reemplazo. */
    return decoded.includes('�') ? text : decoded;
  } catch {
    return text;
  }
}

/** `get_short_epg` de un canal (respaldo de la guía, docs/iptv.md §3.6). */
export async function xtreamShortEpg(
  net: NetClient,
  credentials: XtreamCredentials,
  streamId: string,
  options: XtreamCallOptions,
): Promise<XtreamShortEpgItem[]> {
  let body: unknown;
  try {
    const response = await net.fetchJson(
      xtreamApiUrl(credentials, 'get_short_epg', { stream_id: streamId, limit: '12' }),
      {
        maxBytes: IPTV_XTREAM_LIMITS.shortEpg.maxBytes,
        totalTimeoutMs: IPTV_XTREAM_LIMITS.shortEpg.totalMs,
        headers: HEADERS,
        iptv: options.policy,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    body = response.body;
  } catch (error) {
    throw toIptvError(error, 'list');
  }
  const listings =
    body &&
    typeof body === 'object' &&
    Array.isArray((body as { epg_listings?: unknown }).epg_listings)
      ? ((body as { epg_listings: unknown[] }).epg_listings as unknown[])
      : [];
  const out: XtreamShortEpgItem[] = [];
  for (const item of listings) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const start = looseNumber(record.start_timestamp);
    const stop = looseNumber(record.stop_timestamp);
    if (start === null || stop === null || stop <= start) continue;
    out.push({
      title: base64Text(record.title).slice(0, 8192),
      description: base64Text(record.description).slice(0, 8192),
      start: start * 1000,
      stop: stop * 1000,
    });
  }
  return out;
}
