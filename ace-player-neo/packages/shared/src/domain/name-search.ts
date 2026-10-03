/* Buscar por NOMBRE (canales de la IPTV, y después Pelis y series): las
   palabras de un nombre, lo que escribe una persona y el orden por
   parecido (0.9.0, docs/buscador.md). Pura, sin estado y sin índices: el
   servidor la usa sobre su índice de palabras (iptv/search.ts y la pestaña
   IPTV, iptv/browse.ts) y la web en el modo demo y para resaltar lo que
   casa.

   1. Las palabras de un nombre (`nameSearchWords`), sea limpio («La 1») o
      tal cual lo da el panel («ES► LA 1 FHD ⁺»): sin país delante en
      ninguna de sus formas («ES: », «|ES| », «[ES] », «ES► », «◉ ES: »,
      «ES ✪ », «ESPAÑA - », «ES » suelto…), sin calidad, códec ni
      fotogramas (4K, UHD, FHD, HD, SD, HEVC, H265, 50FPS, «4K HDR»,
      superíndices ᴴᴰ…), sin adornos ni reservas (VIP, ᴿᴬᵂ, «(backup)», la
      copia «(2)» o «#2» del final, emojis, ◉ ┃ ★ ✪), sin tildes ni
      mayúsculas, con la grafía única de `channelSpelling` (M+ → Movistar,
      «la liga» → «laliga», «tele 5» → «telecinco», «antena3» → «antena
      3»…), «La 1 TVE» = «La 1» y los números escritos con letra detrás de
      otra palabra como cifra («la uno» = «la 1», «RAI UNO» = «RAI 1»;
      «cero» siempre es 0, el «#0» de Movistar). Una palabra que empieza el
      nombre se deja como está: «Cuatro» y «Ten» son canales.
   2. Lo que se escribe (`parseNameQuery`): las mismas palabras, el país que
      se pide delante («uk: la liga tv»), «m» o «mov» delante como Movistar
      y los alias de siempre (Champions, TVE, A3, TDP), que buscan además
      otra cosa.
   3. El nivel de parecido (`nameTier`), de mejor a peor: 0 igual; 1 de la
      familia (sin el número del final o sin la marca de delante: «dazn» →
      «DAZN 1», «laliga» → «DAZN LaLiga»); 2 empieza por lo escrito; 3 con
      las palabras enteras y en orden; 4 con las palabras en otro orden o
      por su principio; 5 por dentro de una palabra o pegado; 6 sin la marca
      Movistar escrita («m+ vamos» → «#VAMOS»). Un número solo casa entero:
      «la 1» nunca es «La 10» ni «La 100»; y «la» solo es el principio de
      «LaLiga» en los niveles 4 y 5, así que «la 1» da antes «La 1», «La 1
      Catalunya» y «La 1 Canarias» que «LaLiga TV 1». El servidor añade el
      suyo detrás: 7, por la categoría del proveedor.
   4. El orden (`compareNameRank`): lo flojo (nivel 4 o peor) detrás de todo
      lo bueno; dentro, el país pedido, luego el de casa (España o sin país),
      luego América en español y luego el resto; lo que casa por un alias;
      lo igual; los favoritos; y el nivel. Quien lo use desempata después
      (calidad, número, nombre más corto, orden del proveedor): `rankByName`
      lo hace para listas pequeñas (la demo, Pelis y series).
   5. `nameHighlights`: los trozos de un nombre que casan con lo escrito,
      para resaltarlos en la fila. */

import { channelSpelling } from './channel-names.js';

// ---- Plegado ---------------------------------------------------------------------------

/* Superíndices de las listas: las calidades se leen como tales y el resto (ᵛᶦᵖ, ᴺᴱᵂ) se quita. */
const SUPERSCRIPT_WORDS: readonly (readonly [RegExp, string])[] = [
  [/ᵁᴴᴰ|⁴ᴷ/gu, ' uhd '],
  [/ᶠᴴᴰ/gu, ' fhd '],
  [/ᴴᴰ/gu, ' hd '],
  [/ˢᴰ/gu, ' sd '],
  [/ᴿᴬᵂ/gu, ' raw '],
];
const SUPERSCRIPT_RE = /[\u1D2C-\u1D6A\u1D9B-\u1DBF\u2070-\u209F]+/gu;
const MARKS_RE = /[\u0300-\u036f]/g;

/**
 * Minúsculas, sin tildes y con las letras de ancho completo o de estilo
 * normalizadas (NFKC): «Fútbol» → «futbol», «Ｌａ １» → «la 1». Los
 * superíndices de calidad se leen («ᴴᴰ» → « hd ») y los demás se quitan.
 */
export function foldSearchText(value: string): string {
  let text = String(value ?? '');
  for (const [re, to] of SUPERSCRIPT_WORDS) text = text.replace(re, to);
  return text
    .replace(SUPERSCRIPT_RE, ' ')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(MARKS_RE, '')
    .toLowerCase();
}

// ---- Palabras de un nombre ---------------------------------------------------------------

