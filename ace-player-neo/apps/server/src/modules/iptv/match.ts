/* Emparejado IPTV ↔ canales pedidos (docs/iptv.md §4.3, §4.4 y §16). Puro.

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
   4. País (Isma, 26-sep: «déjalo todo desbloqueado»): no se excluye ninguno.
      España y sin país son un canal y cada otro país es otro («DE: DAZN 1» no
      es una variante de «DAZN 1»). Con la misma puntuación, el de España o sin
      país va antes: es una preferencia de orden, no un filtro. Si solo existe
      el extranjero y casa por nombre, sale.
   5. Variantes de resolución (§16, `planVariants`): de cada canal, un cartel
      por resolución (1080p, 4K, 720p, SD, en ese orden) y detrás las reservas
      y las URLs con macros; 4 como mucho. Las copias de la misma resolución
      no tienen cartel: son el respaldo del relé (`relayVariants`). */

import {
  IPTV_MAX_BACKUP_VARIANTS,
  IPTV_MAX_CANDIDATES,
  IPTV_MIN_SCORE,
  channelAllowsFamilyFallback,
  normalizeChannelKey,
} from '@ace/shared';
import type { Catalog, CatalogEntry, QualityOf } from './catalog.js';
import { compareVariants, isLastResort, nameQuality } from './catalog.js';
import {
  aceChannelTitle,
  cleanIptvTitle,
  iptvAskedChannel,
  iptvPlatform,
  iptvSpelling,
} from './names.js';

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

export interface VariantOptions {
  /** Fiabilidad aprendida de un id (Wilson), para desempatar variantes iguales. */
  readonly reliability?: ((id: string) => number | null) | undefined;
  /** La calidad que manda (la del stream real si se conoce; si no, la del nombre). */
  readonly qualityOf?: QualityOf | undefined;
}

export interface IptvMatchOptions extends VariantOptions {
  readonly scorer: ChannelScorer;
  readonly minScore?: number;
}

/** Las variantes de UN canal (mismo grupo y mismo país) repartidas en carteles y respaldo. */
export interface VariantPlan {
  /**
   * Un cartel por resolución (1080p, 4K, 720p, SD y sin marca), luego las
   * reservas y las URLs con macros, y lo que solo existe en HEVC; 4 como
   * mucho. El primero es el que arranca.
   */
  readonly posters: readonly CatalogEntry[];
  /** El resto (otra copia de una resolución que ya tiene cartel…): respaldo del relé, nunca sale. */
  readonly hidden: readonly CatalogEntry[];
}

export interface IptvGroupMatch {
  /** Clave del grupo (`normalizeChannelKey(base)`). */
  readonly key: string;
  /** '' para España o sin país; si no, el código del país. */
  readonly bucket: string;
  /** El primer cartel (el que arranca solo). */
  readonly best: CatalogEntry;
  /** Los carteles de este canal, en orden (el primero es `best`). */
  readonly posters: readonly CatalogEntry[];
  /** Variantes sin cartel (respaldo del relé). */
  readonly hidden: readonly CatalogEntry[];
  readonly score: number;
  readonly matchedChannel: string;
  readonly guide: boolean;
}

/**
 * Orden de las variantes de un canal (§16): el de `compareVariants` y, entre
 * dos iguales (misma calidad, HEVC y reserva), la fiabilidad aprendida y el
 * orden del catálogo.
 */
export function sortVariants(
  entries: readonly CatalogEntry[],
  options: VariantOptions = {},
): CatalogEntry[] {
  const qualityOf = options.qualityOf ?? nameQuality;
  return [...entries].sort((a, b) => {
    const order = compareVariants(a, b, qualityOf);
    if (
      a.hevc !== b.hevc ||
      isLastResort(a) !== isLastResort(b) ||
      qualityOf(a) !== qualityOf(b) ||
      a.backup !== b.backup
    ) {
      return order;
    }
    const ra = options.reliability?.(a.id) ?? null;
    const rb = options.reliability?.(b.id) ?? null;
    if (ra !== null && rb !== null && ra !== rb) return rb - ra;
    return a.order - b.order;
  });
}

/* Lo que distingue un cartel de otro del mismo canal: su resolución. Una reserva, una URL con macros o una copia
   HEVC de una resolución que ya tiene cartel es respaldo; con una resolución nueva (o sin marca), cartel al final. */
function posterSignature(entry: CatalogEntry, qualityOf: QualityOf): string {
  return qualityOf(entry) ?? '-';
}

/**
 * Carteles y respaldo de las variantes de un canal (§16). `entries` son las
 * variantes de UN canal (mismo grupo y mismo país). null si no hay ninguna.
 */
