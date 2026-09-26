/* El servicio del comprobador: trabajos, cola, reintentos y veredictos
   (server.js:3304-3597; backend-modulos §6.5 y §7; arquitectura §5.8).

   Igual que la 0.6.59:
   - una sonda cada vez (drenado único); los trabajos prioritarios (todo lo
     que no es precalentado) entran por delante;
   - un trabajo nuevo con la misma clave de cliente cancela el anterior;
   - sin `force`, lo que tiene veredicto vigente lo toma sin probar; con
     `force` se prueba, salvo que mande el reproductor (server.js:3505);
   - un fallo espera el retraso de reintento y se prueba otra vez, una sola;
   - la poda borra los trabajos a los 25 min sin actividad.

   Cambios (arquitectura §5.8):
   - Con alguien viendo (`playback.activity`): como mucho una sonda cada
     20 s y NUNCA del hash que se ve. Si solo le quedan hashes vistos sin
     veredicto, el trabajo espera (`waiting`) hasta que cambie la actividad
     o llegue el veredicto del reproductor.
   - Cola acotada a 20 trabajos vivos: al pasarse se cancela el más viejo,
     empezando por los que no tienen clave de cliente (§8.5.23).
   - Por el bus: `scan.verdict`, `scan.progress` y `scan.jobDone` (también
     al cancelar y al podar un trabajo vivo, §8.2.11).
   - Sesiones que quizá quedaron abiertas: se cuentan y van a diagnóstico.
   - Un trabajo en espera cuyo reintento ya no hace falta (el reproductor
     dio su veredicto) se completa en vez de quedarse en `queued`. */

import { randomBytes } from 'node:crypto';
import {
  SCANNER_MAX_CANDIDATES,
  SCANNER_MAX_JOBS,
  TIMEOUTS,
  normalizeHash,
  type ScanJob,
  type ScanRef,
  type VerdictState,
} from '@ace/shared';
import type { Unsubscribe } from '../../core/bus.js';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import {
  SCANNER_LEAK_ALERT,
  SCANNER_LEAK_WINDOW_MS,
  SCANNER_PING_INTERVAL_MS,
  SCANNER_PRUNE_INTERVAL_MS,
  SCANNER_WATCHING_GAP_MS,
} from './constants.js';
import { playableOnFromState, scannerRetryPlan, type PlayableOn } from './evidence.js';
import { isLive, jobPayload, scanRef, type Job, type JobCandidate } from './jobs.js';
import { probeAceCandidate, type ProbeLeak, type ProbeResult } from './probe.js';
import { createHttpScannerTransport, type ScannerTransport } from './transport.js';
import type {
  ScanJobRequest,
  ScannerDeps,
  ScannerHealth,
  ScannerService,
  ScannerStats,
  SourceVerdict,
} from './types.js';
import {
  VerdictCache,
  verdictPolicy,
  type CachedVerdict,
  type Verdict,
  type VerdictInput,
} from './verdicts.js';

const JOB_ID_RE = /^[a-f0-9]{24}$/;

interface PickedCandidate {
  readonly candidate: JobCandidate;
  readonly cached: CachedVerdict | null;
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

export class ScannerServiceImpl implements ScannerService {
  private readonly jobs = new Map<string, Job>();
  private readonly clients = new Map<string, string>();
  private readonly queue: string[] = [];
  private readonly verdicts: VerdictCache;
  private readonly transport: ScannerTransport | null;
  private readonly leaks: number[] = [];
  private busy = false;
  private started = false;
  private stopped = false;
  private life = new AbortController();
  private pace: AbortController | null = null;
  private pruneTimer: TimerHandle | null = null;
  /* get_version propio para la salud (`stats().online`, paso 1.3). */
  private pingTimer: TimerHandle | null = null;
  private pingInFlight: Promise<ScannerHealth> | null = null;
  private lastOnline: boolean | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private watching = false;
  private watched = new Set<string>();
  private lastProbeAt = Number.NEGATIVE_INFINITY;
  private leakWarned = false;
  /* Carril IPTV: una comprobación cada vez por proveedor (docs/iptv.md §7.3). */
  private iptvChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ScannerDeps) {
    this.verdicts = new VerdictCache(verdictPolicy(deps.config.scanner.badTtlMs));
    this.transport = deps.config.scanner.enabled
      ? (deps.transport ??
        createHttpScannerTransport({
          host: deps.config.scanner.host,
          port: deps.config.scanner.port,
          clock: deps.clock,
        }))
      : null;
  }

