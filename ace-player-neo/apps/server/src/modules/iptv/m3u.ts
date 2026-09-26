/* Parser de listas M3U de IPTV con streams http(s) (docs/iptv.md §3.2).

   `directories/parsers.ts` no se toca: sigue siendo solo AceStream. Este lee
   LÍNEA A LÍNEA sobre el `Readable`, sin cargar la lista entera, con un tope
   de 16 KiB por línea: lo que pase se descarta hasta el siguiente salto, sin
   acumularlo.

   - Cabecera `#EXTM3U`: `url-tvg` / `x-tvg-url` (separadas por comas: las 2
     primeras http(s)) y `tvg-shift` global. Si hay más de una línea `#EXTM3U`
     (una de firma y otra con la guía, por ejemplo), se suman.
   - `#EXTINF:-1 …,Título`: `tvg-id`, `tvg-name`, `group-title`, `tvg-shift` y
     el título tras la primera coma que no esté entre comillas (un título
     puede llevar comas).
   - `#EXTGRP:` hace de `group-title` si falta. `#EXTVLCOPT:` solo
     `http-user-agent=` y `http-referrer=`, 256 caracteres como mucho y sin
     caracteres de control. El resto se ignora.
   - URL: solo http(s); fuera `acestream://`, rtmp, udp, rtp y el VOD
     (`/movie/`, `/series/`, .mp4, .mkv, .avi, .mp3, .m4a).
   - Secretos: los tramos `/<u>/<p>/` que se repiten antes del id en las URLs
     cortas se devuelven para el redactor.
   - Sin `#EXTM3U` al principio: `iptv_bad_list`. Más de `maxChannels`:
     `iptv_too_large` (se deja de leer). Sin ningún canal válido lo decide
     quien llama (`iptv_empty`). */

import type { Readable } from 'node:stream';
import { IPTV_M3U_LIMITS, IPTV_MAX_CHANNELS, IPTV_VLCOPT_MAX } from '@ace/shared';
import { AppError } from '../../core/errors.js';

export interface M3uEntry {
  readonly title: string;
  readonly tvgId: string;
  readonly tvgName: string;
  readonly group: string;
  /** Horas (puede ser decimal) o null. */
  readonly tvgShift: number | null;
  readonly url: string;
  readonly userAgent: string | null;
  readonly referrer: string | null;
}

export interface M3uHeader {
  /** Como mucho 2 URLs http(s) de guía (`url-tvg` / `x-tvg-url`). */
  readonly guideUrls: readonly string[];
  readonly tvgShift: number | null;
}

export interface M3uParseResult {
  readonly header: M3uHeader;
  /** Vacío si se pasó `onEntry` (los canales se entregan según se leen). */
  readonly entries: readonly M3uEntry[];
  /** Canales en directo válidos leídos. */
  readonly count: number;
  /** Tramos de ruta que se repiten antes del id (usuario y contraseña de las URLs cortas). */
  readonly learnedSecrets: readonly string[];
  /** Entradas descartadas (VOD, esquemas que no son http, líneas enormes). */
  readonly skipped: number;
}

export interface M3uParseOptions {
  readonly maxLineBytes?: number;
  readonly maxChannels?: number;
  readonly signal?: AbortSignal;
  /** Cada canal según se lee, sin acumularlos (memoria, docs/iptv.md §12.2). */
  readonly onEntry?: (entry: M3uEntry) => void;
}

const VOD_PATH_RE = /\/(?:movie|movies|series)\//i;
const VOD_EXT_RE = /\.(?:mp4|mkv|avi|mp3|m4a|mov|wmv|flv)$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Atributos `clave="valor"` de una línea `#EXTINF` o `#EXTM3U`. */
export function parseAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const re = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    attributes.set((match[1] as string).toLowerCase(), (match[2] as string).trim());
  }
  return attributes;
}

/**
 * Posición de la coma que separa los atributos del título: la primera que no
 * está entre comillas (o -1). Así un título con comas («Cine, series») no se
 * corta.
 */
export function titleComma(text: string): number {
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) return index;
  }
  return -1;
}

function parseShift(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && Math.abs(number) <= 24 ? number : null;
}

/** ¿Es una URL de stream en directo que se puede usar? */
export function isLiveHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const pathname = parsed.pathname;
  return !VOD_PATH_RE.test(pathname) && !VOD_EXT_RE.test(pathname);
}

function vlcOption(line: string, name: string): string | null {
  const body = line.slice(line.indexOf(':') + 1).trim();
  const eq = body.indexOf('=');
  if (eq < 0 || body.slice(0, eq).trim().toLowerCase() !== name) return null;
  const value = body.slice(eq + 1).trim();
  if (!value || value.length > IPTV_VLCOPT_MAX || CONTROL_RE.test(value)) return null;
  return value;
}

