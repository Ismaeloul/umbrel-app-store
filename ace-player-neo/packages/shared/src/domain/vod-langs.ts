/* Idioma de una película o una serie del VOD de la IPTV (docs/vod.md §4.10).
   Puro y sin dependencias: lo usan el servidor (al leer el catálogo,
   `titles.ts`), la demo de la web y los tests, con la misma tabla.

   Las pistas de audio de los paneles casi nunca dicen su lengua («und» en el
   Paso 0), así que el idioma sale de lo que escribe el proveedor:
   - el NOMBRE DE LA CATEGORÍA: «ES | ACCIÓN», «|LAT| TERROR», «VOSE»,
     «FR | FILMS», «CINE ESPAÑOL», «PELIS LATINO», «PELÍCULAS EN FRANCÉS»;
   - las MARCAS del título que la limpieza quita («ES - Coco», «Coco (LAT)»,
     «[VOSE]», «Coco 4K ES»): `titles.ts` le pasa SOLO esos trozos.

   Reglas:
   - Castellano y latino SIEMPRE separados. «Español», «ES», «ESP», «SPA» y
     «Spanish» son castellano «flojo»: si el mismo texto dice latino, es
     latino («Español latino», «ES | LATINO»); si dice VOSE, son los
     subtítulos («VOSE | ESPAÑOL», «ES | VOSE»), salvo que diga MULTI o DUAL
     (varios audios: «[ES] … [MULTI] (VOSE)»). «Castellano», «CAST», «España»
     y «Spain» son castellano «firme»: con latino, los dos.
   - Los códigos solo cuentan en MAYÚSCULAS y como palabra entera. En una
     categoría, los de dos letras (y «POR», «CAT», «FIN»…) solo cuentan como
     marca: al principio o al final con su separador («ES | », « - EN»),
     entre corchetes, barras o paréntesis («[DE]», «|IT|», «(EN)») o junto a
     otra marca («4K ES», «ES/EN»). Así «PELÍCULAS EN ESPAÑOL», «CINE DE
     TERROR», «PELÍCULAS POR GÉNERO» o «LA CASA DE PAPEL» no se toman por
     inglés, alemán, portugués o latino, y «SERIES USA» (series de allí, que
     suelen ir dobladas) no es inglés. «ES» también vale al principio o al
     final con un espacio («ES ACCIÓN», «ACCIÓN ES»). MX, VO y VF, siempre.
   - Las palabras (castellano, latino, francés…), en cualquier caja y con o
     sin tildes. Las de España y Latinoamérica valen en cualquier sitio
     («CINE ESPAÑOL», «CINE MEXICANO»: ahí el origen ES el idioma); las demás
     nacionalidades solo sueltas, al principio, como marca o tras «en»,
     «audio», «idioma», «doblaje», «versión»… («FRANCÉS», «PELÍCULAS EN
     FRANCÉS»): «CINE FRANCÉS», «SERIES TURCAS» o «ANIME JAPONÉS» dicen el
     origen y no el idioma.
   - En las marcas del título (ya recortadas por la limpieza), cualquier
     código cuenta, en cualquier caja.
   - «V.O.» e «inglés» son `ingles` (versión original); «V.O.S.E.», «VOS»,
     «SUB» o «subtitulada en español» son `vose`; VOSTFR (VO con subtítulos
     en francés) cuenta como versión original.
   - MULTI o DUAL no dicen qué lenguas: solo las que se nombren.
   - Una lengua que se reconoce y no está en la lista (árabe, turco, polaco,
     ruso, «|NL|»…) es `otros`. Un código entre barras que no se conoce
     («|4K|», «|VIP|») no dice nada.
   - El título manda sobre la categoría (`combineVodLangs`): «Coco (FR)» en
     «ES | ANIMACIÓN» es francés; pero «ES - Coco» en «PELIS LATINO» es
     latino (castellano flojo y categoría latina). */

import { VOD_LANGS, type VodLang } from '../api/v1/vod.js';

/** Bit de cada idioma (bit i = `VOD_LANGS[i]`). */
export const VOD_LANG_BIT: Readonly<Record<VodLang, number>> = Object.fromEntries(
  VOD_LANGS.map((lang, index) => [lang, 1 << index]),
) as Record<VodLang, number>;