export function planVariants(
  entries: readonly CatalogEntry[],
  options: VariantOptions & { readonly max?: number } = {},
): VariantPlan | null {
  if (!entries.length) return null;
  const qualityOf = options.qualityOf ?? nameQuality;
  const max = Math.max(1, options.max ?? IPTV_MAX_CANDIDATES);
  const posters: CatalogEntry[] = [];
  const hidden: CatalogEntry[] = [];
  const seen = new Set<string>();
  /* HEVC solo tiene cartel si el canal no tiene otra cosa: la web no lo reproduce (D6). */
  const plain = entries.some((entry) => !entry.hevc);
  for (const entry of sortVariants(entries, options)) {
    const signature = posterSignature(entry, qualityOf);
    if (posters.length < max && !seen.has(signature) && !(entry.hevc && plain)) {
      posters.push(entry);
      seen.add(signature);
    } else hidden.push(entry);
  }
  return { posters, hidden };
}

/**
 * Lo que abre el relé para un cartel (§16 y §6.1): esa variante primero y,
 * detrás, las variantes SIN cartel que le tocan (las copias de su misma
 * resolución; las que no tienen un cartel de su resolución van detrás del
 * último), 2 como mucho. Las variantes con cartel propio no se prueban aquí:
 * si esta cae, la web pasa al siguiente cartel IPTV antes de saltar a
 * AceStream, y así se ve en qué variante estás.
 */
export function relayVariants(
  plan: VariantPlan,
  entry: CatalogEntry,
  options: Pick<VariantOptions, 'qualityOf'> = {},
): CatalogEntry[] {
  const qualityOf = options.qualityOf ?? nameQuality;
  const max = 1 + IPTV_MAX_BACKUP_VARIANTS;
  const quality = qualityOf(entry);
  if (!plan.posters.some((poster) => poster.id === entry.id)) {
    /* Un id sin cartel (un favorito antiguo, un enlace): sus copias de la misma resolución. */
    return [
      entry,
      ...plan.hidden.filter((item) => item.id !== entry.id && qualityOf(item) === quality),
    ].slice(0, max);
  }
  const last = plan.posters[plan.posters.length - 1] as CatalogEntry;
  const home = (item: CatalogEntry): CatalogEntry =>
    plan.posters.find((poster) => qualityOf(poster) === qualityOf(item) && !isLastResort(poster)) ??
    plan.posters.find((poster) => qualityOf(poster) === qualityOf(item)) ??
    last;
  return [entry, ...plan.hidden.filter((item) => home(item).id === entry.id)].slice(0, max);
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

/*
 * La marca de cadena de un nombre (docs/iptv.md §17): «movistar» (M., M+,
 * Movistar…) o «dazn», o ''. La regla del « 1» final solo vale si el canal
 * pedido y la entrada IPTV llevan la misma: «M+ LaLiga TV» no es «LA LIGA 1»
 * (el de Rakuten), aunque sin marca los dos sean «laliga».
 */
function chainBrand(name: string): string {
  const first = normalizeChannelKey(iptvSpelling(name)).split(' ')[0] ?? '';
  return first === 'movistar' || first === 'dazn' ? first : '';
}

/** ¿Es la marca paraguas sola («DAZN», sin número ni nada más)? «DAZN 1» no lo es. */
export function isUmbrellaBrand(channel: string): boolean {
  return channelAllowsFamilyFallback(channel) && !HAS_DIGIT.test(normalizeChannelKey(channel));
}

/** ¿Son todas las variantes de este canal de una plataforma de internet (VIX, Pluto TV, Rakuten…)? */
export function isPlatformChannel(entries: readonly CatalogEntry[]): boolean {
  return entries.length > 0 && entries.every((entry) => iptvPlatform(entry.title, entry.group));
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
    /* Nunca con la marca paraguas («DAZN» no es «DAZN 1») ni con otra marca de cadena
       («M+ LaLiga TV» no es «LA LIGA 1»). */
    if (
      !HAS_DIGIT.test(wanted) &&
      !channelAllowsFamilyFallback(wanted) &&
      TRAILING_ONE.test(base) &&
      (!chainBrand(wanted) || chainBrand(wanted) === chainBrand(base))
    ) {
      const without = base.replace(TRAILING_ONE, '');
      best = Math.max(best, scorer([wanted], { id: entry.id, title: without, alias: null }).score);
    }
  }
  return best;
}

/** Un canal emparejado con sus carteles, a partir de sus variantes. */
export function groupMatch(
  key: string,
  bucket: string,
  entries: readonly CatalogEntry[],
  match: { readonly score: number; readonly matchedChannel: string; readonly guide: boolean },
  options: VariantOptions = {},
): IptvGroupMatch | null {
  const plan = planVariants(entries, options);
  if (!plan) return null;
  return {
    key,
    bucket,
    best: plan.posters[0] as CatalogEntry,
    posters: plan.posters,
    hidden: plan.hidden,
    ...match,
  };
}

/**
 * Canales IPTV que casan (≥ 92) con alguno de los canales, de mejor a peor
 * puntuación y, con la misma, España o sin país antes que otro país. Un
 * resultado por canal (grupo y país), con sus carteles. Sin tope: el de 4
 * carteles lo aplica quien junta con la guía.
 */
