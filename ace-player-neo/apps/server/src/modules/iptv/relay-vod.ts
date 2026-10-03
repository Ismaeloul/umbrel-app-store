/* Relé VOD (docs/vod.md §9.3, D-VOD10): lo que hay entre el proveedor y lo
   que lee la película (ffmpeg y el lector del índice), con UNA sola
   conexión hacia arriba.

     proveedor ──(net: SSRF, redirecciones, UA)──► VodSession ──► ffmpeg / índice
                                                  http://127.0.0.1:<p>/r/<ticket>/vod.<ext>

   - La petición más nueva gana: una petición nueva de abajo corta la
     respuesta anterior hacia abajo, destruye la conexión de arriba, ESPERA a
     que su socket se cierre (2 s como mucho) y solo entonces abre `Range:
     bytes=<inicio>-[fin]`. Nunca un 409: ffmpeg abre la petición nueva antes
     de cerrar la vieja en cada salto (§9.2, hallazgo 1).
   - Salto corto hacia delante sin reabrir: si el nuevo inicio está como
     mucho 32 MiB por delante de la conexión abierta, se lee y se tira hasta
     ahí (un ciclo de conexión es lo caro con paneles que cuentan el cierre
     30-120 s).
   - Hacia abajo: 206 con `Content-Range`, `Content-Length`, `Accept-Ranges`
     y `application/octet-stream`; `HEAD` con el tamaño si se sabe; varios
     rangos → 416. Si el proveedor responde 200 a un inicio > 0, la sesión
     pasa a `rangeless` y se responde 416 con `vod_unsupported`/`sin_saltos`
     en la cabecera `x-ace-vod-error` (la lee el lector del índice).
   - Caché en memoria (≤ 40 MiB): los primeros 2 MiB y cada rango ACOTADO
     que pide el índice (moov o Cues, ≤ 32 MiB). Una petición abierta que
     empieza dentro de lo guardado se sirve de ahí y el proveedor se abre al
     final de la región solo si sigue leyendo (continuación perezosa): un
     reinicio de ffmpeg cuesta una sola petición al proveedor.
   - Corte a mitad: se reabre (perezosamente, cuando quien lee pide más)
     desde el byte ya recibido; como mucho 3 veces en 60 s, con esperas de
     1, 2 y 4 s. Un corte con quien lee parado más de 30 s (pausa) no cuenta.
     Después se corta hacia abajo (`onDropped`).
   - EOF es el final: nunca se vuelve al byte 0 (al revés que `TsSession`).
   - Ocupado (403, 429, 456, 458, 509) al abrir: esperas de 2, 4 y 8 s solo si
     cerramos nosotros hace menos de 20 s; si no, la plaza es de otro aparato
     y `vod_busy` al momento.
   - `accountGate()` antes de la primera apertura de la sesión, nunca en los
     saltos.
   - Redirecciones: las sigue `open` (net, SSRF en cada salto). En la v1 cada
     apertura pide la URL original; con `reuseRedirect` se guarda la final
     SOLO en memoria y con 401/403/404/410 se vuelve una vez a la original.
     El Paso 0 (3-oct) vio el token del 302 dar 500 a los 15 min: se queda en
     `false` (VOD_PLAY.reuseRedirect).

   Ajustes del Paso 0 (docs/analisis/paso0-2026-10-03, VOD-5):
   - Primer byte: el panel de Isma a veces no contesta (1 de cada 3-5
     aperturas, 20 s sin nada). Plazo de cabeceras corto (`firstByteMs`, 8 s)
     y hasta `firstByteRetries` reintentos antes de dar `vod_timeout`.
   - Reapertura perezosa tras una pausa: una conexión parada 60 s o más ya no
     entrega datos (no la cierra: se queda muerta). Una conexión sin leer en
     `staleUpstreamMs` (30 s) no se reutiliza: se cierra y se abre otra desde
     donde va quien lee, solo cuando pide más. Sin contar como corte.
   - Ritmo limitado: con `setPace(bytes/s del título)`, lo que lee ffmpeg del
     proveedor va como mucho a `paceFactor` veces la tasa de bits (con un
     arranque de `paceBurstS` segundos de vídeo a toda velocidad tras cada
     salto). Junto con la contrapresión del productor (como mucho 60 s por
     delante de lo que se pide), una película nunca se baja entera de golpe.

   Es una clase suelta: los enganches con relay.ts (`route`, `openVod`,
   `connections`) y la URL del proveedor van en VOD-5. La URL del proveedor
   nunca sale de aquí (ni a ffmpeg, ni a los registros). */

import type http from 'node:http';
import type { Readable } from 'node:stream';
import {
  IPTV_BUSY_STATUSES,
  IPTV_SESSION,
  VOD_PLAY,
  VOD_TIMINGS,
  describeError,
  isVodErrorCode,
} from '@ace/shared';
import type { Clock, TimerHandle } from '../../core/clock.js';
import { AppError, errorCodeOf } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { OpenedStream } from '../net/types.js';
import { VOD_ERROR_HEADER, VOD_REASON_HEADER } from '../remux/vod/reader.js';
import { httpStatusOf } from './errors.js';

