/* País, idioma, tipo, deporte y calidad de un canal IPTV (docs/iptv.md §16.4).

   Puro y sin red: todo sale de lo que ya trae la lista (atributos M3U
   `tvg-country` y `tvg-language`, prefijos del nombre y de la categoría,
   palabras y marcas). Lo que depende solo de la categoría se calcula una vez
   por nombre de categoría (`FacetDeriver` lo guarda): una lista de 27 687
   canales tiene unos pocos cientos.

   Texto con el que se busca: NFKC (las letras en superíndice pasan a letras
   normales: «ᴿᴬᵂ» → «RAW», «ᶠᴴᴰ» → «FHD», «⁴ᴷ» → «4K»), minúsculas y sin
   tildes, «la liga» → «laliga» y troceado en palabras; el «+» se queda
   pegado a la palabra de delante («m+», «laliga+»). Las frases de las tablas
   («serie a», «premier padel», «american football») casan antes que las
   palabras y GASTAN esas palabras: «SERIE A» es fútbol y no el tipo Series.

   Reglas:
   - País: uno por fila. La primera fuente que da algo gana: `tvg-country`,
     prefijo del nombre con separador («ES:», «|ES|», «[ES]», «ES -»),
     prefijo de la categoría, primera palabra de la categoría sin separador
     (solo códigos marcados y nombres de país), y un código entre barras o
     corchetes en cualquier sitio. Solo cuentan los códigos de la tabla (y
     cualquier ISO 3166-1 alfa-2 en mayúsculas con separador): «VIP», «HD»,
     «4K», «PPV»… nunca son país, y «AR» es árabe, no Argentina.
   - Idioma: varios por fila. `tvg-language` y las marcas de idioma del nombre
     o de la categoría se suman; si no dan nada, el idioma del país.
   - Tipo: varios. Adultos es excluyente (ni otro tipo ni deporte) y un
     deporte implica «deportes».
   - Deporte: varios; sin deporte no sale en ningún valor.
   - Calidad: la de la variante (§4.2) o, si no la tiene, la que se lee tras
     NFKC («⁴ᴷ»). «RAW» no es calidad. */

import type { IptvQuality, IptvSport, IptvType } from '@ace/shared';
import { IPTV_SPORTS, IPTV_TYPES } from '@ace/shared';
import { IPTV_CONTINENTS } from './names.js';
import { foldText } from './search.js';

/*
 * Canales para adultos (la regla de §14.3, que el buscador ya no usa como
 * filtro desde §17 pero que aquí es el tipo «Adultos»): xxx, adult, adulto/a,
 * porn… y «+18» / «18+» sueltos, no el «+» de una marca seguido de un número
 * («Canal+ 18» o «M+ 18 Series» no son para adultos). «Adult Swim» es un
 * canal de dibujos, no para adultos.
 */
const ADULT_RE =
  /(?:^|[^a-z0-9])(?:xxx|(?!adult\s*swim)adults?|adult[oa]s?|porn\w*)(?:$|[^a-z0-9])|(?:^|[^a-z0-9+])\+\s?18(?!\d)|(?<!\d)18\s?\+/;

/** ¿Es un canal (o un grupo) para adultos? Por palabra y sin tildes. */
export function isAdultChannel(title: string, group: string): boolean {
  return ADULT_RE.test(foldText(`${group} ${title}`));
}

// --- Texto ---

/* Solo ASCII imprimible: NFKC y NFD no cambian nada (y así no se copia el texto: con 100 000
   canales, la basura que deja montar el índice cuenta, §12.2). */
const PLAIN_ASCII_RE = /^[\x20-\x7e]*$/;

/** NFKC (sin copiar si no hace falta). */
function nfkc(value: string): string {
  return PLAIN_ASCII_RE.test(value) ? value : value.normalize('NFKC');
}