/* Lo que va tras la flecha de un título de AceStream («La 1 HD --> ELCANO») es quién lo sirve. */
const ARROW_TAIL_RE = /\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹]).*$/u;
/* Siglas de 3 letras que son un país en las listas (con 2 letras vale cualquiera). */
// prettier-ignore
const COUNTRY_3: ReadonlySet<string> = new Set([
  'esp', 'spa', 'usa', 'gbr', 'eng', 'deu', 'ger', 'fra', 'ita', 'por', 'prt', 'nld', 'hol', 'bel',
  'che', 'sui', 'aut', 'pol', 'rou', 'rom', 'rus', 'ukr', 'tur', 'grc', 'gre', 'swe', 'nor', 'dnk',
  'den', 'fin', 'irl', 'cze', 'hun', 'hrv', 'cro', 'srb', 'alb', 'bul', 'arg', 'mex', 'bra', 'col',
  'chl', 'chi', 'per', 'ven', 'uru', 'ecu', 'bol', 'par', 'cub', 'dom', 'can', 'aus', 'ind', 'pak',
  'lat', 'lam', 'arb', 'ara', 'afr', 'mar', 'alg', 'tun', 'egy', 'ksa', 'uae', 'qat', 'isr', 'kur',
  /* Adornos que van delante como un país. */
  'vip', 'ppv', 'hot', 'new', 'top', 'fhd', 'uhd', 'tve',
]);
/* Con 4 letras o más, solo estas. */
const COUNTRY_LONG: ReadonlySet<string> = new Set(['exyu', 'latam', 'latino', 'espana', 'spain']);
/*
 * El país (o un adorno) delante, con lo que lo separa del nombre: símbolos de
 * cualquier tipo («ES: », «|ES| », «ES► », «ES ✪ », «ES┃», «[ES] », «◉ ES:
 * ») o, sin símbolo, la plataforma detrás («ES TI - »). Se mira sobre el texto
 * plegado.
 */
const LEAD_PREFIX_RE =
  /^[\s\p{P}\p{S}]*([a-z]{2,6}|4k)(?:\s+[a-z]{2,3})?[\s]*[\p{P}\p{S}]+[\s\p{P}\p{S}]*/u;
/* España delante sin símbolo: «ES DAZN 1», «esp la 1» (otras siglas son palabras: «de», «la», «tv»). */
const LEAD_SPAIN_RE = /^[\s\p{P}\p{S}]*(?:es|esp|espana|spain)\s+(?=[\p{L}\p{N}])/u;
/* La copia del final: «(2)», «[2]», «#2» (no «#0», que es un canal de Movistar). */
const COPY_TAIL_RE = /\s*(?:[([]\s*\d{1,2}\s*[)\]]|#\s*[1-9]\d?)\s*$/u;
/* Fotogramas sueltos: «50 fps», «60FPS». */
const FPS_RE = /\b\d{2}\s*fps\b/gu;
/* RTVE detrás de su canal («La 1 TVE», «Clan RTVE») o delante con el número («TVE 1» → «la 1»). */
const TVE_AFTER_RE = /\b(la\s*[12]|clan|24\s*h(?:oras)?|teledeporte|tdp)\s+r?tve\b/gu;
const TVE_NUMBER_RE = /\br?tve\s*([12])\b/gu;

/** Palabras que no dicen qué canal es: calidad, códec, fotogramas, reservas y adornos. */
const NOISE_WORDS: ReadonlySet<string> = new Set([
  'uhd',
  '4k',
  '8k',
  'fhd',
  'hd',
  'sd',
  'hq',
  'hevc',
  'h265',
  'h264',
  'x265',
  'x264',
  'avc',
  'hdr',
  'hdr10',
  'fps',
  'raw',
  'vip',
  'backup',
  'bkp',
  'bk',
  'reserva',
  'respaldo',
  'multi',
  'multiaudio',
]);
/* «1080p», «720p50», «2160», «1080i»… (resoluciones, nunca el número del canal). */
const RESOLUTION_RE = /^(?:2160|1440|1080|720|576|480|360)(?:[pi]\d{0,2})?$/u;

/** Números escritos con letra (castellano, catalán, italiano, inglés, francés y portugués). */
// prettier-ignore
export const NUMBER_WORDS: Readonly<Record<string, string>> = {
  cero: '0', zero: '0',
  uno: '1', one: '1', um: '1',
  dos: '2', due: '2', two: '2', deux: '2', dois: '2',
  tres: '3', tre: '3', three: '3', trois: '3',
  cuatro: '4', quattro: '4', four: '4', quatre: '4', quatro: '4',
  cinco: '5', cinque: '5', five: '5', cinq: '5',
  seis: '6', sei: '6', six: '6',
  siete: '7', sette: '7', seven: '7', sept: '7', sete: '7',
  ocho: '8', otto: '8', eight: '8', huit: '8', oito: '8',
  nueve: '9', nove: '9', nine: '9', neuf: '9',
  diez: '10', dieci: '10', dix: '10', dez: '10',
};

/* Siglas de 2 letras que son palabras de un nombre, no un país («TV-3», «LA - 1»). */
const NOT_COUNTRY_2: ReadonlySet<string> = new Set([
  'tv',
  'la',
  'el',
  'lo',
  'mi',
  'tu',
  'su',
  'un',
]);

function isCountryLike(code: string): boolean {
  if (code.length === 2) return !NOT_COUNTRY_2.has(code);
  if (code.length === 3) return COUNTRY_3.has(code);
  return COUNTRY_LONG.has(code);
}

/* Quita el país (o el adorno) de delante, hasta tres veces («VIP | ES: …»), si queda algo detrás. */
function stripLead(text: string): string {
  let out = text;
  for (let guard = 0; guard < 3; guard += 1) {
    const prefix = LEAD_PREFIX_RE.exec(out);
    if (
      prefix?.[1] &&
      isCountryLike(prefix[1]) &&
      /[\p{L}\p{N}]/u.test(out.slice(prefix[0].length))
    ) {
      out = out.slice(prefix[0].length);
      continue;
    }
    const spain = LEAD_SPAIN_RE.exec(out);
    if (spain) {
      out = out.slice(spain[0].length);
      continue;
    }
    break;
  }
  return out;
}

/* Adornos del final que tapan la copia («TELECINCO #2 ★»): lo que no es letra, número, cierre ni el «+» pegado (LaLiga+). */
const TRAILING_DECOR_RE = /[^\p{L}\p{N})\]+]+$/u;
/* La reserva escrita: «(BK-1)», «[BK 2]», «BK-1», «bk2», «backup 2», «ALT 1» (el número es de la reserva). */
const BACKUP_TAG_RE =
  /[([]\s*(?:bk|bkp|backup)\s*[-_]?\s*\d{0,2}\s*[)\]]|\b(?:backup|back\s*up|bkp|bk|alt|alternativ[oa]|reserva|respaldo)(?:\s?[-_]?\s?\d{1,2})?\b/gu;
