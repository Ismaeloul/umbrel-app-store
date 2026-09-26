/* Limpieza de los nombres de la IPTV (docs/iptv.md §4.2 y §16, `cleanIptvTitle`).

   Los nombres IPTV traen prefijos y adornos que, con el tope de 58 de
   `distinctiveTokens`, romperían el emparejado: «ES: DAZN LaLiga FHD»
   tendría la palabra de más «es». Y un mismo canal sale muchas veces con
   otra resolución o como copia («DAZN 1 FHD», «DAZN 1 HD», «ES: DAZN 1
   1080p», «DAZN 1 (backup)»…): todas esas son VARIANTES de un canal y tienen
   que dar la misma clave. Antes de puntuar se limpia:

   1. País: prefijo del título (`ES:`, `ES |`, `|ES|`, `[UK]`, `ESPAÑA -`…),
      España al final entre corchetes o barras («DAZN 1 [ES]»), o el del
      grupo/categoría («ES | DEPORTES», «SPAIN SPORTS»). ES, ESP, SPA, SP,
      ESPAÑA y SPAIN dan `ES`; otro código, ese código; sin nada, `null`. Lo
      que va delante del país sin serlo («VIP | ES: …», «FHD | ES: …») se lee
      como marca o como calidad.
   2. Adornos: emojis, banderas, `★◉●▶►|`, corchetes vacíos; los
      superíndices `ᴴᴰ ᶠᴴᴰ ᵁᴴᴰ ˢᴰ` se leen como calidad.
   3. Calidad: FHD/1080p/Full HD → fhd; UHD/4K/2160p → uhd; HD/720p → hd;
      SD/480p/576p → sd, también con los fps pegados («1080p50»).
      HEVC/H265/H.265 → `hevc`. 50FPS/60FPS, H264/AVC, HDR y «VIP» fuera.
   4. Reserva: backup, bkp, bk, alt, alternativo/a, reserva, respaldo, multi
      (también con el número pegado: «bk2»). La copia entre paréntesis del
      final («(1)», «[2]») es la misma señal: se quita y, de la segunda en
      adelante, cuenta como reserva. Los números sueltos NO se tocan: «DAZN
      LaLiga 2» es otro canal. «GEO» al final (restringido a España) se quita;
      con zona («GEO CAT») cuenta como reserva.
   5. Grafías de la IPTV (solo aquí, no en el `normalizeChannelKey`
      compartido, que tiene la matriz 0.6.59 congelada): «la liga» → «laliga»
      y los alias curados `IPTV_CHANNEL_ALIASES`.
   6. Lo que queda es `base`, que pasa por `channelMatchScore`. `display` es
      lo mismo sin las grafías (lo que se enseña: «DAZN LaLiga»). */

import { normalizeChannelKey, type IptvQuality } from '@ace/shared';

export interface CleanIptvTitle {
  /** Nombre para enseñar, sin país, adornos, calidad ni reserva. */
  readonly display: string;
  /** Nombre para emparejar: `display` con las grafías de la IPTV. */
  readonly base: string;
  /** `normalizeChannelKey(base)`: clave del grupo de variantes. */
  readonly key: string;
  readonly quality: IptvQuality | null;
  readonly backup: boolean;
  readonly hevc: boolean;
  readonly country: string | null;
  /** El número de copia quitado del final («(2)» → 2), o null. */
  readonly mirror: number | null;
}

export interface CleanOptions {
  /**
   * Deja la copia del final en el nombre: el catálogo lo pide para un
   * «Canal Sur (2)» que no tiene al lado un «Canal Sur»: ahí el número es
   * parte del nombre, no una copia (docs/iptv.md §16).
   */
  readonly keepMirror?: boolean;
}

const ES_CODES = new Set(['ES', 'ESP', 'SPA', 'SP', 'ESPAÑA', 'ESPANA', 'SPAIN']);