export interface VodRelayLimits {
  readonly forwardSkipBytes: number;
  readonly headBytes: number;
  readonly cacheMaxBytes: number;
  /** Tope de un rango acotado que se guarda (el moov o los Cues del índice). */
  readonly boundedCacheMaxBytes: number;
  readonly reopenMax: number;
  readonly reopenWindowMs: number;
  readonly reopenBackoffMs: readonly number[];
  /** Un corte con quien lee parado más de esto (pausa) no cuenta para el tope. */
  readonly pauseExemptMs: number;
  readonly socketReleaseMs: number;
  /** Respiro tras el cierre del socket antes de abrir (el proveedor procesa el cierre). */
  readonly settleMs: number;
  readonly busyRetryMs: readonly number[];
  readonly busyRetryWindowMs: number;
  /** Tras servir de la caché, cuánto se espera antes de abrir la continuación (perezosa). */
  readonly continuationDelayMs: number;
  /** Plazo de las cabeceras de cada apertura (Paso 0: el panel a veces no contesta). */
  readonly firstByteMs: number;
  /** Reintentos de una apertura que no contesta a tiempo. */
  readonly firstByteRetries: number;
  /** Una conexión sin leer en este rato se da por muerta (Paso 0: parada 60 s ya no entrega). */
  readonly staleUpstreamMs: number;
  /** Ritmo: como mucho estas veces la tasa de bits del título. */
  readonly paceFactor: number;
  /** Arranque a toda velocidad tras cada salto: estos segundos de vídeo. */
  readonly paceBurstS: number;
  /** Suelo del ritmo (bytes/s), para títulos de tasa muy baja o mal medida. */
  readonly paceMinBytesPerS: number;
}

export const DEFAULT_VOD_RELAY_LIMITS: VodRelayLimits = {
  forwardSkipBytes: VOD_PLAY.forwardSkipBytes,
  headBytes: VOD_PLAY.relayHeadBytes,
  cacheMaxBytes: VOD_PLAY.relayCacheMaxBytes,
  boundedCacheMaxBytes: VOD_PLAY.moovMaxBytes,
  reopenMax: VOD_PLAY.reopenMax,
  reopenWindowMs: VOD_PLAY.reopenWindowMs,
  reopenBackoffMs: VOD_PLAY.reopenBackoffMs,
  pauseExemptMs: 30_000,
  socketReleaseMs: VOD_TIMINGS.socketReleaseMs,
  settleMs: 25,
  busyRetryMs: IPTV_SESSION.busyRetryMs,
  busyRetryWindowMs: IPTV_SESSION.busyRetryWindowMs,
  continuationDelayMs: 100,
  firstByteMs: 8_000,
  firstByteRetries: 2,
  staleUpstreamMs: 30_000,
  paceFactor: 3,
  paceBurstS: 20,
  paceMinBytesPerS: 256 * 1024,
};

/** Lo que pide la sesión a quien sabe abrir el proveedor (en VOD-5, `relay.connect` con Range e identity). */
export interface VodOpenRequest {
  readonly url: string;
  /** Bytes [start, end] (end incluido; null = hasta el final). */
  readonly start: number;
  readonly end: number | null;
  readonly signal: AbortSignal;
  /** Plazo de las cabeceras (el corto del Paso 0). */
  readonly headersMs?: number;
}

export interface VodSessionDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  /** UNA conexión con el proveedor: SSRF en cada salto, redirecciones, `identity` y `Range`. */
  readonly open: (request: VodOpenRequest) => Promise<OpenedStream>;
  /** Comprueba la plaza de la cuenta antes de la primera apertura (lanza `vod_busy`). */
  readonly accountGate?: (signal: AbortSignal) => Promise<void>;
  /** Cuándo cerró la IPTV su última conexión (otra sesión, p. ej. el directo), o null. */
  readonly lastClosedAt?: () => number | null;
  /** Se ha cerrado una conexión nuestra con el proveedor (para la ventana de «ocupado»). */
  readonly onUpstreamClosed?: () => void;
}

export interface VodSessionOptions {
  readonly ticket: string;
  /** La URL del relé que se le da a ffmpeg y al lector. */
  readonly inputUrl: string;
  /** La URL del proveedor (nunca sale de la sesión). */
  readonly url: string;
  readonly reuseRedirect?: boolean;
  readonly limits?: Partial<VodRelayLimits>;
}

export interface VodSessionStats {
  readonly bytes: number;
  readonly lastByteAt: number | null;
  /** Conexiones abiertas con el proveedor desde que empezó la sesión. */
  readonly opens: number;
  readonly reopens: number;
  readonly cacheBytes: number;
  readonly size: number | null;
  readonly rangeless: boolean;
  /** Aperturas que no contestaron a tiempo y se reintentaron. */
  readonly timeouts: number;
  /** Tiempo que el ritmo ha frenado la lectura, en ms. */
  readonly pacedMs: number;
  /** Ritmo en bytes/s (null sin limitar). */
  readonly paceBytesPerS: number | null;
}

