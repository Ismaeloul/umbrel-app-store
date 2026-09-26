/* Emparejado IPTV ↔ canales pedidos (docs/iptv.md §4.3 y §4.4). Puro.

   1. Canales pedidos: los de la resolución (8 como mucho) o el título del
      canal suelto (`scope=channel`), sin las plataformas de internet («RTVE
      Play») y sin la cadena del final («La 1 TVE» → «La 1»; `iptvAskedChannel`).
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

import {
  IPTV_MAX_BACKUP_VARIANTS,
  IPTV_MIN_SCORE,
  channelAllowsFamilyFallback,
  normalizeChannelKey,
} from '@ace/shared';
import type { Catalog, CatalogEntry } from './catalog.js';
import { compareVariants, hasUrlMacros } from './catalog.js';
import { cleanIptvTitle, iptvAskedChannel, iptvSpelling } from './names.js';

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
 * fiabilidad desempata después de HEVC, macros sin sustituir, calidad y reserva.
 */
export function pickVariants(
  entries: readonly CatalogEntry[],
  reliability?: (id: string) => number | null,
): { best: CatalogEntry; variants: CatalogEntry[] } | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => {
    if (
      a.hevc !== b.hevc ||
      hasUrlMacros(a.ref) !== hasUrlMacros(b.ref) ||
      a.quality !== b.quality ||
      a.backup !== b.backup
    ) {
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
const TRAILING_NOTE = /\s*\(([^()]*)\)\s*$/u;
/* Una nota que distingue canales no se quita nunca: «LaLiga TV (Hypermotion)» NO es «LaLiga TV». */
const DISTINCTIVE_NOTE =
  /\d|hyper|smartbank|segunda|liga|champions|campeones|europa|conference|premier|copa|f1|moto|femen|women|bar\b|ppv|evento|uhd|4k/iu;

/**
 * El nombre sin la nota entre paréntesis del final cuando es la cadena o la plataforma: «TV Canaria (RTVC)» →
 * «TV Canaria», «Castilla-La Mancha Media (CMM)» → «Castilla-La Mancha Media». Una nota con números, una
 * competición o un deporte se queda. Solo para puntuar contra la agenda: el nombre que se enseña y la clave del
 * grupo no cambian.
 */
export function withoutTrailingNote(name: string): string {
  const note = TRAILING_NOTE.exec(name);
  if (!note || DISTINCTIVE_NOTE.test(note[1] ?? '')) return name;
  return name.slice(0, note.index).trim() || name;
}

/* Mejor puntuación de una entrada contra UN canal pedido. */
function scoreAgainst(
  scorer: ChannelScorer,
  channel: string,
  entry: CatalogEntry,
  base: string,
): number {
  const alias = entry.tvgId || null;
  const spelled = iptvSpelling(channel);
  const asked = spelled === channel ? [channel] : [channel, spelled];
  let best = 0;
  const bare = withoutTrailingNote(base);
  for (const wanted of asked) {
    best = Math.max(best, scorer([wanted], { id: entry.id, title: base, alias }).score);
    /* La cadena entre paréntesis del final («TV Canaria (RTVC)») no la pone la agenda. */
    if (bare !== base) {
      best = Math.max(best, scorer([wanted], { id: entry.id, title: bare, alias: null }).score);
    }
    /* Nunca con la marca paraguas («DAZN» no es «DAZN 1»). */
    if (
      !HAS_DIGIT.test(wanted) &&
      !channelAllowsFamilyFallback(wanted) &&
      TRAILING_ONE.test(base)
    ) {
      const without = base.replace(TRAILING_ONE, '');
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
  const wanted = [
    ...new Set(
      channels
        .map((channel) => iptvAskedChannel(channel))
        .filter((channel): channel is string => Boolean(channel)),
    ),
  ];
  if (!wanted.length) return [];
  const out: IptvGroupMatch[] = [];
  for (const key of catalog.preselect(wanted)) {
    const entries = catalog.group(key).filter((entry) => countryOk(entry.country));
    const representative = entries[0];
    if (!representative) continue;
    let score = 0;
    let matchedChannel = wanted[0] as string;
    /* `base` se calcula una vez por grupo (es un getter con la limpieza del nombre). */
    const base = representative.base;
    for (const channel of wanted) {
      const value = scoreAgainst(options.scorer, channel, representative, base);
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

/**
 * La regla única de «es el mismo canal» del buscador, la búsqueda inversa y
 * el re-emparejado (docs/iptv.md §14.3). Puntúa `other` contra `base` con la
 * función de la resolución (`scorer`, que trae Hypermotion ≤ 58, la regla de
 * los números y la de la familia): tal cual, con la grafía de la IPTV y, si
 * no dice otro país, limpio como un nombre IPTV («DAZN LA LIGA 1080» →
 * «DAZN LaLiga»). Con la regla del « 1» final de §4.2 en los dos sentidos
 * (nunca con la marca paraguas: «DAZN» no es «DAZN 1»). «Es el mismo» es
 * ≥ `IPTV_MIN_SCORE` (92).
 */
export function sameChannelScore(base: string, other: string, scorer: ChannelScorer): number {
  const wanted = base.trim();
  const text = other.trim();
  if (!wanted || !text) return 0;
  const variants = new Set([text, iptvSpelling(text)]);
  const clean = cleanIptvTitle(text);
  if (clean.display && (clean.country === null || clean.country === 'ES')) variants.add(clean.base);
  const score = (a: string, b: string): number => scorer([a], { id: '', title: b }).score;
  let best = 0;
  for (const variant of variants) best = Math.max(best, score(wanted, variant));
  if (best >= 100) return best;
  const baseKey = normalizeChannelKey(iptvSpelling(wanted));
  const otherKey = clean.key || normalizeChannelKey(text);
  /* « 1» final: «M+ LaLiga TV 1» es «M+ LaLiga TV» si el otro no lleva número. */
  if (
    !HAS_DIGIT.test(baseKey) &&
    !channelAllowsFamilyFallback(wanted) &&
    TRAILING_ONE.test(otherKey)
  ) {
    best = Math.max(best, score(wanted, otherKey.replace(TRAILING_ONE, '')));
  }
  if (
    !HAS_DIGIT.test(otherKey) &&
    !channelAllowsFamilyFallback(otherKey) &&
    TRAILING_ONE.test(baseKey)
  ) {
    best = Math.max(best, score(baseKey.replace(TRAILING_ONE, ''), otherKey));
  }
  return best;
}

/** ¿Es `other` el mismo canal que `base`? (≥ 92, docs/iptv.md §14.3). */
export function sameChannel(base: string, other: string, scorer: ChannelScorer): boolean {
  return sameChannelScore(base, other, scorer) >= IPTV_MIN_SCORE;
}