/** Todos los idiomas a la vez. */
export const VOD_LANG_ALL = (1 << VOD_LANGS.length) - 1;

const CAST = VOD_LANG_BIT.castellano;
const LAT = VOD_LANG_BIT.latino;
const VOSE = VOD_LANG_BIT.vose;

/** Bits de una lista de idiomas. */
export function vodLangBits(langs: readonly VodLang[]): number {
  let bits = 0;
  for (const lang of langs) bits |= VOD_LANG_BIT[lang] ?? 0;
  return bits;
}

/** Bits → idiomas, en el orden de `VOD_LANGS`. */
export function vodLangsOf(bits: number): VodLang[] {
  return VOD_LANGS.filter((lang) => (bits & VOD_LANG_BIT[lang]) !== 0);
}

/** `castellano,frances` (el parámetro `langs`) → idiomas válidos, sin repetir y en su orden. */
export function parseVodLangsParam(value: string | null | undefined): VodLang[] {
  if (!value) return [];
  const asked = new Set(value.split(',').map((part) => part.trim()));
  return VOD_LANGS.filter((lang) => asked.has(lang));
}

/** Idiomas → el parámetro `langs` (en su orden fijo: la misma elección da la misma URL). */
export function vodLangsParam(langs: readonly VodLang[]): string {
  const set = new Set(langs);
  return VOD_LANGS.filter((lang) => set.has(lang)).join(',');
}

// --- Tabla ---

interface CodeRule {
  readonly lang: VodLang;
  /**
   * En una categoría, solo como marca («ES | », «[DE]», « - EN»): también es
   * una palabra corriente o un país, que en un nombre suelto dice de dónde
   * es la película y no en qué idioma está («SERIES USA» va doblada).
   */
  readonly strict?: boolean;
  /** Castellano «flojo» (puede ser latino o los subtítulos). */
  readonly weak?: boolean;
  /**
   * Nacionalidad o país: en una categoría solo cuenta suelta, al principio,
   * como marca o tras «en», «audio», «idioma», «doblaje», «versión»…
   */
  readonly origin?: boolean;
}

const rule = (lang: VodLang, extra: Omit<CodeRule, 'lang'> = {}): CodeRule => ({ lang, ...extra });
const each = (words: readonly string[], value: CodeRule): Array<readonly [string, CodeRule]> =>
  words.map((word) => [word, value] as const);

