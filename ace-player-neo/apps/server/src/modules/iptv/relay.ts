/* Relé local de la IPTV (docs/iptv.md §6.1).

     proveedor ──(net: SSRF, IP fijada, UA)──► relé 127.0.0.1:<p>/r/<ticket>/… ──► ffmpeg

   - Un `http.createServer` propio, SOLO en `127.0.0.1` y en un puerto
     efímero: no es una ruta de Fastify, así que no se llega desde nginx ni
     desde otro contenedor.
   - Cada sesión tiene un ticket aleatorio de 128 bits que solo vale mientras
     vive (y se tapa en los registros).
   - UNA sola conexión al proveedor por ticket: una segunda petición a
     `in.ts` mientras la primera sigue abierta recibe 409 y nunca abre otra; en
     HLS la lista y los segmentos se piden de uno en uno.
   - El relé nunca devuelve un 3xx: sigue las redirecciones él mismo con `net`
     (filtro SSRF en cada salto). Ninguna URL del proveedor sale del relé.
   - Ciclo de vida atado al de ffmpeg: si se cierra el socket de ffmpeg, se
     aborta la conexión con el proveedor (salvo en un reinicio pedido por el
     relé). Cada apertura y reconexión empieza en la URL ORIGINAL.

   Origen TS: la conexión se abre ya en `open()` (así los 401/403/404/ocupado
   llegan como `iptv_*` a quien pide el canal) y se entrega a ffmpeg al pedir
   `in.ts`. Si el origen se corta o no manda bytes en 10 s: se cierra el
   socket viejo, esperas de 1, 2 y 4 s (8 s para las cabeceras) y 3 intentos
   en 60 s como mucho, sin cerrar la conexión con ffmpeg. Tras reconectar se
   mira el PCR: si salta más de 5 s respecto a lo esperado, se pide reiniciar
   el remux (`onRestart`). Agotado: otra variante una vez (con reinicio) y, si
   no, `onDropped`.

   Origen HLS: la lista maestra se aplana a una variante con audio muxeado
   (hls.ts); la de medios se reescribe por lista blanca con URIs del relé y se
   pide como mucho una vez por segundo; los segmentos se descargan por `net`
   al pedirlos. Tres fallos seguidos de la lista, o 15 s sin lista nueva,
   cuentan como corte. */

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { IPTV_BUSY_STATUSES, IPTV_RELAY, type IptvReason } from '@ace/shared';
import type { Clock, TimerHandle } from '../../core/clock.js';
import { AppError, errorCodeOf } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { SerialLock } from '../remux/lock.js';
import type { IptvFetchPolicy, NetClient, OpenedStream } from '../net/types.js';
import { httpStatusOf, toIptvError } from './errors.js';
import {
  EXT_CONTENT_TYPE,
  PcrTracker,
  extFromPath,
  isMasterPlaylist,
  isPlaylist,
  masterVariants,
  pickMasterVariant,
  rewriteMediaPlaylist,
  sniffSegment,
  type RewrittenPlaylist,
  type SegmentExt,
} from './hls.js';

/** Una variante del canal (la mejor primero). La URL nunca sale del relé. */
export interface RelayVariant {
  readonly entryId: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RelayDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly net: NetClient;
  /** Filtro de la IPTV de ahora (con `lan`); el puerto del relé lo añade el relé. */
  readonly policy: () => IptvFetchPolicy;
  /**
   * M3U: un canal responde 401/403/404 (token caducado en la URL): se refresca
   * la lista (como mucho una vez por minuto) y se devuelve la URL nueva del
   * mismo canal, o null.
   */
  readonly refreshRef?: (entryId: string) => Promise<string | null>;
  /**
   * Lo que se sabe del vídeo real de una variante al abrirla (la `RESOLUTION`
   * de la maestra HLS elegida): el servicio lo apunta como su calidad real
   * (docs/iptv.md §17).
   */
  readonly onMedia?: (entryId: string, media: { readonly height: number | null }) => void;
  /** Tope de bytes que se guardan mientras ffmpeg no lee (por defecto 4 MiB). */
  readonly pendingMaxBytes?: number;
  /** Espera a que ffmpeg se reenganche tras un reinicio (por defecto 20 s). */
  readonly reattachMs?: number;
  /**
   * Dirección de escucha: SIEMPRE `127.0.0.1` en producción. Los tests del PC
   * de Isma usan `::1` (su 127.0.0.1 corta conexiones al azar, ver
   * test/fake-engine/test-utils.ts); sigue siendo solo loopback.
   */
  readonly host?: string;
}