/** URLs http(s) de guía de la cabecera (las 2 primeras). */
function guideUrlsOf(attributes: Map<string, string>): string[] {
  const out: string[] = [];
  for (const name of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
    for (const part of (attributes.get(name) ?? '').split(',')) {
      const url = part.trim();
      if (/^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
    }
  }
  return out.slice(0, 2);
}

/* Pareja de tramos antes del id en una URL corta (`/<u>/<p>/<id>` o `/live/<u>/<p>/<id>`). */
function shortPair(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const last = parts[parts.length - 1] as string;
  if (!/^\d+(?:\.[a-z0-9]{1,5})?$/i.test(last)) return null;
  return `${parts[parts.length - 3]}\n${parts[parts.length - 2]}`;
}

/**
 * Parsea una lista M3U en streaming. Lanza `iptv_bad_list` si no empieza por
 * `#EXTM3U` e `iptv_too_large` si pasa de `maxChannels`.
 */
export async function parseM3uStream(
  body: Readable,
  options: M3uParseOptions = {},
): Promise<M3uParseResult> {
  const maxLine = options.maxLineBytes ?? IPTV_M3U_LIMITS.maxLineBytes;
  const maxChannels = options.maxChannels ?? IPTV_MAX_CHANNELS;
  const entries: M3uEntry[] = [];
  const pairs = new Map<string, number>();
  let header: M3uHeader = { guideUrls: [], tvgShift: null };
  let sawHeader = false;
  let skipped = 0;
  let count = 0;

  let pending: {
    title: string;
    tvgId: string;
    tvgName: string;
    group: string;
    tvgShift: number | null;
  } | null = null;
  let extGroup = '';
  let userAgent: string | null = null;
  let referrer: string | null = null;

  const handleLine = (raw: string): void => {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) return;
    if (!sawHeader) {
      if (!/^#EXTM3U\b/i.test(line)) throw new AppError('iptv_bad_list');
      sawHeader = true;
      const attributes = parseAttributes(line);
      header = {
        guideUrls: guideUrlsOf(attributes),
        tvgShift: parseShift(attributes.get('tvg-shift')),
      };
      return;
    }
    if (line.startsWith('#')) {
      const upper = line.slice(0, 12).toUpperCase();
      if (/^#EXTM3U\b/i.test(line)) {
        /* Otra cabecera más abajo (hay listas con una primera línea de firma y la guía en la
           segunda): suma sus URLs de guía hasta 2 y su `tvg-shift` si aún no había. */
        const attributes = parseAttributes(line);
        header = {
          guideUrls: [...header.guideUrls, ...guideUrlsOf(attributes)]
            .filter((url, index, all) => all.indexOf(url) === index)
            .slice(0, 2),
          tvgShift: header.tvgShift ?? parseShift(attributes.get('tvg-shift')),
        };
      } else if (upper.startsWith('#EXTINF:')) {
        const comma = titleComma(line);
        const attributes = parseAttributes(comma >= 0 ? line.slice(0, comma) : line);
        const title = comma >= 0 ? line.slice(comma + 1).trim() : '';
        pending = {
          title: title || attributes.get('tvg-name') || '',
          tvgId: attributes.get('tvg-id') ?? '',
          tvgName: attributes.get('tvg-name') ?? '',
          group: attributes.get('group-title') ?? '',
          tvgShift: parseShift(attributes.get('tvg-shift')),
        };
        extGroup = '';
        userAgent = null;
        referrer = null;
      } else if (upper.startsWith('#EXTGRP:')) {
        extGroup = line.slice(line.indexOf(':') + 1).trim();
      } else if (upper.startsWith('#EXTVLCOPT:')) {
        userAgent = vlcOption(line, 'http-user-agent') ?? userAgent;
        referrer = vlcOption(line, 'http-referrer') ?? vlcOption(line, 'http-referer') ?? referrer;
      }
      return;
    }
    /* Una URL: cierra la entrada pendiente. */
    const current = pending;
    pending = null;
    if (!current || !isLiveHttpUrl(line)) {
      skipped += 1;
      return;
    }
    const entry: M3uEntry = {
      title: current.title,
      tvgId: current.tvgId,
      tvgName: current.tvgName,
      group: current.group || extGroup,
      tvgShift: current.tvgShift ?? header.tvgShift,
      url: line,
      userAgent,
      referrer,
    };
    count += 1;
    if (count > maxChannels) throw new AppError('iptv_too_large');
    if (options.onEntry) options.onEntry(entry);
    else entries.push(entry);
    const pair = shortPair(line);
    if (pair) pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  };

  let carry: Buffer[] = [];
  let carryBytes = 0;
  let discarding = false;
  const flushLine = (): void => {
    if (discarding) {
      discarding = false;
      skipped += 1;
    } else if (carryBytes) {
      handleLine(Buffer.concat(carry, carryBytes).toString('utf8'));
    }
    carry = [];
    carryBytes = 0;
  };

  try {
    for await (const value of body as AsyncIterable<Buffer | string>) {
      if (options.signal?.aborted) throw options.signal.reason ?? new AppError('fetch_timeout');
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      let start = 0;
      for (;;) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline < 0 ? chunk.length : newline;
        if (!discarding && end > start) {
          const piece = chunk.subarray(start, end);
          if (carryBytes + piece.length > maxLine) {
            /* Una primera línea enorme no puede ser la cabecera: no se lee más. */
            if (!sawHeader) throw new AppError('iptv_bad_list');
            discarding = true;
            carry = [];
            carryBytes = 0;
          } else {
            carry.push(piece);
            carryBytes += piece.length;
          }
        }
        if (newline < 0) break;
        flushLine();
        start = newline + 1;
      }
    }
    flushLine();
  } finally {
    body.destroy();
  }
  if (!sawHeader) throw new AppError('iptv_bad_list');

  /* Un tramo que se repite en la mayoría de los canales es de la cuenta. */
  const learnedSecrets: string[] = [];
  for (const [pair, hits] of pairs) {
    if (hits * 2 > count && hits >= 2) {
      for (const part of pair.split('\n')) {
        let decoded = part;
        try {
          decoded = decodeURIComponent(part);
        } catch {}
        if (!['live', 'play', 'stream', 'streams', 'hls'].includes(decoded.toLowerCase())) {
          learnedSecrets.push(decoded);
        }
      }
    }
  }
  return { header, entries, count, learnedSecrets, skipped };
}