/* Una copia entre paréntesis o corchetes en cualquier sitio («DAZN 1 (2) HD»): nunca es el número del canal. */
const COPY_INNER_RE = /[([]\s*\d{1,2}\s*[)\]]|#\s*[1-9]\d?\b/gu;

/**
 * Las palabras con las que se busca un nombre (o lo que se escribe): ver la
 * cabecera, punto 1. Vacío si no queda nada (un nombre que solo es «HD»).
 */
export function nameSearchWords(value: string): string[] {
  /* La «Ñ» suelta marca la versión española («BEIN SPORTS Ñ»): no es una palabra. */
  let text = foldSearchText(
    String(value ?? '')
      .replace(ARROW_TAIL_RE, ' ')
      .replace(/(^|\s)[Ññ](?=\s|$)/gu, '$1'),
  );
  /* El país de delante, antes de la grafía (la de Movistar mira el principio). */
  text = stripLead(text);
  /* La copia y la reserva («(2)», «#2», «(BK-1)»), si queda nombre delante. */
  text = text.replace(TRAILING_DECOR_RE, '');
  text = text.replace(COPY_TAIL_RE, (copy, offset: number) =>
    /[\p{L}\p{N}]/u.test(text.slice(0, offset)) ? ' ' : copy,
  );
  text = text.replace(COPY_INNER_RE, (copy, offset: number) =>
    offset > 0 && /[\p{L}\p{N}]/u.test(text.slice(0, offset)) ? ' ' : copy,
  );
  text = text.replace(BACKUP_TAG_RE, ' ');
  text = foldSearchText(channelSpelling(text));
  text = text.replace(FPS_RE, ' ').replace(TVE_AFTER_RE, '$1').replace(TVE_NUMBER_RE, 'la $1');
  /* «M+» y «Movistar Plus+» sueltos (sin otra palabra detrás) también son Movistar. */
  text = text.replace(/\bm\s*\+/gu, ' movistar ').replace(/\bmovistar\s*plus\b\+?/gu, ' movistar ');
  const words: string[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || NOISE_WORDS.has(raw) || RESOLUTION_RE.test(raw)) continue;
    if (/^\d{2,3}fps$/u.test(raw) || /^(?:2160|1080|720)p\d{2}$/u.test(raw)) continue;
    const number = NUMBER_WORDS[raw];
    if (number !== undefined && (words.length > 0 || number === '0')) {
      words.push(number);
      continue;
    }
    words.push(raw);
  }
  /* «full hd»: el «full» suelto que queda delante de una calidad quitada. */
  if (words.length > 1 && words[words.length - 1] === 'full' && /\bfull\s*hd\b/u.test(text)) {
    words.pop();
  }
  /* «A3» a secas es Antena 3 (con la calidad detrás, `channelSpelling` no lo ve: «A3 HD»). */
  if (words.length === 1 && words[0] === 'a3') return ['antena', '3'];
  return words;
}

/**
 * El país escrito delante de un nombre («UK: DAZN 1» → «UK», «ES► LA 1» →
 * «ES», «ESPAÑA - LA 1» → «ES»), o null si no lleva (o lo de delante es un
 * adorno: «VIP - …», «4K | …»).
 */
export function leadingCountry(value: string): string | null {
  let text = foldSearchText(String(value ?? ''));
  for (let guard = 0; guard < 3; guard += 1) {
    const prefix = LEAD_PREFIX_RE.exec(text);
    const code = prefix?.[1];
    if (prefix && code && isCountryLike(code)) {
      if (!ADORNMENT_CODES.has(code)) return countryOfCode(code);
      text = text.slice(prefix[0].length);
      continue;
    }
    return LEAD_SPAIN_RE.test(text) ? 'ES' : null;
  }
  return null;
}

/* Lo que va delante como un país sin serlo. */
const ADORNMENT_CODES: ReadonlySet<string> = new Set([
  'vip',
  'ppv',
  'hot',
  'new',
  'top',
  'fhd',
  'uhd',
  'tve',
  '4k',
  'hd',
  'sd',
]);

function countryOfCode(code: string): string {
  if (['es', 'esp', 'spa', 'espana', 'spain'].includes(code)) return 'ES';
  if (code === 'gb' || code === 'gbr' || code === 'eng') return 'UK';
  if (code === 'latam' || code === 'latino' || code === 'lam') return 'LAT';
  return code.toUpperCase();
}