export interface RelayOpenOptions {
  readonly variants: readonly RelayVariant[];
  readonly signal?: AbortSignal;
  /** Esperas si el proveedor dice «ocupado» nada más abrir (plaza recién cerrada, §6.5). */
  readonly busyRetryMs?: readonly number[];
}

export interface RelayStats {
  readonly bytes: number;
  /** KB/s de los últimos segundos. */
  readonly kbps: number;
  readonly lastByteAt: number | null;
}

export interface RelaySession {
  readonly ticket: string;
  readonly inputUrl: string;
  readonly isHls: boolean;
  readonly closed: boolean;
  stats(): RelayStats;
  onDropped(listener: (code: IptvReason) => void): void;
  onRestart(listener: () => void): void;
  /** Aborta la conexión con el proveedor y espera a que se suelte. Idempotente. */
  close(): Promise<void>;
}

const PENDING_MAX = 4 * 1024 * 1024;
const REATTACH_MS = 20_000;
const HLS_PLAYLIST_MAX = 2 * 1024 * 1024;
const HLS_SEGMENT_MAX = 48 * 1024 * 1024;
const HLS_SEGMENT_MS = 30_000;
const HLS_KEY_MAX = 4096;
/** Bytes que se leen tras reconectar buscando el primer PCR. */
const PCR_PROBE_BYTES = 256 * 1024;

function newTicket(): string {
  return randomBytes(16).toString('base64url');
}

function isBusyError(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status !== null && IPTV_BUSY_STATUSES.includes(status);
}

/** Primer trozo del cuerpo (sin perder nada: el cuerpo queda en pausa). */
function firstChunk(body: Readable): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      body.off('data', onData);
      body.off('end', onEnd);
      body.off('error', onError);
    };
    const onData = (chunk: Buffer | string): void => {
      cleanup();
      body.pause();
      resolve(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    };
    const onEnd = (): void => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    body.on('data', onData);
    body.once('end', onEnd);
    body.once('error', onError);
  });
}