  // --- Ciclo de vida ---

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    if (this.life.signal.aborted) this.life = new AbortController();
    this.unsubscribe = this.deps.bus.on('playback.activity', (activity) =>
      this.onActivity(activity.watching, activity.hashes),
    );
    this.pruneTimer = this.deps.clock.setInterval(
      () => this.prune(this.deps.clock.now()),
      SCANNER_PRUNE_INTERVAL_MS,
      { unref: true },
    );
    /* La salud ya no pregunta al comprobador en cada GET /api/health: lo hace
       él cada 30 s (antes lo hacía systemHealth, server.js:4618-4622). */
    if (this.transport) {
      void this.refreshOnline();
      this.pingTimer = this.deps.clock.setInterval(
        () => void this.refreshOnline(),
        SCANNER_PING_INTERVAL_MS,
        { unref: true },
      );
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.deps.clock.clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    this.deps.clock.clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.life.abort();
    this.pace?.abort();
    this.queue.length = 0;
    /* Como server.js:5150-5155: los trabajos vivos se cancelan al apagar. */
    for (const job of this.jobs.values()) {
      if (isLive(job)) this.cancel(job);
    }
  }

  // --- Consultas ---

  isEnabled(): boolean {
    return this.deps.config.scanner.enabled;
  }

  job(id: string, options: { readonly playableOn?: boolean } = {}): ScanJob {
    const now = this.deps.clock.now();
    this.prune(now);
    const key = String(id || '')
      .trim()
      .toLowerCase();
    const job = JOB_ID_RE.test(key) ? this.jobs.get(key) : undefined;
    if (!job) throw new AppError('scan_not_found');
    return jobPayload(job, now, options);
  }

  verdict(hash: string): SourceVerdict | null {
    const id = normalizeHash(hash);
    if (!id) return null;
    const cached = this.verdicts.hit(id, this.deps.clock.now());
    return cached ? this.toSourceVerdict(id, cached) : null;
  }

  playerVerdictHeld(hash: string): boolean {
    const id = normalizeHash(hash);
    return Boolean(id) && this.verdicts.held(id, this.deps.clock.now());
  }

  forget(hash: string): void {
    const id = normalizeHash(hash);
    if (id) this.verdicts.delete(id);
  }

  stats(): ScannerStats {
    const now = this.deps.clock.now();
    this.pruneLeaks(now);
    return {
      enabled: this.isEnabled(),
      busy: this.busy,
      queue: this.queue.length,
      activeJobs: [...this.jobs.values()].filter(isLive).length,
      cachedSources: this.verdicts.size,
      leakedSessionsLastHour: this.leaks.length,
      online: this.transport ? this.lastOnline : false,
    };
  }

  /** Un solo `get_version` a la vez; al apagar, la señal de vida lo corta. */
  private refreshOnline(): Promise<ScannerHealth> {
    if (!this.pingInFlight) {
      this.pingInFlight = this.ping(this.life.signal).finally(() => {
        this.pingInFlight = null;
      });
    }
    return this.pingInFlight;
  }

  async ping(signal?: AbortSignal): Promise<ScannerHealth> {
    if (!this.transport) return { status: 'disabled', online: false };
    try {
      const result = await this.transport.request(
        '/webui/api/service?method=get_version',
        TIMEOUTS.engineVersionMs,
        signal,
      );
      const online = result.statusCode >= 200 && result.statusCode < 300;
      this.lastOnline = online;
      return { status: online ? 'ready' : 'offline', online };
    } catch {
      /* Un corte por el apagado no es "comprobador caído". */
      if (!this.stopped) this.lastOnline = false;
      return { status: 'offline', online: false };
    }
  }