// --- Caché de rangos ---

interface Chunk {
  readonly at: number;
  readonly data: Buffer;
}

export interface CacheRegion {
  readonly start: number;
  /** Fin exclusivo de lo que puede guardar. */
  readonly limit: number;
  /** Fin exclusivo de lo guardado (contiguo desde `start`). */
  end: number;
  readonly chunks: Chunk[];
  readonly head: boolean;
  lastUsed: number;
}

/** Bytes del fichero guardados en memoria: la cabecera y los rangos acotados del índice. */
export class RangeCache {
  private readonly head: CacheRegion;
  private readonly regions: CacheRegion[] = [];
  private total = 0;
  private tick = 0;

  constructor(
    private readonly maxBytes: number,
    headBytes: number,
  ) {
    this.head = { start: 0, limit: headBytes, end: 0, chunks: [], head: true, lastUsed: 0 };
  }

  get bytes(): number {
    return this.total;
  }

  /** Lo guardado desde `pos` (un trozo contiguo) hasta `last` como mucho; null si no está. */
  read(pos: number, last: number): Buffer | null {
    for (const region of [this.head, ...this.regions]) {
      if (pos < region.start || pos >= region.end) continue;
      const chunks = region.chunks;
      let low = 0;
      let high = chunks.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if ((chunks[mid] as Chunk).at <= pos) low = mid;
        else high = mid - 1;
      }
      const chunk = chunks[low];
      if (!chunk || chunk.at > pos) continue;
      region.lastUsed = ++this.tick;
      const from = pos - chunk.at;
      const to = Math.min(chunk.data.length, last - chunk.at + 1);
      if (to <= from) return null;
      return chunk.data.subarray(from, to);
    }
    return null;
  }

  /** Lo que pasa por la cabecera del fichero (los primeros `headBytes`). */
  recordHead(at: number, data: Buffer): void {
    this.append(this.head, at, data);
  }

  /** Región para un rango acotado [start, end]; null si ya está guardado o no cabe. */
  openRegion(start: number, end: number, maxBytes: number): CacheRegion | null {
    const size = end - start + 1;
    if (size > maxBytes || size > this.maxBytes) return null;
    /* Lo que va a caer en la cabecera ya lo guarda ella. */
    if (end < this.head.limit && start <= this.head.end) return null;
    for (const region of [this.head, ...this.regions]) {
      if (start >= region.start && end + 1 <= region.end) return null;
    }
    const region: CacheRegion = {
      start,
      limit: end + 1,
      end: start,
      chunks: [],
      head: false,
      lastUsed: ++this.tick,
    };
    this.regions.push(region);
    return region;
  }

  append(region: CacheRegion, at: number, data: Buffer): void {
    if (at > region.end || region.end >= region.limit) return;
    const from = region.end - at;
    if (from >= data.length) return;
    const to = Math.min(data.length, region.limit - at);
    const piece = Buffer.from(data.subarray(from, to));
    region.chunks.push({ at: region.end, data: piece });
    region.end += piece.length;
    this.total += piece.length;
    this.evict(region);
  }

  private evict(keep: CacheRegion): void {
    while (this.total > this.maxBytes) {
      const victims = this.regions.filter((region) => region !== keep);
      if (!victims.length) return;
      const oldest = victims.reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b));
      this.regions.splice(this.regions.indexOf(oldest), 1);
      this.total -= oldest.end - oldest.start;
    }
  }
}

// --- Conexión con el proveedor ---

/** Lo que se adelanta de la conexión con el proveedor en memoria (después se para de leer). */
const UPSTREAM_QUEUE_MAX_BYTES = 512 * 1024;

/**
 * Una conexión abierta, leída a trozos sin destruirla si quien la usa se va
 * (así se puede reutilizar). Adelanta hasta 512 KiB en su propia cola: si el
 * proveedor corta, lo que ya llegó no se pierde (lo que se queda dentro del
 * flujo de Node al pararlo, sí: se tira al destruirse).
 */
class Upstream {
  pos: number;
  finished = false;
  /** Última vez que quien lee sacó un trozo (o se abrió). */
  lastReadAt: number;
  error: unknown = null;
  private readonly queue: Buffer[] = [];
  private queued = 0;
  private wake: (() => void) | null = null;
  private readonly body: Readable;