/* «ES: », «|ES| », «[ES] », «(ES) », «ES - », «ESPAÑA | », «ES • ». */
const TITLE_COUNTRY_RE = /^\s*[|[(]?\s*([A-Z]{2,3}|ESPAÑA|ESPANA|SPAIN)\s*[|\]):\-–•·▎┃]+\s*/u;
/* España al final, entre corchetes, paréntesis o barras: «DAZN 1 [ES]», «DAZN 1 |ES|», «DAZN 1 (ESP)». */
const TITLE_SPAIN_SUFFIX_RE = /\s*[|[(]\s*(?:ES|ESP|SPA|ESPAÑA|ESPANA|SPAIN)\s*[|\])]?\s*$/u;
/* Grupo o categoría: «ES | DEPORTES», «ES: DEPORTES», «UK| SPORTS», «SPAIN SPORTS», «España». */
const GROUP_COUNTRY_RE = /^\s*[|[(]?\s*([A-Z]{2,3})\s*[|\]):\-–]/u;
const GROUP_SPAIN_RE = /^\s*[|[(]?\s*(?:españa|espana|spain)\b/iu;
/*
 * Lo que va delante como un país sin serlo: una marca («VIP | ES: …»), una
 * calidad («FHD | ES: …», que cuenta como calidad) o un grupo («XXX |
 * ADULTOS», «PPV | …»).
 */
const NOT_COUNTRY: Readonly<Record<string, IptvQuality | null>> = {
  VIP: null,
  HQ: null,
  NEW: null,
  HOT: null,
  TOP: null,
  XXX: null,
  PPV: null,
  VOD: null,
  TV: null,
  HD: 'hd',
  FHD: 'fhd',
  UHD: 'uhd',
  SD: 'sd',
};

/* Superíndices de calidad. */
const SUPERSCRIPT_QUALITY: readonly (readonly [RegExp, IptvQuality])[] = [
  [/ᵁᴴᴰ/gu, 'uhd'],
  [/ᶠᴴᴰ/gu, 'fhd'],
  [/ᴴᴰ/gu, 'hd'],
  [/ˢᴰ/gu, 'sd'],
];

/* Con los fps pegados («1080p50», «720p60») y el «+» de «HD+». */
const QUALITY_TOKENS: readonly (readonly [RegExp, IptvQuality])[] = [
  [/\b(?:uhd|4k|2160[pi]?(?:25|30|50|60)?)\b\+?/giu, 'uhd'],
  [/\b(?:fhd|full\s*hd|1080[pi]?(?:25|30|50|60)?)\b\+?/giu, 'fhd'],
  [/\b(?:hd|720[pi]?(?:25|30|50|60)?)\b\+?/giu, 'hd'],
  [/\b(?:sd|480[pi]?|576[pi]?)\b/giu, 'sd'],
];

/* Mayúsculas y al final: «Geo News» o «GEO TV» son nombres de canal. */
const GEO_RE = /\s+GEO(?:\s+([A-Z]{2,3}))?\s*$/u;
const HEVC_RE = /\b(?:hevc|h\.?265|x265)\b/giu;
const FPS_RE = /\b(?:25|30|50|60)\s*fps\b/giu;
/* Marcas técnicas que no cambian el canal: el códec normal, el HDR y «VIP». */
const TECH_RE = /\b(?:h\.?264|x264|avc|hdr(?:10)?|vip)\b/giu;
const BACKUP_RE =
  /\b(?:backup|back\s*up|bkp|bk|alt|alternativ[oa]|reserva|respaldo|multi(?:audio)?)\d{0,2}\b/giu;
/* La copia entre paréntesis o corchetes del final: «DAZN 1 (2)», «DAZN 1 [1]». */
const MIRROR_RE = /\s*[([]\s*(\d{1,2})\s*[)\]]\s*$/u;

/* Emojis, banderas (indicadores regionales) y adornos. */
const EMOJI_RE = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu;
const DECOR_RE = /[★☆◉●○◆◇■□▶►▷▸•·|✪✦✧⚽▎┃]/gu;

/**
 * Alias curados, pocos y con test (docs/iptv.md §4.2). Clave y valor van ya
 * con `normalizeChannelKey` y la grafía «laliga». Se amplía solo con casos
 * reales del corpus.
 */
export const IPTV_CHANNEL_ALIASES: Readonly<Record<string, string>> = {
  'movistar hypermotion': 'LaLiga TV Hypermotion',
  'laliga hypermotion': 'LaLiga TV Hypermotion',
  'movistar laliga': 'M+ LaLiga TV',
  'movistar liga de campeones': 'M+ Liga de Campeones',
};

/** «la liga» (con o sin espacio, en cualquier caja) → «LaLiga». */
export function iptvSpelling(value: string): string {
  const joined = value.replace(/\bla\s*liga\b/giu, 'LaLiga');
  const key = normalizeChannelKey(joined);
  return IPTV_CHANNEL_ALIASES[key] ?? joined;
}

/** País de un código o nombre (ES para las formas de España). */
export function countryCode(value: string): string {
  const upper = value.trim().toUpperCase();
  return ES_CODES.has(upper) ? 'ES' : upper;
}

/** País que declara un grupo o categoría, o null. */
export function groupCountry(group: string | null | undefined): string | null {
  const text = String(group ?? '');
  if (!text) return null;
  if (GROUP_SPAIN_RE.test(text)) return 'ES';
  const match = GROUP_COUNTRY_RE.exec(text);
  if (!match?.[1] || Object.hasOwn(NOT_COUNTRY, match[1])) return null;
  return countryCode(match[1]);
}

/**
 * El «país» de un canal para juntar variantes: España y sin país son el mismo
 * (`''`); otro país, su código. «ES: DAZN 1» y «DAZN 1» son el mismo canal;
 * «DE: DAZN 1» es otro (docs/iptv.md §16).
 */
export function countryBucket(country: string | null): string {
  return country === null || country === 'ES' ? '' : country;
}

function collapse(value: string): string {
  return value
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(/\s*[-–:]\s*$/u, '')
    .replace(/^\s*[-–:]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Quita lo que case con `re` (global) y dice si había algo. */
function strip(text: string, re: RegExp): { readonly text: string; readonly found: boolean } {
  let found = false;
  const out = text.replace(re, () => {
    found = true;
    return ' ';
  });
  return { text: out, found };
}

/** Limpia el nombre de un canal IPTV (título y grupo/categoría). */
export function cleanIptvTitle(
  title: string,
  group?: string | null,
  options: CleanOptions = {},
): CleanIptvTitle {
  let text = String(title ?? '').normalize('NFC');
  let country: string | null = null;
  let quality: IptvQuality | null = null;

  for (const [re, value] of SUPERSCRIPT_QUALITY) {
    const step = strip(text, re);
    text = step.text;
    if (step.found) quality ??= value;
  }
  text = text.replace(EMOJI_RE, ' ');
  /* El país va delante (o, entre corchetes o barras, al final); se mira antes
     de quitar las barras de adorno. Delante puede haber marcas que no lo son. */
  for (let guard = 0; guard < 3; guard += 1) {
    const prefix = TITLE_COUNTRY_RE.exec(text);
    if (!prefix?.[1]) break;
    const code = prefix[1].toUpperCase();
    text = text.slice(prefix[0].length);
    if (Object.hasOwn(NOT_COUNTRY, code)) {
      quality ??= NOT_COUNTRY[code] ?? null;
      continue;
    }
    country = countryCode(code);
    break;
  }
  const suffix = TITLE_SPAIN_SUFFIX_RE.exec(text);
  if (suffix && suffix.index > 0) {
    country ??= 'ES';
    text = text.slice(0, suffix.index);
  }
  text = text.replace(DECOR_RE, ' ');
  const hevcStep = strip(text, HEVC_RE);
  text = hevcStep.text;
  const hevc = hevcStep.found;
  text = text.replace(FPS_RE, ' ').replace(TECH_RE, ' ');
  for (const [re, value] of QUALITY_TOKENS) {
    const step = strip(text, re);
    text = step.text;
    if (step.found) quality ??= value;
  }
  const backupStep = strip(text, BACKUP_RE);
  text = collapse(backupStep.text);
  /* «(1)», «(2)» al final: la misma señal repetida en la lista; de la segunda en adelante, reserva. */
  let mirror: number | null = null;
  const copy = MIRROR_RE.exec(text);
  if (copy && copy.index > 0) {
    mirror = Number(copy[1]);
    if (!options.keepMirror) text = text.slice(0, copy.index);
  }
  /* «GEO» al final (solo se ve desde España) es una marca técnica, no otro canal: «Teledeporte GEO» y
     «Teledeporte» son el mismo. Con zona detrás («Esport3 GEO CAT», solo desde Cataluña) cuenta como reserva. */
  const geo = GEO_RE.exec(text);
  if (geo) text = text.slice(0, geo.index);
  const backup =
    backupStep.found ||
    (mirror !== null && mirror >= 2 && !options.keepMirror) ||
    Boolean(geo?.[1]);
  const display = collapse(text);
  country ??= groupCountry(group);
  const base = iptvSpelling(display);
  return {
    display,
    base,
    key: normalizeChannelKey(base),
    quality,
    backup,
    hevc,
    country,
    mirror,
  };
}

/* Plataformas de internet, no canales de televisión: «RTVE Play», «LPF Play», «DAZN App Gratis», «Real Betis TV
   YouTube», «OneFootball PPV»… Con ellas no se sabe qué canal IPTV es (en una lista hay decenas de «En Play»). */
const PLATFORM_RE =
  /\b(?:play|app|youtube|twitch|facebook|twitter|instagram|tiktok|ppv|web|online)\b|@/iu;
/* La cadena detrás del canal en la agenda: «La 1 TVE», «Clan RTVE». */
const BROADCASTER_SUFFIX_RE = /\s+r?tve$/iu;

/**
 * Cómo busca la IPTV un canal de la agenda (docs/iptv.md §4.3): null si es una plataforma de internet (no se
 * empareja por nombre: solo la guía puede confirmarla) y sin la cadena del final («La 1 TVE» → «La 1»), que las
 * listas no ponen. Solo para la IPTV: el emparejado de AceStream no cambia.
 */
export function iptvAskedChannel(channel: string): string | null {
  const text = String(channel ?? '').trim();
  if (!text || PLATFORM_RE.test(text)) return null;
  return text.replace(BROADCASTER_SUFFIX_RE, '').trim() || text;
}

/**
 * Orden de las variantes de un canal (Isma, 26-sep; docs/iptv.md §16): 1080p
 * primero, luego 4K, 720p y SD; sin marca, al final.
 */
export function qualityRank(quality: IptvQuality | null): number {
  switch (quality) {
    case 'fhd':
      return 4;
    case 'uhd':
      return 3;
    case 'hd':
      return 2;
    case 'sd':
      return 1;
    default:
      return 0;
  }
}

/** Resolución de mayor a menor (las etiquetas del buscador: «4K · 1080p · 720p»). */
export function qualityHeightRank(quality: IptvQuality | null): number {
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

/**
 * La calidad por la altura del vídeo real (ffprobe o la `RESOLUTION` de la
 * maestra HLS), que manda sobre la del nombre: 2160 → 4K, 1080 (y 1440) →
 * 1080p, 720 → 720p, menos → SD. null si no se sabe.
 */
export function qualityFromHeight(height: number | null | undefined): IptvQuality | null {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  if (height >= 1800) return 'uhd';
  if (height >= 1000) return 'fhd';
  if (height >= 700) return 'hd';
  return 'sd';
}