  async searchRaw(query: string, signal?: AbortSignal): Promise<string> {
    if (!this.transport) throw new AppError('engine_unavailable');
    let result;
    try {
      result = await this.transport.request(
        `/search?query=${encodeURIComponent(query)}&page_size=60`,
        TIMEOUTS.engineSearchMs,
        signal,
      );
    } catch (error) {
      /* Como searchAceStreams (server.js:3642-3650): el plazo se distingue,
         lo demás es motor no disponible. */
      if (error instanceof Error && error.message === 'scanner_timeout') {
        throw new AppError('ace_timeout', { cause: error });
      }
      throw new AppError('engine_unavailable', { cause: error });
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new AppError('engine_unavailable', { detail: `HTTP ${result.statusCode}` });
    }
    return result.body;
  }

  // --- Veredictos ---

  recordVerdict(
    hash: string,
    verdict: {
      readonly state: VerdictState;
      readonly reason: string;
      readonly by: 'scanner' | 'player';
    },
  ): SourceVerdict {
    const id = normalizeHash(hash);
    if (!id) throw new AppError('bad_request');
    const result: VerdictInput = {
      state: verdict.state,
      reason: verdict.reason,
      by: verdict.by,
      checkedAt: this.deps.clock.date().toISOString(),
      playableOn: playableOnFromState(verdict.state),
    };
    const recorded = this.record(id, result, null);
    return this.toSourceVerdict(id, recorded);
  }

  /**
   * `recordScannerVerdict` completo (server.js:3330-3353): anota, avisa por
   * el bus y, si es del reproductor, lo copia a los trabajos abiertos.
   */
  private record(id: string, result: VerdictInput, jobId: string | null): Verdict {
    const now = this.deps.clock.now();
    const transition = this.verdicts.record(id, result, now);
    const entry = transition.entry;
    if (entry) {
      this.deps.bus.emit('scan.verdict', {
        jobId,
        hash: id,
        state: entry.state,
        reason: entry.reason,
        by: entry.by,
        checkedAt: isoOr(entry.checkedAt, new Date(now).toISOString()),
        playableOn: this.toSourceVerdict(id, entry).playableOn,
      });
      if (entry.by === 'player') this.copyPlayerVerdict(id, entry, now);
    }
    return transition.verdict;
  }

  /** server.js:3340-3351, más completar o despertar el trabajo si ya no le queda nada. */
  private copyPlayerVerdict(id: string, verdict: CachedVerdict, now: number): void {
    for (const job of this.jobs.values()) {
      if (job.status === 'cancelled') continue;
      let touched = false;
      for (const candidate of job.candidates) {
        if (candidate.id !== id || candidate.state === 'checking') continue;
        if (verdict.state === 'failed' && candidate.state === 'retry_wait') continue;
        Object.assign(candidate, {
          state: verdict.state,
          reason: verdict.reason,
          checkedAt: verdict.checkedAt,
          cached: true,
          playableOn: verdict.playableOn,
        });
        if (verdict.state !== 'failed') candidate.retryAt = 0;
        job.updatedAt = now;
        touched = true;
      }
      if (!touched) continue;
      this.progress(job);
      if (job.parked) this.unpark(job);
      else if (job.status === 'waiting' && !this.hasPending(job)) this.complete(job);
    }
  }

  private toSourceVerdict(id: string, entry: Verdict | CachedVerdict): SourceVerdict {
    const cachedAt = 'cachedAt' in entry ? Number(entry.cachedAt) : this.deps.clock.now();
    const checkedAt = Date.parse(String(entry.checkedAt ?? ''));
    const audio = entry.audioCodecs;
    return {
      hash: id,
      state: entry.state,
      reason: entry.reason,
      by: entry.by,
      checkedAt: Number.isFinite(checkedAt) ? checkedAt : cachedAt,
      videoCodec:
        typeof entry.videoCodec === 'string' && entry.videoCodec ? entry.videoCodec : null,
      audioCodecs: Array.isArray(audio) ? audio.map(String) : [],
      playableOn: (entry.playableOn as PlayableOn | undefined) ?? playableOnFromState(entry.state),
    };
  }

  // --- Trabajos ---