  constructor(
    readonly opened: OpenedStream,
    readonly start: number,
    /** Fin incluido de lo pedido (null = hasta el final). */
    readonly end: number | null,
    private readonly clock: Clock,
  ) {
    this.pos = start;
    this.lastReadAt = clock.now();
    this.body = opened.body;
    this.body.on('data', (chunk: Buffer | string) => {
      const piece = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      this.queue.push(piece);
      this.queued += piece.length;
      if (this.queued >= UPSTREAM_QUEUE_MAX_BYTES) this.body.pause();
      this.notify();
    });
    this.body.once('end', () => {
      this.finished = true;
      this.notify();
    });
    this.body.once('error', (error) => {
      this.error = error;
      this.finished = true;
      this.notify();
    });
    this.body.once('close', () => {
      this.finished = true;
      this.notify();
    });
    this.body.pause();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** El siguiente trozo (y avanza `pos`), o null si la conexión ha acabado. */
  async next(signal: AbortSignal): Promise<Buffer | null> {
    for (;;) {
      const chunk = this.queue.shift();
      if (chunk) {
        this.pos += chunk.length;
        this.queued -= chunk.length;
        this.lastReadAt = this.clock.now();
        if (!this.finished && this.queued < UPSTREAM_QUEUE_MAX_BYTES / 2) this.body.resume();
        return chunk;
      }
      if (this.finished || signal.aborted) return null;
      await new Promise<void>((resolve) => {
        const done = (): void => {
          signal.removeEventListener('abort', done);
          resolve();
        };
        this.wake = done;
        signal.addEventListener('abort', done, { once: true });
        this.body.resume();
      });
    }
  }

  get alive(): boolean {
    return !this.finished || this.queue.length > 0;
  }

  /** Destruye la conexión y espera a que su socket se cierre (con tope). */
  async destroy(clock: Clock, maxMs: number): Promise<void> {
    this.finished = true;
    this.queue.length = 0;
    this.queued = 0;
    this.body.destroy();
    const released = this.opened.released;
    if (!released) return;
    let timer: TimerHandle | null = null;
    await Promise.race([
      released,
      new Promise<void>((resolve) => {
        timer = clock.setTimeout(resolve, maxMs);
      }),
    ]);
    clock.clearTimeout(timer);
  }
}

// --- Peticiones de abajo ---

interface Leg {
  readonly id: number;
  readonly res: http.ServerResponse;
  readonly start: number;
  /** Fin incluido pedido (null = hasta el final). */
  readonly end: number | null;
  /** ¿Vino con Range? (si no, 200). */
  readonly ranged: boolean;
  readonly controller: AbortController;
  pos: number;
  headersSent: boolean;
  /** Región de la caché que va llenando (rango acotado del índice). */
  region: CacheRegion | null;
  /** Desde cuándo está parado quien lee (esperando 'drain'), o null. */
  stalledSince: number | null;
  /** Lo que duró la última parada. */
  lastStallMs: number;
  /** Espera antes de la próxima reapertura (tras un corte). */
  backoffMs: number;
}

function parseRange(
  header: string | undefined,
): { start: number; end: number | null } | 'bad' | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return 'bad';
  const start = Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    (end !== null && (!Number.isSafeInteger(end) || end < start))
  ) {
    return 'bad';
  }
  return { start, end };
}

/** Escribe hacia abajo respetando la contrapresión; false si quien lee se ha ido. */
function write(leg: Leg, clock: Clock, data: Buffer): Promise<boolean> {
  const res = leg.res;
  if (res.destroyed || leg.controller.signal.aborted) return Promise.resolve(false);
  if (res.write(data)) return Promise.resolve(true);
  leg.stalledSince = clock.now();
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      leg.controller.signal.removeEventListener('abort', onClose);
      if (leg.stalledSince !== null) leg.lastStallMs = clock.now() - leg.stalledSince;
      leg.stalledSince = null;
      resolve(ok && !res.destroyed);
    };
    const onDrain = (): void => done(true);
    const onClose = (): void => done(false);
    res.on('drain', onDrain);
    res.on('close', onClose);
    leg.controller.signal.addEventListener('abort', onClose, { once: true });
  });
}

/** Un fallo de abrir el proveedor como `vod_*`. */
export function toVodError(error: unknown): AppError {
  const code = errorCodeOf(error);
  if (error instanceof AppError && code && isVodErrorCode(code)) return error;
  const status = httpStatusOf(error);
  if (status !== null) {
    if (IPTV_BUSY_STATUSES.includes(status))
      return new AppError('vod_busy', { cause: error, detail: `http ${status}` });
    if (status === 401) return new AppError('vod_account', { cause: error });
    if (status === 404 || status === 410) return new AppError('vod_not_found', { cause: error });
    return new AppError('vod_dropped', { cause: error, detail: `http ${status}` });
  }
  if (code === 'fetch_timeout') return new AppError('vod_timeout', { cause: error });
  return new AppError('vod_dropped', { cause: error, detail: code ?? 'red' });
}

