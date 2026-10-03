/* Carteles, fondos y fotogramas por un proxy propio (docs/vod.md §8, D-VOD8).

   La CSP (`img-src 'self' data:`) no deja enlazar al proveedor, y enlazarlo
   filtraría la URL. `vodArt` recibe SOLO ids (nunca URLs, no es un proxy
   abierto); la URL sale de la tabla (cartel) o de la ficha (fondo y
   fotograma) y nunca sale del módulo.

   - Descarga por `net.fetchBuffer` con la política IPTV (filtro en cada
     salto, `pinnedLookup`, 5 redirecciones y el puerto del relé bloqueado).
     REGLA EXTRA: la red de casa nunca vale para imágenes salvo el host
     EXACTO del proveedor configurado (un JSON malicioso podría apuntar un
     cartel al router). Eso lo decide `policyFor` (vod-service.ts).
   - 1 MiB (2 MiB los fondos) y 8 s por imagen; 4 a la vez y 64 en cola; con
     la cola llena, 503 con `Retry-After`.
   - Solo JPEG, PNG y WebP, por BYTES MÁGICOS; se sirven con el tipo que dicen
     los bytes, `nosniff` y `Content-Security-Policy: default-src 'none'`.
   - TMDB al tamaño justo (un cambio de texto, sin librería de imágenes):
     `w342` carteles, `w780` fondos y `w300` fotogramas.
   - `v = HMAC(k_vod, url)[0..8]`: con la `v` correcta, caché inmutable de un
     año; sin ella o con otra, `no-cache`. `ETag` = sha256(bytes)[0..16], 304.
   - Caché en disco `v2/iptv/arte/<ab>/<HMAC(k_vod, url) 32 hex>` (0600 en
     carpetas 0700): el nombre no revela la URL. 256 MiB y 5 000 ficheros
     como mucho, LRU por `mtime` (se toca al servir), barrido cada 10 min y al
     arrancar. Un 404 o un error del origen se recuerda 1 h (5 000 entradas). */

import { createHash, createHmac } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
  chmod,
} from 'node:fs/promises';
import path from 'node:path';
import { IPTV_USER_AGENT, VOD_ART, type VodArtKind } from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import type { Logger } from '../../../core/logger.js';
import type { IptvKeys } from '../../../config/keys.js';
import type { IptvFetchPolicy, NetClient } from '../../net/types.js';
import { DIR_MODE, FILE_MODE } from '../crypto.js';

export const ART_SWEEP_MS = 10 * 60_000;
/** Un `.tmp` más joven que esto es una descarga en marcha (8 s como mucho): el barrido no lo toca. */
export const ART_TMP_MAX_AGE_MS = 5 * 60_000;
const NEGATIVE_MAX = 5_000;
const CACHE_IMMUTABLE = 'private, max-age=31536000, immutable';
const CACHE_PLAIN = 'private, no-cache';
const TMDB_SIZE: Readonly<Record<VodArtKind, string>> = {
  poster: 'w342',
  backdrop: 'w780',
  still: 'w300',
};

export type ArtImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Tipo de imagen por los bytes mágicos; null si no es JPEG, PNG ni WebP (SVG, HTML… fuera). */
export function imageTypeOf(bytes: Buffer): ArtImageType | null {
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

/** La URL de TMDB al tamaño justo (`/t/p/<tamaño>/…`); el resto, igual. */
export function tmdbSized(url: string, kind: VodArtKind): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== 'image.tmdb.org') return url;
  const match = /^\/t\/p\/[a-z0-9_]{1,40}\/(.+)$/i.exec(parsed.pathname);
  if (!match) return url;
  parsed.pathname = `/t/p/${TMDB_SIZE[kind]}/${match[1]}`;
  return parsed.toString();
}

/** ¿`If-None-Match` casa con el ETag (también `W/`, comillas y listas)? */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
    .includes(etag);
}

export type ArtReply =
  | { readonly status: 200; readonly headers: Record<string, string>; readonly body: Buffer }
  | { readonly status: 304; readonly headers: Record<string, string> };

