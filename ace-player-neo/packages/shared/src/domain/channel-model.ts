/* Tubería única de nombres y modelo de canal (0.9.9, docs/iptv.md §4.8).

   Hasta la 0.9.8 la agenda, las listas de AceStream y la IPTV se comparaban
   con `channelMatchScore` sobre nombres distintos: la IPTV limpiaba el suyo
   (`cleanIptvTitle`, grafías, la regla del « 1»), AceStream puntuaba el
   título crudo y la agenda llegaba tal cual. Con la lista real de Isma
   (2026-10-22) se vio que «LaLiga TV Bar», «LaLiga TV M2», «M+ #Vamos Bar»
   o «DAZN 1 Bar» no casaban con nada, que «Esport3» no era «ESPORT 3», que
   los títulos del buscador del motor con enlaces («… elcano.top
   https://x.com/…») daban 0 y que los nombres en árabe se reducían a su
   número y salían como familia de «TPA7».

   Aquí todo nombre (de donde venga) pasa por la MISMA tubería antes de
   puntuar, y de ella sale un modelo: el PRODUCTO (lo que se ve: «laliga»,
   «liga campeones», «laliga hypermotion», «vamos», «dazn»), el DIAL (el
   número del canal, si lo hay) y nada más. Las variantes neutras (Bar, HDR,
   4K, Low, Dispositivos, reserva) y el operador (Movistar, Orange…) no
   cambian de qué canal hablamos. Dos modelos con el mismo producto y el
   mismo dial son el mismo canal; con el mismo producto y un dial de menos
   son familia (78); con diales distintos, nunca (0).

   `channelMatchScore` (channels.ts) NO se toca: tiene la matriz 0.6.59
   congelada (T-088) y sigue siendo la fachada antigua. `canonicalMatchScore`
   lo usa POR DEBAJO sobre los nombres ya canónicos, y el modelo manda cuando
   reconoce el producto de los dos lados. */

import {
  CHANNEL_FAMILY_SCORE,
  CHANNEL_FILLER_TOKENS,
  channelMatchScore,
  esFamiliaDe,
  normalizeChannelKey,
} from './channels.js';
import { channelSpelling, stripQualityMarks } from './channel-names.js';

