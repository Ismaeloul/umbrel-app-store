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
   (`matchId` null), `scope: 'channel'` con su nombre y, como la ficha
   (sources/session.ts `reverseChannel`), la búsqueda inversa en AceStream
   (`engine: '1'`): de fondo si hay pocas AceStream, y esperándola con «Buscar
   más fuentes».

   Una resolución a la vez por sala, numeradas: solo la última que se lanzó
   guarda lo suyo (una vieja que acaba tarde no pisa a la nueva). «Buscar más
   fuentes» tampoco se repite: si ya hay una en marcha se espera esa, y entre
   dos de la misma sala pasan al menos `LIVE_RESEARCH_MIN_MS`. */

import {
  IPTV_SEARCH,
  type PartyLive,
  type PartyLiveSourcesResponse,
  type ResolutionCandidate,
  type ScanJob,
} from '@ace/shared';
import type { Clock } from '../../core/clock.js';
import type { FootballService } from '../football/types.js';
import type { ScannerService } from '../scanner/types.js';

/** Cuánto vale lo resuelto para una sala (luego se vuelve a resolver). */
export const LIVE_SOURCES_TTL_MS = 3 * 60_000;
/** Entre dos «Buscar más fuentes» de la misma sala (la búsqueda completa es cara). */
export const LIVE_RESEARCH_MIN_MS = 15_000;

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

/** Lo que ya había y, al final, lo nuevo sin repetir (lo comprobado no se reordena). */
function merge(
  base: readonly ResolutionCandidate[],
  extra: readonly ResolutionCandidate[],
): ResolutionCandidate[] {
  const known = new Set(base.map((candidate) => candidate.id.toLowerCase()));
  const fresh = extra.filter((candidate) => !known.has(candidate.id.toLowerCase()));
  return [...base, ...fresh];
}

const aceCount = (candidates: readonly ResolutionCandidate[]): number =>
  candidates.filter((candidate) => candidate.source !== 'iptv').length;

interface Running {
  readonly key: string;
  readonly promise: Promise<LiveSourcesEntry>;
}