export function matchIptvChannels(
  catalog: Catalog,
  channels: readonly string[],
  options: IptvMatchOptions,
): IptvGroupMatch[] {
  const minScore = options.minScore ?? IPTV_MIN_SCORE;
  const wanted = [
    ...new Set(
      channels
        .map((channel) => iptvAskedChannel(channel))
        /* «DAZN» a secas es la marca paraguas (la agenda no dice qué DAZN): nunca casa por nombre, ni con un
           canal que la lista llame «DAZN» (docs/iptv.md §17). */
        .filter(
          (channel): channel is string => Boolean(channel) && !isUmbrellaBrand(channel as string),
        ),
    ),
  ];
  if (!wanted.length) return [];
  const out: IptvGroupMatch[] = [];
  for (const key of catalog.preselect(wanted)) {
    const representative = catalog.group(key)[0];
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
    for (const { bucket, entries } of catalog.buckets(key)) {
      /* Una plataforma de internet no se empareja por nombre (docs/iptv.md §17). */
      if (isPlatformChannel(entries)) continue;
      const match = groupMatch(
        key,
        bucket,
        entries,
        { score, matchedChannel, guide: false },
        options,
      );
      if (match) out.push(match);
    }
  }
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.bucket !== '') - Number(b.bucket !== '') ||
      a.best.order - b.best.order,
  );
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
  const clean = cleanIptvTitle(text);
  /* Otro idioma al final («Real Madrid TV EN») es otro canal: la función de
     la resolución no ve «EN» (es una palabra vacía en español). */
  if (trailingLanguage(wanted) !== trailingLanguage(clean.key || text)) {
    return Math.min(sameChannelCore(wanted, text, clean, scorer), LANGUAGE_MISMATCH_MAX);
  }
  return sameChannelCore(wanted, text, clean, scorer);
}

/** Tope de dos nombres que solo se diferencian en el idioma del final (como Hypermotion). */
const LANGUAGE_MISMATCH_MAX = 58;
/* Marcas de idioma al final de un nombre, ya con `normalizeChannelKey` (sin paréntesis). */
const LANGUAGE_TOKENS: Readonly<Record<string, string>> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  ingles: 'en',
  fr: 'fr',
  fra: 'fr',
  french: 'fr',
  frances: 'fr',
  ger: 'de',
  german: 'de',
  aleman: 'de',
  ita: 'it',
  italian: 'it',
  italiano: 'it',
  por: 'pt',
  portugues: 'pt',
};

/** El idioma que dice la última palabra de un nombre («Real Madrid TV EN» → «en»), o ''. */
function trailingLanguage(name: string): string {
  const words = normalizeChannelKey(name).split(' ');
  if (words.length < 2) return '';
  return LANGUAGE_TOKENS[words[words.length - 1] as string] ?? '';
}

/*
 * «Esport3», «La1» o «Antena3»: letras y número pegados al final de una
 * palabra se separan («Esport 3»), para que la regla de los números los
 * compare como lo que son. Solo con 2 letras o más delante («F1» se queda).
 */
const GLUED_NUMBER = /(\p{L}{2,})(\d+)(?=\s|$)/gu;
function splitGluedNumbers(value: string): string {
  return value.replace(GLUED_NUMBER, '$1 $2');
}

/*
 * La clave con las palabras de letras pegadas entre sí («la sexta» →
 * «lasexta»; los números siguen aparte: «dazn 1» no es «dazn 10»).
 */
function joinedLetters(value: string): string {
  return normalizeChannelKey(iptvSpelling(value)).replace(/(?<=[a-z]) (?=[a-z])/g, '');
}

function sameChannelCore(
  wanted: string,
  text: string,
  clean: ReturnType<typeof cleanIptvTitle>,
  scorer: ChannelScorer,
): number {
  const variants = new Set([text, iptvSpelling(text)]);
  if (clean.display && (clean.country === null || clean.country === 'ES')) variants.add(clean.base);
  /* El nombre de AceStream sin flecha, asteriscos, calidad ni «TVE» («La 1 TVE 720p *» → «La 1»). */
  const ace = aceChannelTitle(text);
  if (ace !== text) variants.add(iptvSpelling(ace));
  const score = (a: string, b: string): number => scorer([a], { id: '', title: b }).score;
  let best = 0;
  for (const variant of variants) best = Math.max(best, score(wanted, variant));
  if (best >= 100) return best;
  /* Las mismas letras juntas o separadas («LA SEXTA» = «laSexta»): mismo canal. */
  const joined = joinedLetters(wanted);
  if (joined) {
    for (const variant of variants) if (joinedLetters(variant) === joined) return 100;
  }
  /* Números pegados en alguno de los dos: se prueba con ellos separados. */
  const wantedSplit = splitGluedNumbers(wanted);
  for (const variant of variants) {
    const variantSplit = splitGluedNumbers(variant);
    if (wantedSplit !== wanted || variantSplit !== variant) {
      best = Math.max(best, score(wantedSplit, variantSplit));
    }
  }
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