export interface VodArtDeps {
  readonly net: NetClient;
  readonly clock: Clock;
  readonly logger: Logger;
  /** `v2/iptv/arte`. */
  readonly dir: string;
  readonly keys: () => Pick<IptvKeys, 'vod'>;
  /** Filtro de la IPTV para una imagen: SIN red de casa salvo el host exacto del proveedor. */
  readonly policyFor: (url: URL) => IptvFetchPolicy;
}

interface Waiter {
  resolve(): void;
}

export class VodArtCache {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private readonly running = new Map<string, Promise<Buffer>>();
  private readonly negative = new Map<string, number>();
  private timer: TimerHandle | null = null;
  private sweeping: Promise<void> | null = null;
  /** Bytes escritos desde el último barrido (para barrer antes si se pasa). */
  private writtenSinceSweep = 0;
  /** Descargas hechas al origen (para los tests). */
  fetches = 0;

  constructor(private readonly deps: VodArtDeps) {}

  /** `v` de una URL: HMAC(k_vod, url)[0..8]. */
  stamp(url: string): string {
    return this.hmac(url).slice(0, 8);
  }

  private hmac(url: string): string {
    return createHmac('sha256', this.deps.keys().vod).update(url).digest('hex').slice(0, 32);
  }

  /** Ruta del fichero de caché de una URL (el nombre no revela la URL). */
  fileOf(url: string): string {
    const name = this.hmac(url);
    return path.join(this.deps.dir, name.slice(0, 2), name);
  }

  start(): void {
    void this.sweep();
    this.timer = this.deps.clock.setInterval(() => void this.sweep(), ART_SWEEP_MS, {
      unref: true,
    });
  }

  stop(): void {
    if (this.timer) this.deps.clock.clearInterval(this.timer);
    this.timer = null;
    for (const waiter of this.queue.splice(0)) waiter.resolve();
  }

  /** Olvida la caché negativa (otro proveedor). La carpeta la borra `IptvFiles.removeAll`. */
  reset(): void {
    this.negative.clear();
  }

  /**
   * Sirve una imagen. `url` es la del proveedor (de la tabla o la ficha);
   * `version`, la `v` que mandó el cliente. Lanza `vod_not_found` si no hay
   * imagen (o el origen falló hace menos de 1 h) y `vod_unavailable` con la
   * cola llena (la ruta pone `Retry-After`).
   */
  async serve(
    url: string,
    kind: VodArtKind,
    version: string | undefined,
    ifNoneMatch: string | undefined,
  ): Promise<ArtReply> {
    const file = this.fileOf(url);
    const cached: Buffer | null = await readFile(file).catch(() => null);
    let bytes: Buffer;
    let type = cached ? imageTypeOf(cached) : null;
    if (cached && type) {
      bytes = cached;
      const now = new Date(this.deps.clock.now());
      await utimes(file, now, now).catch(() => undefined);
    } else {
      bytes = await this.download(url, kind, file);
      type = imageTypeOf(bytes);
      if (!type) throw new AppError('vod_not_found', { detail: 'cartel no raster' });
    }
    const etag = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const headers: Record<string, string> = {
      etag: `"${etag}"`,
      'cache-control': version && version === this.stamp(url) ? CACHE_IMMUTABLE : CACHE_PLAIN,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    };
    if (etagMatches(ifNoneMatch, etag)) return { status: 304, headers };
    return { status: 200, headers: { ...headers, 'content-type': type }, body: bytes };
  }

  private negativeHit(key: string): boolean {
    const until = this.negative.get(key);
    if (until === undefined) return false;
    if (until > this.deps.clock.now()) return true;
    this.negative.delete(key);
    return false;
  }

  private remember(key: string): void {
    this.negative.delete(key);
    this.negative.set(key, this.deps.clock.now() + VOD_ART.negativeMs);
    while (this.negative.size > NEGATIVE_MAX) {
      const oldest = this.negative.keys().next().value;
      if (oldest === undefined) break;
      this.negative.delete(oldest);
    }
  }

  private async slot(): Promise<void> {
    if (this.active < VOD_ART.concurrent) {
      this.active += 1;
      return;
    }
    if (this.queue.length >= VOD_ART.queue) {
      throw new AppError('vod_unavailable', { detail: 'carteles: cola llena' });
    }
    await new Promise<void>((resolve) => this.queue.push({ resolve }));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.queue.shift()?.resolve();
  }