/* Códigos en MAYÚSCULAS (tras quitar las tildes). */
const CODES: ReadonlyMap<string, CodeRule> = new Map<string, CodeRule>([
  // Castellano
  ['ES', rule('castellano', { strict: true, weak: true })],
  ['ESP', rule('castellano', { weak: true })],
  ['SPA', rule('castellano', { weak: true })],
  ['CAST', rule('castellano')],
  // Latino (MX y MEX siempre; el resto de países, solo como marca)
  ...each(['LAT', 'LATAM', 'MX', 'MEX'], rule('latino')),
  ...each(
    ['LATIN', 'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'BO', 'PY', 'CR', 'GT', 'HN', 'SV', 'PR', 'DO'],
    rule('latino', { strict: true }),
  ),
  // VOSE
  ...each(['VOSE', 'VOS', 'SUB', 'SUBS', 'SUBT', 'VOSUB'], rule('vose')),
  // Inglés / versión original (VOSTFR: VO con subtítulos en francés)
  ...each(['ENG', 'VO', 'VOST', 'VOSTFR'], rule('ingles')),
  ...each(['EN', 'UK', 'US', 'USA', 'GB'], rule('ingles', { strict: true })),
  // Francés
  ...each(['FRA', 'FRE', 'VF', 'VFF', 'VFQ', 'VFI'], rule('frances')),
  ['FR', rule('frances', { strict: true })],
  // Italiano
  ['ITA', rule('italiano')],
  ['IT', rule('italiano', { strict: true })],
  // Alemán
  ...each(['GER', 'DEU'], rule('aleman')),
  ...each(['DE', 'AT'], rule('aleman', { strict: true })),
  // Portugués
  ['PTBR', rule('portugues')],
  ...each(['PT', 'POR', 'BR'], rule('portugues', { strict: true })),
  // Catalán
  ['CAT', rule('catalan', { strict: true })],
  // Otras lenguas que se reconocen («AR» en los paneles multipaís es árabe)
  ...each(
    [
      'TUR',
      'POL',
      'RUS',
      'NED',
      'HUN',
      'CZE',
      'UKR',
      'EXYU',
      'JAP',
      'JPN',
      'KOR',
      'KURD',
      'HEB',
      'ARA',
      'ARB',
      'HIN',
      'ALB',
      'SWE',
      'NOR',
    ],
    rule('otros'),
  ),
  ...each(
    [
      'AR',
      'TR',
      'PL',
      'RU',
      'NL',
      'BE',
      'SE',
      'NO',
      'DK',
      'FI',
      'FIN',
      'GR',
      'RO',
      'ROM',
      'HU',
      'CZ',
      'SK',
      'BG',
      'HR',
      'RS',
      'SI',
      'UA',
      'AL',
      'IN',
      'PK',
      'JP',
      'KR',
      'CN',
      'CHI',
      'TH',
      'VN',
      'IR',
      'KU',
      'IL',
      'HE',
    ],
    rule('otros', { strict: true }),
  ),
]);

/* Palabras en minúsculas y sin tildes, en cualquier caja. */
const WORDS: ReadonlyMap<string, CodeRule> = new Map<string, CodeRule>([
  ...each(['castellano', 'castellana', 'espana', 'spain', 'castilian'], rule('castellano')),
  ...each(
    ['espanol', 'espanola', 'espanoles', 'espanolas', 'spanish'],
    rule('castellano', { weak: true }),
  ),
  ...each(
    [
      'latino',
      'latina',
      'latinos',
      'latinas',
      'latinoamerica',
      'latinoamericano',
      'latinoamericana',
      'latinoamericanos',
      'latinoamericanas',
      'latam',
      'hispanoamerica',
      'hispanoamericano',
      'hispanoamericana',
      'mexico',
      'mexicano',
      'mexicana',
      'mexicanos',
      'mexicanas',
      'argentina',
      'argentino',
      'argentinas',
      'argentinos',
      'colombia',
      'colombiano',
      'colombiana',
      'chile',
      'chileno',
      'chilena',
      'peru',
      'peruano',
      'peruana',
      'venezuela',
      'venezolano',
      'venezolana',
    ],
    rule('latino'),
  ),
  ...each(
    [
      'vose',
      'subtitulado',
      'subtitulada',
      'subtitulados',
      'subtituladas',
      'subtitulos',
      'subtitled',
      'subbed',
    ],
    rule('vose'),
  ),
  ...each(['ingles', 'inglesa', 'inglesas', 'english'], rule('ingles', { origin: true })),
  ...each(
    [
      'frances',
      'francesa',
      'francesas',
      'francais',
      'francaise',
      'french',
      'truefrench',
      'france',
      'francia',
      'quebec',
      'quebecois',
    ],
    rule('frances', { origin: true }),
  ),
  ...each(
    [
      'italiano',
      'italiana',
      'italianos',
      'italianas',
      'italiane',
      'italiani',
      'italian',
      'italia',
      'italy',
    ],
    rule('italiano', { origin: true }),
  ),
  ...each(
    [
      'aleman',
      'alemana',
      'alemanes',
      'alemanas',
      'german',
      'deutsch',
      'deutsche',
      'alemania',
      'germany',
    ],
    rule('aleman', { origin: true }),
  ),
  ...each(
    [
      'portugues',
      'portuguesa',
      'portuguesas',
      'portuguese',
      'portugal',
      'brasil',
      'brazil',
      'brasileno',
      'brasilena',
      'brasilenas',
      'brasileiro',
      'brasileira',
    ],
    rule('portugues', { origin: true }),
  ),
  ...each(
    ['catalan', 'catala', 'catalana', 'catalanas', 'catalunya', 'cataluna', 'valenciano'],
    rule('catalan', { origin: true }),
  ),
  ...each(
    [
      'arabe',
      'arabes',
      'arabic',
      'turco',
      'turca',
      'turcas',
      'turcos',
      'turkish',
      'turkce',
      'polaco',
      'polaca',
      'polish',
      'polski',
      'ruso',
      'rusa',
      'rusas',
      'russian',
      'holandes',
      'dutch',
      'nederlands',
      'sueco',
      'swedish',
      'danes',
      'danish',
      'noruego',
      'norwegian',
      'finlandes',
      'finnish',
      'griego',
      'greek',
      'rumano',
      'romanian',
      'hungaro',
      'hungarian',
      'checo',
      'czech',
      'bulgaro',
      'croata',
      'serbio',
      'ucraniano',
      'albanes',
      'albanian',
      'hindi',
      'bollywood',
      'tamil',
      'telugu',
      'punjabi',
      'japones',
      'japonesa',
      'japonesas',
      'japanese',
      'coreano',
      'coreana',
      'coreanas',
      'korean',
      'chino',
      'chinese',
      'mandarin',
      'cantones',
      'tailandes',
      'thai',
      'vietnamita',
      'persa',
      'farsi',
      'kurdo',
      'hebreo',
      'hebrew',
      'filipino',
      'tagalog',
      'euskera',
      'euskara',
      'gallego',
      'galego',
    ],
    rule('otros', { origin: true }),
  ),
]);

/* Palabras tras las que una nacionalidad ES el idioma («EN FRANCÉS», «AUDIO ITALIANO»). */
const LANG_INTRO = new Set([
  'en',
  'in',
  'audio',
  'idioma',
  'idiomas',
  'lengua',
  'doblaje',
  'doblada',
  'doblado',
  'dobladas',
  'doblados',
  'version',
  'versiones',
  'vo',
  'dub',
  'dubbed',
]);

/* Calidad y otras marcas que pueden ir junto a un código («4K ES», «ES HD»). */
const MARK_TOKENS = new Set([
  '4K',
  'UHD',
  'FHD',
  'HD',
  'SD',
  'HDR',
  'HDR10',
  'HEVC',
  'H265',
  'X265',
  '1080P',
  '720P',
  '2160P',
  'MULTI',
  'DUAL',
  '3D',
]);

/* Separadores que convierten un código en marca («ES | », «[DE]», « - EN»). */
const LEFT_MARK = /[|[(:\-–—/,·+_]/;
const RIGHT_MARK = /[|\])}:\-–—/,·+_]/;
const SPACES = /^\s+$/;