/* Palabra entera con límites Unicode: `\b` es ASCII y «bar» casaría dentro de «Barça». */
function word(body: string, flags = 'giu'): RegExp {
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${body})(?![\p{L}\p{N}])`, flags);
}

/* 1. Lo que las listas de AceStream ponen detrás de la flecha: « --> NEW ERA». */
const PROVIDER_TAIL_RE = /\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹]).*$/u;
/* 2. Enlaces, dominios y cuentas del buscador del motor: «elcano.top https://x.com/ace_stream_ @acestreamf1». */
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/giu;
const DOMAIN_RE =
  /(?<![\p{L}\p{N}@])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:top|com|org|net|io|me|blog|online|xyz|info|link|site|club|app|cc|ru|eu)(?![\p{L}\p{N}])(?:\/\S*)?/giu;
const HANDLE_RE = /(?<![\p{L}\p{N}])@[\p{L}\p{N}_]+/gu;
const JUNK_WORDS_RE = word('zeronet|vpn|ipfs|ipns|shickat');
/* 3. Superíndices (también ¹²³, U+00B9-B3, que no están en el bloque de los demás), emojis y adornos. */
const SUPERSCRIPT_RE = /[¹²³ᴬ-ᵪᶛ-ᶿ⁰-₟]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu;
const DECOR_RE = /[★☆◉●○◆◇■□▶►▷▸•·|✪✦✧⚽▎┃*]/gu;
/* «#VAMOS» → «VAMOS», «PPV #2» → «PPV 2»; «#0» es el canal de Movistar. */
const HASH_RE = /#\s*(?=[\p{L}\p{N}])(?!0(?![\p{L}\p{N}]))/gu;
/* 4. El operador que sirve el canal, delante con dos puntos: «M+: DAZN 1», «PRIME: LALIGA HYPERMOTION TV 2». */
const CARRIER_PREFIX_RE =
  /^\s*(?:prime(?:\s*video)?|tivify|orange|vodafone|telecable|euskaltel|avatel|cabel(?:\s*tv)?|movistar\+?|m\s*\+)\s*:\s*/iu;
/* Compuestos pegados de listas reales (Avatel escribe todo junto). */
const GLUED_LDC_RE = word(String.raw`m\s*liga\s*campeones\s*t?\s*(\d{1,2})`);
const GLUED_LALIGATV_MULTI_RE = word(String.raw`laligatv\s*multi\s*(\d{1,2})`);
const GLUED_LALIGATV_RE = word('laligatv');
/* «LaLiga TV M2» (la agenda), «LaLiga TV Multi 2» (Orange): el 2 de LaLiga TV. */
const LALIGATV_M_RE = word(String.raw`la\s*liga\s*tv\s+(?:m|multi)\s*(\d{1,2})`);
const HYPERMOTIONV_RE = word('hypermotionv');
/* 5. Marcas de calidad que `stripQualityMarks` no conoce («LA 1 3840P»). */
const RESOLUTION_RE = word(String.raw`(?:3840|1920)p?`);
/* «LaLiga TV Bar» NO es el bar de M+ LaLiga TV: es el canal para bares de LaLiga, que da todos los partidos
   (los de DAZN, los de Movistar y hasta la Conference). futbolenlatv lo anuncia como otra entrada del mismo
   partido junto a «DAZN LaLiga» o a «M+ LALIGA». Se deja como producto propio («LaLigaBar», una palabra, para que
   «bar» no cuente como variante) y solo casa con un canal que se llame así. */
const LALIGA_BAR_RE = word(String.raw`la\s*liga\s*(?:tv\s*)?bar`);
/* Variantes neutras: el mismo canal para otro local («DAZN 1 Bar», «M+ #Vamos Bar»), otra calidad u otro aparato. */
const NEUTRAL_VARIANT_RE = word('bar|low|dispositivos|backup|bkp|alt|multiaudio|vip');
/* Al final y en mayúsculas: «Teledeporte GEO», «LA 1 RAW» (un «Geo News» es otro canal). */
const TRAILING_MARK_RE = /\s+(?:GEO|RAW)\s*$/u;
/* 7. Productos escritos de otra forma. Van tras `channelSpelling` (ya con «LaLiga» y «Movistar»). */
const LDC_RE = word(
  String.raw`l\s*campeones|liga\s+campeones|la\s*liga\s+de\s+campeones|liga\s+de\s+campeones`,
);
const HYPERMOTION_NUMBER_RE = word(String.raw`la\s*liga\s*tv\s+(\d{1,2})\s+hypermotion`);
const HYPERMOTION_RE = word(
  String.raw`(?:la\s*liga\s*(?:tv\s*)?|liga\s*)?(?:hypermotion|smartbank)(?:\s+tv)?`,
);
const PRIMERA_RFEF_RE = word(
  String.raw`1\s*[°ºª]?\s*(?:rfef|federacion|federación)|primera\s+(?:rfef|federacion|federación)|1rfef`,
);
const SEGUNDA_RFEF_RE = word(
  String.raw`2\s*[°ºª]?\s*(?:rfef|federacion|federación)|segunda\s+(?:rfef|federacion|federación)|2rfef`,
);
/* 6. Letras y número pegados: «Esport3», «TPA7», «CAMPEONES2» (dos letras o más: «F1» se queda). Va antes
   de los productos, que «LIGA CAMPEONES2» no se reconocería. */
const GLUED_NUMBER_RE = /(\p{L}{2,})(\d{1,2})(?![\p{L}\p{N}])/gu;
/* Notas entre paréntesis que no cambian el canal («Canal 1 (1RFEF) (SOLO EVENTOS)»). */
const NOTE_RE =
  /[([]\s*(?:solo\s+eventos?|only\s+events?|not\s*24\s*\/\s*7|24\s*\/\s*7|live\s*events?)\s*[)\]]/giu;
/* «TVG» es como la agenda llama a TV Galicia (la lista pone «GALICIA TV» o «TV GALICIA»). */
const TVG_RE = word('tvg');

/**
 * El nombre canónico de un canal, venga de la agenda, de una lista de
 * AceStream, del buscador del motor o de la IPTV: sin proveedor, enlaces,
 * adornos, calidad ni variantes neutras, con las grafías únicas y los
 * productos escritos de una sola forma. Lo que se enseña no cambia: esto es
 * solo para comparar.
 */
export function canonicalChannelName(value: unknown): string {
  let text = String(value ?? '').normalize('NFC');
  if (!text.trim()) return '';
  text = text
    .replace(PROVIDER_TAIL_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(DOMAIN_RE, ' ')
    .replace(HANDLE_RE, ' ')
    .replace(JUNK_WORDS_RE, ' ')
    .replace(SUPERSCRIPT_RE, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(DECOR_RE, ' ')
    .replace(HASH_RE, '')
    .replace(NOTE_RE, ' ')
    .replace(CARRIER_PREFIX_RE, '')
    .replace(GLUED_LDC_RE, 'Movistar Liga de Campeones $1')
    .replace(GLUED_LALIGATV_MULTI_RE, 'LaLiga TV $1')
    .replace(GLUED_LALIGATV_RE, 'LaLiga TV')
    .replace(LALIGATV_M_RE, 'LaLiga TV $1')
    .replace(HYPERMOTIONV_RE, 'Hypermotion')
    .replace(LALIGA_BAR_RE, 'LaLigaBar');
  text = stripQualityMarks(text)
    .replace(RESOLUTION_RE, ' ')
    .replace(TRAILING_MARK_RE, ' ')
    .replace(NEUTRAL_VARIANT_RE, ' ')
    .replace(GLUED_NUMBER_RE, '$1 $2');
  text = channelSpelling(text)
    .replace(LDC_RE, 'Liga de Campeones')
    .replace(HYPERMOTION_NUMBER_RE, 'LaLiga TV Hypermotion $1')
    .replace(HYPERMOTION_RE, 'LaLiga TV Hypermotion')
    .replace(PRIMERA_RFEF_RE, 'Primera Federación')
    .replace(SEGUNDA_RFEF_RE, 'Segunda Federación')
    .replace(TVG_RE, 'TV Galicia')
    .replace(/\(\s*\)|\[\s*\]/g, ' ');
  const words: string[] = [];
  for (const piece of text.split(/\s+/)) {
    if (!piece) continue;
    const previous = words[words.length - 1];
    /* «Movistar Movistar LaLiga» (M+: M.LALIGA): una vez. */
    if (previous && previous.toLowerCase() === piece.toLowerCase()) continue;
    words.push(piece);
  }
  return words.join(' ');
}

/** El modelo de un nombre de canal: producto y dial, ya sin operador, calidad ni variantes. */
export interface ChannelModel {
  /** `canonicalChannelName`. */
  readonly canonical: string;
  /** `normalizeChannelKey` del canónico (lo que se compara con el emparejador clásico). */
  readonly key: string;
  /** Lo que se ve, sin relleno ni dial («laliga», «liga campeones», «dazn»); '' si no queda nada. */
  readonly product: string;
  /** El número del canal («2» en «M+ LaLiga TV 2»), o null. */
  readonly dial: string | null;
  /** La clave tiene alguna letra latina: un nombre en árabe o cirílico se queda solo con sus dígitos. */
  readonly letters: boolean;
}

/* Marcas paraguas: pedirlas a secas es pedir toda la familia numerada. */
const UMBRELLA_PRODUCTS: ReadonlySet<string> = new Set([
  'dazn',
  'primera federacion',
  'segunda federacion',
]);

export function channelModel(value: unknown): ChannelModel {
  const canonical = canonicalChannelName(value);
  const key = normalizeChannelKey(canonical);
  const tokens = key.split(' ').filter(Boolean);
  const letters = tokens.some((token) => /[a-z]/.test(token));
  const core = tokens.filter((token) => !CHANNEL_FILLER_TOKENS.has(token));
  const numbers = core.filter((token) => /^\d+$/.test(token));
  let dial: string | null = null;
  /* Un solo número y en un extremo: «DAZN 2», «Canal 1 Primera Federación». «Liga 1 Perú» o «3 24», no. */
  if (numbers.length === 1 && core.length > 1) {
    const last = core[core.length - 1] as string;
    const first = core[0] as string;
    if (/^\d+$/.test(last)) dial = core.pop() as string;
    else if (/^\d+$/.test(first)) dial = core.shift() as string;
  }
  /* Un producto sin letras («La 7 TV» → «7») no dice qué canal es: decide el emparejador clásico. */
  const product = core.some((token) => /[a-z]/.test(token)) ? core.join(' ') : '';
  return { canonical, key, product, dial, letters };
}

/** La clave de un canal sin sus variantes: «M+ LALIGA», «M+ LALIGA HDR» y «LaLiga TV Bar» dan la misma. */
export function canonicalChannelKey(value: unknown): string {
  const model = channelModel(value);
  if (!model.product) return model.key;
  return model.dial ? `${model.product} ${model.dial}` : model.product;
}

/** ¿Es la marca paraguas a secas («DAZN», «Primera Federación»), sin dial? */
export function isUmbrellaChannel(value: unknown): boolean {
  const model = channelModel(value);
  return model.dial === null && UMBRELLA_PRODUCTS.has(model.product);
}

/**
 * Lo que dice el modelo de dos nombres: 100 mismo producto y dial, 0 diales
 * distintos, 78 (familia) con un dial de menos, 100 si el que falta es el 1
 * de un canal que no es marca paraguas («DAZN LaLiga 1» es «DAZN LaLiga»).
 * null si no reconoce el producto de alguno: decide el emparejador clásico.
 */
export function channelModelScore(a: ChannelModel, b: ChannelModel): number | null {
  if (!a.letters || !b.letters) return 0;
  if (!a.product || !b.product || a.product !== b.product) return null;
  if (a.dial === b.dial) return 100;
  if (a.dial !== null && b.dial !== null) return 0;
  if (UMBRELLA_PRODUCTS.has(a.product)) return CHANNEL_FAMILY_SCORE;
  return (a.dial ?? b.dial) === '1' ? 100 : CHANNEL_FAMILY_SCORE;
}

/**
 * Puntuación 0..100 de que dos nombres (de cualquier origen) sean el mismo
 * canal, por la tubería única: el modelo cuando reconoce el producto de los
 * dos, `channelMatchScore` sobre los nombres canónicos si no. Un nombre sin
 * letras latinas nunca puntúa.
 */
export function canonicalMatchScore(left: unknown, right: unknown): number {
  const a = channelModel(left);
  const b = channelModel(right);
  if (!a.key || !b.key || !a.letters || !b.letters) return 0;
  const byModel = channelModelScore(a, b);
  if (byModel === 0) return 0;
  const byText = channelMatchScore(a.canonical, b.canonical);
  return byModel === null ? byText : Math.max(byModel, byText);
}

/** ¿Es `right` de la familia numerada de `left` (o al revés), por la tubería única? */
export function isChannelFamily(left: unknown, right: unknown): boolean {
  const a = channelModel(left);
  const b = channelModel(right);
  if (!a.key || !b.key || a.key === b.key) return false;
  const byModel = channelModelScore(a, b);
  if (byModel !== null) return byModel === CHANNEL_FAMILY_SCORE;
  return esFamiliaDe(a.canonical, b.canonical);
}