export class VodSession {
  readonly ticket: string;
  readonly inputUrl: string;
  closed = false;
  rangeless = false;
  /** Tamaño del fichero (lo dice el `Content-Range` de la primera respuesta). */
  size: number | null = null;
  private readonly limits: VodRelayLimits;
  private readonly cache: RangeCache;
  private readonly dropped: ((code: string) => void)[] = [];
  private upstream: Upstream | null = null;
  private opening = false;
  private leg: Leg | null = null;
  private legs = 0;
  /** Las peticiones se atienden de una en una (la más nueva corta a la anterior). */
  private chain: Promise<void> = Promise.resolve();
  private gated = false;
  private reuse: string | null = null;
  private lastCloseAt: number | null = null;
  private reopenTimes: number[] = [];
  private opens = 0;
  private reopens = 0;
  private bytes = 0;
  private lastByteAt: number | null = null;
  private timeouts = 0;
  private readonly closedListeners: (() => void)[] = [];
  /** Ritmo (bytes/s y cubo) o null sin limitar. */
  private pace: { readonly rate: number; readonly burst: number } | null = null;
  private tokens = 0;
  private tokensAt = 0;
  private pacedMs = 0;

  constructor(
    private readonly deps: VodSessionDeps,
    private readonly options: VodSessionOptions,
  ) {
    this.ticket = options.ticket;
    this.inputUrl = options.inputUrl;
    this.limits = { ...DEFAULT_VOD_RELAY_LIMITS, ...options.limits };
    this.cache = new RangeCache(this.limits.cacheMaxBytes, this.limits.headBytes);
  }

  /** Conexiones abiertas ahora con el proveedor (0 o 1; abriendo también cuenta). */
  connections(): number {
    return this.opening || (this.upstream !== null && !this.upstream.finished) ? 1 : 0;
  }

  stats(): VodSessionStats {
    return {
      bytes: this.bytes,
      lastByteAt: this.lastByteAt,
      opens: this.opens,
      reopens: this.reopens,
      cacheBytes: this.cache.bytes,
      size: this.size,
      rangeless: this.rangeless,
      timeouts: this.timeouts,
      pacedMs: this.pacedMs,
      paceBytesPerS: this.pace?.rate ?? null,
    };
  }

  /**
   * Ritmo de lectura (Paso 0): `bytesPerS` es la tasa media del título
   * (tamaño / duración). ffmpeg lee como mucho `paceFactor` veces eso, con
   * un arranque de `paceBurstS` segundos de vídeo tras cada salto. null quita
   * el límite.
   */
  setPace(bytesPerS: number | null): void {
    if (bytesPerS === null || !(bytesPerS > 0) || !Number.isFinite(bytesPerS)) {
      this.pace = null;
      return;
    }
    const rate = Math.max(this.limits.paceMinBytesPerS, bytesPerS * this.limits.paceFactor);
    this.pace = { rate, burst: Math.max(512 * 1024, bytesPerS * this.limits.paceBurstS) };
    this.tokens = this.pace.burst;
    this.tokensAt = this.deps.clock.now();
  }

  /**
   * Suelta la conexión con el proveedor sin cerrar la sesión (pausa larga
   * del productor): la plaza queda libre y la siguiente lectura reabre.
   */
  async release(): Promise<void> {
    if (this.closed) return;
    if (this.leg) this.abandon(this.leg);
    await this.dropUpstream();
  }

  /** Avisa cuando la sesión se cierra (el relé la olvida). */
  onClosed(listener: () => void): void {
    this.closedListeners.push(listener);
  }

  /** El proveedor ha cortado más veces de las que se aguantan (`vod_dropped`). */
  onDropped(listener: (code: string) => void): void {
    this.dropped.push(listener);
  }