const NORMALIZED_KEY_RE = /^[a-z0-9]+(?: [a-z0-9]+)*$/;

/**
 * `nameSearchWords` para una clave ya normalizada del catálogo
 * (`normalizeChannelKey` sobre un nombre ya limpio y con `channelSpelling`:
 * «rai uno», «movistar laliga tv 2»): solo trocea, quita lo que no dice qué
 * canal es y pasa los números con letra a cifra. Diez veces más rápido; da lo
 * mismo que `nameSearchWords` con esas claves (lo prueba el servidor con el
 * corpus). Con otra cosa, `nameSearchWords`.
 */
export function keySearchWords(key: string): string[] {
  if (!NORMALIZED_KEY_RE.test(key)) return nameSearchWords(key);
  const words: string[] = [];
  for (const raw of key.split(' ')) {
    if (NOISE_WORDS.has(raw) || RESOLUTION_RE.test(raw)) continue;
    if (/^\d{2,3}fps$/u.test(raw) || /^(?:2160|1080|720)p\d{2}$/u.test(raw)) continue;
    const number = NUMBER_WORDS[raw];
    words.push(number !== undefined && (words.length > 0 || number === '0') ? number : raw);
  }
  if (words.length === 1 && words[0] === 'a3') return ['antena', '3'];
  return words;
}

/** Las palabras de un nombre unidas por espacios («ES► LA 1 FHD» → «la 1»). */
export function nameSearchKey(value: string): string {
  return nameSearchWords(value).join(' ');
}

// ---- Hechos de un nombre -----------------------------------------------------------------

/** Palabras que no hace falta encontrar: «m+ laliga tv» es «M. LALIGA» aunque la lista no diga «tv». */
export const OPTIONAL_SEARCH_WORDS: ReadonlySet<string> = new Set([
  'tv',
  'canal',
  'canales',
  'channel',
  'channels',
]);
/** La marca de delante que se quita para comparar la familia («dazn laliga» y «movistar laliga» → «laliga»). */
export const BRAND_SEARCH_WORDS: ReadonlySet<string> = new Set(['movistar', 'dazn', 'm']);

const NUMBER_RE = /^\d+$/;

/** Las palabras que tienen que casar: sin «tv», «canal» ni «channel» si hay otras. */
export function significantWords(words: readonly string[]): string[] {
  const out = words.filter((word) => !OPTIONAL_SEARCH_WORDS.has(word));
  return out.length ? out : [...words];
}

function familyWords(sig: readonly string[]): string[] {
  return sig.length > 1 && NUMBER_RE.test(sig[sig.length - 1] as string)
    ? sig.slice(0, -1)
    : [...sig];
}

function coreWords(family: readonly string[]): string[] {
  if (family.length > 1 && BRAND_SEARCH_WORDS.has(family[0] as string)) {
    const rest = family.slice(1);
    if (rest.some((word) => /\p{L}/u.test(word))) return rest;
  }
  return [...family];
}

/** Lo que se mira de un nombre para compararlo (se calcula una vez por nombre). */
export interface NameFacts {
  /** Sus palabras (`nameSearchWords`). */
  readonly words: readonly string[];
  /** Las que cuentan (sin «tv», «canal», «channel»). */
  readonly sigWords: readonly string[];
  readonly sig: string;
  /** `sig` sin el número del final («movistar laliga 1» → «movistar laliga»). */
  readonly family: string;
  /** `family` sin la marca de delante si queda algo con letras («dazn laliga» → «laliga»). */
  readonly core: string;
  /** Las palabras pegadas («lasexta»). */
  readonly compact: string;
  /** El número del final («DAZN 3» → 3; sin número, 0): la familia va en orden. */
  readonly number: number;
}

/** Los hechos de un nombre a partir de sus palabras (ya calculadas con `nameSearchWords`). */
export function nameFacts(words: readonly string[]): NameFacts {
  const sigWords = significantWords(words);
  const family = familyWords(sigWords);
  const trailing = sigWords.length > family.length ? Number(sigWords[sigWords.length - 1]) : 0;
  return {
    words,
    sigWords,
    sig: sigWords.join(' '),
    family: family.join(' '),
    core: coreWords(family).join(' '),
    compact: words.join(''),
    number: Number.isFinite(trailing) ? trailing : 0,
  };
}

/** `nameFacts(nameSearchWords(name))`. */
export function nameFactsOf(name: string): NameFacts {
  return nameFacts(nameSearchWords(name));
}

// ---- Lo que se escribe ----------------------------------------------------------------------

/* Países que alguien escribe delante, en cualquier caja: «es-m.laliga», «[es] dazn 1», «uk: …». */
// prettier-ignore
const QUERY_COUNTRIES: ReadonlySet<string> = new Set([
  'es', 'esp', 'spa', 'uk', 'gb', 'de', 'ger', 'fr', 'fra', 'pt', 'por', 'it', 'ita', 'us', 'usa', 'mx',
  'ar', 'arg', 'co', 'cl', 'pe', 'per', 'ec', 've', 'br', 'nl', 'be', 'ch', 'at', 'pl', 'ro', 'se', 'sw',
  'no', 'dk', 'fi', 'ie', 'tr', 'ru', 'ca', 'ad', 'lat',
]);
const SPAIN_CODES: ReadonlySet<string> = new Set(['es', 'esp', 'spa']);
/* «[es] », «(es) », «es-», «es:», «es|», «es - », «|es| ». */
const QUERY_COUNTRY_RE = /^\s*(?:[[(|]\s*(\p{L}{2,3})\s*[\])|]|(\p{L}{2,3})\s*[-–:|]+)\s*/iu;
/* Lo que escribe una persona: «m laliga» o «mov laliga» es Movistar (en una lista no se toca). */
const QUERY_MOVISTAR_RE = /^\s*(?:m|mov)\s+(?=[\p{L}\p{N}])/iu;