const ACCENTS = /[̀-ͯ]/g;
const TOKEN = /[A-Za-z0-9]+/g;

/** Sin tildes (la «ñ» pasa a «n»): «ESPAÑOL» → «ESPANOL». */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(ACCENTS, '');
}

/* Abreviaturas con puntos y frases, antes de partir en palabras. */
const REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bv\.\s?o\.\s?s\.\s?e\.?/gi, ' VOSE '],
  [/\bv\.\s?o\.\s?s\.?(?![a-z])/gi, ' VOS '],
  [/\bv\.\s?o\.?(?![a-z])/gi, ' VO '],
  [/\bv\.\s?f\.?(?![a-z])/gi, ' VF '],
  /* «Subtitulada en español», «subs español», «sub esp»: los subtítulos, no el audio. */
  [
    /\b(?:subtitulad[oa]s?|subtitulos|subs?|subt)\.?\s+(?:(?:en|al)\s+)?(?:espanol|castellano|esp|es|spanish)\b/gi,
    ' VOSE ',
  ],
  [/\bversion\s+original\s+subtitulada\b/gi, ' VOSE '],
  [/\bversion\s+original\b/gi, ' VO '],
  [/\bes[-_](?:419|mx|la|us)\b/gi, ' LAT '],
  [/\bes[-_]es\b/gi, ' CAST '],
  [/\bpt[-_]br\b/gi, ' PTBR '],
  [/\bmulti[\s-]?(?:audio|lang|idioma)s?\b/gi, ' MULTI '],
];

export type VodLangContext = 'categoria' | 'titulo';

export interface VodLangDetection {
  /** Bits de `VOD_LANGS`. */
  readonly bits: number;
  /** El castellano salió SOLO de marcas flojas («ES», «español»): con una categoría latina, es latino. */
  readonly weakSpanish: boolean;
}

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const NONE: VodLangDetection = { bits: 0, weakSpanish: false };

/**
 * Idiomas de un texto: el nombre de una categoría (`categoria`) o las marcas
 * que la limpieza ha quitado de un título (`titulo`).
 */