/** NFKC y sin tildes. */
function plain(value: string): string {
  return PLAIN_ASCII_RE.test(value)
    ? value
    : value.normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** NFKC, minúsculas, sin tildes, «la liga» → «laliga» y «24/7» → «247». */
export function facetText(value: string): string {
  return plain(String(value ?? ''))
    .toLowerCase()
    .replace(/\bla\s*liga\b/g, 'laliga')
    .replace(/\b24\s*\/\s*7\b/g, ' 247 ');
}

/** Palabras del texto (letras y cifras; el «+» se queda pegado a la de delante). */
export function facetTokens(value: string): string[] {
  return facetText(value).match(/[\p{L}\p{N}]+\+*/gu) ?? [];
}

/** La palabra sin los «+» del final («laliga+» → «laliga»). */
function bare(token: string): string {
  return token.endsWith('+') ? token.replace(/\++$/, '') : token;
}

/** Mayúsculas y sin tildes, para buscar en las tablas de alias («España» → «ESPANA»). */
function aliasKey(value: string): string {
  return plain(String(value ?? ''))
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// --- País ---

interface CountryRow {
  readonly code: string;
  readonly aliases: readonly string[];
  /** Vale como primera palabra de la categoría sin separador («UK SPORTS»). */
  readonly noSeparator: boolean;
}

/** Tabla de países de §16.4 (el código canónico y lo que lo da). */
export const IPTV_COUNTRY_TABLE: readonly CountryRow[] = [
  {
    code: 'ES',
    /* Y las comunidades con lengua propia que las listas usan como categoría («CATALUNYA», «PAIS VASCO»). */
    aliases: [
      'ES',
      'ESP',
      'SPA',
      'SP',
      'ESPAÑA',
      'ESPANA',
      'SPAIN',
      'CAT',
      'CATALUNYA',
      'CATALUÑA',
      'CATALONIA',
      'EUSKADI',
      'PAIS VASCO',
      'GALICIA',
    ],
    noSeparator: true,
  },
  { code: 'UK', aliases: ['UK', 'GB', 'ENG', 'UNITED KINGDOM'], noSeparator: true },
  { code: 'US', aliases: ['US', 'USA', 'UNITED STATES'], noSeparator: true },
  {
    code: 'LAT',
    aliases: ['LAT', 'LATAM', 'LATINO', 'LATINOAMERICA', 'LATIN'],
    noSeparator: true,
  },
  { code: 'MX', aliases: ['MX', 'MEX', 'MEXICO'], noSeparator: true },
  { code: 'ARG', aliases: ['ARG', 'ARGENTINA'], noSeparator: true },
  { code: 'CO', aliases: ['CO', 'COL', 'COLOMBIA'], noSeparator: false },
  { code: 'CL', aliases: ['CL', 'CHI', 'CHILE'], noSeparator: false },
  { code: 'PE', aliases: ['PE', 'PER', 'PERU'], noSeparator: false },
  { code: 'PT', aliases: ['PT', 'POR', 'PRT', 'PORTUGAL'], noSeparator: true },
  { code: 'BR', aliases: ['BR', 'BRA', 'BRASIL', 'BRAZIL'], noSeparator: true },
  { code: 'FR', aliases: ['FR', 'FRA', 'FRANCE', 'FRANCIA'], noSeparator: true },
  { code: 'IT', aliases: ['IT', 'ITA', 'ITALIA', 'ITALY'], noSeparator: true },
  {
    code: 'DE',
    aliases: ['DE', 'GER', 'DEU', 'GERMANY', 'DEUTSCHLAND', 'ALEMANIA'],
    noSeparator: true,
  },
  { code: 'NL', aliases: ['NL', 'NED', 'HOL', 'NETHERLANDS', 'HOLANDA'], noSeparator: true },
  { code: 'BE', aliases: ['BE', 'BEL', 'BELGIUM', 'BELGICA'], noSeparator: false },
  { code: 'CH', aliases: ['CH', 'SUI', 'SWISS', 'SUIZA'], noSeparator: false },
  { code: 'AT', aliases: ['AT', 'AUT', 'AUSTRIA'], noSeparator: false },
  { code: 'IE', aliases: ['IE', 'IRL', 'IRELAND', 'IRLANDA'], noSeparator: false },
  { code: 'PL', aliases: ['PL', 'POL', 'POLAND', 'POLONIA'], noSeparator: true },
  { code: 'RO', aliases: ['RO', 'ROM', 'ROU', 'ROMANIA', 'RUMANIA'], noSeparator: true },
  { code: 'TR', aliases: ['TR', 'TUR', 'TURKEY', 'TURQUIA'], noSeparator: true },
  { code: 'GR', aliases: ['GR', 'GRE', 'GREECE', 'GRECIA'], noSeparator: true },
  { code: 'AL', aliases: ['AL', 'ALB', 'ALBANIA'], noSeparator: true },
  { code: 'RU', aliases: ['RU', 'RUS', 'RUSSIA', 'RUSIA'], noSeparator: true },
  { code: 'UA', aliases: ['UA', 'UKR', 'UKRAINE', 'UCRANIA'], noSeparator: false },
  { code: 'SE', aliases: ['SE', 'SWE', 'SWEDEN', 'SUECIA'], noSeparator: false },
  { code: 'NO', aliases: ['NO', 'NOR', 'NORWAY', 'NORUEGA'], noSeparator: false },
  { code: 'DK', aliases: ['DK', 'DEN', 'DENMARK', 'DINAMARCA'], noSeparator: false },
  { code: 'FI', aliases: ['FI', 'FIN', 'FINLAND', 'FINLANDIA'], noSeparator: false },
  { code: 'CA', aliases: ['CA', 'CAN', 'CANADA'], noSeparator: false },
  { code: 'IN', aliases: ['IN', 'IND', 'INDIA'], noSeparator: false },
  { code: 'PK', aliases: ['PK', 'PAK', 'PAKISTAN'], noSeparator: false },
  { code: 'MA', aliases: ['MA', 'MAR', 'MOROCCO', 'MARRUECOS'], noSeparator: false },
  { code: 'EXYU', aliases: ['EXYU', 'EX-YU', 'BALKAN', 'BALCANES'], noSeparator: true },
];

/* ISO 3166-1 alfa-2 (los que no están en la tabla valen tal cual con separador y en mayúsculas). */
const ISO_3166 = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO ' +
    'JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR ' +
    'MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO ' +
    'RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV ' +
    'TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' '),
);

/**
 * Nunca son país, ni con separador (§16.4): marcas técnicas y de paquete,
 * «AR», que en las listas es árabe, y «LA» («LA | GENERAL» es latino o Los
 * Ángeles; Laos no sale en las listas).
 */
export const NEVER_COUNTRY: ReadonlySet<string> = new Set([
  'HD',
  'SD',
  'FHD',
  'UHD',
  '4K',
  '8K',
  'VIP',
  'PPV',
  'TV',
  'NEW',
  'HEVC',
  'RAW',
  'VOD',
  'EPG',
  'BAR',
  'TOP',
  'ALL',
  'AR',
  'LA',
  'XXX',
  'LIVE',
  'HQ',
  'LQ',
  'MULTI',
  'SUB',
  'DUAL',
  'GEO',
  'ALT',
  'BK',
  'BKP',
  'OFF',
]);

const COUNTRY_BY_ALIAS = new Map<string, CountryRow>();
for (const row of IPTV_COUNTRY_TABLE) {
  for (const alias of row.aliases) COUNTRY_BY_ALIAS.set(aliasKey(alias), row);
}

/* «ES: », «|ES| », «[ES] », «(ES) », «ES - », «ES | », «ESPAÑA | », «EX-YU: », «4K: ». */
const PREFIX_RE =
  /^\s*(?:[|[(]\s*)?([\p{L}\p{N}]{2,}(?:[ -][\p{L}]{2,})?)\s*(?:[|\]):]|\s[-–]\s|[-–]\s)\s*/u;
/* Un código entre barras, corchetes o paréntesis en cualquier sitio: «DEPORTES |ES|», «SKY SPORTS [UK]». */
const BRACKET_RE = /[|[(]\s*([A-Za-z]{2,4})\s*[|\])]/gu;

/** Código canónico de un alias de la tabla, o null. */
function tableCountry(value: string): string | null {
  const key = aliasKey(value);
  if (NEVER_COUNTRY.has(key)) return null;
  return COUNTRY_BY_ALIAS.get(key)?.code ?? null;
}

/**
 * ¿Es el continente de «EU | ES | TDT» o «AM | USA | ESPN» (el país va detrás)? «AM», «AS» y «AF» también son
 * siglas ISO (Armenia, Samoa, Afganistán) y «EU», euskera. «LATAM» no: está en la tabla.
 */
function isContinent(key: string): boolean {
  return IPTV_CONTINENTS.has(key) && !COUNTRY_BY_ALIAS.has(key);
}

/** País de un texto marcado como código (con separador o entre barras): tabla o ISO en mayúsculas. */
function markedCountry(raw: string): string | null {
  const key = aliasKey(raw);
  if (NEVER_COUNTRY.has(key) || isContinent(key)) return null;
  const known = COUNTRY_BY_ALIAS.get(key);
  if (known) return known.code;
  /* Otro ISO alfa-2, solo si viene en mayúsculas («HU:»; no «la:»). */
  if (/^[A-Z]{2}$/.test(raw) && ISO_3166.has(raw)) return raw;
  return null;
}

/**
 * Prefijos con separador del principio (hasta 2: «VIP | ES: …» o «EU | ES |
 * TDT» miran el segundo si el primero es una marca que nunca es país o un
 * continente).
 */
function prefixes(text: string): string[] {
  const out: string[] = [];
  let rest = nfkc(text);
  for (let round = 0; round < 2; round += 1) {
    const match = PREFIX_RE.exec(rest);
    if (!match?.[1]) break;
    out.push(match[1]);
    const key = aliasKey(match[1]);
    if (!NEVER_COUNTRY.has(key) && !isContinent(key)) break;
    rest = rest.slice(match[0].length);
  }
  return out;
}

function prefixCountry(list: readonly string[]): string | null {
  for (const prefix of list) {
    const code = markedCountry(prefix);
    if (code) return code;
  }
  return null;
}

/** Primera palabra (o las dos primeras) de la categoría sin separador: solo códigos marcados y nombres. */
function firstWordCountry(group: string): string | null {
  const words = nfkc(group)
    .trim()
    .split(/[\s|:\-–[\]()]+/u)
    .filter(Boolean);
  const candidates = words.length > 1 ? [`${words[0]} ${words[1]}`, words[0]] : [words[0]];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = aliasKey(candidate);
    if (NEVER_COUNTRY.has(key)) continue;
    const row = COUNTRY_BY_ALIAS.get(key);
    if (!row) continue;
    /* Un nombre de país («SWISS», «CHILE») vale siempre; un código, solo si la tabla lo dice. */
    if (row.noSeparator || key.length >= 4) return row.code;
  }
  return null;
}