async function readText(body: Readable, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of body as AsyncIterable<Buffer | string>) {
    const chunk = typeof value === 'string' ? Buffer.from(value) : value;
    size += chunk.length;
    if (size > max) {
      body.destroy();
      throw new AppError('iptv_unsupported', { detail: 'lista HLS enorme' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/* Media móvil de KB/s (ventana de unos segundos). */
class RateMeter {
  private samples: { at: number; bytes: number }[] = [];
  total = 0;
  lastAt: number | null = null;

  constructor(private readonly clock: Clock) {}

  add(bytes: number): void {
    const now = this.clock.now();
    this.total += bytes;
    this.lastAt = now;
    this.samples.push({ at: now, bytes });
    while (this.samples.length && now - (this.samples[0] as { at: number }).at > 5000) {
      this.samples.shift();
    }
  }

  kbps(): number {
    const now = this.clock.now();
    const recent = this.samples.filter((sample) => now - sample.at <= 5000);
    if (!recent.length) return 0;
    const bytes = recent.reduce((sum, sample) => sum + sample.bytes, 0);
    const span = Math.max(1000, now - (recent[0] as { at: number }).at);
    return Math.round(bytes / span);
  }
}

abstract class BaseSession implements RelaySession {
  closed = false;
  protected readonly dropped: ((code: IptvReason) => void)[] = [];
  protected readonly restarts: (() => void)[] = [];
  protected readonly meter: RateMeter;
  protected variantIndex = 0;
  protected attempts: number[] = [];

  constructor(
    readonly ticket: string,
    readonly inputUrl: string,
    readonly isHls: boolean,
    protected readonly relay: IptvRelayImpl,
    protected readonly variants: readonly RelayVariant[],
    /** Corta todo lo de esta sesión con el proveedor (también la primera conexión). */
    readonly controller: AbortController,
  ) {
    this.meter = new RateMeter(relay.deps.clock);
  }

  stats(): RelayStats {
    return { bytes: this.meter.total, kbps: this.meter.kbps(), lastByteAt: this.meter.lastAt };
  }

  onDropped(listener: (code: IptvReason) => void): void {
    this.dropped.push(listener);
  }

  onRestart(listener: () => void): void {
    this.restarts.push(listener);
  }

  protected emitDropped(code: IptvReason): void {
    if (this.closed) return;
    this.relay.deps.logger.warn(
      { ticket: '•••', errorCode: code },
      'relé IPTV: la emisión se ha cortado',
    );
    for (const listener of [...this.dropped]) {
      try {
        listener(code);
      } catch {}
    }
  }

  protected emitRestart(): void {
    for (const listener of [...this.restarts]) {
      try {
        listener();
      } catch {}
    }
  }

  protected variant(): RelayVariant {
    return this.variants[this.variantIndex] as RelayVariant;
  }

  abstract handle(
    kind: string,
    rest: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void;

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.controller.signal.aborted) this.controller.abort(new AppError('iptv_dropped'));
    this.teardown();
    this.relay.forget(this.ticket);
    /* Una vuelta para que el socket con el proveedor termine de cerrarse. */
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  protected abstract teardown(): void;
}

/** Sesión con origen MPEG-TS (una conexión continua). */
class TsSession extends BaseSession {
  private upstream: OpenedStream | null = null;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private downstream: http.ServerResponse | null = null;
  private restartPending = false;
  private reconnecting = false;
  private reattachTimer: TimerHandle | null = null;
  private readonly pcr = new PcrTracker();
  private lastPcrAt: number | null = null;
  /** Bytes entregados al ffmpeg de ahora (sin nada, no hace falta reiniciar tras reconectar). */
  private delivered = 0;

  constructor(
    ticket: string,
    inputUrl: string,
    relay: IptvRelayImpl,
    variants: readonly RelayVariant[],
    controller: AbortController,
    first: OpenedStream,
    head: Buffer | null,
  ) {
    super(ticket, inputUrl, false, relay, variants, controller);
    this.upstream = first;
    if (head) this.queue(head);
    this.wire(first);
  }

  private queue(chunk: Buffer): void {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (this.pendingBytes > (this.relay.deps.pendingMaxBytes ?? PENDING_MAX)) {
      /* ffmpeg no lee: se deja de pedir al proveedor (el relé no acumula más). */
      this.upstream?.body.pause();
    }
  }

  private notePcr(chunk: Buffer): void {
    const before = this.pcr.last;
    this.pcr.push(chunk);
    if (this.pcr.last !== null && this.pcr.last !== before)
      this.lastPcrAt = this.relay.deps.clock.now();
  }

  private wire(opened: OpenedStream): void {
    const body = opened.body;
    body.on('data', (value: Buffer | string) => {
      if (this.upstream !== opened || this.closed) return;
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      this.meter.add(chunk.length);
      this.notePcr(chunk);
      this.deliver(chunk);
    });
    const lost = (): void => {
      if (this.upstream !== opened || this.closed) return;
      this.upstream = null;
      void this.reconnect();
    };
    body.once('end', lost);
    body.once('error', lost);
    body.once('close', lost);
    if (!this.downstream) body.pause();
    /* Si ya había terminado antes de engancharse, sus eventos no vuelven a llegar. */
    if (body.destroyed || body.readableEnded) queueMicrotask(lost);
  }

  private deliver(chunk: Buffer): void {
    const res = this.downstream;
    if (!res || this.restartPending || res.writableEnded || res.destroyed) {
      this.queue(chunk);
      return;
    }
    this.delivered += chunk.length;
    if (!res.write(chunk)) {
      this.upstream?.body.pause();
      res.once('drain', () => {
        if (!this.restartPending) this.upstream?.body.resume();
      });
    }
  }

  handle(kind: string, rest: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    if (kind !== 'in.ts' || rest) {
      res.writeHead(404).end();
      return;
    }
    if (this.downstream && !this.downstream.destroyed && !this.downstream.writableEnded) {
      /* Nunca una segunda conexión al proveedor por el mismo ticket. */
      res.writeHead(409).end();
      return;
    }
    this.attach(req, res);
  }

  private attach(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.relay.deps.clock.clearTimeout(this.reattachTimer);
    this.reattachTimer = null;
    this.restartPending = false;
    this.downstream = res;
    this.delivered = 0;
    res.writeHead(200, { 'content-type': 'video/mp2t', 'cache-control': 'no-store' });
    const flush = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    for (const chunk of flush) {
      this.delivered += chunk.length;
      res.write(chunk);
    }
    const onClose = (): void => {
      if (this.downstream !== res) return;
      this.downstream = null;
      if (this.closed || this.restartPending) return;
      /* ffmpeg se ha ido (muerto, parado o desalojado): fuera la conexión con el proveedor. */
      const upstream = this.upstream;
      this.upstream = null;
      upstream?.body.destroy();
    };
    res.once('close', onClose);
    req.once('close', onClose);
    if (this.upstream) this.upstream.body.resume();
    else if (!this.reconnecting) void this.reconnect({ immediate: true });
  }

  /** Abre de nuevo desde la URL original (con las esperas de §6.1). */
  private async reconnect(options: { readonly immediate?: boolean } = {}): Promise<void> {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    const { clock } = this.relay.deps;
    let lastCode: IptvReason = 'iptv_dropped';
    let first = options.immediate === true;
    try {
      for (;;) {
        if (this.closed) return;
        const now = clock.now();
        this.attempts = this.attempts.filter((at) => now - at < IPTV_RELAY.attemptsWindowMs);
        if (this.attempts.length >= IPTV_RELAY.maxAttempts) {
          if (await this.nextVariant(lastCode)) return;
          this.emitDropped(lastCode === 'iptv_busy' ? 'iptv_busy' : 'iptv_dropped');
          return;
        }
        if (!first) {
          const wait =
            IPTV_RELAY.backoffMs[Math.min(this.attempts.length, IPTV_RELAY.backoffMs.length - 1)] ??
            1000;
          this.attempts.push(clock.now());
          try {
            await clock.sleep(wait, this.controller.signal);
          } catch {
            return;
          }
        }
        first = false;
        try {
          const opened = await this.relay.connect(this.variant(), this.controller.signal, []);
          if (this.closed) {
            opened.body.destroy();
            return;
          }
          await this.adopt(opened, false);
          return;
        } catch (error) {
          if (this.closed) return;
          const code = toIptvError(error, 'stream').code as IptvReason;
          lastCode = isBusyError(error) ? 'iptv_busy' : code;
          /* Fallo de cuenta: ni más intentos ni otras variantes. */
          if (lastCode === 'iptv_auth_failed' || lastCode === 'iptv_account_expired') {
            this.emitDropped(lastCode);
            return;
          }
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  /** Otra variante del canal (una vez), con reinicio del remux. */
  private async nextVariant(lastCode: IptvReason): Promise<boolean> {
    if (lastCode === 'iptv_busy') return false;
    if (this.variantIndex + 1 >= this.variants.length) return false;
    this.variantIndex += 1;
    this.attempts = [];
    try {
      const opened = await this.relay.connect(this.variant(), this.controller.signal, []);
      if (this.closed) {
        opened.body.destroy();
        return true;
      }
      await this.adopt(opened, true);
      return true;
    } catch {
      return false;
    }
  }

  /* Usa una conexión nueva: si la base de tiempos salta (o es otra variante), reinicio del remux. */
  private async adopt(opened: OpenedStream, forceRestart: boolean): Promise<void> {
    const { clock } = this.relay.deps;
    const expected =
      this.pcr.last !== null && this.lastPcrAt !== null
        ? this.pcr.last + (clock.now() - this.lastPcrAt) / 1000
        : null;
    const probe = new PcrTracker();
    const head: Buffer[] = [];
    let headBytes = 0;
    let firstPcr: number | null = null;
    while (firstPcr === null && headBytes < PCR_PROBE_BYTES) {
      const chunk = await firstChunk(opened.body).catch(() => null);
      if (!chunk) break;
      head.push(chunk);
      headBytes += chunk.length;
      probe.push(chunk);
      firstPcr = probe.first;
    }
    /* Una conexión que no manda nada cuenta como intento fallido. */
    if (!headBytes) {
      opened.body.destroy();
      throw new AppError('iptv_dropped', { detail: 'reconexión sin datos' });
    }
    const jump =
      forceRestart ||
      (this.downstream !== null &&
        this.delivered > 0 &&
        expected !== null &&
        firstPcr !== null &&
        Math.abs(firstPcr - expected) * 1000 > IPTV_RELAY.ptsJumpMs);
    this.upstream = opened;
    if (jump) {
      /* No se empalma: lo nuevo espera a que el remux se reinicie y ffmpeg vuelva. */
      this.restartPending = true;
      this.pcr.reset();
      for (const chunk of head) {
        this.pending.push(chunk);
        this.pendingBytes += chunk.length;
        this.notePcr(chunk);
      }
      this.wire(opened);
      opened.body.pause();
      this.reattachTimer = clock.setTimeout(() => {
        if (this.closed || !this.restartPending) return;
        this.emitDropped('iptv_dropped');
      }, this.relay.deps.reattachMs ?? REATTACH_MS);
      this.emitRestart();
      return;
    }
    for (const chunk of head) {
      this.meter.add(chunk.length);
      this.notePcr(chunk);
      this.deliver(chunk);
    }
    this.wire(opened);
    if (this.downstream) opened.body.resume();
  }

  protected teardown(): void {
    this.relay.deps.clock.clearTimeout(this.reattachTimer);
    const upstream = this.upstream;
    this.upstream = null;
    upstream?.body.destroy();
    this.pending = [];
    this.pendingBytes = 0;
    const res = this.downstream;
    this.downstream = null;
    res?.destroy();
  }

  hasUpstream(): boolean {
    return this.upstream !== null;
  }
}

/** Sesión con origen HLS (lista y segmentos de uno en uno). */
class HlsSession extends BaseSession {
  private readonly lock = new SerialLock();
  private cache: { playlist: RewrittenPlaylist; at: number } | null = null;
  private readonly segments = new Map<number, { url: string; ext: SegmentExt }>();
  private readonly keys = new Map<number, string>();
  private guessExt: SegmentExt = 'ts';
  private failures = 0;
  private lastNewAt: number;
  private lastSequence: number | null = null;
  private lastText = '';
  private inFlight = 0;
  private readonly open = new Set<Readable>();

  constructor(
    ticket: string,
    inputUrl: string,
    relay: IptvRelayImpl,
    variants: readonly RelayVariant[],
    controller: AbortController,
    private mediaUrl: string,
    initial: string,
  ) {
    super(ticket, inputUrl, true, relay, variants, controller);
    this.lastNewAt = relay.deps.clock.now();
    this.learn(initial);
  }

  private prefix(): string {
    return `/r/${this.ticket}/`;
  }

  private learn(text: string): RewrittenPlaylist {
    const playlist = rewriteMediaPlaylist(text, this.mediaUrl, this.prefix(), this.guessExt);
    for (const [seq, segment] of playlist.segments) this.segments.set(seq, segment);
    for (const [n, url] of playlist.keys) this.keys.set(n, url);
    /* Solo los 40 últimos segmentos (y los MAP, que van en negativo). */
    const numbered = [...this.segments.keys()].filter((seq) => seq >= 0).sort((a, b) => a - b);
    while (numbered.length > IPTV_RELAY.segmentMemory) {
      this.segments.delete(numbered.shift() as number);
    }
    if (text !== this.lastText) {
      this.lastText = text;
      this.lastNewAt = this.relay.deps.clock.now();
    }
    if (this.lastSequence !== null && playlist.mediaSequence < this.lastSequence) {
      /* La secuencia vuelve atrás: el proveedor ha reiniciado la emisión. */
      this.emitRestart();
    }
    this.lastSequence = playlist.mediaSequence;
    this.cache = { playlist, at: this.relay.deps.clock.now() };
    return playlist;
  }

  connections(): number {
    return this.inFlight;
  }

  handle(kind: string, rest: string, _req: http.IncomingMessage, res: http.ServerResponse): void {
    if (kind === 'index.m3u8' && !rest) {
      void this.lock.run(() => this.servePlaylist(res));
      return;
    }
    if (kind === 's' && rest) {
      void this.lock.run(() => this.serveSegment(rest, res));
      return;
    }
    if (kind === 'k' && rest) {
      void this.lock.run(() => this.serveKey(rest, res));
      return;
    }
    res.writeHead(404).end();
  }

  private async servePlaylist(res: http.ServerResponse): Promise<void> {
    if (this.closed) {
      res.writeHead(410).end();
      return;
    }
    const { clock } = this.relay.deps;
    if (!this.cache || clock.now() - this.cache.at >= IPTV_RELAY.playlistCacheMs) {
      try {
        const text = await this.fetchPlaylist(this.mediaUrl);
        this.learn(text);
        this.failures = 0;
      } catch (error) {
        this.failures += 1;
        const stale = clock.now() - this.lastNewAt > IPTV_RELAY.playlistStaleMs;
        if (this.failures >= IPTV_RELAY.playlistFailures || stale) {
          if (!(await this.nextVariant())) {
            const code = toIptvError(error, 'stream').code as IptvReason;
            this.emitDropped(
              isBusyError(error)
                ? 'iptv_busy'
                : code === 'iptv_gone'
                  ? 'iptv_gone'
                  : 'iptv_dropped',
            );
          }
        }
        if (!this.cache) {
          res.writeHead(503, { 'retry-after': '1', 'cache-control': 'no-store' }).end();
          return;
        }
      }
    }
    const body = Buffer.from((this.cache as { playlist: RewrittenPlaylist }).playlist.text, 'utf8');
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
      'content-length': String(body.length),
    });
    res.end(body);
  }

  private async fetchPlaylist(url: string): Promise<string> {
    this.inFlight += 1;
    try {
      const opened = await this.relay.connect(
        { ...this.variant(), url },
        this.controller.signal,
        [],
        { maxBytes: HLS_PLAYLIST_MAX, totalMs: IPTV_RELAY.headersMs * 2 },
      );
      return await readText(opened.body, HLS_PLAYLIST_MAX);
    } finally {
      this.inFlight -= 1;
    }
  }

  private async nextVariant(): Promise<boolean> {
    if (this.variantIndex + 1 >= this.variants.length) return false;
    this.variantIndex += 1;
    try {
      const resolved = await this.relay.resolveHls(this.variant(), this.controller.signal);
      this.mediaUrl = resolved.mediaUrl;
      this.segments.clear();
      this.keys.clear();
      this.lastSequence = null;
      this.learn(resolved.text);
      this.failures = 0;
      this.emitRestart();
      return true;
    } catch {
      return false;
    }
  }

  private async serveSegment(name: string, res: http.ServerResponse): Promise<void> {
    const map = /^map(\d{1,4})\.mp4$/.exec(name);
    const plain = /^(\d{1,12})\.(ts|m4s|aac|mp4)$/.exec(name);
    const seq = map ? -Number(map[1]) : plain ? Number(plain[1]) : null;
    const segment = seq === null ? undefined : this.segments.get(seq);
    if (!segment || this.closed) {
      res.writeHead(404).end();
      return;
    }
    this.inFlight += 1;
    try {
      const opened = await this.relay.connect(
        { ...this.variant(), url: segment.url },
        this.controller.signal,
        [],
        { maxBytes: HLS_SEGMENT_MAX, totalMs: HLS_SEGMENT_MS },
      );
      const head = await firstChunk(opened.body);
      const sniffed = head ? sniffSegment(head, opened.contentType) : null;
      if (sniffed && sniffed !== 'mp4' && seq !== null && seq >= 0) this.guessExt = sniffed;
      res.writeHead(200, {
        'content-type': EXT_CONTENT_TYPE[sniffed ?? segment.ext],
        'cache-control': 'no-store',
      });
      if (head) {
        this.meter.add(head.length);
        res.write(head);
      }
      this.open.add(opened.body);
      await new Promise<void>((resolve) => {
        const done = (): void => {
          this.open.delete(opened.body);
          resolve();
        };
        opened.body.on('data', (chunk: Buffer) => {
          this.meter.add(chunk.length);
          if (!res.write(chunk)) {
            opened.body.pause();
            res.once('drain', () => opened.body.resume());
          }
        });
        opened.body.once('end', () => {
          res.end();
          done();
        });
        opened.body.once('error', () => {
          res.destroy();
          done();
        });
        res.once('close', () => {
          if (!res.writableFinished) opened.body.destroy();
          done();
        });
        opened.body.resume();
      });
    } catch (error) {
      if (!res.headersSent) {
        /* 404 de un segmento que ya salió de la ventana: ffmpeg lo salta. */
        res.writeHead(httpStatusOf(error) === 404 ? 404 : 502).end();
      } else res.destroy();
    } finally {
      this.inFlight -= 1;
    }
  }

  private async serveKey(name: string, res: http.ServerResponse): Promise<void> {
    const url = this.keys.get(Number(name));
    if (!url || this.closed || !/^\d{1,4}$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    this.inFlight += 1;
    try {
      const opened = await this.relay.connect(
        { ...this.variant(), url },
        this.controller.signal,
        [],
        {
          maxBytes: HLS_KEY_MAX,
          totalMs: IPTV_RELAY.headersMs,
        },
      );
      const chunks: Buffer[] = [];
      for await (const chunk of opened.body as AsyncIterable<Buffer>) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(502).end();
    } finally {
      this.inFlight -= 1;
    }
  }

  protected teardown(): void {
    for (const body of this.open) body.destroy();
    this.open.clear();
  }
}

export interface ConnectLimits {
  readonly maxBytes?: number;
  readonly totalMs?: number;
}

export interface IptvRelay {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Puerto del relé (null si no está escuchando). */
  port(): number | null;
  open(options: RelayOpenOptions): Promise<RelaySession>;
  /** Conexiones abiertas ahora con el proveedor (0 o 1: un canal a la vez en casa). */
  connections(): number;
  /** Sesiones vivas. */
  sessions(): number;
}

/** Implementación (exportada para los tests). */
export class IptvRelayImpl implements IptvRelay {
  private server: http.Server | null = null;
  private listening: number | null = null;
  private readonly live = new Map<string, TsSession | HlsSession>();

  constructor(readonly deps: RelayDeps) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => this.route(req, res));
    server.keepAliveTimeout = 5000;
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, this.host(), () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.listening = (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const session of [...this.live.values()]) await session.close();
    const server = this.server;
    this.server = null;
    this.listening = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  port(): number | null {
    return this.listening;
  }

  private host(): string {
    const host = this.deps.host ?? '127.0.0.1';
    return host === '::1' ? host : '127.0.0.1';
  }

  sessions(): number {
    return this.live.size;
  }

  connections(): number {
    let count = 0;
    for (const session of this.live.values()) {
      if (session instanceof TsSession) count += session.hasUpstream() ? 1 : 0;
      else count += session.connections() > 0 ? 1 : 0;
    }
    return count;
  }

  forget(ticket: string): void {
    this.live.delete(ticket);
  }

  private policy(): IptvFetchPolicy {
    const base = this.deps.policy();
    const port = this.listening;
    return port === null ? base : { ...base, blockedPorts: [...(base.blockedPorts ?? []), port] };
  }

  /**
   * Una conexión con el proveedor desde la URL que se le da (nunca la
   * `finalUrl` de otra vez). Con `busyRetryMs`, reintenta si dice «ocupado»;
   * en M3U, un 401/403/404 refresca la lista una vez y prueba la URL nueva.
   */
  async connect(
    variant: RelayVariant,
    signal: AbortSignal,
    busyRetryMs: readonly number[],
    limits: ConnectLimits = {},
  ): Promise<OpenedStream> {
    const { clock } = this.deps;
    let url = variant.url;
    let refreshed = false;
    let busyTry = 0;
    for (;;) {
      try {
        return await this.deps.net.openStream(url, {
          idleMs: IPTV_RELAY.idleMs,
          headersMs: IPTV_RELAY.headersMs,
          headers: variant.headers,
          accept: '*/*',
          iptv: this.policy(),
          signal,
          ...(limits.maxBytes === undefined ? {} : { maxBytes: limits.maxBytes }),
          ...(limits.totalMs === undefined ? {} : { totalMs: limits.totalMs }),
        });
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        const status = httpStatusOf(error);
        if (isBusyError(error) && busyTry < busyRetryMs.length) {
          await clock.sleep(busyRetryMs[busyTry] as number, signal);
          busyTry += 1;
          continue;
        }
        if (
          !refreshed &&
          this.deps.refreshRef &&
          (status === 401 || status === 403 || status === 404)
        ) {
          refreshed = true;
          const next = await this.deps.refreshRef(variant.entryId).catch(() => null);
          if (next) {
            url = next;
            continue;
          }
        }
        throw error;
      }
    }
  }

  /** Lista de medios de una variante HLS (aplana la maestra si hace falta). */
  async resolveHls(
    variant: RelayVariant,
    signal: AbortSignal,
    first?: OpenedStream,
  ): Promise<{ mediaUrl: string; text: string }> {
    const opened =
      first ??
      (await this.connect(variant, signal, [], {
        maxBytes: HLS_PLAYLIST_MAX,
        totalMs: IPTV_RELAY.headersMs * 2,
      }));
    let text = await readText(opened.body, HLS_PLAYLIST_MAX);
    let mediaUrl = opened.finalUrl;
    if (!isPlaylist(text))
      throw new AppError('iptv_unsupported', { detail: 'no es una lista HLS' });
    if (isMasterPlaylist(text)) {
      const chosen = pickMasterVariant(masterVariants(text));
      /* La resolución real de lo que se va a ver manda sobre la del nombre (docs/iptv.md §17). */
      try {
        this.deps.onMedia?.(variant.entryId, { height: chosen.height });
      } catch {}
      let next: string;
      try {
        next = new URL(chosen.uri, opened.finalUrl).toString();
      } catch {
        throw new AppError('iptv_unsupported', { detail: 'variante sin URL' });
      }
      const media = await this.connect({ ...variant, url: next }, signal, [], {
        maxBytes: HLS_PLAYLIST_MAX,
        totalMs: IPTV_RELAY.headersMs * 2,
      });
      text = await readText(media.body, HLS_PLAYLIST_MAX);
      mediaUrl = media.finalUrl;
      if (!isPlaylist(text) || isMasterPlaylist(text)) {
        throw new AppError('iptv_unsupported', { detail: 'variante sin lista de medios' });
      }
    }
    return { mediaUrl, text };
  }

  async open(options: RelayOpenOptions): Promise<RelaySession> {
    if (!this.server || this.listening === null) await this.start();
    const variants = options.variants;
    if (!variants.length) throw new AppError('iptv_gone');
    const ticket = newTicket();
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(options.signal?.reason ?? new Error('aborted'));
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let lastError: unknown = null;
      for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index] as RelayVariant;
        let opened: OpenedStream;
        try {
          opened = await this.connect(
            variant,
            controller.signal,
            index === 0 ? (options.busyRetryMs ?? []) : [],
          );
        } catch (error) {
          lastError = error;
          if (controller.signal.aborted) throw controller.signal.reason ?? error;
          const code = toIptvError(error, 'stream').code;
          /* Fallo de cuenta o de plaza: no se prueban variantes. */
          if (
            code === 'iptv_busy' ||
            code === 'iptv_auth_failed' ||
            code === 'iptv_account_expired'
          ) {
            throw toIptvError(error, 'stream');
          }
          continue;
        }
        const pathLooksHls =
          extFromPath(variant.url) === null && /\.m3u8?(?:[?#]|$)/i.test(variant.url);
        const typeLooksHls = /mpegurl/i.test(opened.contentType ?? '');
        let head: Buffer | null = null;
        let isHls = pathLooksHls || typeLooksHls;
        if (!isHls) {
          head = await firstChunk(opened.body).catch((error: unknown) => {
            lastError = error;
            return null;
          });
          if (!head) {
            opened.body.destroy();
            continue;
          }
          isHls = head
            .subarray(0, 16)
            .toString('latin1')
            .replace(/^\uFEFF/, '')
            .trimStart()
            .startsWith('#EXTM3U');
        }
        const host = this.host();
        const base = `http://${host.includes(':') ? `[${host}]` : host}:${this.listening}/r/${ticket}/`;
        const session = isHls
          ? await this.openHls(ticket, base, variants, index, opened, head, controller)
          : new TsSession(
              ticket,
              `${base}in.ts`,
              this,
              variants.slice(index),
              controller,
              opened,
              head,
            );
        this.live.set(ticket, session);
        /* El aborto de quien abre ya no vale: la sesión se cierra con close(). */
        options.signal?.removeEventListener('abort', onAbort);
        return session;
      }
      throw toIptvError(lastError ?? new AppError('iptv_gone'), 'stream');
    } catch (error) {
      options.signal?.removeEventListener('abort', onAbort);
      throw error instanceof AppError && errorCodeOf(error)?.startsWith('iptv_')
        ? error
        : toIptvError(error, 'stream');
    }
  }

  private async openHls(
    ticket: string,
    base: string,
    variants: readonly RelayVariant[],
    index: number,
    opened: OpenedStream,
    head: Buffer | null,
    controller: AbortController,
  ): Promise<HlsSession> {
    const variant = variants[index] as RelayVariant;
    let first = opened;
    if (head) {
      /* Ya se leyó el primer trozo: se reconstruye el cuerpo con él delante. */
      const rest = await readText(opened.body, HLS_PLAYLIST_MAX);
      const text = head.toString('utf8') + rest;
      first = { ...opened, body: Readable.from([Buffer.from(text, 'utf8')]) };
    }
    const resolved = await this.resolveHls(variant, controller.signal, first);
    return new HlsSession(
      ticket,
      `${base}index.m3u8`,
      this,
      variants.slice(index),
      controller,
      resolved.mediaUrl,
      resolved.text,
    );
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.on('error', () => undefined);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const match = /^\/r\/([A-Za-z0-9_-]{16,64})\/([^/?#]+)(?:\/([^/?#]+))?(?:\?.*)?$/.exec(
      req.url ?? '',
    );
    const session = match ? this.live.get(match[1] as string) : undefined;
    if (!match || !session || session.closed) {
      res.writeHead(404).end();
      return;
    }
    session.handle(match[2] as string, match[3] ?? '', req, res);
  }
}

export function createIptvRelay(deps: RelayDeps): IptvRelayImpl {
  return new IptvRelayImpl(deps);
}
