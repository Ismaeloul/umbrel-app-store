/* Planificador de «Arranque instantáneo» (D24). Las reglas están en plan.ts;
   aquí, el reloj, la memoria de cada partido y las llamadas a los demás
   módulos. Nunca lanza: un fallo se apunta en el registro y se reintenta en
   la vuelta siguiente (con tope por partido). */

import { motivoDeFallo } from '@ace/shared';
import type { Unsubscribe } from '../../core/bus.js';
import type { TimerHandle } from '../../core/clock.js';
import {
  INSTANT_START_FIRST_RUN_MS,
  INSTANT_START_MEMORY_MS,
  INSTANT_START_TICK_MS,
} from './constants.js';
import {
  EMPTY_MEMORY,
  chooseTarget,
  favoriteMatches,
  pickPrewarmCandidate,
  planStep,
  type FavoriteMatch,
  type MatchMemory,
} from './plan.js';
import type { InstantStartDeps, InstantStartHealth, InstantStartService } from './types.js';

export function createInstantStartRuntime(deps: InstantStartDeps): InstantStartService {
  const { bus, clock, football, playback, scanner, state } = deps;
  const logger = deps.logger.child({ module: 'instant-start' });
  const memory = new Map<string, MatchMemory & { start: number }>();
  /** Saque de cada partido preparado (para soltarlo a su hora aunque salga de la agenda). */
  const starts = new Map<string, number>();
  /* La última preparación terminada que ya se ha contado (por identidad, no por hora). */
  let lastSeen: object | null = null;
  let lastNote: string | null = null;
  let running: Promise<void> | null = null;
  let timers: TimerHandle[] = [];
  let subscriptions: Unsubscribe[] = [];
  let started = false;

  function enabled(): boolean {
    try {
      return state.instantStartEnabled();
    } catch {
      return false;
    }
  }

  function teams(): readonly string[] {
    try {
      return state.get().preferences.teams;
    } catch {
      return [];
    }
  }

  function memoryOf(match: FavoriteMatch): MatchMemory & { start: number } {
    let entry = memory.get(match.id);
    if (!entry) {
      entry = { ...EMPTY_MEMORY, start: match.start };
      memory.set(match.id, entry);
    }
    return entry;
  }

  /* Lo que playback cuenta de la última preparación: una que terminó (usada,
     cedida, caducada) no se repite para ese partido; un fallo suma. */
  function absorbOutcome(): void {
    const last = playback.prewarmInfo().last;
    if (!last || last === lastSeen) return;
    lastSeen = last;
    lastNote = last.code ? `${last.outcome}:${last.code}` : last.outcome;
    const entry = memory.get(last.matchId);
    if (!entry) return;
    if (last.outcome === 'failed') entry.failures += 1;
    else entry.done = true;
  }

  async function release(reason: 'expired' | 'disabled'): Promise<void> {
    if (!playback.prewarmInfo().active) return;
    await playback.releasePrewarm(reason);
    absorbOutcome();
  }

  async function round(): Promise<void> {
    const now = clock.now();
    for (const [id, entry] of memory) {
      if (now - entry.start > INSTANT_START_MEMORY_MS) {
        memory.delete(id);
        starts.delete(id);
      }
    }
    absorbOutcome();
    const followed = teams();
    if (!enabled() || !followed.length) {
      await release('disabled');
      return;
    }
    let payload: unknown;
    try {
      payload = await football.schedule();
    } catch (error) {
      logger.warn({ errorCode: motivoDeFallo(error) }, '[arranque] sin agenda');
      return;
    }
    const target = chooseTarget(favoriteMatches(payload, followed), now);
    const info = playback.prewarmInfo().active;
    const active = info ? { matchId: info.matchId, start: starts.get(info.matchId) ?? null } : null;
    const entry = target ? memoryOf(target) : { ...EMPTY_MEMORY };
    const step = planStep(now, target, entry, active);
    if (step.release) await release('expired');
    if (!target) return;
    starts.set(target.id, target.start);
    if (step.refresh) {
      entry.refreshed = true;
      logger.info(
        { matchId: target.id, minutes: Math.round((target.start - now) / 60_000) },
        '[arranque] resolviendo las fuentes del partido',
      );
      await football.prepareMatch(target.id, { refresh: true });
    }
    if (!step.prewarm) return;
    const prepared = await football.prepareMatch(target.id, { refresh: false });
    const candidate = prepared
      ? pickPrewarmCandidate(
          prepared.candidates,
          (hash) => {
            try {
              return scanner.verdict(hash)?.state ?? null;
            } catch {
              return null;
            }
          },
          scanner.isEnabled(),
        )
      : null;
    if (!candidate) {
      lastNote = 'skipped:no_source';
      logger.info({ matchId: target.id }, '[arranque] aún no hay una fuente que preparar');
      return;
    }
    const result = await playback.prewarm({
      hash: candidate.id,
      matchId: target.id,
      title: candidate.title,
      ih: candidate.ih,
    });
    if (result.status === 'skipped') {
      lastNote = `skipped:${result.reason}`;
      if (result.reason === 'yielded') entry.done = true;
    } else if (result.status === 'failed') {
      lastNote = `failed:${result.code}`;
    }
    absorbOutcome();
  }

  const service: InstantStartService = {
    async start() {
      if (started) return;
      started = true;
      const run = (): void => {
        void service.tick();
      };
      timers.push(
        clock.setInterval(run, INSTANT_START_TICK_MS, { unref: true }),
        clock.setTimeout(run, INSTANT_START_FIRST_RUN_MS, { unref: true }),
      );
      /* Apagar el ajuste o cambiar de equipos se nota al momento, no a los 30 s. */
      subscriptions.push(
        bus.on('state.changed', (event) => {
          if (event.scopes.includes('settings') || event.scopes.includes('preferences')) run();
        }),
      );
    },

    async stop() {
      for (const timer of timers) {
        clock.clearInterval(timer);
        clock.clearTimeout(timer);
      }
      timers = [];
      for (const off of subscriptions) off();
      subscriptions = [];
      started = false;
      await running;
    },

    tick() {
      /* Sin solapes: una vuelta que tarda (resolución) no se pisa con la siguiente. */
      if (running) return running;
      running = round()
        .catch((error: unknown) => {
          logger.warn({ errorCode: motivoDeFallo(error) }, '[arranque] fallo en la vuelta');
        })
        .finally(() => {
          running = null;
        });
      return running;
    },

    healthInfo(): InstantStartHealth {
      const on = enabled();
      const active = playback.prewarmInfo().active;
      return {
        enabled: on,
        status: !on ? 'off' : !active ? 'idle' : active.ready ? 'warm' : 'warming',
        matchId: active?.matchId ?? null,
        source: active?.source ?? null,
        last: lastNote,
      };
    },
  };
  return service;
}