export function createLiveSources(deps: LiveSourcesDeps): LiveSources {
  const { clock, football, scanner } = deps;
  const entries = new Map<string, LiveSourcesEntry>();
  /* La última resolución en marcha por sala: dos que piden a la vez esperan la misma. */
  const pending = new Map<string, Running>();
  /* «Buscar más fuentes» en marcha por sala, y cuándo empezó la última. */
  const researching = new Map<string, Running>();
  const researchAt = new Map<string, number>();
  /* El número de la última resolución lanzada por sala: solo esa guarda. */
  const generations = new Map<string, number>();

  function nextGeneration(code: string): number {
    const gen = (generations.get(code) ?? 0) + 1;
    generations.set(code, gen);
    return gen;
  }

  const isLatest = (code: string, gen: number): boolean => generations.get(code) === gen;

  function jobOf(id: string | null): ScanJob | null {
    if (!id || !scanner) return null;
    try {
      return scanner.job(id, { playableOn: true });
    } catch {
      /* Olvidado o caducado: la lista se enseña sin comprobador. */
      return null;
    }
  }

  function queryOf(code: string, live: PartyLive, research: boolean) {
    const client = partyClientKey(code);
    const channel = channelOfLive(live.channel);
    return live.matchId
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
        };
  }

  /** La búsqueda inversa de un canal suelto (`engine: '1'`), como la ficha. */
  function reverse(code: string, live: PartyLive, research: boolean) {
    return football.resolve({ ...queryOf(code, live, research), engine: '1' });
  }

  /** De fondo: si sigue siendo lo último de la sala, se suman las AceStream que encuentre. */
  async function reverseLater(code: string, live: PartyLive, gen: number): Promise<void> {
    let result: Awaited<ReturnType<typeof reverse>>;
    try {
      result = await reverse(code, live, false);
    } catch {
      return;
    }
    if (!isLatest(code, gen)) return;
    const current = entries.get(code);
    if (!current || current.key !== keyOf(live)) return;
    entries.set(code, {
      ...current,
      candidates: merge(current.candidates, result.candidates),
      /* El trabajo nuevo (misma clave) ha sustituido al anterior en el comprobador. */
      jobId: result.scan?.id ?? current.jobId,
    });
  }

  async function resolve(
    code: string,
    live: PartyLive,
    research: boolean,
    gen: number,
  ): Promise<LiveSourcesEntry> {
    const key = keyOf(live);
    const result = await football.resolve(queryOf(code, live, research));
    let candidates: readonly ResolutionCandidate[] = result.candidates;
    let jobId = result.scan?.id ?? null;
    const loose = !live.matchId;
    if (loose && research && isLatest(code, gen)) {
      /* «Buscar más fuentes» en un canal suelto: también en AceStream, y se espera. */
      try {
        const extra = await reverse(code, live, true);
        candidates = merge(candidates, extra.candidates);
        jobId = extra.scan?.id ?? jobId;
      } catch {
        /* Sin la inversa: lo que ya había. */
      }
    }
    const entry: LiveSourcesEntry = { key, at: clock.now(), candidates, jobId };
    if (!isLatest(code, gen)) {
      /* Hay otra más nueva: esta no pisa lo suyo (ni su trabajo). */
      const newer = entries.get(code);
      return newer?.key === key ? newer : entry;
    }
    entries.set(code, entry);
    if (loose && !research && aceCount(candidates) < IPTV_SEARCH.reverseBelowAce) {
      void reverseLater(code, live, gen);
    }
    return entry;
  }

  function launch(code: string, live: PartyLive, research: boolean): Promise<LiveSourcesEntry> {
    const key = keyOf(live);
    const gen = nextGeneration(code);
    const promise = resolve(code, live, research, gen);
    const running = { key, promise };
    pending.set(code, running);
    if (research) researching.set(code, running);
    const clean = (): void => {
      if (pending.get(code) === running) pending.delete(code);
      if (researching.get(code) === running) researching.delete(code);
    };
    promise.then(clean, clean);
    return promise;
  }

  return {
    async get(code, live, options = {}) {
      const key = keyOf(live);
      const cached = entries.get(code);
      const now = clock.now();
      /* El sondeo del comprobador: solo un trabajo de esta sala, nunca uno cualquiera. */
      if (options.job) {
        if (cached?.key === key && cached.jobId === options.job) {
          return { candidates: [...cached.candidates], scan: jobOf(cached.jobId) };
        }
        /* Otro partido u otro trabajo: lo que hay ahora (se resuelve si hace falta, abajo). */
      }
      let entry: LiveSourcesEntry;
      if (options.research) {
        const running = researching.get(code);
        const last = researchAt.get(code) ?? Number.NEGATIVE_INFINITY;
        if (running && running.key === key) {
          entry = await running.promise;
        } else if (cached?.key === key && now - last < LIVE_RESEARCH_MIN_MS) {
          /* Otra «Buscar más fuentes» hace nada: lo que trajo esa (o lo que esté en marcha). */
          const other = pending.get(code);
          entry = other && other.key === key ? await other.promise : cached;
        } else {
          researchAt.set(code, now);
          entry = await launch(code, live, true);
        }
      } else if (cached?.key === key && now - cached.at < LIVE_SOURCES_TTL_MS) {
        entry = cached;
      } else {
        const running = pending.get(code);
        entry =
          running && running.key === key ? await running.promise : await launch(code, live, false);
      }
      return { candidates: [...entry.candidates], scan: jobOf(entry.jobId) };
    },
    cached(code) {
      return entries.get(code) ?? null;
    },
    forget(code) {
      entries.delete(code);
      pending.delete(code);
      researching.delete(code);
      researchAt.delete(code);
      /* Lo que aún esté en marcha ya no guarda nada. */
      nextGeneration(code);
    },
  };
}