/** Una consulta lista para comparar (sin alias). */
export interface NameQueryWords {
  /** Sus palabras unidas («la 1»). Vacía: no hay nada que buscar. */
  readonly key: string;
  readonly words: readonly string[];
  /** Las que tienen que casar (sin «tv», «canal» ni «channel» si hay otras), sin repetir. */
  readonly required: readonly string[];
  readonly sig: string;
  readonly core: string;
  readonly compact: string;
}

/** Un alias de la consulta: otra consulta y el peor nivel que se le acepta. */
export interface NameQueryAlias {
  readonly query: NameQueryWords;
  readonly maxTier: number;
}

export interface NameQuery extends NameQueryWords {
  /** Lo escrito sin el país pedido delante, con los espacios colapsados («uk: la liga tv» → «la liga tv»). */
  readonly text: string;
  /** El país pedido delante («uk: la liga tv» → «UK»); '' si ninguno o España. */
  readonly country: string;
  /** Otras consultas que buscar (Champions, TVE, A3, TDP): lo que casa con ellas se suma. */
  readonly aliases: readonly NameQueryAlias[];
  /** Las palabras de relleno que se escribieron («laliga tv» → ['tv']). */
  readonly typedOptional: readonly string[];
}

/** Las palabras de una consulta ya troceada. */
export function queryWordsOf(words: readonly string[]): NameQueryWords {
  const sigWords = significantWords(words);
  return {
    key: words.join(' '),
    words,
    required: significantWords([...new Set(words)]),
    sig: sigWords.join(' '),
    core: coreWords(familyWords(sigWords)).join(' '),
    compact: words.join(''),
  };
}

/* «champions», «champions league», «la champions», «uefa champions league» y «ucl» son la Liga de Campeones;
   «champions tour» (golf), la de hockey o la «champions cup» (rugby), no. */
const CHAMPIONS_RE = /(?:^| )(?:uefa )?(?:la )?(?:champions(?: league)?|ucl)(?= |$)/u;
const NOT_CHAMPIONS_RE = /(?:^| )(?:tour|hockey|cup|chl)(?= |$)/u;
/** «tve» o «rtve» a secas: los canales de RTVE. */
const RTVE_FAMILY: readonly string[] = ['la 1', 'la 2', 'teledeporte', '24h', '24 horas', 'clan'];

/**
 * Otras claves que buscar para una consulta (sobre su clave ya limpia): la
 * Liga de Campeones como la llama la gente, la familia de RTVE, «a3» (Antena
 * 3) y «tdp» (Teledeporte). Lo que casa con un alias se suma a lo que casa al
 * pie de la letra (no lo quita).
 */
export function nameQueryAliases(key: string): { key: string; maxTier: number }[] {
  if (key === 'tve' || key === 'rtve')
    return RTVE_FAMILY.map((alias) => ({ key: alias, maxTier: 2 }));
  if (key === 'a3') return [{ key: 'antena 3', maxTier: 2 }];
  if (key === 'tdp') return [{ key: 'teledeporte', maxTier: 2 }];
  if (CHAMPIONS_RE.test(key) && !NOT_CHAMPIONS_RE.test(key)) {
    const alias = key.replace(CHAMPIONS_RE, ' liga de campeones').trim();
    if (alias !== key) return [{ key: alias, maxTier: 5 }];
  }
  return [];
}

/**
 * Lo que escribe una persona, listo para buscar: el país pedido delante (en
 * cualquier caja), «m»/«mov» delante como Movistar, las palabras de
 * `nameSearchWords` y los alias.
 */
export function parseNameQuery(value: string): NameQuery {
  let text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  let country = '';
  const prefix = QUERY_COUNTRY_RE.exec(text);
  const code = (prefix?.[1] ?? prefix?.[2] ?? '').toLowerCase();
  if (prefix && QUERY_COUNTRIES.has(code) && prefix[0].length < text.length) {
    country = SPAIN_CODES.has(code) ? '' : code === 'gb' ? 'UK' : code.toUpperCase();
    text = text.slice(prefix[0].length);
  }
  const words = nameSearchWords(text.replace(QUERY_MOVISTAR_RE, 'Movistar '));
  const base = queryWordsOf(words);
  const all = new Set(words);
  return {
    ...base,
    text,
    country,
    aliases: nameQueryAliases(base.key).map((alias) => ({
      query: queryWordsOf(alias.key.split(' ')),
      maxTier: alias.maxTier,
    })),
    typedOptional:
      base.required.length < all.size
        ? [...all].filter((word) => OPTIONAL_SEARCH_WORDS.has(word))
        : [],
  };
}

// ---- Parecido ---------------------------------------------------------------------------------