function bracketCountry(text: string): string | null {
  if (!/[|[(]/.test(text)) return null;
  for (const match of nfkc(text).matchAll(BRACKET_RE)) {
    const code = markedCountry(match[1] as string);
    if (code) return code;
  }
  return null;
}

/**
 * El país que ya sacó del nombre la limpieza de la lista real (`cleanIptvTitle`, §18), pasado por la misma
 * tabla que el resto de fuentes: «USA» → US; «AR» (árabe), «LA», «EN» (un idioma) o el continente de «EU |
 * LATVIA» («AM», «AS» y «AF» también son siglas ISO) → sin país.
 */
function nameCountryCode(value: string | null | undefined): string | null {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!raw) return null;
  return markedCountry(raw);
}

/** `tvg-country`: el primer valor de la lista (`;`, `,` o `|`), código o nombre. */
export function tvgCountryCode(value: string | null | undefined): string | null {
  for (const part of String(value ?? '').split(/[;,|]/)) {
    const text = part.trim();
    if (!text) continue;
    const known = tableCountry(text);
    if (known) return known;
    const upper = aliasKey(text);
    if (/^[A-Z]{2}$/.test(upper) && ISO_3166.has(upper) && !NEVER_COUNTRY.has(upper)) return upper;
    return null;
  }
  return null;
}

// --- Idioma ---

interface LanguageRow {
  readonly code: string;
  /** Códigos (2 y 3 letras) que valen como marca («(ENG)», «CAT:», « EN» al final). */
  readonly codes: readonly string[];
  /** Nombres y palabras que valen en cualquier sitio («latino», «castellano»). */
  readonly words: readonly string[];
  /** Países que lo dan cuando no hay marca (fuente 3). */
  readonly countries: readonly string[];
}

export const IPTV_LANGUAGE_TABLE: readonly LanguageRow[] = [
  {
    code: 'es',
    codes: ['es', 'spa', 'esp', 'lat'],
    words: ['spanish', 'espanol', 'castellano', 'latino'],
    countries: [
      'ES',
      'MX',
      'ARG',
      'AR',
      'CO',
      'CL',
      'PE',
      'LAT',
      'VE',
      'EC',
      'BO',
      'PY',
      'UY',
      'CR',
      'PA',
      'DO',
      'GT',
      'HN',
      'SV',
      'NI',
      'CU',
      'PR',
    ],
  },
  {
    code: 'en',
    codes: ['en', 'eng'],
    words: ['english', 'ingles'],
    /* Sin «CA»: Canadá es bilingüe («CA: RDS» o «CA: TVA» son en francés). */
    countries: ['UK', 'GB', 'US', 'IE', 'AU', 'NZ'],
  },
  {
    code: 'ca',
    codes: ['cat'],
    words: ['catalan', 'catala', 'catalunya', 'cataluna', 'catalonia'],
    countries: [],
  },
  {
    code: 'eu',
    codes: ['eu', 'eus'],
    words: ['basque', 'euskera', 'euskara', 'euskadi', 'vasco'],
    countries: [],
  },
  {
    code: 'gl',
    codes: ['gl', 'glg'],
    words: ['galician', 'galego', 'gallego', 'galicia'],
    countries: [],
  },
  {
    code: 'pt',
    codes: ['pt', 'por'],
    words: ['portuguese', 'portugues'],
    countries: ['PT', 'BR'],
  },
  {
    code: 'fr',
    codes: ['fr', 'fra', 'fre'],
    words: ['french', 'francais', 'frances'],
    countries: ['FR'],
  },
  { code: 'it', codes: ['it', 'ita'], words: ['italian', 'italiano'], countries: ['IT'] },
  {
    code: 'de',
    codes: ['de', 'ger', 'deu'],
    words: ['german', 'deutsch', 'aleman'],
    countries: ['DE', 'AT'],
  },
  {
    code: 'ar',
    codes: ['ar', 'ara'],
    words: ['arabic', 'arabe'],
    countries: [
      'MA',
      'SA',
      'AE',
      'QA',
      'EG',
      'DZ',
      'TN',
      'LB',
      'JO',
      'KW',
      'BH',
      'OM',
      'IQ',
      'SY',
      'LY',
      'YE',
      'SD',
      'PS',
    ],
  },
  {
    code: 'nl',
    codes: ['nl', 'nld'],
    words: ['dutch', 'nederlands', 'neerlandes'],
    countries: ['NL'],
  },
  { code: 'pl', codes: ['pl', 'pol'], words: ['polish', 'polski', 'polaco'], countries: ['PL'] },
  { code: 'ro', codes: ['ro', 'ron'], words: ['romanian', 'rumano'], countries: ['RO'] },
  { code: 'tr', codes: ['tr', 'tur'], words: ['turkish', 'turkce', 'turco'], countries: ['TR'] },
  { code: 'el', codes: ['el', 'ell'], words: ['greek', 'griego'], countries: ['GR'] },
  { code: 'sq', codes: ['sq', 'sqi'], words: ['albanian', 'shqip', 'albanes'], countries: ['AL'] },
  {
    code: 'ru',
    codes: ['ru', 'rus'],
    words: ['russian', 'ruso', 'русский', 'русскии'],
    countries: ['RU'],
  },
];

const LANGUAGE_BY_CODE = new Map<string, string>();
const LANGUAGE_BY_WORD = new Map<string, string>();
const LANGUAGE_BY_COUNTRY = new Map<string, string>();
for (const row of IPTV_LANGUAGE_TABLE) {
  LANGUAGE_BY_CODE.set(row.code, row.code);
  for (const code of row.codes) LANGUAGE_BY_CODE.set(code, row.code);
  for (const word of row.words) LANGUAGE_BY_WORD.set(word, row.code);
  for (const country of row.countries) LANGUAGE_BY_COUNTRY.set(country, row.code);
}

/** Idioma de un código o nombre de `tvg-language` («Spanish», «cat», «hu»), o null. */
function tvgLanguageCode(value: string): string | null {
  const text = facetText(value).trim();
  if (!text) return null;
  const known = LANGUAGE_BY_CODE.get(text) ?? LANGUAGE_BY_WORD.get(text);
  if (known) return known;
  /* Otro ISO 639-1: el código tal cual. */
  return /^[a-z]{2}$/.test(text) ? text : null;
}

/** `tvg-language`: todos los de la lista (`;`, `,` o `|`). */
export function tvgLanguageCodes(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(value ?? '').split(/[;,|]/)) {
    const code = tvgLanguageCode(part);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * Marca de idioma de un prefijo: «AR |» → ar, «CAT:» → ca, «EN:» → en. Un
 * prefijo que es país («ES:», «UK:») no es marca: su idioma sale del país.
 */
function prefixLanguage(list: readonly string[]): string | null {
  for (const prefix of list) {
    const key = aliasKey(prefix);
    /* «EU | ES | TDT» o «EU | LATVIA»: «EU» es el continente, no euskera. */
    if (isContinent(key)) continue;
    if (key === 'CAT') return 'ca';
    if (key === 'AR') return 'ar';
    if (COUNTRY_BY_ALIAS.has(key)) return null;
    const lower = key.toLowerCase();
    const code = LANGUAGE_BY_CODE.get(lower) ?? LANGUAGE_BY_WORD.get(lower);
    if (code) return code;
  }
  return null;
}

/* Códigos de idioma que valen como marca entre paréntesis o al final (no «ca»: es Canadá). */
function markLanguage(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (lower === 'ca') return null;
  return LANGUAGE_BY_CODE.get(lower) ?? null;
}

/** Marcas de idioma de un texto (nombre o categoría): prefijo, código entre paréntesis o al final, palabras. */
function languageMarks(
  text: string,
  tokens: readonly string[],
  list: readonly string[] = prefixes(text),
): string[] {
  const out: string[] = [];
  const add = (code: string | null): void => {
    if (code && !out.includes(code)) out.push(code);
  };
  add(prefixLanguage(list));
  const normalized = nfkc(text);
  /* «(ENG)», «[EN]»; «[ES]» o «(IT)» dan lo mismo que su país. */
  if (/[([]/.test(normalized)) {
    for (const match of normalized.matchAll(/[([]\s*([A-Za-z]{2,3})\s*[)\]]/gu)) {
      add(markLanguage(match[1] as string));
    }
  }
  /* « EN» al final, en mayúsculas y con algo delante. */
  const tail = /\s([A-Z]{2,3})\s*$/u.exec(normalized.trim());
  if (tail?.[1]) add(markLanguage(tail[1]));
  for (const token of tokens) add(LANGUAGE_BY_WORD.get(bare(token)) ?? null);
  return out;
}

// --- Tipo y deporte ---

type Target =
  | { readonly kind: 'type'; readonly value: IptvType }
  | { readonly kind: 'sport'; readonly value: IptvSport };

type MatchMode = 'word' | 'prefix' | 'inside';

interface Term {
  readonly tokens: readonly string[];
  readonly mode: MatchMode;
  readonly target: Target;
}

/*
 * Tablas de §16.4. Notación: «palabra», «prefijo*» (una palabra que empieza
 * así), «~dentro» (también dentro de otra palabra) y «dos palabras» (frase).
 */
export const IPTV_TYPE_TERMS: Readonly<Record<Exclude<IptvType, 'adultos'>, readonly string[]>> = {
  generalistas: [
    'generalista*',
    'general',
    'nacional*',
    'tdt',
    'autonomic*',
    'regional*',
    'abierto*',
    'la 1',
    'la 2',
    'antena 3',
    'antena3',
    'cuatro',
    'telecinco',
    'lasexta',
    'la sexta',
    'trece',
    'tv3',
    'telemadrid',
    'canal sur',
    'etb',
    'a punt',
    'tvg',
    'aragon tv',
    'cmm',
    'ib3',
    'bbc one',
    'bbc two',
    'itv',
    'channel 4',
    'tf1',
    'france 2',
    'rai 1',
    'rai 2',
    'rai 3',
    'canale 5',
    'rtp 1',
    'sic',
    'tvi',
    'das erste',
    'zdf',
  ],
  deportes: [
    '~deport',
    '~sport',
    'esport*',
    'futbol',
    'football',
    'soccer',
    'dazn',
    'laliga',
    'gol',
    'goltv',
    'teledeporte',
    'eurosport',
    'bein',
    'espn',
    'sky sports',
    'tnt sports',
    'bt sport',
    'arena sport',
    'sportklub',
    'sport tv',
    'canal+ sport',
    'canal+ foot',
    'rmc sport',
    'setanta',
    'fox sports',
    'tudn',
    'tyc sports',
    'win sports',
    'directv sports',
    'real madrid tv',
    'barca tv',
  ],
  cine: [
    'cine*',
    'cinema*',
    'movie*',
    'film*',
    'pelicula*',
    'tcm',
    'cinemax',
    'hollywood',
    'sundance',
    'm+ estrenos',
    'xtrm',
  ],
  series: [
    'serie',
    'series',
    'sitcom',
    'novela*',
    'telenovela*',
    '247',
    'comedia',
    'comedy',
    'axn',
    'calle 13',
    'cosmo',
    'syfy',
    'warner tv',
    'hbo',
    'fox',
  ],
  noticias: [
    'noticia*',
    'news',
    'informativo*',
    '24h',
    '24 horas',
    'cnn',
    'bbc news',
    'euronews',
    'france 24',
    'al jazeera',
    'bloomberg',
    'sky news',
    'fox news',
    'cnbc',
    'dw',
    'rt',
  ],
  infantil: [
    'infantil*',
    'kids',
    'ninos',
    'children',
    'cartoon*',
    'dibujos',
    'clan',
    'boing',
    'disney junior',
    'disney channel',
    'nickelodeon',
    'nick jr',
    'nick',
    'baby tv',
    'cartoon network',
  ],
  documentales: [
    'document*',
    'docu*',
    'historia',
    'history',
    'naturaleza',
    'nature',
    'ciencia',
    'science',
    'discovery',
    'national geographic',
    'nat geo',
    'odisea',
    'viajar',
    'animal planet',
    'dmax',
    'canal historia',
  ],
  musica: [
    'musica*',
    'music*',
    'radio*',
    'hits',
    'mtv',
    'vh1',
    'los40',
    'sol musica',
    'mezzo',
    'stingray',
    'clubbing tv',
  ],
  entretenimiento: [
    'entretenimiento',
    'entertainment',
    'variedades',
    'lifestyle',
    'cocina',
    'food',
    'viajes',
    'travel',
    'reality*',
    'movistar plus',
    'movistar+',
    'divinity',
    'energy',
    'fdf',
    'neox',
    'nova',
    'mega',
    'paramount',
    'comedy central',
  ],
  religion: [
    'religion*',
    'religious',
    'iglesia',
    'catolic*',
    'cristian*',
    'evangel*',
    'islam*',
    'quran',
    '13tv',
    'ewtn',
  ],
};

/** Marcas para adultos, además de la regla `isAdultChannel` de §14.3. */
export const IPTV_ADULT_BRANDS: readonly string[] = [
  'playboy',
  'brazzers',
  'hustler',
  'dorcel',
  'private',
  'redlight',
  'vivid',
];

export const IPTV_SPORT_TERMS: Readonly<Record<IptvSport, readonly string[]>> = {
  futbol: [
    'futbol',
    'football',
    'soccer',
    'calcio',
    'futebol',
    'laliga',
    'hypermotion',
    'smartbank',
    'premier league',
    'epl',
    'serie a',
    'bundesliga',
    'ligue 1',
    'liga de campeones',
    'champions',
    'europa league',
    'conference league',
    'copa del rey',
    'supercopa',
    'liga f',
    'mls',
    'liga mx',
    'eredivisie',
    'gol',
    'goltv',
    'real madrid tv',
    'barca tv',
    'canal+ foot',
  ],
  baloncesto: [
    'baloncesto',
    'basket*',
    'acb',
    'liga endesa',
    'nba',
    'euroliga',
    'euroleague',
    'eurocup',
    'fiba',
    'wnba',
  ],
  f1: ['f1', 'formula 1', 'formula1', 'formula uno'],
  motos: ['motogp', 'moto gp', 'moto2', 'moto3', 'motoe', 'superbike*', 'sbk', 'motociclismo'],
  motor: [
    'motor',
    'motorsport*',
    'nascar',
    'indycar',
    'rally*',
    'wrc',
    'wec',
    'le mans',
    'dakar',
    'dtm',
    'formula e',
  ],
  tenis: ['tenis', 'tennis', 'atp', 'wta', 'wimbledon', 'roland garros', 'supertennis'],
  padel: ['padel', 'premier padel', 'world padel tour', 'wpt'],
  golf: ['golf', 'pga', 'lpga', 'ryder cup', 'dp world tour'],
  ciclismo: [
    'ciclismo',
    'cycling',
    'tour de francia',
    'tour de france',
    'la vuelta',
    'giro',
    'gcn',
  ],
  balonmano: ['balonmano', 'handball', 'asobal'],
  rugby: ['rugby', 'six nations', 'seis naciones'],
  lucha: ['boxeo', 'boxing', 'ufc', 'mma', 'wwe', 'lucha', 'kickboxing'],
  'futbol-americano': ['nfl', 'futbol americano', 'american football', 'redzone'],
  hockey: ['hockey', 'nhl'],
  beisbol: ['beisbol', 'baseball', 'mlb'],
  toros: ['toros', 'toros tv', 'tauromaquia'],
};

function parseTerm(raw: string, target: Target): Term {
  if (raw.startsWith('~')) return { tokens: [raw.slice(1)], mode: 'inside', target };
  if (raw.endsWith('*')) return { tokens: [raw.slice(0, -1)], mode: 'prefix', target };
  const tokens = raw.split(' ').filter(Boolean);
  return { tokens, mode: 'word', target };
}

interface TermIndex {
  /** Frases (2 palabras o más) por su primera palabra, de más largas a más cortas. */
  readonly phrases: ReadonlyMap<string, readonly Term[]>;
  /** Palabra exacta → destinos. */
  readonly words: ReadonlyMap<string, readonly Target[]>;
  /** Prefijos y «dentro» (pocos: se prueban todos). */
  readonly partial: readonly Term[];
}

function buildTermIndex(): TermIndex {
  const terms: Term[] = [];
  for (const type of IPTV_TYPES) {
    if (type === 'adultos') continue;
    for (const raw of IPTV_TYPE_TERMS[type])
      terms.push(parseTerm(raw, { kind: 'type', value: type }));
  }
  for (const sport of IPTV_SPORTS) {
    for (const raw of IPTV_SPORT_TERMS[sport])
      terms.push(parseTerm(raw, { kind: 'sport', value: sport }));
  }
  const phrases = new Map<string, Term[]>();
  const words = new Map<string, Target[]>();
  const partial: Term[] = [];
  for (const term of terms) {
    if (term.mode !== 'word') partial.push(term);
    else if (term.tokens.length > 1) {
      const first = term.tokens[0] as string;
      const list = phrases.get(first) ?? [];
      list.push(term);
      phrases.set(first, list);
    } else {
      const word = term.tokens[0] as string;
      const list = words.get(word) ?? [];
      list.push(term.target);
      words.set(word, list);
    }
  }
  for (const list of phrases.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  return { phrases, words, partial };
}

const TERMS = buildTermIndex();
const ADULT_BRANDS = new Set(IPTV_ADULT_BRANDS);

/** ¿Casa la palabra de la tabla con la del texto? Una con «+» solo casa con esa misma. */
function tokenIs(termToken: string, textToken: string): boolean {
  if (termToken.endsWith('+')) return textToken === termToken;
  return bare(textToken) === termToken;
}

interface TermMatch {
  readonly types: Set<IptvType>;
  readonly sports: Set<IptvSport>;
  readonly adult: boolean;
}

/** Tipos, deportes y marcas para adultos de unas palabras (frases primero, que gastan sus palabras). */
export function matchTerms(tokens: readonly string[]): TermMatch {
  const types = new Set<IptvType>();
  const sports = new Set<IptvSport>();
  const add = (target: Target): void => {
    if (target.kind === 'type') types.add(target.value);
    else sports.add(target.value);
  };
  const used = new Array<boolean>(tokens.length).fill(false);
  /* Frases: las candidatas de todas las posiciones, las más largas primero. */
  const found: { start: number; term: Term }[] = [];
  const tryPhrases = (list: readonly Term[] | undefined, start: number): void => {
    if (!list) return;
    for (const term of list) {
      if (start + term.tokens.length > tokens.length) continue;
      if (term.tokens.every((word, i) => tokenIs(word, tokens[start + i] as string))) {
        found.push({ start, term });
      }
    }
  };
  tokens.forEach((token, start) => {
    tryPhrases(TERMS.phrases.get(token), start);
    const plainToken = bare(token);
    if (plainToken !== token) tryPhrases(TERMS.phrases.get(plainToken), start);
  });
  found.sort((a, b) => b.term.tokens.length - a.term.tokens.length || a.start - b.start);
  /* La misma frase en dos tablas («real madrid tv»: deportes y fútbol) cuenta en las dos. */
  const spans = new Set<string>();
  for (const { start, term } of found) {
    const span = term.tokens.length;
    const key = `${start}:${span}`;
    if (!spans.has(key)) {
      let free = true;
      for (let i = start; i < start + span; i += 1) if (used[i]) free = false;
      if (!free) continue;
      for (let i = start; i < start + span; i += 1) used[i] = true;
      spans.add(key);
    }
    add(term.target);
  }
  let adult = false;
  tokens.forEach((token, index) => {
    if (used[index]) return;
    const plain = bare(token);
    if (ADULT_BRANDS.has(plain)) adult = true;
    for (const target of TERMS.words.get(token) ?? []) add(target);
    if (plain !== token) for (const target of TERMS.words.get(plain) ?? []) add(target);
    for (const term of TERMS.partial) {
      const word = term.tokens[0] as string;
      if (term.mode === 'prefix' ? plain.startsWith(word) : plain.includes(word)) add(term.target);
    }
  });
  return { types, sports, adult };
}

// --- Calidad ---

const QUALITY_RES: readonly (readonly [RegExp, IptvQuality])[] = [
  [/\b(?:uhd|4k|2160p?)\b/iu, 'uhd'],
  [/\b(?:fhd|full\s*hd|1080[pi]?)\b/iu, 'fhd'],
  [/\b(?:hd|720p?)\b/iu, 'hd'],
  [/\b(?:sd|480p?|576[pi]?)\b/iu, 'sd'],
];

/** La calidad de una variante: la de §4.2 o, si no tiene, la que se lee tras NFKC («⁴ᴷ» → 4K). */
export function variantQuality(title: string, quality: IptvQuality | null): IptvQuality | null {
  if (quality) return quality;
  const text = nfkc(String(title ?? ''));
  for (const [re, value] of QUALITY_RES) if (re.test(text)) return value;
  return null;
}

// --- Todo junto ---

export interface FacetInput {
  readonly title: string;
  readonly group: string;
  readonly tvgCountry?: string | null;
  readonly tvgLanguage?: string | null;
  readonly quality?: IptvQuality | null;
  /**
   * El país que ya sacó del nombre la limpieza de la lista real (§18, `cleanIptvTitle`): «DAZN 1 ES» o
   * «ES DAZN 1». Solo se usa si nada de lo de aquí lo dice.
   */
  readonly nameCountry?: string | null;
}

export interface ChannelFacets {
  readonly country: string | null;
  readonly languages: readonly string[];
  readonly types: readonly IptvType[];
  readonly sports: readonly IptvSport[];
  readonly quality: IptvQuality | null;
}

interface GroupFacets {
  readonly prefixCountry: string | null;
  readonly firstWordCountry: string | null;
  readonly bracketCountry: string | null;
  readonly languages: readonly string[];
  readonly match: TermMatch;
  readonly adult: boolean;
}

const TYPE_ORDER = new Map(IPTV_TYPES.map((type, index) => [type, index]));

/*
 * Marcas del nombre que solo son esa marca en su país (o sin país): «nova» es la de Atresmedia en España, pero
 * «GR: NOVA SPORTS 1» es Grecia y no suma Entretenimiento.
 */
const LOCAL_BRANDS: ReadonlyMap<string, string> = new Map([['nova', 'ES']]);

/** Las palabras del nombre sin las marcas locales de otro país. */
function brandTokens(tokens: readonly string[], country: string | null): readonly string[] {
  if (country === null) return tokens;
  return tokens.filter((token) => {
    const home = LOCAL_BRANDS.get(bare(token));
    return home === undefined || home === country;
  });
}
const SPORT_ORDER = new Map(IPTV_SPORTS.map((sport, index) => [sport, index]));

/**
 * Deduce las facetas de los canales con una caché por categoría (se crea una
 * por catálogo y se tira con él).
 */
export class FacetDeriver {
  private readonly groups = new Map<string, GroupFacets>();

  private group(name: string): GroupFacets {
    const known = this.groups.get(name);
    if (known) return known;
    const tokens = facetTokens(name);
    const list = name ? prefixes(name) : [];
    const facets: GroupFacets = {
      prefixCountry: prefixCountry(list),
      firstWordCountry: name ? firstWordCountry(name) : null,
      bracketCountry: name ? bracketCountry(name) : null,
      languages: name ? languageMarks(name, tokens, list) : [],
      match: matchTerms(tokens),
      adult: Boolean(name) && isAdultChannel('', name),
    };
    this.groups.set(name, facets);
    return facets;
  }

  /** País de un canal (el que separa las filas, §16.3). */
  country(
    input: Pick<FacetInput, 'title' | 'group' | 'tvgCountry' | 'nameCountry'>,
    titlePrefixes: readonly string[] = prefixes(input.title),
  ): string | null {
    const group = this.group(input.group ?? '');
    return (
      tvgCountryCode(input.tvgCountry) ??
      prefixCountry(titlePrefixes) ??
      group.prefixCountry ??
      group.firstWordCountry ??
      bracketCountry(input.title) ??
      group.bracketCountry ??
      nameCountryCode(input.nameCountry)
    );
  }

  derive(input: FacetInput): ChannelFacets {
    const group = this.group(input.group ?? '');
    const titlePrefixes = prefixes(input.title);
    const country = this.country(input, titlePrefixes);
    const tokens = facetTokens(input.title);
    const quality = variantQuality(input.title, input.quality ?? null);

    const languages: string[] = [];
    const addLanguage = (code: string | null | undefined): void => {
      if (code && !languages.includes(code)) languages.push(code);
    };
    if (input.tvgLanguage)
      for (const code of tvgLanguageCodes(input.tvgLanguage)) addLanguage(code);
    for (const code of languageMarks(input.title, tokens, titlePrefixes)) addLanguage(code);
    for (const code of group.languages) addLanguage(code);
    if (!languages.length && country) addLanguage(LANGUAGE_BY_COUNTRY.get(country));

    const name = matchTerms(brandTokens(tokens, country));
    const adult = group.adult || name.adult || group.match.adult || isAdultChannel(input.title, '');
    if (adult) {
      return { country, languages, types: ['adultos'], sports: [], quality };
    }
    const sports = new Set<IptvSport>([...group.match.sports, ...name.sports]);
    const types = new Set<IptvType>([...group.match.types, ...name.types]);
    if (sports.size) types.add('deportes');
    return {
      country,
      languages,
      types: [...types].sort((a, b) => (TYPE_ORDER.get(a) ?? 0) - (TYPE_ORDER.get(b) ?? 0)),
      sports: [...sports].sort((a, b) => (SPORT_ORDER.get(a) ?? 0) - (SPORT_ORDER.get(b) ?? 0)),
      quality,
    };
  }
}

/** Facetas de un canal suelto (tests y usos de uno en uno). */
export function deriveFacets(input: FacetInput): ChannelFacets {
  return new FacetDeriver().derive(input);
}
