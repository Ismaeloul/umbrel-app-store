/* Vigilante del motor principal (arquitectura §5.5).

   En la 0.6.59 el backend no guardaba ningún estado del motor: preguntaba
   en cada `/api/engine/status` (server.js:4949-4953) y la histéresis la hacía
   el navegador (`motorSinRespuesta`, index.html:4238-4245, B-011). Aquí la
   hace el backend para todos los clientes:

   - `get_version` cada 10 s (3 s de plazo, lo pone el cliente);
   - histéresis: `offline` tras 2 fallos seguidos con alguien viendo y 3 sin
     nadie; `online` tras 2 aciertos seguidos. Un solo silencio NO pone el
     motor `offline` (B-011). Recién arrancado (`unknown`) manda la primera
     respuesta: "unknown" es "todavía no se ha preguntado";
   - `engine.status` en el bus SOLO al cambiar de estado;
   - motor que responde pero no entrega: con alguien viendo, 60 s seguidos de
     estadísticas que no avanzan (`stat_url` que no contesta, o `dl` con
     pares y velocidad 0 sin que crezca `downloaded`) sin ninguna buena en
     medio. Una fuente sin pares (`prebuf`, 0 pares) NO cuenta: es de la
     fuente, no del motor;
   - reinicio automático vía engine_control solo con alguien viendo y el motor
     60 s `offline`, 3 aperturas seguidas fallidas por culpa del motor o 60 s
     sin entregar; esperas de 1, 2 y 4 min entre reinicios y como mucho 3 por
     hora (al agotarse: aviso en diagnóstico y `autoRestarts.exhausted` para
     la salud);
   - reinicio manual con su enfriamiento de 15 s (`restart_cooldown`, marcado
     ANTES de llamar, server.js:4683), que no gasta el cupo automático;
   - tras reiniciar, `restarting` hasta 2 `get_version` buenos seguidos (90 s
     como máximo; si no, `offline`); el paso a `online` es la señal para que
     playback reabra los canales (`stream.reopened`). */

import {
  ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
  ENGINE_WATCHDOG,
  type EngineState,
  type EngineStatus,
} from '@ace/shared';
import type { DomainBus, Unsubscribe } from '../../core/bus.js';
import type { Clock, TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { EngineStat } from './types.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Ritmo de sondeo mientras se espera a que el motor vuelva (tras un reinicio
 * o con un visor esperando). Con los 10 s normales, las 2 respuestas buenas
 * tardarían 20 s en llegar. Vive en @ace/shared desde el paso 1.3.
 */
export const READY_POLL_MS = ENGINE_WATCHDOG.readyPollMs;

/** Cuánto tiempo sin entregar datos se da por motor colgado (@ace/shared desde el paso 1.3). */
export const STALL_AFTER_MS = ENGINE_WATCHDOG.stalledAfterMs;

/** Sesiones cuyo `downloaded` se recuerda para ver si crece. */
const MAX_TRACKED_STATS = 32;

export interface WatchdogProbeResult {
  readonly ok: boolean;
  /** Cuerpo de `get_version` (para el `raw` de /api/engine/status). */
  readonly raw: string;
  readonly version: string | null;
}

export type AutoRestartReason = 'offline' | 'open_failures' | 'stalled';

export interface EngineWatchdogDeps {
  readonly clock: Clock;
  readonly bus: DomainBus;
  readonly logger: Logger;
  /** Una pregunta a `get_version`; no debería lanzar (si lanza, cuenta como fallo). */
  probe(signal: AbortSignal): Promise<WatchdogProbeResult>;
  /** POST a engine_control; lanza `restart_failed`. */
  restart(): Promise<void>;
}

interface ReadyWaiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly timer: TimerHandle;
  readonly cleanup: () => void;
}

const REASON_TEXT: Record<AutoRestartReason, string> = {
  offline: `el motor lleva ${ENGINE_WATCHDOG.autoRestartAfterOfflineMs / 1000} s sin responder`,
  open_failures: `han fallado ${ENGINE_WATCHDOG.autoRestartAfterOpenFailures} aperturas seguidas`,
  stalled: `el motor responde pero lleva ${STALL_AFTER_MS / 1000} s sin entregar datos`,
};

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

