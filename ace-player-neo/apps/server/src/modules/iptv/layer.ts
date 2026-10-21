/* La capa IPTV de la resolución, pura (docs/iptv.md §4.3 a §4.5): por nombre
   (match.ts) y por la guía (guide-match.ts), juntas y en orden. La usan el
   servicio y el ensayo (`iptv-ensayo`), que así dicen exactamente lo mismo. */

import {
  IPTV_GUIDE_SCORE,
  IPTV_MAX_CANDIDATES,
  IPTV_MAX_GUIDE_HINTS,
  canonicalChannelKey,
  canonicalMatchScore,
  normalizeChannelKey,
} from '@ace/shared';
import type { Catalog } from './catalog.js';
import { matchEventChannels } from './event-match.js';
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

/**
 * Los canales del catálogo con su guía (un candidato por grupo de variantes),
 * lo que mira `confirmByGuide`. Lo usan la resolución y la agenda híbrida
 * (guide-agenda.ts), que así ven exactamente lo mismo.
 */
export function guideCandidates(
  catalog: Catalog,
  window: GuideWindow | null,
): GuideChannelCandidate[] {
  if (!window) return [];
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
  return candidates;
}

/**
 * Cuánto casa el nombre de un canal IPTV con los canales que anuncia la
 * agenda, como los busca la IPTV: «La 1 TVE» es «La 1» y «RTVE Play» no
 * cuenta (reglas 5 y 6 de la guía). Por la tubería única (docs/iptv.md
 * §4.8): los únicos «Liga de Campeones» con guía de la lista real se llaman
 * «M.LALIGA DE CAMPEONES N» y con el clásico daban 58, así que la guía no
 * confirmaba nunca.
 */
export function agendaScorer(channels: readonly string[]): (display: string) => number {
  const asked = channels
    .map((channel) => iptvAskedChannel(channel))
    .filter((channel): channel is string => Boolean(channel));
  return (display: string): number => {
    const bare = withoutTrailingNote(display);
    return asked.reduce(
      (max, channel) =>
        Math.max(max, canonicalMatchScore(channel, display), canonicalMatchScore(channel, bare)),
      0,
    );
  };
}

/** Canales IPTV confirmados por la guía para un partido. */
export function guideGroupMatches(
  catalog: Catalog,
  window: GuideWindow | null,
  program: IptvProgramInput,
  options: VariantOptions = {},
): IptvGroupMatch[] {
  if (!window || program.start === null || !program.home || !program.away) return [];
  const candidates = guideCandidates(catalog, window);
  const agendaScore = agendaScorer(program.channels);
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
 * Reparte los 4 carteles IPTV entre los canales, ya en orden (§17): cada
 * CANAL PEDIDO distinto («DAZN 2» y «M+ Vamos 2» son dos; «DAZN 2» y «M+:
 * DAZN 2» son uno, docs/iptv.md §4.8) tiene un cartel asegurado mientras
 * quepan (el gemelo de otro país de un canal que ya está, «DE: DAZN 1» con
 * «DAZN 1», no cuenta: solo entra si sobra sitio) y el resto se llena en
 * orden, así el primer canal enseña todas sus resoluciones. Lo que no cabe
 * pasa a respaldo. Hasta la 0.9.8 solo los 2 primeros grupos tenían cartel
 * seguro y en Liga F cuatro «DAZN 2» se comían a «VAMOS 2».
 */
export function allotPosters(ordered: readonly IptvGroupMatch[]): IptvGroupMatch[] {
  const withSpain = new Set(ordered.filter((match) => match.bucket === '').map((m) => m.key));
  const twin = (match: IptvGroupMatch): boolean => match.bucket !== '' && withSpain.has(match.key);
  const counts = new Map<IptvGroupMatch, number>();
  const served = new Set<string>();
  let left = IPTV_MAX_CANDIDATES;
  for (const match of ordered.filter((item) => !twin(item))) {
    if (left <= 0) break;
    const channel = canonicalChannelKey(match.matchedChannel) || match.key;
    if (served.has(channel)) continue;
    served.add(channel);
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

/**
 * Junta la guía, los huecos de evento (§4.9) y el nombre: un canal una vez
 * (la guía primero, luego los eventos) y 4 carteles como mucho (§17). Las
 * pistas para AceStream salen solo de la guía: el nombre de un hueco de
 * evento no es un canal que buscar en el motor.
 */
export function mergeIptvMatches(
  byGuide: readonly IptvGroupMatch[],
  byName: readonly IptvGroupMatch[],
  byEvent: readonly IptvGroupMatch[] = [],
): IptvLayerResult {
  const merged = new Map<string, IptvGroupMatch>();
  const id = (match: IptvGroupMatch): string => `${match.key}\u0000${match.bucket}`;
  for (const match of byGuide) merged.set(id(match), match);
  for (const match of byEvent) if (!merged.has(id(match))) merged.set(id(match), match);
  for (const match of byName) if (!merged.has(id(match))) merged.set(id(match), match);
  const ordered = [...merged.values()].sort(
    (a, b) =>
      Number(b.guide) - Number(a.guide) ||
      Number(b.event === true) - Number(a.event === true) ||
      b.score - a.score ||
      Number(a.bucket !== '') - Number(b.bucket !== '') ||
      a.best.order - b.best.order,
  );
  return {
    matches: allotPosters(ordered),
    hints: guideHints(byGuide.map((match) => match.best.display)),
  };
}

/* «M+ LaLiga TV» y «M+ LaLiga TV Bar» (o «… UHD») son el mismo canal para buscarlo. */
const HINT_VARIANT_TOKENS: ReadonlySet<string> = new Set(['bar', 'hdr', 'uhd', '4k', 'fhd', 'hd']);

/** Clave de un canal sin sus coletillas de calidad o de bar (para no gastar dos pistas en uno). */
export function channelVariantKey(name: string): string {
  const key = normalizeChannelKey(name);
  return (
    key
      .split(' ')
      .filter((token) => token && !HINT_VARIANT_TOKENS.has(token))
      .join(' ') || key
  );
}

/** Las pistas de la guía para AceStream: 2 como mucho y un canal una vez (sin variantes repetidas). */
export function guideHints(displays: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const display of displays) {
    const key = channelVariantKey(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(display);
    if (out.length >= IPTV_MAX_GUIDE_HINTS) break;
  }
  return out;
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
  const byEvent = program ? matchEventChannels(catalog, program) : [];
  return mergeIptvMatches(byGuide, byName, byEvent);
}