/** Niveles de parecido por el nombre (de mejor a peor). */
export const NAME_TIER = {
  /** Igual («la 1» → «La 1»; «la1» → «La 1»). */
  exact: 0,
  /** De la familia: sin el número del final o sin la marca de delante («dazn» → «DAZN 1»). */
  family: 1,
  /** Empieza por lo escrito («la 1» → «La 1 Catalunya»). */
  prefix: 2,
  /** Con las palabras enteras y en orden («laliga 2» → «DAZN LaLiga 2»). */
  words: 3,
  /** Con las palabras en otro orden o por su principio («la 1» → «LaLiga TV 1»). */
  partial: 4,
  /** Por dentro de una palabra o pegado («liga» → «LaLiga»). */
  inside: 5,
  /** Sin la marca Movistar escrita («m+ vamos» → «#VAMOS»): las listas no siempre la ponen. */
  brandless: 6,
} as const;

/** Las palabras que se leen como la marca Movistar (`MOVISTAR_WORDS` de channel-names.ts). */
const MOVISTAR_SEARCH_WORDS: ReadonlySet<string> = new Set(['movistar', 'm', 'mov', 'moviestar']);
/** Desde este nivel, lo que casa es flojo: va detrás de todo lo bueno, sea del país que sea. */
export const NAME_TIER_WEAK = NAME_TIER.partial;

/*
 * Compuestos que una palabra puede encontrar por dentro («liga» en «laliga»,
 * «sexta» en «lasexta»). Fuera de estos, dentro de una palabra solo casa con
 * 5 letras o más («nba» no casa con «dazn baloncesto»).
 */
const COMPOUND_PARTS: Readonly<Record<string, readonly string[]>> = {
  laliga: ['liga'],
  lasexta: ['sexta'],
  telecinco: ['cinco'],
  teledeporte: ['deporte'],
  telemadrid: ['madrid'],
  motogp: ['gp'],
  onetoro: ['toro'],
  bemad: ['mad'],
  atreseries: ['series'],
};

const DIGIT_RE = /\d/;

/* ¿Casa `word` por dentro de `token` (no por el principio)? */
function insideMatch(token: string, word: string): boolean {
  if (NUMBER_RE.test(word) || token.startsWith(word)) return false;
  const at = token.indexOf(word);
  if (at < 0) return false;
  /* «f1» no está dentro de «f10». */
  if (DIGIT_RE.test(word.slice(-1)) && DIGIT_RE.test(token.charAt(at + word.length))) return false;
  if (word.length >= 5) return true;
  return (COMPOUND_PARTS[token] ?? []).some((part) => part.startsWith(word));
}

/**
 * Cómo casa una palabra escrita con una palabra del nombre: 3 igual, 2 por
 * el principio, 1 por dentro, 0 no casa. Un número solo casa entero («1» no
 * es «10»), aunque sí es el principio de «24h» o «3cat»; y una palabra que
 * acaba en número no es el principio de otra que sigue con números («f1» no
 * es «f10»).
 */
export function wordMatch(token: string, word: string): number {
  if (token === word) return 3;
  if (token.startsWith(word)) {
    const next = token.charAt(word.length);
    if (DIGIT_RE.test(word.slice(-1)) && DIGIT_RE.test(next)) return 0;
    if (NUMBER_RE.test(word) && !/\p{L}/u.test(next)) return 0;
    return 2;
  }
  return insideMatch(token, word) ? 1 : 0;
}

/*
 * ¿Vale lo escrito pegado («antena3», «la1») a partir de la palabra `from`
 * del nombre? Si se queda dentro de esa palabra, sí. Si pasa a la siguiente,
 * la última palabra que toca tiene que casar entera, con 2 letras o más, o
 * con números («tve» no es «REAL MADRID TV EN»); y un número escrito no se
 * corta («la1» no es «La 10»).
 */
function compactJoinOk(words: readonly string[], from: number, compact: string): boolean {
  let rest = compact.length;
  let at = from;
  while (at < words.length - 1 && rest > (words[at] as string).length) {
    rest -= (words[at] as string).length;
    at += 1;
  }
  const last = words[at] as string;
  if (DIGIT_RE.test(compact.slice(-1)) && DIGIT_RE.test(last.charAt(rest))) return false;
  if (at === from) return true;
  return rest >= Math.min(2, last.length) || NUMBER_RE.test(last.slice(0, rest));
}

/** El nivel de lo escrito pegado («la1», «antena3»), o -1. */
function compactTier(query: NameQueryWords, facts: NameFacts): number {
  if (query.compact.length < 3) return -1;
  if (facts.compact === query.compact) return NAME_TIER.exact;
  if (!facts.compact.includes(query.compact)) return -1;
  const { words } = facts;
  for (let i = 0; i < words.length; i += 1) {
    let joined = '';
    for (let j = i; j < words.length && joined.length < query.compact.length; j += 1) {
      joined += words[j] as string;
    }
    if (joined.startsWith(query.compact) && compactJoinOk(words, i, query.compact)) {
      return i === 0 ? NAME_TIER.prefix : NAME_TIER.partial;
    }
  }
  return -1;
}

/**
 * El nivel de parecido de un nombre con lo escrito (`NAME_TIER`), o -1 si no
 * casa: cada palabra escrita (menos «tv», «canal» y «channel», que no hace
 * falta encontrar) tiene que casar con una del nombre (`wordMatch`); o lo
 * escrito pegado, con el nombre pegado desde el principio de una palabra.
 */
