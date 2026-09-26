/* La capa IPTV de la resolución, pura (docs/iptv.md §4.3 a §4.5): por nombre
   (match.ts) y por la guía (guide-match.ts), juntas y en orden. La usan el
   servicio y el ensayo (`iptv-ensayo`), que así dicen exactamente lo mismo. */

import {
  IPTV_GUIDE_SCORE,
  IPTV_MAX_CANDIDATES,
  IPTV_MAX_GUIDE_HINTS,
  IPTV_MAX_MATCHED_CHANNELS,
  channelMatchScore,
} from '@ace/shared';
import type { Catalog } from './catalog.js';
import type { GuideWindow, StoredProgramme } from './guide.js';
import { confirmByGuide, type GuideChannelCandidate } from './guide-match.js';
import {
  groupMatch,
  matchIptvChannels,
  withoutTrailingNote,
  type ChannelScorer,
  type IptvGroupMatch,
  type VariantOptions,
} from './match.js';
import { iptvAskedChannel } from './names.js';
import type { IptvProgramInput } from './types.js';

/** Canales IPTV confirmados por la guía para un partido. */
export function guideGroupMatches(
  catalog: Catalog,
  window: GuideWindow | null,
  program: IptvProgramInput,
  options: VariantOptions = {},
): IptvGroupMatch[] {
  if (!window || program.start === null || !program.home || !program.away) return [];
  const groups = new Map<string, StoredProgramme[]>();
  for (const [channel, programmes] of window.byChannel) {
    for (const key of catalog.groupsByTvgId(channel)) {
      const bucket = groups.get(key) ?? [];
      bucket.push(...programmes);
      groups.set(key, bucket);
    }
  }
  const candidates: GuideChannelCandidate[] = [];
  for (const [key, programmes] of groups) {
    const entries = catalog.group(key);
    const best = entries[0];
    if (!best) continue;
    /* País: ES explícito en alguna variante; si no, el de la mejor. */
    const country = entries.some((entry) => entry.country === 'ES') ? 'ES' : best.country;
    candidates.push({ key, display: best.display, country, programmes });
  }
  /* Los canales de la agenda como los busca la IPTV: «La 1 TVE» es «La 1» y «RTVE Play» no cuenta. */
  const asked = program.channels
    .map((channel) => iptvAskedChannel(channel))
    .filter((channel): channel is string => Boolean(channel));
  const agendaScore = (display: string): number => {
    const bare = withoutTrailingNote(display);
    return asked.reduce(
      (max, channel) =>
        Math.max(max, channelMatchScore(channel, display), channelMatchScore(channel, bare)),
      0,
    );
  };
  const confirmed = confirmByGuide(
    {
      home: program.home,
      away: program.away,
      competition: program.competition,
      title: program.title,
      start: program.start,
      channels: program.channels,
    },
    candidates,
    { agendaScore },
  );
  const out: IptvGroupMatch[] = [];
  for (const item of confirmed) {
    /* La guía exige España (§4.5.5): su canal es el de España o sin país; si no hay, el primero. */
    const bucket = catalog.buckets(item.key)[0];
    if (!bucket) continue;
    const match = groupMatch(
      item.key,
      bucket.bucket,
      bucket.entries,
      { score: IPTV_GUIDE_SCORE, matchedChannel: item.display, guide: true },
      options,
    );
    if (match) out.push(match);
  }
  return out;
}

export interface IptvLayerResult {
  /**
   * Los canales con sitio, primero los de la guía, cada uno con los carteles
   * que le tocan: 4 carteles en total como mucho (§17).
   */
  readonly matches: readonly IptvGroupMatch[];
  /** Nombres de canal confirmados por la guía (pistas para AceStream). */
  readonly hints: readonly string[];
}

/**
 * Reparte los 4 carteles IPTV entre los canales, ya en orden (§17): los 2
 * primeros canales «de verdad» tienen uno asegurado cada uno (el gemelo de
 * otro país de un canal que ya está, «DE: DAZN 1» con «DAZN 1», no cuenta:
 * solo entra si sobra sitio) y el resto se llena en orden, así el primer
 * canal enseña todas sus resoluciones. Lo que no cabe pasa a respaldo.
 */
export function allotPosters(ordered: readonly IptvGroupMatch[]): IptvGroupMatch[] {
  const withSpain = new Set(ordered.filter((match) => match.bucket === '').map((m) => m.key));
  const twin = (match: IptvGroupMatch): boolean => match.bucket !== '' && withSpain.has(match.key);
  const counts = new Map<IptvGroupMatch, number>();
  let left = IPTV_MAX_CANDIDATES;
  for (const match of ordered.filter((item) => !twin(item)).slice(0, IPTV_MAX_MATCHED_CHANNELS)) {
    if (left <= 0) break;
    counts.set(match, 1);
    left -= 1;
  }
  for (const match of ordered) {
    while (left > 0 && (counts.get(match) ?? 0) < match.posters.length) {
      counts.set(match, (counts.get(match) ?? 0) + 1);
      left -= 1;
    }
  }
  return ordered
    .filter((match) => (counts.get(match) ?? 0) > 0)
    .map((match) => {
      const count = counts.get(match) as number;
      if (count >= match.posters.length) return match;
      return {
        ...match,
        posters: match.posters.slice(0, count),
        hidden: [...match.posters.slice(count), ...match.hidden],
      };
    });
}

/** Junta la guía y el nombre: un canal una vez (la guía primero) y 4 carteles como mucho (§17). */
export function mergeIptvMatches(
  byGuide: readonly IptvGroupMatch[],
  byName: readonly IptvGroupMatch[],
): IptvLayerResult {
  const merged = new Map<string, IptvGroupMatch>();
  const id = (match: IptvGroupMatch): string => `${match.key}\u0000${match.bucket}`;
  for (const match of byGuide) merged.set(id(match), match);
  for (const match of byName) if (!merged.has(id(match))) merged.set(id(match), match);
  const ordered = [...merged.values()].sort(
    (a, b) =>
      Number(b.guide) - Number(a.guide) ||
      b.score - a.score ||
      Number(a.bucket !== '') - Number(b.bucket !== '') ||
      a.best.order - b.best.order,
  );
  return {
    matches: allotPosters(ordered),
    hints: byGuide.slice(0, IPTV_MAX_GUIDE_HINTS).map((match) => match.best.display),
  };
}

/** Capa entera sin caché (el ensayo; el servicio cachea la parte de la guía). */
export function iptvLayer(
  catalog: Catalog,
  window: GuideWindow | null,
  channels: readonly string[],
  program: IptvProgramInput | null,
  scorer: ChannelScorer,
): IptvLayerResult {
  const byName = matchIptvChannels(catalog, channels, { scorer });
  const byGuide = program ? guideGroupMatches(catalog, window, program) : [];
  return mergeIptvMatches(byGuide, byName);
}