  /** Una petición de abajo (ffmpeg o el lector del índice) a `vod.<ext>`. */
  handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.on('error', () => undefined);
    if (this.closed) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const header = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const range = parseRange(header);
    if (range === 'bad') {
      res
        .writeHead(416, this.size === null ? {} : { 'content-range': `bytes */${this.size}` })
        .end();
      return;
    }
    const start = range?.start ?? 0;
    if (this.rangeless && start > 0) {
      this.sendError(res, new AppError('vod_unsupported', { data: { reason: 'sin_saltos' } }), 416);
      return;
    }
    if (this.size !== null && start >= this.size) {
      res.writeHead(416, { 'content-range': `bytes */${this.size}` }).end();
      return;
    }
    if (req.method === 'HEAD') {
      res
        .writeHead(200, {
          'accept-ranges': 'bytes',
          'content-type': 'application/octet-stream',
          ...(this.size === null ? {} : { 'content-length': String(this.size) }),
        })
        .end();
      return;
    }
    const leg: Leg = {
      id: ++this.legs,
      res,
      start,
      end: range?.end ?? null,
      ranged: range !== null,
      controller: new AbortController(),
      pos: start,
      headersSent: false,
      region: null,
      stalledSince: null,
      lastStallMs: 0,
      backoffMs: 0,
    };
    /* La más nueva gana: la anterior se corta ya, sin esperar a la fila. */
    const previous = this.leg;
    this.leg = leg;
    if (previous) this.abandon(previous);
    /* Un salto (o el arranque) de ffmpeg: el cubo del ritmo se llena otra vez. */
    if (this.pace && leg.end === null && (!previous || previous.pos !== start)) {
      this.tokens = this.pace.burst;
      this.tokensAt = this.deps.clock.now();
    }
    res.once('close', () => leg.controller.abort());
    this.chain = this.chain.then(() => this.serve(leg)).catch(() => undefined);
  }

  /** Corta todo con el proveedor y espera a que se suelte el socket. Idempotente. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.leg) this.abandon(this.leg);
    await this.dropUpstream();
    await this.chain;
    for (const listener of this.closedListeners.splice(0)) {
      try {
        listener();
      } catch {}
    }
  }

  // --- Atender una petición ---

  private abandon(leg: Leg): void {
    leg.controller.abort();
    leg.res.destroy();
  }

  private gone(leg: Leg): boolean {
    return this.closed || this.leg !== leg || leg.controller.signal.aborted || leg.res.destroyed;
  }

  /** Último byte que se le da a esta petición (o Infinity si aún no se sabe). */
  private lastByte(leg: Leg): number {
    const end = leg.end ?? Infinity;
    return this.size === null ? end : Math.min(end, this.size - 1);
  }

  private async serve(leg: Leg): Promise<void> {
    if (this.gone(leg)) return;
    try {
      await this.pump(leg);
    } catch (error) {
      if (this.gone(leg)) return;
      const vod = toVodError(error);
      if (vod.code === 'vod_dropped') this.emitDropped(vod.code);
      /* «Sin saltos» va con 416 (docs/vod.md §9.3); lo demás, con el HTTP del catálogo. */
      if (!leg.headersSent) {
        this.sendError(leg.res, vod, vod.code === 'vod_unsupported' ? 416 : undefined);
      } else leg.res.destroy();
    }
  }

  private async pump(leg: Leg): Promise<void> {
    for (;;) {
      if (this.gone(leg)) return;
      const last = this.lastByte(leg);
      if (leg.pos > last) {
        this.sendHeaders(leg);
        leg.res.end();
        return;
      }
      /* 1. Lo guardado (cabecera o rango del índice). */
      if (this.size !== null) {
        const cached = this.cache.read(leg.pos, last);
        if (cached) {
          this.sendHeaders(leg);
          if (!(await write(leg, this.deps.clock, cached))) return;
          leg.pos += cached.length;
          /* Un respiro entre trozos: si ffmpeg ya salta a otro sitio, su petición
             nueva corta esta antes de llegar al final de lo guardado. */
          await new Promise((resolve) => setImmediate(resolve));
          if (leg.pos <= last && !this.cache.read(leg.pos, last)) {
            await this.deps.clock
              .sleep(this.limits.continuationDelayMs, leg.controller.signal)
              .catch(() => undefined);
          }
          continue;
        }
      }
      /* 2. El proveedor. */
      const up = await this.upstreamFor(leg);
      if (!up || this.gone(leg)) return;
      this.sendHeaders(leg);
      const chunk = await up.next(leg.controller.signal);
      if (this.gone(leg)) return;
      if (chunk === null) {
        await this.upstreamEnded(leg, up);
        continue;
      }
      const chunkStart = up.pos - chunk.length;
      this.bytes += chunk.length;
      this.lastByteAt = this.deps.clock.now();
      if (chunkStart < this.limits.headBytes) this.cache.recordHead(chunkStart, chunk);
      if (leg.region) this.cache.append(leg.region, chunkStart, chunk);
      const from = Math.max(0, leg.pos - chunkStart);
      const to = Math.min(chunk.length, this.lastByte(leg) - chunkStart + 1);
      if (to > from) {
        if (!(await write(leg, this.deps.clock, chunk.subarray(from, to)))) return;
        leg.pos = chunkStart + to;
        /* Ritmo: solo lo que lee ffmpeg (abierto); el índice va sin freno. */
        if (leg.end === null) await this.throttle(leg, to - from);
      }
    }
  }

  /** La conexión de arriba ha acabado: EOF, fin de lo pedido o un corte (y entonces, la cuenta). */
  private async upstreamEnded(leg: Leg, up: Upstream): Promise<void> {
    if (this.upstream === up) this.upstream = null;
    this.noteClosed();
    /* Sin tamaño conocido, un final limpio es el final del fichero. */
    const eof = this.size !== null ? up.pos >= this.size : up.error === null && up.end === null;
    const boundedDone = up.end !== null && up.pos > up.end;
    /* Un corte a mitad. Con quien lee parado (pausa) no cuenta. (El plazo de
       inactividad de `net` no salta por la contrapresión: `guardBody` lo
       desarma mientras no se lee; si salta es que el proveedor se calló, y eso
       sí cuenta.) */
    const now = this.deps.clock.now();
    const paused =
      leg.lastStallMs > this.limits.pauseExemptMs ||
      (leg.stalledSince !== null && now - leg.stalledSince > this.limits.pauseExemptMs);
    if (eof || boundedDone || leg.pos > this.lastByte(leg)) return;
    leg.lastStallMs = 0;
    if (paused) {
      leg.backoffMs = 0;
      return;
    }
    this.reopenTimes = this.reopenTimes.filter((at) => now - at < this.limits.reopenWindowMs);
    if (this.reopenTimes.length >= this.limits.reopenMax) {
      throw new AppError('vod_dropped', { detail: 'el proveedor corta una y otra vez' });
    }
    leg.backoffMs = this.limits.reopenBackoffMs[this.reopenTimes.length] ?? 4_000;
    this.reopenTimes.push(now);
    this.reopens += 1;
    this.deps.logger.debug(
      { ticket: '•••', pos: leg.pos, backoffMs: leg.backoffMs },
      'relé VOD: el proveedor cortó, se reabre desde lo recibido',
    );
  }

  /** La conexión para seguir esta petición: la abierta si vale (o con un salto corto), o una nueva. */
  private async upstreamFor(leg: Leg): Promise<Upstream | null> {
    const up = this.upstream;
    if (up) {
      /* La que leía esta petición acaba de terminar (el corte llegó mientras se
         escribía): que lo decida `upstreamEnded` (corte que cuenta, EOF…), no
         cambiarla sin más. */
      if (!up.alive && leg.pos === up.pos) return up;
      const last = this.lastByte(leg);
      /* Paso 0: una conexión parada mucho rato ya no entrega (se queda muerta
         sin cerrarse): se cambia por otra en vez de esperar al plazo de net. */
      const fresh = this.deps.clock.now() - up.lastReadAt < this.limits.staleUpstreamMs;
      const reusable =
        fresh &&
        up.alive &&
        leg.pos >= up.pos &&
        leg.pos - up.pos <= this.limits.forwardSkipBytes &&
        (up.end === null || (last !== Infinity && last <= up.end));
      if (reusable) return up;
      await this.dropUpstream();
    }
    if (this.gone(leg)) return null;
    if (leg.backoffMs > 0) {
      const wait = leg.backoffMs;
      leg.backoffMs = 0;
      await this.deps.clock.sleep(wait, leg.controller.signal).catch(() => undefined);
      if (this.gone(leg)) return null;
    }
    const end = leg.end;
    if (end !== null && leg.pos === leg.start) {
      leg.region = this.cache.openRegion(leg.start, end, this.limits.boundedCacheMaxBytes);
    }
    this.opening = true;
    /* La conexión vive por su cuenta (para poder reutilizarla en un salto
       corto): la petición solo la puede cancelar mientras se está abriendo. */
    const connection = new AbortController();
    const cancel = (): void => connection.abort(leg.controller.signal.reason);
    leg.controller.signal.addEventListener('abort', cancel, { once: true });
    let opened: OpenedStream;
    try {
      opened = await this.openUpstream(leg.pos, end, connection.signal);
    } catch (error) {
      /* Una apertura cortada a medias (llegó otra petición): un respiro para que
         su socket se suelte antes de que la siguiente abra. */
      if (leg.controller.signal.aborted) {
        await this.deps.clock.sleep(this.limits.settleMs * 4).catch(() => undefined);
      }
      throw error;
    } finally {
      this.opening = false;
      leg.controller.signal.removeEventListener('abort', cancel);
    }
    const created = new Upstream(opened, leg.pos, end, this.deps.clock);
    if (this.gone(leg)) {
      await created.destroy(this.deps.clock, this.limits.socketReleaseMs);
      this.noteClosed();
      return null;
    }
    this.upstream = created;
    return created;
  }

  /** Abre el proveedor en [start, end]: plaza de la cuenta, ocupado, rangeless y tamaño. */
  private async openUpstream(
    start: number,
    end: number | null,
    signal: AbortSignal,
  ): Promise<OpenedStream> {
    if (!this.gated) {
      this.gated = true;
      await this.deps.accountGate?.(signal);
    }
    let url = this.reuse ?? this.options.url;
    let resolvedAgain = false;
    let busyTry = 0;
    let timeoutTry = 0;
    for (;;) {
      let opened: OpenedStream;
      try {
        this.opens += 1;
        opened = await this.deps.open({
          url,
          start,
          end,
          signal,
          headersMs: this.limits.firstByteMs,
        });
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        /* Paso 0: el panel a veces no contesta; otra vez enseguida suele ir. */
        if (errorCodeOf(error) === 'fetch_timeout' && timeoutTry < this.limits.firstByteRetries) {
          timeoutTry += 1;
          this.timeouts += 1;
          this.noteClosed();
          this.deps.logger.debug(
            { ticket: '•••', attempt: timeoutTry },
            'relé VOD: el proveedor no contesta, se reintenta',
          );
          continue;
        }
        const status = httpStatusOf(error);
        if (
          status !== null &&
          IPTV_BUSY_STATUSES.includes(status) &&
          busyTry < this.limits.busyRetryMs.length &&
          this.closedRecently()
        ) {
          await this.deps.clock.sleep(this.limits.busyRetryMs[busyTry] as number, signal);
          busyTry += 1;
          continue;
        }
        if (
          this.reuse &&
          !resolvedAgain &&
          status !== null &&
          [401, 403, 404, 410].includes(status)
        ) {
          resolvedAgain = true;
          this.reuse = null;
          url = this.options.url;
          continue;
        }
        throw toVodError(error);
      }
      this.checkResponse(opened, start);
      if (this.options.reuseRedirect ?? VOD_PLAY.reuseRedirect) this.reuse = opened.finalUrl;
      return opened;
    }
  }

  /** 206 con su Content-Range (de ahí, el tamaño); 200 solo vale desde el byte 0. */
  private checkResponse(opened: OpenedStream, start: number): void {
    const header = (name: string): string | undefined => {
      const value = opened.headers[name];
      return typeof value === 'string' ? value : value?.[0];
    };
    if (opened.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header('content-range') ?? '');
      if (!match || Number(match[1]) !== start) {
        opened.body.destroy();
        throw new AppError('vod_dropped', { detail: 'Content-Range del proveedor no casa' });
      }
      if (match[3] !== '*') this.size = Number(match[3]);
      return;
    }
    if (start > 0) {
      /* 200 a una petición con inicio > 0: el proveedor no deja saltar. */
      opened.body.destroy();
      this.rangeless = true;
      throw new AppError('vod_unsupported', {
        detail: 'el proveedor no admite Range',
        data: { reason: 'sin_saltos' },
      });
    }
    const length = Number(header('content-length'));
    if (Number.isSafeInteger(length) && length > 0) this.size = length;
  }

  private closedRecently(): boolean {
    const now = this.deps.clock.now();
    const ours = this.lastCloseAt;
    const theirs = this.deps.lastClosedAt?.() ?? null;
    const last = Math.max(ours ?? -Infinity, theirs ?? -Infinity);
    return now - last < this.limits.busyRetryWindowMs;
  }

  private noteClosed(): void {
    this.lastCloseAt = this.deps.clock.now();
    try {
      this.deps.onUpstreamClosed?.();
    } catch {}
  }

  /** Destruye la conexión de arriba, espera a que se suelte su socket y un respiro. */
  private async dropUpstream(): Promise<void> {
    const up = this.upstream;
    this.upstream = null;
    if (!up) return;
    await up.destroy(this.deps.clock, this.limits.socketReleaseMs);
    this.noteClosed();
    if (this.limits.settleMs > 0) await this.deps.clock.sleep(this.limits.settleMs);
  }

  // --- Respuestas ---

  /**
   * 206 con su `Content-Range` (o 200 sin Range). Sin saber dónde acaba (un
   * proveedor que no dice el tamaño, raro), 200 sin longitud: no hay un
   * `Content-Range` válido que dar.
   */
  private sendHeaders(leg: Leg): void {
    if (leg.headersSent || leg.res.headersSent) {
      leg.headersSent = true;
      return;
    }
    leg.headersSent = true;
    const last = this.lastByte(leg);
    const headers: http.OutgoingHttpHeaders = {
      'accept-ranges': 'bytes',
      'content-type': 'application/octet-stream',
    };
    if (last === Infinity) {
      leg.res.writeHead(200, headers);
      return;
    }
    headers['content-length'] = String(last - leg.start + 1);
    if (leg.ranged) headers['content-range'] = `bytes ${leg.start}-${last}/${this.size ?? '*'}`;
    leg.res.writeHead(leg.ranged ? 206 : 200, headers);
  }

  private sendError(res: http.ServerResponse, error: AppError, status?: number): void {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    const reason = (error.data as { reason?: unknown } | undefined)?.reason;
    res
      .writeHead(status ?? describeError(error.code)?.status ?? 502, {
        [VOD_ERROR_HEADER]: error.code,
        ...(typeof reason === 'string' ? { [VOD_REASON_HEADER]: reason } : {}),
      })
      .end();
  }

  /** Frena la lectura si va por encima del ritmo (cubo de fichas). */
  private async throttle(leg: Leg, bytes: number): Promise<void> {
    const pace = this.pace;
    if (!pace) return;
    const now = this.deps.clock.now();
    this.tokens = Math.min(pace.burst, this.tokens + ((now - this.tokensAt) * pace.rate) / 1000);
    this.tokensAt = now;
    this.tokens -= bytes;
    if (this.tokens >= 0) return;
    const waitMs = Math.min(5_000, Math.ceil((-this.tokens / pace.rate) * 1000));
    this.pacedMs += waitMs;
    await this.deps.clock.sleep(waitMs, leg.controller.signal).catch(() => undefined);
  }

  private emitDropped(code: string): void {
    this.deps.logger.warn(
      { ticket: '•••', errorCode: code },
      'relé VOD: el proveedor ha cortado el vídeo',
    );
    for (const listener of [...this.dropped]) {
      try {
        listener(code);
      } catch {}
    }
  }
}