export function nameTier(query: NameQueryWords, facts: NameFacts): number {
  if (!query.required.length) return -1;
  const byCompact = compactTier(query, facts);
  if (byCompact === NAME_TIER.exact) return byCompact;
  /* Si lo escrito es solo relleno («canal», «tv»), el relleno del nombre también cuenta: «canal» empieza «Canal 5». */
  const words = query.required.some((word) => OPTIONAL_SEARCH_WORDS.has(word))
    ? facts.words
    : facts.sigWords;
  /* Cada palabra escrita casa con alguna del nombre (en cualquier orden). */
  for (const word of query.required) {
    if (!facts.words.some((token) => wordMatch(token, word) > 0)) {
      return byCompact >= 0 ? byCompact : brandlessTier(query, facts);
    }
  }
  if (facts.sig === query.sig) return NAME_TIER.exact;
  if (facts.family === query.sig || facts.core === query.sig || facts.core === query.core) {
    return NAME_TIER.family;
  }
  /* En orden: dónde casa cada una, cómo y si van seguidas desde la primera. */
  let from = 0;
  let previous = -1;
  let ordered = true;
  let start = -1;
  let together = true;
  let whole = true;
  let inside = false;
  const last = query.required.length - 1;
  for (let i = 0; i <= last; i += 1) {
    const word = query.required[i] as string;
    let found = -1;
    let how = 0;
    for (let j = from; j < words.length; j += 1) {
      how = wordMatch(words[j] as string, word);
      if (how) {
        found = j;
        break;
      }
    }
    if (found < 0) {
      ordered = false;
      break;
    }
    if (i === 0) start = found;
    if (previous >= 0 && found !== previous + 1) together = false;
    if (how === 1) inside = true;
    if (how === 2 && i < last) whole = false;
    previous = found;
    from = found + 1;
  }
  let tier: number;
  if (!ordered) {
    /* En otro orden: por dentro de una palabra es lo más flojo. */
    const anyInside = query.required.some(
      (word) => !facts.words.some((token) => wordMatch(token, word) >= 2),
    );
    tier = anyInside ? NAME_TIER.inside : NAME_TIER.partial;
  } else if (inside) tier = NAME_TIER.inside;
  else if (start === 0 && together && whole) tier = NAME_TIER.prefix;
  else if (whole) tier = NAME_TIER.words;
  else tier = NAME_TIER.partial;
  return byCompact >= 0 ? Math.min(tier, byCompact) : tier;
}

/*
 * Sin la marca Movistar escrita («movistar vamos» → «#VAMOS»): las demás
 * palabras casan por el principio de una palabra del nombre (nunca por
 * dentro: «movistar ellas» no es «LAS ESTRELLAS»), si queda alguna de 3
 * letras o más que no sea un número.
 */
function brandlessTier(query: NameQueryWords, facts: NameFacts): number {
  const rest = query.required.filter((word) => !MOVISTAR_SEARCH_WORDS.has(word));
  if (rest.length === query.required.length) return -1;
  if (!rest.some((word) => word.length >= 3 && !NUMBER_RE.test(word))) return -1;
  const all = rest.every((word) => facts.words.some((token) => wordMatch(token, word) >= 2));
  return all ? NAME_TIER.brandless : -1;
}

/**
 * El nivel con la consulta y sus alias: el mejor. `lead` dice si lo mejor
 * vino de un alias como igual o de la familia (lo que se quería decir: va
 * delante de lo que casa al pie de la letra, «champions» → «M+ Liga de
 * Campeones» antes que «CHAMPIONS TV»).
 */
export function nameTierWithAliases(
  query: NameQuery,
  facts: NameFacts,
): { readonly tier: number; readonly lead: boolean } {
  let tier = nameTier(query, facts);
  let lead = false;
  for (const alias of query.aliases) {
    const byAlias = nameTier(alias.query, facts);
    if (byAlias < 0 || byAlias > alias.maxTier) continue;
    if (byAlias <= NAME_TIER.family) lead = true;
    if (tier < 0 || byAlias < tier) tier = byAlias;
  }
  return { tier, lead };
}

// ---- Orden ------------------------------------------------------------------------------------

/** Países de América en español (van detrás de España y antes que el resto). */
// prettier-ignore
export const SPANISH_AMERICA: ReadonlySet<string> = new Set([
  'LAT', 'LATAM', 'LATINO', 'MX', 'MEX', 'ARG', 'CO', 'COL', 'CL', 'CHI', 'PE', 'PER', 'VE', 'UY', 'EC',
  'BO', 'PY', 'CR', 'GT', 'HN', 'SV', 'NI', 'PA', 'DO', 'PR', 'CU',
]);

/**
 * El puesto del país de un nombre: -1 el pedido en la consulta; 0 España o
 * sin país; 1 América en español; 2 el resto.
 */
export function regionRank(country: string | null | undefined, asked = ''): number {
  const code = (country ?? '').toUpperCase();
  if (asked && code === asked.toUpperCase()) return -1;
  if (!code || code === 'ES') return 0;
  return SPANISH_AMERICA.has(code) ? 1 : 2;
}

/** Lo que decide el orden de un resultado (`compareNameRank`). */
export interface NameRank {
  /** `nameTier` (el servidor añade los suyos detrás: sin la marca, por la categoría). */
  readonly tier: number;
  /** `regionRank`. */
  readonly region: number;
  /** Casa por un alias como igual o de la familia (`nameTierWithAliases`). */
  readonly lead?: boolean;
  /** Es uno de tus favoritos. */
  readonly favorite?: boolean;
}