  private download(url: string, kind: VodArtKind, file: string): Promise<Buffer> {
    const key = path.basename(file);
    if (this.negativeHit(key)) {
      return Promise.reject(new AppError('vod_not_found', { detail: 'cartel: origen fallido' }));
    }
    const running = this.running.get(key);
    if (running) return running;
    const promise = (async () => {
      await this.slot();
      try {
        const target = tmdbSized(url, kind);
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          throw new AppError('vod_not_found', { detail: 'cartel: URL' });
        }
        this.fetches += 1;
        let body: Buffer;
        try {
          const response = await this.deps.net.fetchBuffer(target, {
            maxBytes: kind === 'backdrop' ? VOD_ART.backdropMaxBytes : VOD_ART.posterMaxBytes,
            totalTimeoutMs: VOD_ART.fetchMs,
            idleTimeoutMs: VOD_ART.fetchMs,
            accept: 'image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
            headers: { 'User-Agent': IPTV_USER_AGENT },
            iptv: this.deps.policyFor(parsed),
          });
          body = response.body;
        } catch {
          this.remember(key);
          throw new AppError('vod_not_found', { detail: 'cartel: el origen ha fallado' });
        }
        if (!imageTypeOf(body)) {
          this.remember(key);
          throw new AppError('vod_not_found', { detail: 'cartel no raster' });
        }
        await this.write(file, body).catch((error: unknown) => {
          this.deps.logger.warn({ err: error }, 'VOD: no se pudo guardar un cartel en disco');
        });
        return body;
      } finally {
        this.release();
      }
    })();
    this.running.set(key, promise);
    void promise.then(
      () => this.running.delete(key),
      () => this.running.delete(key),
    );
    return promise;
  }

  private async write(file: string, body: Buffer): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true, mode: DIR_MODE });
    await chmod(this.deps.dir, DIR_MODE).catch(() => undefined);
    const sub = path.dirname(file);
    await mkdir(sub, { recursive: true, mode: DIR_MODE });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, body, { mode: FILE_MODE });
    await chmod(tmp, FILE_MODE).catch(() => undefined);
    await rename(tmp, file);
    this.writtenSinceSweep += body.length;
    if (this.writtenSinceSweep > VOD_ART.cacheBytes / 8) void this.sweep();
  }

  /** Barrido LRU por `mtime`: ≤ 256 MiB y ≤ 5 000 ficheros; borra también restos `.tmp`. */
  sweep(): Promise<void> {
    this.sweeping ??= this.doSweep().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async doSweep(): Promise<void> {
    this.writtenSinceSweep = 0;
    const files: Array<{ file: string; size: number; mtime: number }> = [];
    let subdirs: string[];
    try {
      subdirs = await readdir(this.deps.dir);
    } catch {
      return;
    }
    for (const sub of subdirs) {
      if (!/^[a-f0-9]{2}$/.test(sub)) continue;
      const dir = path.join(this.deps.dir, sub);
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names) {
        const file = path.join(dir, name);
        if (!/^[a-f0-9]{32}$/.test(name)) {
          /* El `.tmp` de una descarga EN MARCHA no se toca (fallo 10): solo
             los restos viejos. Su `mtime` lo pone el disco, así que se
             compara con la hora de verdad y no con el reloj del servicio. */
          if (/^[a-f0-9]{32}\.tmp$/.test(name)) {
            const info = await stat(file).catch(() => null);
            if (info && Date.now() - info.mtimeMs < ART_TMP_MAX_AGE_MS) continue;
          }
          await rm(file, { force: true }).catch(() => undefined);
          continue;
        }
        const info = await stat(file).catch(() => null);
        if (info?.isFile()) files.push({ file, size: info.size, mtime: info.mtimeMs });
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    let bytes = 0;
    for (const [index, item] of files.entries()) {
      bytes += item.size;
      if (index >= VOD_ART.cacheFiles || bytes > VOD_ART.cacheBytes) {
        await rm(item.file, { force: true }).catch(() => undefined);
      }
    }
  }
}
