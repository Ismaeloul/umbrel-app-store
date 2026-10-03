/* Logos de canal e imágenes de programa de la Guía TV por un proxy propio
   (docs/iptv.md §20.6, `iptvGuideArt`).

   La CSP de la web (`img-src 'self' data:`) no deja enlazar al proveedor, y
   enlazarlo filtraría la URL. La ruta recibe SOLO referencias de la guía
   (`c<g>` o `p<g>.<minuto>`): la URL sale de `guia.db` y nunca sale del
   módulo. No es un proxy abierto.

   - Descarga por `net.fetchBuffer` con la política IPTV y SIN red de casa
     (`lan: false`): una guía hostil no puede apuntar un logo al router.
   - 512 KiB y 8 s por imagen; 2 a la vez y 32 en cola; con la cola llena,
     503 `guide_busy` con `Retry-After`.
   - Solo JPEG, PNG y WebP por BYTES MÁGICOS (nada de SVG ni HTML); se sirven
     con el tipo que dicen los bytes, `nosniff` y `default-src 'none'`.
   - Caché en memoria (LRU, 16 MiB): los logos son pocos y pequeños. Un fallo
     del origen se recuerda 1 h. La web los guarda un día (`immutable`: la
     URL lleva la `v` de la guía). */

import { createHash } from 'node:crypto';
import { IPTV_GUIDE_ART, IPTV_USER_AGENT } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Clock } from '../../core/clock.js';
import type { Logger } from '../../core/logger.js';
import type { IptvFetchPolicy, NetClient } from '../net/types.js';

export type GuideImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Tipo de imagen por los bytes mágicos; null si no es JPEG, PNG ni WebP. */
export function guideImageType(bytes: Buffer): GuideImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** ¿`If-None-Match` casa con el ETag (también `W/`, comillas y listas)? */
export function guideEtagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
    .includes(etag);
}

export type GuideArtReply =
  | { readonly status: 200; readonly headers: Record<string, string>; readonly body: Buffer }
  | { readonly status: 304; readonly headers: Record<string, string> };

interface Cached {
  readonly body: Buffer;
  readonly type: GuideImageType;
  readonly etag: string;
}

export interface GuideArtDeps {
  readonly net: NetClient;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Filtro de la IPTV (el puerto del relé bloqueado); aquí siempre sin red de casa. */
  readonly policy: () => IptvFetchPolicy;
}

const CACHE_HEADER = 'private, max-age=86400, immutable';

export class GuideArt {
  private readonly cache = new Map<string, Cached>();
  private cacheBytes = 0;
  private readonly negative = new Map<string, number>();
  private readonly running = new Map<string, Promise<Cached>>();
  private active = 0;
  private readonly queue: (() => void)[] = [];
  /** Descargas hechas al origen (para las pruebas). */
  fetches = 0;

  constructor(private readonly deps: GuideArtDeps) {}

  /** La imagen de esa URL (de la caché o descargada), o el 304. Lanza `not_found` o `guide_busy`. */
  async reply(url: string, ifNoneMatch: string | undefined): Promise<GuideArtReply> {
    const item = await this.load(url);
    const headers: Record<string, string> = {
      'cache-control': CACHE_HEADER,
      etag: `"${item.etag}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    };
    if (guideEtagMatches(ifNoneMatch, item.etag)) return { status: 304, headers };
    return {
      status: 200,
      headers: {
        ...headers,
        'content-type': item.type,
        'content-length': String(item.body.length),
      },
      body: item.body,
    };
  }

  /** Vacía la caché (otra guía u otro proveedor). */
  clear(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    this.negative.clear();
  }

  private async load(url: string): Promise<Cached> {
    const cached = this.cache.get(url);
    if (cached) {
      /* LRU: al final del mapa lo último usado. */
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached;
    }
    const until = this.negative.get(url);
    if (until !== undefined) {
      if (until > this.deps.clock.now())
        throw new AppError('not_found', { detail: 'guía: imagen que falló' });
      this.negative.delete(url);
    }
    const running = this.running.get(url);
    if (running) return running;
    if (this.active >= IPTV_GUIDE_ART.concurrency && this.queue.length >= IPTV_GUIDE_ART.queueMax) {
      throw new AppError('guide_busy', { detail: 'guía: cola de imágenes llena' });
    }
    const promise = this.fetch(url).finally(() => this.running.delete(url));
    this.running.set(url, promise);
    return promise;
  }

  private async fetch(url: string): Promise<Cached> {
    await this.slot();
    try {
      this.fetches += 1;
      let body: Buffer;
      try {
        const response = await this.deps.net.fetchBuffer(url, {
          maxBytes: IPTV_GUIDE_ART.maxBytes,
          totalTimeoutMs: IPTV_GUIDE_ART.timeoutMs,
          idleTimeoutMs: IPTV_GUIDE_ART.timeoutMs,
          accept: 'image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
          headers: { 'User-Agent': IPTV_USER_AGENT },
          iptv: { ...this.deps.policy(), lan: false },
        });
        body = response.body;
      } catch {
        this.remember(url);
        throw new AppError('not_found', { detail: 'guía: el origen de la imagen ha fallado' });
      }
      const type = guideImageType(body);
      if (!type) {
        this.remember(url);
        throw new AppError('not_found', { detail: 'guía: la imagen no es JPEG, PNG ni WebP' });
      }
      const item: Cached = {
        body,
        type,
        etag: createHash('sha256').update(body).digest('hex').slice(0, 16),
      };
      this.store(url, item);
      return item;
    } finally {
      this.release();
    }
  }

  private store(url: string, item: Cached): void {
    this.cache.set(url, item);
    this.cacheBytes += item.body.length;
    while (this.cacheBytes > IPTV_GUIDE_ART.cacheBytes && this.cache.size > 1) {
      const [oldest, value] = this.cache.entries().next().value as [string, Cached];
      this.cache.delete(oldest);
      this.cacheBytes -= value.body.length;
    }
  }

  private remember(url: string): void {
    this.negative.set(url, this.deps.clock.now() + IPTV_GUIDE_ART.negativeMs);
    if (this.negative.size > 2000) {
      const oldest = this.negative.keys().next().value;
      if (oldest !== undefined) this.negative.delete(oldest);
    }
  }

  private slot(): Promise<void> {
    if (this.active < IPTV_GUIDE_ART.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