/**
 * Orden de dos resultados (ver la cabecera, punto 4): lo flojo detrás; el
 * país; lo de un alias; lo igual; tus favoritos; y el nivel. 0 si empatan:
 * quien lo use sigue desempatando.
 */
export function compareNameRank(a: NameRank, b: NameRank): number {
  return (
    Number(a.tier >= NAME_TIER_WEAK) - Number(b.tier >= NAME_TIER_WEAK) ||
    a.region - b.region ||
    Number(!a.lead) - Number(!b.lead) ||
    Number(a.tier !== NAME_TIER.exact) - Number(b.tier !== NAME_TIER.exact) ||
    Number(!a.favorite) - Number(!b.favorite) ||
    a.tier - b.tier
  );
}

/** Calidad para desempatar: mejor, más alto. */
export function qualityScore(quality: string | null | undefined): number {
  switch (quality) {
    case 'uhd':
      return 4;
    case 'fhd':
      return 3;
    case 'hd':
      return 2;
    case 'sd':
      return 1;
    default:
      return 0;
  }
}

/** Lo que `rankByName` necesita saber de cada elemento. */
export interface NameItem {
  /** El nombre (limpio o tal cual). */
  readonly name: string;
  /** Su país ('ES', 'UK'…); null o '' si es de España o no se sabe. */
  readonly country?: string | null;
  readonly favorite?: boolean;
  /** Su mejor calidad (`uhd`, `fhd`, `hd`, `sd`), para desempatar. */
  readonly quality?: string | null;
  /** Los hechos del nombre ya calculados (`nameFactsOf(name)`), para listas grandes. */
  readonly facts?: NameFacts;
}

/**
 * Los elementos que casan con lo escrito, de mejor a peor (`compareNameRank`
 * y, al empatar, la familia más corta, el número del final, la mejor
 * calidad, el nombre más corto y el orden de entrada). Calcula los hechos de
 * cada nombre al momento salvo que vengan ya hechos (`NameItem.facts`): para
 * listas grandes, prepararlos una vez.
 */
export function rankByName<T>(
  items: readonly T[],
  query: string | NameQuery,
  describe: (item: T) => NameItem,
): T[] {
  const q = typeof query === 'string' ? parseNameQuery(query) : query;
  if (!q.key) return [];
  const hits: { item: T; facts: NameFacts; rank: NameRank; quality: number; order: number }[] = [];
  items.forEach((item, order) => {
    const info = describe(item);
    const facts = info.facts ?? nameFactsOf(info.name);
    const { tier, lead } = nameTierWithAliases(q, facts);
    if (tier < 0) return;
    hits.push({
      item,
      facts,
      rank: {
        tier,
        lead,
        region: regionRank(info.country, q.country),
        favorite: Boolean(info.favorite),
      },
      quality: qualityScore(info.quality),
      order,
    });
  });
  return hits
    .sort(
      (a, b) =>
        compareNameRank(a.rank, b.rank) ||
        a.facts.family.length - b.facts.family.length ||
        a.facts.number - b.facts.number ||
        b.quality - a.quality ||
        a.facts.sig.length - b.facts.sig.length ||
        a.order - b.order,
    )
    .map((hit) => hit.item);
}

// ---- Resaltado ---------------------------------------------------------------------------------

/**
 * Los trozos de `text` (un nombre tal cual se enseña) que casan con lo
 * escrito, como pares [inicio, fin) sin solaparse y en orden: cada palabra
 * escrita marca el principio de las palabras del nombre que empiezan por ella
 * (o las palabras seguidas que, pegadas, empiezan por ella: «laliga» en «LA
 * LIGA»). Solo para pintar: si no casa nada, vacío.
 */
export function nameHighlights(query: string, text: string): [number, number][] {
  const q = parseNameQuery(query);
  const typed = foldSearchText(String(query ?? ''))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const wanted = [...new Set([...q.required, ...typed.filter((word) => word.length >= 1)])];
  if (!wanted.length) return [];
  /* Palabras del nombre con su sitio y plegadas (letra a letra, para no mover los sitios). */
  const tokens: { start: number; end: number; folded: string }[] = [];
  for (const match of String(text ?? '').matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = match[0];
    const start = match.index ?? 0;
    tokens.push({ start, end: start + raw.length, folded: foldSearchText(raw) });
  }
  const marks: [number, number][] = [];
  const mark = (start: number, end: number): void => {
    if (end > start) marks.push([start, end]);
  };
  for (const word of wanted) {
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] as { start: number; end: number; folded: string };
      const how = wordMatch(token.folded, word);
      if (how >= 2) {
        /* Igual o por el principio: se marca lo escrito (el plegado no cambia la longitud de las letras latinas). */
        mark(token.start, token.start + Math.min(word.length, token.end - token.start));
        continue;
      }
      /* Palabras seguidas que, pegadas, empiezan por lo escrito: «la liga» para «laliga». */
      if (word.length > token.folded.length && word.startsWith(token.folded)) {
        let joined = token.folded;
        let j = i;
        while (joined.length < word.length && j + 1 < tokens.length) {
          j += 1;
          joined += (tokens[j] as { folded: string }).folded;
        }
        if (joined.startsWith(word) || word.startsWith(joined)) {
          mark(token.start, (tokens[j] as { end: number }).end);
        }
      }
    }
  }
  /* En orden y sin solaparse. */
  marks.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: [number, number][] = [];
  for (const [start, end] of marks) {
    const previous = out[out.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else out.push([start, end]);
  }
  return out;
}
