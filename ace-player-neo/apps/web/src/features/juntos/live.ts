/* La sala en directo (docs/ver-juntos.md §14): de dónde salen las fuentes y
   los partidos que puede poner quien controla.

   - Fuentes: las mismas que la ficha del partido (`footballResolve` con sus
     canales), por canal y en el orden del servidor (la mejor, primero).
   - Lo que suena para todos es un `PartyLiveChoice`: el hash, cómo se llama
     el canal («DAZN 1 · 1080p»), si es IPTV o AceStream y el partido.
   - «Cambio automático si se cae»: la siguiente fuente que aún no se ha
     probado en esta sala, saltando las de la IPTV si la que se cayó era de
     la IPTV (la plaza es una: si se fue, la otra de la IPTV tampoco va). */

import type { FootballMatch, PartyLiveChoice, ResolutionCandidate } from '@ace/shared';
import { useQuery } from '@tanstack/react-query';
import { api, getViewerId } from '../../api/index.ts';
import { matchTitle } from '../agenda/domain.ts';
import { channelNameOf, entryFromCandidate, isIptv, qualityLabel } from '../sources/model.ts';

/** Una fuente del partido, lista para «Poner». */
export interface LiveSource {
  readonly choice: PartyLiveChoice;
  /** El canal de la agenda con el que casó («M+ LaLiga»): agrupa la lista. */
  readonly group: string;
  /** «1080p», «720p»… o null si no se sabe. */
  readonly quality: string | null;
}

export interface LiveSourceGroup {
  readonly name: string;
  readonly sources: readonly LiveSource[];
}

const HASH_RE = /^[a-f0-9]{40}$/;

/** Lo que va a la sala para una fuente del partido. */
export function liveSourceOf(
  candidate: ResolutionCandidate,
  match: Pick<FootballMatch, 'id' | 'home' | 'away' | 'title'> | null,
): LiveSource | null {
  const hash = candidate.id.toLowerCase();
  if (!HASH_RE.test(hash)) return null;
  const entry = entryFromCandidate(candidate);
  const quality = qualityLabel(entry);
  const name = channelNameOf(entry) || candidate.matchedChannel || 'Canal';
  return {
    choice: {
      hash,
      channel: (quality ? `${name} · ${quality}` : name).slice(0, 120),
      source: isIptv(entry) ? 'iptv' : 'engine',
      matchId: match?.id ?? null,
      match: match ? matchTitle(match).slice(0, 200) : null,
    },
    group: candidate.matchedChannel || name,
    quality,
  };
}

/** Por canal, en el orden en que llegan (el del servidor: la mejor, primero). */
export function groupSources(sources: readonly LiveSource[]): LiveSourceGroup[] {
  const groups = new Map<string, LiveSource[]>();
  for (const source of sources) {
    const list = groups.get(source.group) ?? [];
    list.push(source);
    groups.set(source.group, list);
  }
  return [...groups].map(([name, list]) => ({ name, sources: list }));
}

/** Las fuentes de un partido para la sala (solo quien controla las pide). */
export function useLiveSources(match: FootballMatch | null, enabled: boolean) {
  return useQuery({
    queryKey: ['juntos-live-sources', match?.id ?? null],
    enabled: enabled && match !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (!match) return [];
      const data = await api('footballResolve', {
        query: {
          match: match.id,
          channel: (match.channels ?? []).map((channel) => channel.name),
          client: getViewerId(),
        },
        signal,
      });
      return data.candidates
        .map((candidate) => liveSourceOf(candidate, match))
        .filter((source): source is LiveSource => source !== null);
    },
  });
}

/**
 * «Cambio automático si se cae»: la siguiente fuente buena que no se ha
 * probado aún. Si la que se cayó era de la IPTV, las demás de la IPTV no.
 */
export function nextSource(
  sources: readonly LiveSource[],
  failed: PartyLiveChoice,
  tried: ReadonlySet<string>,
): LiveSource | null {
  return (
    sources.find(
      (source) =>
        source.choice.hash !== failed.hash &&
        !tried.has(source.choice.hash) &&
        !(failed.source === 'iptv' && source.choice.source === 'iptv'),
    ) ?? null
  );
}

/** «Poner» un partido: su mejor fuente (la primera que da el servidor). */
export async function bestSourceOf(match: FootballMatch): Promise<PartyLiveChoice | null> {
  const data = await api('footballResolve', {
    query: {
      match: match.id,
      channel: (match.channels ?? []).map((channel) => channel.name),
      client: getViewerId(),
    },
  });
  for (const candidate of data.candidates) {
    const source = liveSourceOf(candidate, match);
    if (source) return source.choice;
  }
  return null;
}