export function detectVodLangs(text: string, context: VodLangContext): VodLangDetection {
  if (!text) return NONE;
  let plain = stripAccents(text);
  for (const [pattern, replacement] of REWRITES) plain = plain.replace(pattern, replacement);
  const tokens: Token[] = [];
  for (const match of plain.matchAll(TOKEN)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  const loose = context === 'titulo';
  let bits = 0;
  let strongSpanish = false;
  let weakSpanish = false;
  let multi = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    const upper = token.text.toUpperCase();
    if (upper === 'MULTI' || upper === 'DUAL') multi = true;
    let found: CodeRule | undefined = WORDS.get(token.text.toLowerCase());
    if (found?.origin && !loose && !languageSpot(plain, tokens, index)) found = undefined;
    if (!found && (loose || (token.text === upper && /[A-Z]/.test(upper)))) {
      const code = CODES.get(upper);
      if (code && (loose || !code.strict || isMark(plain, tokens, index, upper))) found = code;
    }
    if (!found) continue;
    bits |= VOD_LANG_BIT[found.lang];
    if (found.lang === 'castellano') {
      if (found.weak) weakSpanish = true;
      else strongSpanish = true;
    }
  }
  if (bits & CAST && !strongSpanish) {
    /* «Español latino», «ES | LATINO»: latino. «VOSE | ESPAÑOL»: los
       subtítulos (salvo MULTI o DUAL, que son varios audios). */
    if (bits & LAT || (bits & VOSE && !multi)) bits &= ~CAST;
  }
  return { bits, weakSpanish: (bits & CAST) !== 0 && !strongSpanish && weakSpanish };
}

/** Lo que hay entre el token anterior (o el principio) y este, y entre este y el siguiente. */
function around(
  text: string,
  tokens: readonly Token[],
  index: number,
): { before: string; after: string; prev: Token | undefined; next: Token | undefined } {
  const token = tokens[index] as Token;
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  return {
    prev,
    next,
    before: text.slice(prev ? prev.end : 0, token.start),
    after: text.slice(token.end, next ? next.start : text.length),
  };
}

/**
 * ¿Una marca de calidad o un código de idioma que no es también palabra?
 * («4K ES», «ES LAT»). «DE» o «EN» no cuentan: «SERIES DE USA» no es inglés.
 */
function isMarkToken(token: Token | undefined): boolean {
  if (!token) return false;
  const upper = token.text.toUpperCase();
  if (MARK_TOKENS.has(upper)) return true;
  const code = token.text === upper ? CODES.get(upper) : undefined;
  return code !== undefined && code.strict !== true;
}

/** ¿El código de la posición `index` está como marca en una categoría? */
function isMark(text: string, tokens: readonly Token[], index: number, code: string): boolean {
  const { before, after, prev, next } = around(text, tokens, index);
  const leftOk = !prev || LEFT_MARK.test(before) || (SPACES.test(before) && isMarkToken(prev));
  const rightOk = !next || RIGHT_MARK.test(after) || (SPACES.test(after) && isMarkToken(next));
  if (leftOk && rightOk) return true;
  /* «ES» también al principio o al final con un simple espacio («ES ACCIÓN»). */
  if (code === 'ES') return (!prev && SPACES.test(after)) || (!next && SPACES.test(before));
  return false;
}

/**
 * ¿Una nacionalidad dice aquí el idioma? Suelta, al principio, como marca o
 * tras «en», «audio», «idioma»… («FRANCÉS», «FR | FRANCÉS», «PELÍCULAS EN
 * FRANCÉS»); tras otra palabra dice el origen («CINE FRANCÉS»).
 */
function languageSpot(text: string, tokens: readonly Token[], index: number): boolean {
  const { before, prev } = around(text, tokens, index);
  if (!prev || LEFT_MARK.test(before)) return true;
  return LANG_INTRO.has(prev.text.toLowerCase()) || isMarkToken(prev);
}

/**
 * El idioma de un título: el de sus marcas si tiene alguna; si no, el de su
 * categoría. Con un castellano flojo en el título («ES - Coco») y una
 * categoría latina, latino.
 */
export function combineVodLangs(title: VodLangDetection, category: VodLangDetection): number {
  if (!title.bits) return category.bits;
  if (title.weakSpanish && category.bits & LAT && !(category.bits & CAST)) {
    return (title.bits & ~CAST) | LAT;
  }
  return title.bits;
}
