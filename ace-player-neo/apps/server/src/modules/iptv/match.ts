/* Emparejado IPTV ↔ canales pedidos (docs/iptv.md §4.3 y §4.4). Puro.

   1. Canales pedidos: los de la resolución (8 como mucho) o el título del
      canal suelto (`scope=channel`).
   2. Para cada canal y cada grupo preseleccionado por palabras se puntúa con
      la MISMA función de la resolución (`scoreResolutionCandidate`, que se
      inyecta: `scorer`) sobre `{ title: base, alias: tvgId }`. Así se hereda
      la protección Hypermotion (≤ 58), la regla de los números y la de la
      familia. Además se puntúa el canal pedido con la grafía de la IPTV
      («La Liga» → «LaLiga») y, si NO lleva número y la entrada acaba en
      « 1», la entrada sin ese « 1». Nunca al revés, y nunca con la marca
      paraguas («DAZN», la de la familia 78: «DAZN» no es «DAZN 1»).
   3. Umbral estricto: 92. Mejor no emparejar que emparejar mal.
   4. Filtro de país: solo ES o sin país.
   5. Un cartel por grupo: la mejor variante (no HEVC, fhd > hd > uhd > sd,
      no reserva, fiabilidad, orden) y hasta 2 variantes de respaldo (la mejor
      reserva incluida si existe) que no salen del servidor. */

import { IPTV_MAX_BACKUP_VARIANTS, IPTV_MIN_SCORE, channelAllowsFamilyFallback } from '@ace/shared';
import type { Catalog, CatalogEntry } from './catalog.js';
import { compareVariants } from './catalog.js';
import { iptvSpelling } from './names.js';

/** Lo que devuelve la función de puntuación de la resolución. */
export interface ChannelScore {
  readonly score: number;
  readonly matchedChannel: string;
  readonly soloFamilia: boolean;
}

/** `scoreResolutionCandidate` (football/resolution.ts) o una equivalente. */
export type ChannelScorer = (
  channels: readonly string[],
  item: { readonly id: string; readonly title: string; readonly alias?: string | null },
) => ChannelScore;

export interface IptvMatchOptions {
  readonly scorer: ChannelScorer;
  readonly minScore?: number;
  /** Fiabilidad aprendida de un id (Wilson), para ordenar variantes. */
  readonly reliability?: (id: string) => number | null;
  /** Países que valen (por defecto ES o sin país). */
  readonly countryOk?: (country: string | null) => boolean;
}

export interface IptvGroupMatch {
  readonly key: string;
  readonly best: CatalogEntry;
  /** Respaldo del relé (como mucho 2), de mejor a peor. */
  readonly variants: readonly CatalogEntry[];
  readonly score: number;
  readonly matchedChannel: string;
  readonly guide: boolean;
}

export const defaultCountryOk = (country: string | null): boolean =>
  country === null || country === 'ES';

/**
 * Mejor variante de un grupo y sus respaldos (docs/iptv.md §4.3). La
 * fiabilidad desempata después de HEVC, calidad y reserva.
 */
export function pickVariants(
  entries: readonly CatalogEntry[],
  reliability?: (id: string) => number | null,
): { best: CatalogEntry; variants: CatalogEntry[] } | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => {
    if (a.hevc !== b.hevc || a.quality !== b.quality || a.backup !== b.backup) {
      return compareVariants(a, b);
    }
    const ra = reliability?.(a.id) ?? null;
    const rb = reliability?.(b.id) ?? null;
    if (ra !== null && rb !== null && ra !== rb) return rb - ra;
    return a.order - b.order;
  });
  const [best, ...rest] = sorted as [CatalogEntry, ...CatalogEntry[]];
  const variants: CatalogEntry[] = [];
  const bestBackup = rest.find((entry) => entry.backup);
  for (const entry of rest) {
    if (variants.length >= IPTV_MAX_BACKUP_VARIANTS) break;
    if (entry.backup && entry !== bestBackup) continue;
    variants.push(entry);
  }
  if (bestBackup && !variants.includes(bestBackup)) {
    if (variants.length >= IPTV_MAX_BACKUP_VARIANTS) variants.pop();
    variants.push(bestBackup);
  }
  return { best, variants };
}

const HAS_DIGIT = /\d/;
const TRAILING_ONE = /\s+1$/;

/* Mejor puntuación de una entrada contra UN canal pedido. */
function scoreAgainst(scorer: ChannelScorer, channel: string, entry: CatalogEntry): number {
  const alias = entry.tvgId || null;
  const spelled = iptvSpelling(channel);
  const asked = spelled === channel ? [channel] : [channel, spelled];
  let best = 0;
  for (const wanted of asked) {
    best = Math.max(best, scorer([wanted], { id: entry.id, title: entry.base, alias }).score);
    /* Nunca con la marca paraguas («DAZN» no es «DAZN 1»). */
    if (
      !HAS_DIGIT.test(wanted) &&
      !channelAllowsFamilyFallback(wanted) &&
      TRAILING_ONE.test(entry.base)
    ) {
      const without = entry.base.replace(TRAILING_ONE, '');
      best = Math.max(best, scorer([wanted], { id: entry.id, title: without, alias: null }).score);
    }
  }
  return best;
}

/**
 * Grupos IPTV que casan (≥ 92) con alguno de los canales, de mejor a peor
 * puntuación. Sin tope: el de 2 lo aplica quien junta con la guía.
 */
export function matchIptvChannels(
  catalog: Catalog,
  channels: readonly string[],
  options: IptvMatchOptions,
): IptvGroupMatch[] {
  const minScore = options.minScore ?? IPTV_MIN_SCORE;
  const countryOk = options.countryOk ?? defaultCountryOk;
  const wanted = channels.map((channel) => channel.trim()).filter(Boolean);
  if (!wanted.length) return [];
  const out: IptvGroupMatch[] = [];
  for (const key of catalog.preselect(wanted)) {
    const entries = catalog.group(key).filter((entry) => countryOk(entry.country));
    const representative = entries[0];
    if (!representative) continue;
    let score = 0;
    let matchedChannel = wanted[0] as string;
    for (const channel of wanted) {
      const value = scoreAgainst(options.scorer, channel, representative);
      if (value > score) {
        score = value;
        matchedChannel = channel;
      }
    }
    if (score < minScore) continue;
    const picked = pickVariants(entries, options.reliability);
    if (!picked) continue;
    out.push({ key, ...picked, score, matchedChannel, guide: false });
  }
  return out.sort((a, b) => b.score - a.score || a.best.order - b.best.order);
}
