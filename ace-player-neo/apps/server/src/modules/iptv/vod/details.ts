/* Fichas bajo demanda (docs/vod.md §7.1, D-VOD30): una cola que no raspa
   `player_api` (los paneles bloquean a quien lo hace).

   - Coalescencia: diez peticiones de la misma ficha hacen una sola llamada.
   - Una en vuelo, 300 ms entre llamadas al proveedor, 60 por minuto como
     mucho y 8 en espera. Con la cola llena, `failed` al momento.
   - Precargas (`pre=1`): solo se lanzan si la cola está vacía; si no,
     `pending` al momento (la web la vuelve a pedir al abrir la ficha).
   - LRU acotada por BYTES (el JSON de la ficha ya reducida), 8 MiB en total,
     TTL de 6 h; se vacía al cambiar el catálogo (`clear`).
   - Un fallo del proveedor da `failed` y no se guarda: la ficha nunca se
     queda en blanco (§7.3), quien llama pinta lo que sabe por la lista. */

import { VOD_DETAILS, type VodKind } from '@ace/shared';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import type { VodInfo } from './parse.js';

export type VodDetailsFetcher = (
  kind: VodKind,
  source: number,
  signal: AbortSignal,
) => Promise<VodInfo>;

export type VodDetailsResult =
  | { readonly info: 'ok'; readonly data: VodInfo }
  | { readonly info: 'pending' }
  | { readonly info: 'failed' };

interface CacheEntry {
  readonly data: VodInfo;
  readonly bytes: number;
  readonly at: number;
}

interface Job {
  readonly key: string;
  readonly kind: VodKind;
  readonly source: number;
  readonly generation: number;
  readonly promise: Promise<VodDetailsResult>;
  resolve(result: VodDetailsResult): void;
}

export interface VodDetailsLimits {
  readonly cacheBytes: number;
  readonly ttlMs: number;
  readonly spacingMs: number;
  readonly perMinute: number;
  readonly waitingMax: number;
}

const WINDOW_MS = 60_000;

export class VodDetailsQueue {
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly pending = new Map<string, Job>();
  private readonly waiting: Job[] = [];
  private inflight: Job | null = null;
  private controller = new AbortController();
  private timer: TimerHandle | null = null;
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private readonly starts: number[] = [];
  private generation = 0;
  /** Llamadas hechas al proveedor (para los tests y el registro). */
  calls = 0;

  constructor(
    private readonly clock: Clock,
    private readonly fetcher: VodDetailsFetcher,
    private readonly limits: VodDetailsLimits = VOD_DETAILS,
  ) {}

  private static key(kind: VodKind, source: number): string {
    return `${kind}:${source}`;
  }

  /** La ficha en caché (sin pedir nada), o null. */
  peek(kind: VodKind, source: number): VodInfo | null {
    const key = VodDetailsQueue.key(kind, source);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (this.clock.now() - entry.at > this.limits.ttlMs) {
      this.drop(key);
      return null;
    }
    /* Tocarla la pone la última de la LRU. */
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  /** ¿Hay algo en vuelo o esperando? */
  busy(): boolean {
    return this.inflight !== null || this.waiting.length > 0;
  }

  /** La ficha: de la caché, coalescida con una en marcha, o por la cola. */
  get(
    kind: VodKind,
    source: number,
    options: { readonly pre?: boolean } = {},
  ): Promise<VodDetailsResult> {
    const cached = this.peek(kind, source);
    if (cached) return Promise.resolve({ info: 'ok', data: cached });
    const key = VodDetailsQueue.key(kind, source);
    const running = this.pending.get(key);
    if (running) return options.pre ? Promise.resolve({ info: 'pending' }) : running.promise;
    if (options.pre && this.busy()) return Promise.resolve({ info: 'pending' });
    if (this.waiting.length >= this.limits.waitingMax) return Promise.resolve({ info: 'failed' });
    let resolve!: (result: VodDetailsResult) => void;
    const promise = new Promise<VodDetailsResult>((done) => {
      resolve = done;
    });
    const job: Job = { key, kind, source, generation: this.generation, promise, resolve };
    this.pending.set(key, job);
    this.waiting.push(job);
    this.pump();
    return promise;
  }

  /** Vacía la caché y la cola (otro catálogo u otro proveedor). */
  clear(): void {
    this.generation += 1;
    this.cache.clear();
    this.cacheBytes = 0;
    this.controller.abort(new Error('otro catálogo'));
    this.controller = new AbortController();
    for (const job of this.waiting.splice(0)) {
      this.pending.delete(job.key);
      job.resolve({ info: 'failed' });
    }
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.clear();
  }

  private drop(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.cacheBytes -= entry.bytes;
  }

  private store(key: string, data: VodInfo): void {
    const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (bytes > this.limits.cacheBytes) return;
    this.drop(key);
    this.cache.set(key, { data, bytes, at: this.clock.now() });
    this.cacheBytes += bytes;
    while (this.cacheBytes > this.limits.cacheBytes) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
  }

  /** Cuánto hay que esperar para la siguiente llamada (300 ms de separación y 60 por minuto). */
  private waitMs(now: number): number {
    while (this.starts.length && now - (this.starts[0] as number) >= WINDOW_MS) this.starts.shift();
    const spacing = this.lastStartAt + this.limits.spacingMs - now;
    const rate =
      this.starts.length >= this.limits.perMinute
        ? (this.starts[0] as number) + WINDOW_MS - now
        : 0;
    return Math.max(0, spacing, rate);
  }

  private pump(): void {
    if (this.inflight || this.timer || !this.waiting.length) return;
    const wait = this.waitMs(this.clock.now());
    if (wait > 0) {
      this.timer = this.clock.setTimeout(
        () => {
          this.timer = null;
          this.pump();
        },
        wait,
        { unref: true },
      );
      return;
    }
    const job = this.waiting.shift() as Job;
    this.inflight = job;
    const now = this.clock.now();
    this.lastStartAt = now;
    this.starts.push(now);
    this.calls += 1;
    const signal = this.controller.signal;
    void this.fetcher(job.kind, job.source, signal)
      .then(
        (data) => {
          if (job.generation === this.generation) this.store(job.key, data);
          return { info: 'ok', data } as const;
        },
        () => ({ info: 'failed' }) as const,
      )
      .then((result) => {
        if (this.pending.get(job.key) === job) this.pending.delete(job.key);
        if (this.inflight === job) this.inflight = null;
        job.resolve(result);
        this.pump();
      });
  }
}