export class EngineWatchdog {
  private state: EngineState = 'unknown';
  private since: number | null = null;
  private checkedAt: number | null = null;
  private engineVersion: string | null = null;
  private lastRaw = '';
  private successes = 0;
  private failures = 0;
  private watching = false;
  private openFailures = 0;
  private stallSince: number | null = null;
  private stallReported = false;
  private readonly downloadedByKey = new Map<string, number>();
  /** Último intento de reinicio (manual o automático): el enfriamiento de 15 s. */
  private lastRestartAttemptAt: number | null = null;
  private autoRestarts: number[] = [];
  private exhaustionReported = false;

  private started = false;
  private stopped = false;
  private interval: TimerHandle | null = null;
  private fastInterval: TimerHandle | null = null;
  private restartDeadline: TimerHandle | null = null;
  private probeInFlight: Promise<void> | null = null;
  private probeController: AbortController | null = null;
  private restartInFlight: Promise<void> | null = null;
  private readonly waiters = new Set<ReadyWaiter>();
  private readonly subscriptions: Unsubscribe[] = [];

  constructor(private readonly deps: EngineWatchdogDeps) {}

  // --- ciclo de vida ---------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    const { bus, clock } = this.deps;
    this.subscriptions.push(
      bus.on('playback.activity', (activity) => this.setWatching(activity.watching)),
      /* Las estadísticas que publica playback cada 2 s: la misma evidencia que
         ve el cliente, por si las lee por otro camino. */
      bus.on('stream.stats', (stats) =>
        this.noteStat(`session:${stats.sessionId}`, {
          status: stats.status,
          peers: stats.peers,
          speedDown: stats.speedDown,
          speedUp: stats.speedUp,
          downloaded: stats.downloaded,
        }),
      ),
    );
    this.interval = clock.setInterval(() => void this.probeNow(), ENGINE_WATCHDOG.intervalMs, {
      unref: true,
    });
    void this.probeNow();
  }

  async stop(): Promise<void> {
    if (!this.started && this.stopped) return;
    this.started = false;
    this.stopped = true;
    const { clock } = this.deps;
    for (const off of this.subscriptions.splice(0)) off();
    clock.clearInterval(this.interval);
    this.interval = null;
    this.stopFastPoll();
    clock.clearTimeout(this.restartDeadline);
    this.restartDeadline = null;
    this.probeController?.abort(new Error('engine_watchdog_stopped'));
    for (const waiter of [...this.waiters]) {
      waiter.cleanup();
      waiter.reject(new AppError('engine_unavailable', { detail: 'apagando' }));
    }
    await Promise.allSettled([this.probeInFlight, this.restartInFlight]);
  }

  /** Espera a que no quede ninguna pregunta ni reinicio en marcha (tests). */
  async idle(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
      const pending = [this.probeInFlight, this.restartInFlight].filter(Boolean);
      if (!pending.length) return;
      await Promise.allSettled(pending);
    }
  }

  // --- estado ----------------------------------------------------------------

  status(): EngineStatus {
    const quota = this.quota(this.deps.clock.now());
    return {
      status: this.state,
      online: this.state === 'online',
      since: iso(this.since),
      checkedAt: iso(this.checkedAt),
      engineVersion: this.engineVersion,
      autoRestarts: {
        lastHour: quota.lastHour,
        max: ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
        nextAllowedAt: iso(quota.nextAllowedAt),
        exhausted: quota.lastHour >= ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
      },
    };
  }

  /** `/api/engine/status` de la 0.6.59: `{ online, raw }` desde la caché. */
  legacyStatus(): { online: boolean; raw: string } {
    return { online: this.state === 'online', raw: this.lastRaw.slice(0, 300) };
  }

  /** ¿Lleva el motor 60 s respondiendo sin entregar datos? (diagnóstico y tests) */
  isStalled(): boolean {
    return this.stallSince !== null && this.deps.clock.now() - this.stallSince >= STALL_AFTER_MS;
  }

  // --- sondeo ----------------------------------------------------------------

  /** Pregunta ya a `get_version` (si hay una pregunta en marcha, espera a esa). */
  probeNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.probeInFlight) return this.probeInFlight;
    const controller = new AbortController();
    this.probeController = controller;
    const run = async (): Promise<void> => {
      let result: WatchdogProbeResult;
      try {
        result = await this.deps.probe(controller.signal);
      } catch {
        result = { ok: false, raw: '', version: null };
      }
      if (this.stopped || controller.signal.aborted) return;
      this.onProbe(result);
    };
    const promise = run().finally(() => {
      if (this.probeInFlight === promise) this.probeInFlight = null;
      if (this.probeController === controller) this.probeController = null;
    });
    this.probeInFlight = promise;
    return promise;
  }

  private onProbe(result: WatchdogProbeResult): void {
    this.checkedAt = this.deps.clock.now();
    if (result.ok) {
      this.successes += 1;
      this.failures = 0;
      if (result.version) this.engineVersion = result.version;
    } else {
      this.failures += 1;
      this.successes = 0;
    }
    this.lastRaw = result.raw;
    /* Mientras engine_control está reiniciando, las respuestas se cuentan pero
       no cambian el estado: el motor se cae a propósito. */
    if (this.restartInFlight) return;
    switch (this.state) {
      case 'unknown':
        this.setState(result.ok ? 'online' : 'offline');
        break;
      case 'online': {
        const needed = this.watching
          ? ENGINE_WATCHDOG.failuresToOfflineWatching
          : ENGINE_WATCHDOG.failuresToOfflineIdle;
        if (!result.ok && this.failures >= needed) this.setState('offline');
        break;
      }
      case 'offline':
        if (result.ok && this.successes >= ENGINE_WATCHDOG.successesToOnline)
          this.setState('online');
        break;
      case 'restarting':
        if (result.ok && this.successes >= ENGINE_WATCHDOG.readySuccesses) this.setState('online');
        break;
    }
    this.evaluateAutoRestart();
  }

  private setState(next: EngineState): void {
    if (next === this.state) return;
    const previous = this.state;
    this.state = next;
    this.since = this.deps.clock.now();
    if (next !== 'restarting') {
      this.deps.clock.clearTimeout(this.restartDeadline);
      this.restartDeadline = null;
    }
    if (next === 'online') {
      for (const waiter of [...this.waiters]) {
        waiter.cleanup();
        waiter.resolve();
      }
    }
    this.updateFastPoll();
    const level = next === 'offline' ? 'warn' : 'info';
    this.deps.logger[level]({ from: previous, to: next }, 'estado del motor');
    this.deps.bus.emit('engine.status', this.status());
  }

  private updateFastPoll(): void {
    const wanted = !this.stopped && (this.state === 'restarting' || this.waiters.size > 0);
    if (wanted && !this.fastInterval) {
      this.fastInterval = this.deps.clock.setInterval(() => void this.probeNow(), READY_POLL_MS, {
        unref: true,
      });
    } else if (!wanted) {
      this.stopFastPoll();
    }
  }

  private stopFastPoll(): void {
    this.deps.clock.clearInterval(this.fastInterval);
    this.fastInterval = null;
  }

  // --- señales de fuera ------------------------------------------------------

  setWatching(watching: boolean): void {
    this.watching = watching;
    if (!watching) this.resetStall();
    else this.evaluateAutoRestart();
  }

  reportOpenFailure(): void {
    this.openFailures += 1;
    this.evaluateAutoRestart();
  }

  reportOpenSuccess(): void {
    this.openFailures = 0;
  }

  /** Estadística leída: si avanza, el motor entrega; si no, puede estar colgado. */
  noteStat(key: string, stat: EngineStat): void {
    const previous = this.downloadedByKey.get(key);
    if (stat.downloaded !== null) {
      this.downloadedByKey.delete(key);
      this.downloadedByKey.set(key, stat.downloaded);
      if (this.downloadedByKey.size > MAX_TRACKED_STATS) {
        const oldest = this.downloadedByKey.keys().next().value;
        if (oldest !== undefined) this.downloadedByKey.delete(oldest);
      }
    }
    const grew = stat.downloaded !== null && previous !== undefined && stat.downloaded > previous;
    if (stat.speedDown > 0 || grew) {
      this.resetStall();
      return;
    }
    /* `prebuf` o sin pares: problema de la fuente, no del motor. */
    if (stat.status === 'dl' && stat.peers > 0) this.noteNoDelivery();
  }

  /** `stat_url` no contestó a tiempo. */
  noteStatTimeout(_key: string): void {
    this.noteNoDelivery();
  }

  private noteNoDelivery(): void {
    if (!this.watching) return;
    this.stallSince ??= this.deps.clock.now();
  }

  private resetStall(): void {
    this.stallSince = null;
    this.stallReported = false;
  }

  // --- reinicios -------------------------------------------------------------

  /** Reinicio pedido por alguien: 15 s de enfriamiento, no gasta el cupo automático. */
  async restartManual(): Promise<{ readonly restarted: true }> {
    const now = this.deps.clock.now();
    if (
      this.restartInFlight ||
      (this.lastRestartAttemptAt !== null &&
        now - this.lastRestartAttemptAt < ENGINE_WATCHDOG.manualRestartCooldownMs)
    ) {
      throw new AppError('restart_cooldown');
    }
    /* Se marca ANTES de llamar: un intento fallido también enfría (server.js:4683). */
    this.lastRestartAttemptAt = now;
    await this.performRestart('manual', null);
    return { restarted: true };
  }

  private performRestart(kind: 'manual' | 'auto', reason: AutoRestartReason | null): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await this.deps.restart();
      } catch (error) {
        this.deps.logger.warn(
          { errorCode: 'restart_failed', kind },
          'no se pudo reiniciar el motor',
        );
        if (kind === 'auto') {
          this.deps.bus.emit('diagnostics.report', {
            cause: 'engine',
            code: 'restart_failed',
            message:
              'El reinicio automático del motor ha fallado: engine_control no respondió bien.',
          });
        }
        throw error;
      }
      this.deps.logger.info({ kind, reason }, 'motor reiniciado; esperando a que responda');
      this.successes = 0;
      this.failures = 0;
      this.openFailures = 0;
      this.resetStall();
      this.downloadedByKey.clear();
    };
    const promise = run().finally(() => {
      if (this.restartInFlight === promise) this.restartInFlight = null;
    });
    this.restartInFlight = promise;
    return promise.then(() => {
      if (this.stopped) return;
      this.setState('restarting');
      this.deps.clock.clearTimeout(this.restartDeadline);
      this.restartDeadline = this.deps.clock.setTimeout(
        () => this.onRestartDeadline(),
        ENGINE_WATCHDOG.readyMaxWaitMs,
        { unref: true },
      );
      void this.probeNow();
    });
  }

  private onRestartDeadline(): void {
    this.restartDeadline = null;
    if (this.state !== 'restarting') return;
    this.deps.bus.emit('diagnostics.report', {
      cause: 'engine',
      code: 'engine_not_ready',
      message: `El motor no ha vuelto a responder ${ENGINE_WATCHDOG.readyMaxWaitMs / 1000} s después de reiniciarlo.`,
    });
    this.setState('offline');
    this.evaluateAutoRestart();
  }

  /** Cupo de la última hora y cuándo se permite el siguiente reinicio automático. */
  private quota(now: number): { lastHour: number; nextAllowedAt: number | null } {
    this.autoRestarts = this.autoRestarts.filter((at) => now - at < HOUR_MS);
    const count = this.autoRestarts.length;
    if (count === 0) return { lastHour: 0, nextAllowedAt: null };
    const backoff = ENGINE_WATCHDOG.autoRestartBackoffMs;
    const last = this.autoRestarts[count - 1] as number;
    let next = last + (backoff[Math.min(count, backoff.length) - 1] as number);
    if (count >= ENGINE_MAX_AUTO_RESTARTS_PER_HOUR) {
      /* El que tiene que salir de la ventana de una hora para dejar sitio. */
      const oldest = this.autoRestarts[count - ENGINE_MAX_AUTO_RESTARTS_PER_HOUR] as number;
      next = Math.max(next, oldest + HOUR_MS);
    }
    return { lastHour: count, nextAllowedAt: next > now ? next : null };
  }

  private autoRestartReason(now: number): AutoRestartReason | null {
    if (
      this.state === 'offline' &&
      this.since !== null &&
      now - this.since >= ENGINE_WATCHDOG.autoRestartAfterOfflineMs
    ) {
      return 'offline';
    }
    if (this.openFailures >= ENGINE_WATCHDOG.autoRestartAfterOpenFailures) return 'open_failures';
    if (this.state === 'online' && this.isStalled()) return 'stalled';
    return null;
  }

  private evaluateAutoRestart(): void {
    if (this.stopped || !this.watching || this.restartInFlight) return;
    if (this.state === 'restarting' || this.state === 'unknown') return;
    const now = this.deps.clock.now();
    const reason = this.autoRestartReason(now);
    if (!reason) return;
    if (reason === 'stalled' && !this.stallReported) {
      this.stallReported = true;
      this.deps.logger.warn(
        { errorCode: 'engine_stalled' },
        'el motor responde pero no entrega datos',
      );
      this.deps.bus.emit('diagnostics.report', {
        cause: 'engine',
        code: 'engine_stalled',
        message: `El motor responde pero lleva ${STALL_AFTER_MS / 1000} s sin entregar datos.`,
      });
    }
    const quota = this.quota(now);
    if (quota.lastHour >= ENGINE_MAX_AUTO_RESTARTS_PER_HOUR) {
      if (!this.exhaustionReported) {
        this.exhaustionReported = true;
        this.deps.logger.warn(
          {
            errorCode: 'engine_auto_restart_exhausted',
            reason,
            nextAllowedAt: iso(quota.nextAllowedAt),
          },
          'cupo de reinicios automáticos agotado',
        );
        this.deps.bus.emit('diagnostics.report', {
          cause: 'engine',
          code: 'engine_auto_restart_exhausted',
          message:
            `El motor sigue fallando (${REASON_TEXT[reason]}) y ya se ha reiniciado ` +
            `${ENGINE_MAX_AUTO_RESTARTS_PER_HOUR} veces en la última hora: no se reinicia solo ` +
            'hasta que pase la hora. Se puede reiniciar a mano desde Ajustes.',
        });
      }
      return;
    }
    this.exhaustionReported = false;
    if (quota.nextAllowedAt !== null) return; // espera exponencial
    if (
      this.lastRestartAttemptAt !== null &&
      now - this.lastRestartAttemptAt < ENGINE_WATCHDOG.manualRestartCooldownMs
    ) {
      return;
    }
    this.autoRestarts.push(now);
    this.lastRestartAttemptAt = now;
    this.deps.logger.warn({ reason }, 'reinicio automático del motor');
    this.deps.bus.emit('diagnostics.report', {
      cause: 'engine',
      code: 'engine_auto_restart',
      message: `Reinicio automático del motor: ${REASON_TEXT[reason]}.`,
    });
    this.performRestart('auto', reason).catch(() => undefined);
  }

  // --- espera a que esté listo -----------------------------------------------

  /** Resuelve con el motor `online`; 90 s como máximo (`engine_unavailable`). */
  waitUntilReady(signal?: AbortSignal): Promise<void> {
    if (this.state === 'online' && !this.restartInFlight) return Promise.resolve();
    if (this.stopped) {
      return Promise.reject(new AppError('engine_unavailable', { detail: 'vigilante parado' }));
    }
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    const { clock } = this.deps;
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        waiter.cleanup();
        reject(signal?.reason ?? new Error('aborted'));
      };
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timer: clock.setTimeout(
          () => {
            waiter.cleanup();
            reject(
              new AppError('engine_unavailable', {
                detail: `el motor no está listo tras ${ENGINE_WATCHDOG.readyMaxWaitMs / 1000} s`,
              }),
            );
          },
          ENGINE_WATCHDOG.readyMaxWaitMs,
          { unref: true },
        ),
        cleanup: () => {
          clock.clearTimeout(waiter.timer);
          signal?.removeEventListener('abort', onAbort);
          this.waiters.delete(waiter);
          this.updateFastPoll();
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.add(waiter);
      this.updateFastPoll();
      void this.probeNow();
    });
  }
}