  enqueue(request: ScanJobRequest): ScanRef | null {
    if (!this.isEnabled()) return null;
    const now = this.deps.clock.now();
    this.prune(now);
    const force = request.force === true;
    const seen = new Set<string>();
    const candidates: JobCandidate[] = [];
    for (const item of Array.isArray(request.candidates) ? request.candidates : []) {
      const id = normalizeHash(item?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      candidates.push({
        id,
        ih: item.ih === true,
        state: 'queued',
        attempts: 0,
        force,
        retryAt: 0,
        ...(this.isIptv(id) ? { lane: 'iptv' as const } : {}),
      });
      if (candidates.length >= SCANNER_MAX_CANDIDATES) break;
    }
    if (!candidates.length) return null;

    const clientKey = String(request.clientKey || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40);
    const previousId = clientKey ? this.clients.get(clientKey) : undefined;
    const previous = previousId ? this.jobs.get(previousId) : undefined;
    if (previous && isLive(previous)) this.cancel(previous);
    this.makeRoom();

    const job: Job = {
      id: this.deps.jobId?.() ?? randomBytes(12).toString('hex'),
      clientKey,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      enqueued: false,
      retryTimer: null,
      priority: request.priority ?? request.kind !== 'preheat',
      kind: request.kind,
      matchId: String(request.matchId || '').slice(0, 100),
      reportKey: String(request.reportKey || '').slice(0, 40),
      candidates,
      parked: false,
    };
    for (const candidate of job.candidates) {
      /* La IPTV la mira siempre su carril (sus fallidas se reintentan a los 2 min, no a los 10). */
      if (candidate.lane) continue;
      const cached = force ? null : this.verdicts.hit(candidate.id, now);
      if (cached) Object.assign(candidate, cached, { cached: true });
    }
    this.jobs.set(job.id, job);
    if (clientKey) this.clients.set(clientKey, job.id);
    for (const candidate of job.candidates) if (candidate.lane) this.runIptvLane(job, candidate);
    if (!this.hasQueued(job)) {
      /* Todo tenía veredicto: completo desde el principio. El aviso sale
         después de devolver la referencia, para que quien lo crea la tenga. */
      job.status = 'complete';
      queueMicrotask(() => this.announceDone(job));
    } else {
      this.progress(job);
      this.enqueueJob(job);
    }
    return scanRef(job);
  }

  /** Deja sitio para uno más: 20 trabajos vivos como máximo. */
  private makeRoom(): void {
    const live = [...this.jobs.values()].filter(isLive);
    if (live.length < SCANNER_MAX_JOBS) return;
    live.sort(
      (a, b) =>
        Number(Boolean(a.clientKey)) - Number(Boolean(b.clientKey)) ||
        Number(a.priority) - Number(b.priority) ||
        a.createdAt - b.createdAt,
    );
    for (const victim of live.slice(0, live.length - SCANNER_MAX_JOBS + 1)) this.cancel(victim);
  }

  private hasQueued(job: Job): boolean {
    return job.candidates.some((item) => item.state === 'queued' && !item.lane);
  }

  private hasPending(job: Job): boolean {
    return job.candidates.some(
      (item) =>
        !item.lane &&
        (item.state === 'queued' || item.state === 'retry_wait' || item.state === 'checking'),
    );
  }

  /** ¿Es un id de la IPTV (del catálogo vigente o de antes)? */
  private isIptv(id: string): boolean {
    const iptv = this.deps.iptv;
    if (!iptv) return false;
    try {
      return iptv.classify(id) !== 'engine';
    } catch {
      return false;
    }
  }

  /**
   * Carril IPTV (docs/iptv.md §7.3): nivel 1 (la cuenta) siempre y sin gastar
   * conexión; nivel 2 (sonda de stream) solo en el precalentamiento. Una
   * cuenta activa no es un stream verificado: sin veredicto, el candidato se
   * queda «Sin comprobar» (`queued`) y no frena el trabajo.
   */
  private runIptvLane(job: Job, candidate: JobCandidate): void {
    const iptv = this.deps.iptv;
    if (!iptv || this.stopped) return;
    const transport = this.transport;
    const inspectFile = transport?.inspectFile
      ? (file: string, timeoutMs: number, signal?: AbortSignal) =>
          (transport.inspectFile as NonNullable<ScannerTransport['inspectFile']>)(
            file,
            timeoutMs,
            signal,
          )
      : undefined;
    const run = async (): Promise<void> => {
      if (job.status === 'cancelled' || this.stopped) return;
      let result: Awaited<ReturnType<typeof iptv.check>>;
      try {
        result = await iptv.check(candidate.id, {
          kind: job.kind,
          signal: this.life.signal,
          ...(inspectFile ? { inspectFile } : {}),
        });
      } catch (error) {
        this.deps.logger.debug(
          { errorCode: error instanceof Error ? error.message : 'desconocido' },
          '[scanner] carril IPTV',
        );
        return;
      }
      if (!result || this.stopped || (job.status as string) === 'cancelled') return;
      const verdict = this.record(
        candidate.id,
        {
          state: result.state,
          reason: result.reason,
          by: 'scanner',
          checkedAt: this.deps.clock.date().toISOString(),
          ...(result.videoCodec ? { videoCodec: result.videoCodec } : {}),
          ...(result.audioCodecs ? { audioCodecs: [...result.audioCodecs] } : {}),
          ...(result.rateKbps !== undefined ? { rateKbps: result.rateKbps } : {}),
          ...(result.playableOn ? { playableOn: result.playableOn } : {}),
        },
        job.id,
      );
      Object.assign(candidate, verdict, {
        cached: false,
        attempts: (candidate.attempts || 0) + 1,
      });
      job.updatedAt = this.deps.clock.now();
      this.progress(job);
    };
    const next = this.iptvChain.then(run, run);
    this.iptvChain = next.catch(() => undefined);
  }

  /** `enqueueScannerJob` (server.js:3420-3427). */
  private enqueueJob(job: Job, priority = job.priority): void {
    if (job.enqueued || !isLive(job) || this.stopped) return;
    if (!this.hasQueued(job)) return;
    job.enqueued = true;
    if (priority) this.queue.unshift(job.id);
    else this.queue.push(job.id);
    queueMicrotask(() => this.kick());
  }

  /* server.js:3478-3480: un fallo del drenado no tumba el proceso (B-028). */
  private kick(): void {
    this.drain().catch((error: unknown) => {
      this.deps.logger.error({ err: error }, '[scanner] fallo drenando la cola');
    });
  }

  private cancel(job: Job): void {
    this.deps.clock.clearTimeout(job.retryTimer);
    job.retryTimer = null;
    job.status = 'cancelled';
    job.parked = false;
    job.updatedAt = this.deps.clock.now();
    this.progress(job);
    this.announceDone(job);
  }

  /** `completeScannerJob` (server.js:3429-3435). */
  private complete(job: Job): void {
    this.deps.clock.clearTimeout(job.retryTimer);
    job.retryTimer = null;
    job.status = 'complete';
    job.parked = false;
    job.updatedAt = this.deps.clock.now();
    this.progress(job);
    this.announceDone(job);
  }

  private announceDone(job: Job): void {
    const payload = jobPayload(job, this.deps.clock.now());
    this.deps.bus.emit('scan.jobDone', {
      jobId: job.id,
      kind: job.kind,
      status: job.status === 'cancelled' ? 'cancelled' : 'complete',
      matchId: job.matchId || null,
      reportKey: job.reportKey || null,
      total: payload.total,
      playable: payload.playable,
    });
  }

  private progress(job: Job): void {
    const payload = jobPayload(job, this.deps.clock.now());
    this.deps.bus.emit('scan.progress', {
      jobId: job.id,
      kind: job.kind,
      status: payload.status,
      total: payload.total,
      checked: payload.checked,
      playable: payload.playable,
      failed: payload.failed,
      waiting: payload.waiting,
      retryAt: payload.retryAt,
      matchId: job.matchId || null,
    });
  }

  /** Tras procesar un candidato: a la cola, a esperar el reintento o completo (server.js:3526-3528). */
  private advance(job: Job): void {
    if (!isLive(job)) return;
    if (this.hasQueued(job)) this.enqueueJob(job);
    else if (!this.scheduleRetry(job)) this.complete(job);
  }

  /** `scheduleScannerRetry` (server.js:3446-3471). */
  private scheduleRetry(job: Job): boolean {
    if (!isLive(job)) return false;
    const waiting = job.candidates.filter(
      (item) => item.state === 'retry_wait' && Number(item.retryAt) > 0,
    );
    if (!waiting.length) return false;
    const { clock } = this.deps;
    const nextAt = Math.min(...waiting.map((item) => Number(item.retryAt)));
    clock.clearTimeout(job.retryTimer);
    job.status = 'waiting';
    job.retryTimer = clock.setTimeout(
      () => {
        job.retryTimer = null;
        if (!isLive(job)) return;
        const now = clock.now();
        for (const candidate of job.candidates) {
          if (candidate.state !== 'retry_wait' || Number(candidate.retryAt) > now) continue;
          candidate.state = 'queued';
          candidate.reason = 'delayed_retry';
          candidate.retryAt = 0;
          candidate.force = true;
        }
        job.updatedAt = now;
        job.status = 'queued';
        this.progress(job);
        this.enqueueJob(job, job.priority);
        if (!job.enqueued && !this.scheduleRetry(job)) this.complete(job);
      },
      Math.max(0, nextAt - clock.now()),
      { unref: true },
    );
    this.progress(job);
    return true;
  }

  /** Espera a que cambie la actividad: solo le quedan fuentes que alguien está viendo. */
  private park(job: Job): void {
    job.parked = true;
    job.status = 'waiting';
    job.updatedAt = this.deps.clock.now();
    this.progress(job);
  }

  private unpark(job: Job): void {
    job.parked = false;
    if (!isLive(job)) return;
    job.status = 'queued';
    this.advance(job);
  }

  private isWatched(id: string): boolean {
    return this.watching && this.watched.has(id);
  }

  private onActivity(watching: boolean, hashes: readonly string[]): void {
    const next = new Set(watching ? hashes.map((hash) => normalizeHash(hash)).filter(Boolean) : []);
    const changed =
      watching !== this.watching ||
      next.size !== this.watched.size ||
      [...next].some((hash) => !this.watched.has(hash));
    this.watching = watching;
    this.watched = next;
    if (!watching) this.pace?.abort();
    if (!changed) return;
    for (const job of this.jobs.values()) if (job.parked) this.unpark(job);
  }

  /**
   * El candidato que toca (server.js:3496-3505): el primer `queued`. Uno que
   * alguien está viendo nunca se prueba: toma su veredicto guardado si lo hay
   * y, si no, se salta; si solo quedan de esos, el trabajo espera.
   */
  private pick(job: Job, now: number): PickedCandidate | 'park' | null {
    let onlyWatched = false;
    for (const candidate of job.candidates) {
      if (candidate.state !== 'queued' || candidate.lane) continue;
      if (this.isWatched(candidate.id)) {
        const cached = this.verdicts.hit(candidate.id, now);
        if (cached) return { candidate, cached };
        onlyWatched = true;
        continue;
      }
      /* La fuente que alguien está viendo no se vuelve a probar aunque se
         fuerce: el reproductor ya cuenta cómo va (T-122, B-026). */
      const cached =
        candidate.force === true && !this.verdicts.held(candidate.id, now)
          ? null
          : this.verdicts.hit(candidate.id, now);
      return { candidate, cached };
    }
    return onlyWatched ? 'park' : null;
  }

  /** Con alguien viendo, como mucho una sonda cada 20 s. */
  private async paceProbes(): Promise<void> {
    if (!this.watching) return;
    const wait = this.lastProbeAt + SCANNER_WATCHING_GAP_MS - this.deps.clock.now();
    if (wait <= 0) return;
    const pace = new AbortController();
    this.pace = pace;
    const onStop = (): void => pace.abort();
    this.life.signal.addEventListener('abort', onStop, { once: true });
    try {
      await this.deps.clock.sleep(wait, pace.signal);
    } catch {
      // cortado: dejaron de ver o se apaga el servicio
    } finally {
      this.life.signal.removeEventListener('abort', onStop);
      if (this.pace === pace) this.pace = null;
    }
  }

  private probe(candidate: JobCandidate): Promise<ProbeResult> {
    const transport = this.transport as ScannerTransport;
    const settings = this.deps.config.scanner;
    return probeAceCandidate(candidate, {
      clock: this.deps.clock,
      request: (pathname, timeoutMs, signal) => transport.request(pathname, timeoutMs, signal),
      sample: (pathname, timeoutMs, minBytes, sustainMs, signal) =>
        transport.sample(pathname, timeoutMs, minBytes, sustainMs, signal),
      inspect: (pathname, timeoutMs, signal) => transport.inspect(pathname, timeoutMs, signal),
      timeoutMs: settings.probeTimeoutMs,
      minBytes: settings.sampleBytes,
      sustainMs: settings.sustainMs,
      mediaProbeMs: settings.mediaProbeMs,
      signal: this.life.signal,
      onLeak: (leak) => this.noteLeak(leak),
    });
  }

  /** `drainScannerQueue` (server.js:3482-3534). */
  private async drain(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const { clock } = this.deps;
    try {
      while (this.queue.length && !this.stopped) {
        const job = this.jobs.get(this.queue.shift() as string);
        if (!job) continue;
        job.enqueued = false;
        if (job.status === 'cancelled') continue;
        /* Primero se da una oportunidad a TODAS; la segunda de una fallida
           queda aplazada (server.js:3491-3499). */
        const picked = this.pick(job, clock.now());
        if (picked === null) {
          if (!this.scheduleRetry(job)) this.complete(job);
          continue;
        }
        if (picked === 'park') {
          this.park(job);
          continue;
        }
        const { candidate, cached } = picked;
        if (cached) {
          Object.assign(candidate, cached, { cached: true });
        } else {
          await this.paceProbes();
          if (this.stopped) break;
          if (!isLive(job)) continue;
          if (candidate.state !== 'queued' || this.isWatched(candidate.id)) {
            /* Mientras se esperaba cambió algo (veredicto del reproductor o
               empezaron a verla): se vuelve a decidir. */
            this.advance(job);
            continue;
          }
          candidate.state = 'checking';
          job.status = 'running';
          job.updatedAt = clock.now();
          this.progress(job);
          this.lastProbeAt = clock.now();
          const result = await this.probe(candidate);
          if (this.stopped) break;
          candidate.attempts = (candidate.attempts || 0) + 1;
          const verdict = this.record(candidate.id, result, job.id);
          Object.assign(candidate, verdict, {
            cached: 'cached' in verdict && verdict.cached === true,
          });
          const retry = scannerRetryPlan(
            verdict,
            candidate.attempts,
            clock.now(),
            this.deps.config.scanner.retryDelayMs,
          );
          if (retry) Object.assign(candidate, retry);
          else candidate.retryAt = 0;
        }
        job.updatedAt = clock.now();
        this.progress(job);
        /* Se pudo cancelar durante la sonda (server.js:3525); `advance` ya no hace nada entonces. */
        this.advance(job);
      }
    } finally {
      this.busy = false;
      if (this.queue.length && !this.stopped) queueMicrotask(() => this.kick());
    }
  }

  // --- Poda y fugas ---

  /** `pruneScannerState` (server.js:3362-3374), sin los marcadores (son de football). */
  private prune(now: number): void {
    const ttl = this.deps.config.scanner.jobTtlMs;
    for (const [id, job] of this.jobs) {
      if (now - job.updatedAt <= ttl) continue;
      this.deps.clock.clearTimeout(job.retryTimer);
      job.retryTimer = null;
      this.jobs.delete(id);
      if (job.clientKey && this.clients.get(job.clientKey) === id)
        this.clients.delete(job.clientKey);
      /* Un trabajo vivo que se poda avisa como cancelado: así un informe no
         se queda en `checking` para siempre (backend-modulos §8.2.11). */
      if (isLive(job)) {
        job.status = 'cancelled';
        job.parked = false;
        this.announceDone(job);
      }
    }
    this.verdicts.prune(now);
    this.pruneLeaks(now);
  }

  private pruneLeaks(now: number): void {
    while (this.leaks.length && now - (this.leaks[0] as number) > SCANNER_LEAK_WINDOW_MS) {
      this.leaks.shift();
    }
    if (this.leaks.length <= SCANNER_LEAK_ALERT) this.leakWarned = false;
  }

  private noteLeak(leak: ProbeLeak): void {
    const now = this.deps.clock.now();
    this.leaks.push(now);
    this.pruneLeaks(now);
    this.deps.bus.emit('diagnostics.report', {
      cause: 'engine',
      code: 'scanner_session_leak',
      message: `el comprobador pudo dejar una sesión abierta (${leak.reason})`,
      hash: leak.hash,
    });
    if (this.leaks.length > SCANNER_LEAK_ALERT && !this.leakWarned) {
      this.leakWarned = true;
      this.deps.logger.warn(
        { leaked: this.leaks.length },
        '[scanner] más de 5 sesiones sin parar en la última hora',
      );
    }
  }
}
