/* Las fuentes de una sala en directo (docs/ver-juntos.md §14, `partyLiveSources`).

   La misma resolución que la ficha del partido (`football.resolve`), con dos
   diferencias que importan:

   - La clave del comprobador es `party-<código>`, no la del navegador. El
     comprobador cancela el trabajo vivo anterior de una clave: con la del
     navegador, abrir Fuentes en la sala cancelaba la comprobación de la
     ficha del partido (y al revés).
   - Una caché por sala de unos minutos: varios que controlan (o el cambio
     automático) no relanzan la resolución ni un trabajo nuevo cada vez.

   Los canales del partido los pone `resolve` con la agenda (B-231). Si el
   partido ya no está en ella, se manda el canal que suena; con un canal suelto
   (`matchId` null), `scope: 'channel'` con su nombre. */

import type {
  PartyLive,
  PartyLiveSourcesResponse,
  ResolutionCandidate,
  ScanJob,
} from '@ace/shared';
import type { Clock } from '../../core/clock.js';
import type { FootballService } from '../football/types.js';
import type { ScannerService } from '../scanner/types.js';

/** Cuánto vale lo resuelto para una sala (luego se vuelve a resolver). */
export const LIVE_SOURCES_TTL_MS = 3 * 60_000;

export interface LiveSourcesDeps {
  readonly clock: Pick<Clock, 'now'>;
  readonly football: Pick<FootballService, 'resolve'>;
  readonly scanner?: Pick<ScannerService, 'job'>;
}

/** Lo que se guarda de una sala: las candidatas, su trabajo y para qué partido o canal eran. */
export interface LiveSourcesEntry {
  readonly key: string;
  readonly at: number;
  readonly candidates: readonly ResolutionCandidate[];
  readonly jobId: string | null;
}

export interface LiveSources {
  /** Las fuentes (de la caché si valen), con el estado del trabajo del comprobador. */
  get(
    code: string,
    live: PartyLive,
    options?: { readonly research?: boolean; readonly job?: string },
  ): Promise<PartyLiveSourcesResponse>;
  /** Lo último que se resolvió para la sala, aunque haya caducado (el cambio automático). */
  cached(code: string): LiveSourcesEntry | null;
  /** La sala se ha cerrado. */
  forget(code: string): void;
}

/** «DAZN 1 · 1080p» → «DAZN 1»: el canal sin la calidad que le pone la sala. */
export function channelOfLive(channel: string): string {
  return channel.split(' · ')[0]?.trim() || channel.trim();
}

/** El partido, o el canal suelto: lo que identifica qué fuentes valen. */
function keyOf(live: Pick<PartyLive, 'matchId' | 'hash'>): string {
  return live.matchId ? `m:${live.matchId}` : `c:${live.hash}`;
}

/** La clave del comprobador de la sala: no es la de ningún navegador. */
export function partyClientKey(code: string): string {
  return `party-${code}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

export function createLiveSources(deps: LiveSourcesDeps): LiveSources {
  const { clock, football, scanner } = deps;
  const entries = new Map<string, LiveSourcesEntry>();
  /* Una resolución en marcha por sala: dos que piden a la vez esperan la misma. */
  const pending = new Map<string, { key: string; promise: Promise<LiveSourcesEntry> }>();

  function jobOf(id: string | null): ScanJob | null {
    if (!id || !scanner) return null;
    try {
      return scanner.job(id, { playableOn: true });
    } catch {
      /* Olvidado o caducado: la lista se enseña sin comprobador. */
      return null;
    }
  }

  async function resolve(code: string, live: PartyLive, research: boolean) {
    const key = keyOf(live);
    const client = partyClientKey(code);
    const channel = channelOfLive(live.channel);
    const result = await football.resolve(
      live.matchId
        ? {
            match: live.matchId,
            channel: [channel],
            client,
            ...(research ? { research: '1', current: live.hash } : {}),
          }
        : {
            scope: 'channel',
            channel: [channel],
            iptv: live.hash,
            client,
            ...(research ? { research: '1' } : {}),
          },
    );
    const entry: LiveSourcesEntry = {
      key,
      at: clock.now(),
      candidates: result.candidates,
      jobId: result.scan?.id ?? null,
    };
    entries.set(code, entry);
    return entry;
  }

  return {
    async get(code, live, options = {}) {
      const key = keyOf(live);
      const cached = entries.get(code);
      /* El sondeo del comprobador: solo un trabajo de esta sala, nunca uno cualquiera. */
      if (options.job) {
        if (cached?.key === key && cached.jobId === options.job) {
          return { candidates: [...cached.candidates], scan: jobOf(cached.jobId) };
        }
        /* Otro partido u otro trabajo: lo que hay ahora (se resuelve si hace falta, abajo). */
      }
      const fresh =
        !options.research && cached?.key === key && clock.now() - cached.at < LIVE_SOURCES_TTL_MS;
      let entry: LiveSourcesEntry;
      if (fresh && cached) {
        entry = cached;
      } else {
        const running = pending.get(code);
        if (running && running.key === key && !options.research) {
          entry = await running.promise;
        } else {
          const promise = resolve(code, live, !!options.research);
          pending.set(code, { key, promise });
          try {
            entry = await promise;
          } finally {
            if (pending.get(code)?.promise === promise) pending.delete(code);
          }
        }
      }
      return { candidates: [...entry.candidates], scan: jobOf(entry.jobId) };
    },
    cached(code) {
      return entries.get(code) ?? null;
    },
    forget(code) {
      entries.delete(code);
      pending.delete(code);
    },
  };
}
