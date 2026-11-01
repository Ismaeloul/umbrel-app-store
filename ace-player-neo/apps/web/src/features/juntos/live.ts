/* La sala en directo (docs/ver-juntos.md §14): de dónde sale la fuente al
   poner un partido.

   - Lo que suena para todos es un `PartyLiveChoice`: el hash, cómo se llama
     el canal («DAZN 1 · 1080p»), si es IPTV o AceStream y el partido.
   - Las fuentes de la sala que suena salen de su propia ruta
     (`partyLiveSources`, useRoomSources.ts), y el «Cambio automático si se
     cae» lo decide el servidor (party/live-auto.ts): aquí solo queda elegir
     la fuente de OTRO partido («Poner» en Partidos, crear la sala). */

import type { FootballMatch, PartyLiveChoice, ResolutionCandidate } from '@ace/shared';
import { api } from '../../api/index.ts';
import { matchTitle } from '../agenda/domain.ts';
import { channelNameOf, entryFromCandidate, isIptv, qualityLabel } from '../sources/model.ts';

/** Una fuente del partido, lista para «Poner». */
export interface LiveSource {
  readonly choice: PartyLiveChoice;
  /** El canal de la agenda con el que casó («M+ LaLiga»). */
  readonly group: string;
  /** «1080p», «720p»… o null si no se sabe. */
  readonly quality: string | null;
}

const HASH_RE = /^[a-f0-9]{40}$/;

/**
 * La clave del comprobador al elegir la fuente de otro partido. No es la del navegador: el
 * comprobador cancela el trabajo vivo de la misma clave, y con la del navegador «Poner» un
 * partido en la sala cancelaba la comprobación de la ficha (directo §14).
 */
export const PICK_CLIENT = 'party-pick';

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

/**
 * «Poner» un partido: su mejor fuente. La primera que da el servidor (la IPTV va primero) que no
 * esté reportada ni en cuarentena.
 */
export async function bestSourceOf(match: FootballMatch): Promise<PartyLiveChoice | null> {
  const data = await api('footballResolve', {
    query: {
      match: match.id,
      channel: (match.channels ?? []).map((channel) => channel.name),
      client: PICK_CLIENT,
    },
  });
  for (const candidate of data.candidates) {
    if (candidate.quarantined || candidate.reported) continue;
    const source = liveSourceOf(candidate, match);
    if (source) return source.choice;
  }
  return null;
}
