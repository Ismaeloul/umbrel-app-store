/* La capa IPTV de la resolución, pura (docs/iptv.md §4.3 a §4.5): por nombre
   (match.ts) y por la guía (guide-match.ts), juntas y en orden. La usan el
   servicio y el ensayo (`iptv-ensayo`), que así dicen exactamente lo mismo. */

import {
  IPTV_GUIDE_SCORE,
  IPTV_MAX_CANDIDATES,
  IPTV_MAX_GUIDE_HINTS,
  channelMatchScore,
} from '@ace/shared';
import type { Catalog } from './catalog.js';
import type { GuideWindow, StoredProgramme } from './guide.js';
import { confirmByGuide, type GuideChannelCandidate } from './guide-match.js';
import {
  matchIptvChannels,
  pickVariants,
  withoutTrailingNote,
  type ChannelScorer,
  type IptvGroupMatch,
} from './match.js';
import { iptvAskedChannel } from './names.js';
import type { IptvProgramInput } from './types.js';

/** Canales IPTV confirmados por la guía para un partido. */
export function guideGroupMatches(
  catalog: Catalog,
  window: GuideWindow | null,
  program: IptvProgramInput,
  reliability?: (id: string) => number | null,
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
    const all = catalog.group(item.key);
    const entries = all.filter((entry) => entry.country === null || entry.country === 'ES');
    const picked = pickVariants(entries.length ? entries : all, reliability);
    if (!picked) continue;
    out.push({
      key: item.key,
      ...picked,
      score: IPTV_GUIDE_SCORE,
      matchedChannel: item.display,
      guide: true,
    });
  }
  return out;
}

export interface IptvLayerResult {
  /** Como mucho 2 grupos, primero los de la guía. */
  readonly matches: readonly IptvGroupMatch[];
  /** Nombres de canal confirmados por la guía (pistas para AceStream). */
  readonly hints: readonly string[];
}

/** Junta la guía y el nombre: un cartel por grupo, la guía primero, 2 como mucho. */
export function mergeIptvMatches(
  byGuide: readonly IptvGroupMatch[],
  byName: readonly IptvGroupMatch[],
): IptvLayerResult {
  const merged = new Map<string, IptvGroupMatch>();
  for (const match of byGuide) merged.set(match.key, match);
  for (const match of byName) if (!merged.has(match.key)) merged.set(match.key, match);
  const ordered = [...merged.values()].sort(
    (a, b) => Number(b.guide) - Number(a.guide) || b.score - a.score || a.best.order - b.best.order,
  );
  return {
    matches: ordered.slice(0, IPTV_MAX_CANDIDATES),
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
