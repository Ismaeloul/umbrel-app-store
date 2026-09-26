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
      lo mismo sin las grafías (lo que se enseña: «DAZN LaLiga»).

   Con la lista real de Isma (26-sep, docs/iptv.md §18) se suma:
   - Filas que no son canales (`filler`): cabeceras «##### … #####» y «NO
     MATCH». El catálogo no las guarda: ni se buscan ni se emparejan.
   - Filas de evento con horario («ESPN PLUS 12 : SOCCER … 3:00 PM ET»):
     `event`, que el buscador pone al final.
   - País: «ES TI - » (la segunda sigla es la plataforma), «ES-M.LALIGA»
     pegado, la «Ñ» suelta del final («BEIN SPORTS Ñ») y las categorías
     `CONTINENTE | PAÍS | TEMA` («EU | ES | TDT»: el país es ES, no EU).
   - Fuera del nombre: ᴿᴬᵂ (reserva: otro feed del mismo canal), ᵛᶦᵖ y los
     demás superíndices, «4K/UHD», las notas entre corchetes o paréntesis
     («[ PREMIERELEAGUE ]», «(SOLO EVENTOS)», «[NOT 24/7]»), la reserva
     «(BK-1)» / «BK-1» (antes se leía «M. LALIGA ( -1)» y se juntaba con
     M. LALIGA 1), el «#» delante de palabra y los asteriscos.
   - La grafía única de `channelSpelling` (@ace/shared): «M.», «M+»,
     «MOVISTAR PLUS+»… → «Movistar»; «LA SEXTA» = «LASEXTA»; «LALIGA+» →
     «LaLigaPlus»; «SUPER CUPA» → «Supercopa»; «R. MADRID» → «Real Madrid».
   - `platform`: VIX, Pluto TV, Rakuten TV, GOLD TV 24/7… (por el nombre o
     la categoría). No se emparejan por nombre con la agenda (su «LA LIGA 1»
     no es «M+ LaLiga TV») y el buscador las pone detrás. */

import { channelSpelling, normalizeChannelKey, type IptvQuality } from '@ace/shared';

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
  /** No es un canal: cabecera «##### … #####» o «NO MATCH» (docs/iptv.md §18). */
  readonly filler: boolean;
  /** Fila de un evento con horario («ESPN PLUS 12 : … 3:00 PM ET»). */
  readonly event: boolean;
  /** Plataforma de internet por el nombre o la categoría («vix», «pluto», «rakuten»…), o null. */
  readonly platform: string | null;
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

/* «ES: », «|ES| », «[ES] », «(ES) », «ES - », «ESPAÑA | », «ES • », «ES TI - » (la segunda sigla es la plataforma). */
const TITLE_COUNTRY_RE =
  /^\s*[|[(]?\s*([A-Z]{2,3}|ESPAÑA|ESPANA|SPAIN)(?:\s+[A-Z]{2,3})?\s*[|\]):\-–•·▎┃]+\s*/u;
/* España al final, entre corchetes, paréntesis o barras: «DAZN 1 [ES]», «DAZN 1 |ES|», «DAZN 1 (ESP)». */
const TITLE_SPAIN_SUFFIX_RE = /\s*[|[(]\s*(?:ES|ESP|SPA|ESPAÑA|ESPANA|SPAIN)\s*[|\])]?\s*$/u;
/* Grupo o categoría: «ES | DEPORTES», «ES: DEPORTES», «UK| SPORTS», «SPAIN SPORTS», «España». */
const GROUP_COUNTRY_RE = /^\s*[|[(]?\s*([A-Z]{2,3})\s*[|\]):\-–]/u;
const GROUP_SPAIN_RE = /^\s*[|[(]?\s*(?:españa|espana|spain)\b/iu;
/* El primer tramo de «EU | ES | TDT» es el continente: el país va en el segundo. */
const CONTINENTS = new Set(['EU', 'AM', 'AS', 'AF', 'OC', 'EUR', 'AME', 'LATAM']);
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
  [/ᵁᴴᴰ|⁴ᴷ/gu, 'uhd'],
  [/ᶠᴴᴰ/gu, 'fhd'],
  [/ᴴᴰ/gu, 'hd'],
  [/ˢᴰ/gu, 'sd'],
];
/* «ᴿᴬᵂ»: el feed en crudo del mismo canal (reserva). */
const SUPERSCRIPT_RAW_RE = /ᴿᴬᵂ/gu;
/* Cualquier otra tira de superíndices («ᵛᶦᵖ», «ᴺᴱᵂ»): adorno. */
const SUPERSCRIPT_RE = /[\u1D2C-\u1D6A\u1D9B-\u1DBF\u2070-\u209F]+/gu;

/* Cabeceras y huecos de la lista: «##### ES - M. LALIGA #####», «==== CINE ====», «XX - NO MATCH». */
const FILLER_RE =
  /^\s*([#=*~_★☆•-])\1{2,}.*\1{2,}\s*$|^\s*(?:[A-Z]{2,4}\s*[-|:]\s*)?NO\s+(?:MATCH|EVENT)S?\s*$/iu;
/* Fila de evento con horario: «ESPN PLUS 12 : SOCCER: … SEP 25 – 3:00 PM ET / 8:00 PM UK». */
const EVENT_RE = /\s:\s.*(?:\b\d{1,2}:\d{2}\s*(?:AM|PM)\b|\b(?:ET|UK|CET)\s*$)/iu;
/* Notas entre corchetes o paréntesis que no cambian el canal. */
const NOTE_RE =
  /[([]\s*(?:solo\s+eventos?|only\s+events?|not\s*24\s*\/\s*7|24\s*\/\s*7|live\s*event|premiere?\s*league)\s*[)\]]/giu;
/* La reserva escrita «(BK-1)», «[BK 2]», «BK-1» (el número es de la reserva, no del canal). */
const BACKUP_TAG_RE =
  /[([]\s*(?:bk|bkp|backup)\s*[-_]?\s*\d{0,2}\s*[)\]]|\bbk\s*[-_]\s*\d{1,2}\b/giu;
/* La «Ñ» suelta del final marca la versión española («BEIN SPORTS Ñ»). */
const SPAIN_LETTER_RE = /\s+Ñ\s*$/u;
/* Plataformas de internet por el nombre («VIX - …», «Pluto TV …») o por la categoría. */
const PLATFORM_TITLE_RE =
  /^\s*(?:[|[(]?\s*[A-Z]{2,3}\s*[|\]):\-–]+\s*)?(vix|pluto\s*tv|rakuten(?:\s*tv)?|gold\s*tv(?:\s*24\s*\/\s*7)?|samsung\s*tv\s*plus)\b/iu;
const PLATFORM_GROUP_RE =
  /\b(vix|pluto(?:\s*tv)?|rakuten(?:\s*tv)?|gold\s*tv|samsung\s*tv\s*plus|fast\s*channels?)\b/iu;

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
const DECOR_RE = /[★☆◉●○◆◇■□▶►▷▸•·|✪✦✧⚽▎┃*]/gu;

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
  /* La agenda dice «TVG»; la lista, «TV GALICIA» (o «ES TI - TVG»). «TVG 2» es otro canal. */
  tvg: 'TV Galicia',
};

/**
 * La grafía de la IPTV para emparejar: `channelSpelling` (Movistar, LaLiga,
 * compuestos…) y los alias curados. «M+ La Liga» → «M+ LaLiga TV».
 */
export function iptvSpelling(value: string): string {
  const spelled = channelSpelling(value);
  const key = normalizeChannelKey(spelled);
  return IPTV_CHANNEL_ALIASES[key] ?? spelled;
}

/*
 * Lo que escribe una persona en el buscador: «m laliga» o «mov laliga» es
 * Movistar (en una lista, «M LALIGA» sin punto no se toca: podría ser otra
 * cosa).
 */
const SEARCH_MOVISTAR_RE = /^\s*(?:m|mov)\s+(?=[\p{L}\p{N}])/iu;

/**
 * La grafía para el BUSCADOR (docs/iptv.md §18): `channelSpelling` sin los
 * alias curados del emparejado (que añadían palabras: «movistar laliga» →
 * «M+ LaLiga TV» buscaba también «tv» y daba 0).
 */
export function iptvSearchSpelling(value: string): string {
  return channelSpelling(String(value ?? '').replace(SEARCH_MOVISTAR_RE, 'Movistar '));
}

/** País de un código o nombre (ES para las formas de España). */
export function countryCode(value: string): string {
  const upper = value.trim().toUpperCase();
  return ES_CODES.has(upper) ? 'ES' : upper;
}

/** País que declara un grupo o categoría, o null. */
export function groupCountry(group: string | null | undefined): string | null {
  const text = String(group ?? '').replace(/\u00a0/g, ' ');
  if (!text) return null;
  if (GROUP_SPAIN_RE.test(text)) return 'ES';
  /* «EU | ES | TDT», «AM | USA | ESPN PLUS»: el país es el segundo tramo. */
  const parts = text.split('|').map((part) => part.trim().toUpperCase());
  if (parts.length >= 2 && CONTINENTS.has(parts[0] as string)) {
    const code = parts[1] as string;
    /* «AM | LATINO», «EU | LATVIA», «AS | THAILAND»: el nombre del país en vez de su sigla (docs/iptv.md §19).
       No es España: los latinos y México cuentan como América en español; el resto, con el continente. */
    if (/^\p{L}[\p{L} +]{3,}$/u.test(code) && !Object.hasOwn(NOT_COUNTRY, code)) {
      if (/^(?:ESPAÑA|ESPANA|SPAIN)\b/u.test(code)) return 'ES';
      if (/^LATIN|^LATAM/u.test(code)) return 'LAT';
      if (/^MEXIC/u.test(code)) return 'MX';
      return parts[0] as string;
    }
    if (!/^[A-Z]{2,4}$/.test(code) || Object.hasOwn(NOT_COUNTRY, code)) return null;
    return countryCode(code);
  }
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
    .replace(/(?:\s*[-–:/]\s*)+$/u, '')
    .replace(/^(?:\s*[-–:/]\s*)+/u, '')
    .replace(/\s+\/\s+(?=\S)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Es la fila de un evento con horario («ESPN PLUS 12 : … 3:00 PM ET / 8:00 PM UK»)? */
export function isEventTitle(title: string): boolean {
  return EVENT_RE.test(String(title ?? ''));
}

/** ¿Es una fila que no es un canal (cabecera «##### … #####», «NO MATCH»)? */
export function isFillerTitle(title: string): boolean {
  return FILLER_RE.test(String(title ?? ''));
}

/** Plataforma de internet de un canal por su nombre o su categoría, o null. */
export function iptvPlatform(title: string, group?: string | null): string | null {
  return iptvTitlePlatform(title) ?? iptvGroupPlatform(group);
}

/** Plataforma de internet que dice el NOMBRE (\u00abVIX - \u2026\u00bb, \u00abPluto TV \u2026\u00bb, \u00abRAKUTEN TV ACCION\u00bb), o null. */
export function iptvTitlePlatform(title: string): string | null {
  const match = PLATFORM_TITLE_RE.exec(String(title ?? ''));
  return match?.[1] ? match[1].toLowerCase().split(/\s+/)[0] || null : null;
}

/**
 * Plataforma de internet que dice la CATEGOR\u00cdA (\u00abEU | ES | RAKUTEN TV\u00bb), o null. Ojo: hay categor\u00edas con ese
 * nombre que mezclan canales de la TDT (\u00abES - LA 2\u00bb, \u00abES - TVG 2\u00bb); el cat\u00e1logo las distingue
 * (`Catalog.platformOf`, docs/iptv.md \u00a719).
 */
export function iptvGroupPlatform(group: string | null | undefined): string | null {
  const match = PLATFORM_GROUP_RE.exec(String(group ?? '').replace(/\u00a0/g, ' '));
  return match?.[1] ? match[1].toLowerCase().split(/\s+/)[0] || null : null;
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
  const raw = String(title ?? '').normalize('NFC');
  let text = raw;
  let country: string | null = null;
  let quality: IptvQuality | null = null;
  const filler = isFillerTitle(raw);
  const event = EVENT_RE.test(raw);

  for (const [re, value] of SUPERSCRIPT_QUALITY) {
    const step = strip(text, re);
    text = step.text;
    if (step.found) quality ??= value;
  }
  const rawFeed = strip(text, SUPERSCRIPT_RAW_RE);
  text = rawFeed.text.replace(SUPERSCRIPT_RE, ' ');
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
  text = text.replace(NOTE_RE, ' ');
  const backupTag = strip(text, BACKUP_TAG_RE);
  text = backupTag.text.replace(DECOR_RE, ' ').replace(/#(?=[\p{L}\p{N}])/gu, '');
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
  const spainLetter = SPAIN_LETTER_RE.exec(text);
  if (spainLetter && spainLetter.index > 0) {
    country ??= 'ES';
    text = text.slice(0, spainLetter.index);
  }
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
    backupTag.found ||
    rawFeed.found ||
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
    filler,
    event,
    platform: iptvPlatform(raw, group),
  };
}

/* Plataformas de internet, no canales de televisión: «RTVE Play», «LPF Play», «DAZN App Gratis», «Real Betis TV
   YouTube», «OneFootball PPV», «Disney+», «Prime Video», «Apple TV», «FANSEAT»… Con ellas no se sabe qué canal
   IPTV es (en una lista hay decenas de «En Play», y «Disney+» casaba con «DISNEY CHANNEL»). «Movistar Plus+» es un
   canal, no una plataforma. */
const PLATFORM_RE =
  /\b(?:play|app|youtube|twitch|facebook|twitter|instagram|tiktok|ppv|web|online|netflix|skyshowtime|filmin|atresplayer|mitele|fanseat|fanplay|peacock|hbo\s*max|prime\s*video|amazon\s*prime|apple\s*tv|vix|pluto\s*tv|rakuten)\b|\bparamount\s*\+|\bdisney\s*(?:\+|plus\b)|^\s*max\s*$|[a-z]play\b|@/iu;
/* La cadena detrás del canal en la agenda: «La 1 TVE», «Clan RTVE». */
const BROADCASTER_SUFFIX_RE = /\s+r?tve$/iu;
/* … y en medio, detrás de un canal de RTVE: «La 1 TVE 720p *» (biblioteca de AceStream). */
const BROADCASTER_INNER_RE = /\b(la\s*[12]|clan|24\s*h(?:oras)?|teledeporte|tdp)\s+r?tve\b/giu;
/* Lo que las listas de AceStream ponen detrás de la flecha: « --> NEW ERA». */
const ACE_PROVIDER_RE = /\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹]).*$/u;
/* … o entre corchetes o paréntesis, tras una barra o un guion con espacios, o tras la calidad («LA 1 FHD [NEW
   ERA]», «LA 1 (NEW ERA)», «LA 1 | NEW ERA», «LA 1 - NEW ERA», «LA 1 1080 NEW ERA»). */
const ACE_TAIL_NOTE_RE = /\s*[[(]\s*([^\])]+?)\s*[\])]\s*$/u;
const ACE_TAIL_BAR_RE = /\s+(?:\||-|–)\s+([^|\-–]+?)\s*$/u;
const ACE_TAIL_QUALITY_RE =
  /\s(?:uhd|4k|fhd|full\s*hd|hd|sd|(?:2160|1080|720|576|480)[pi]?(?:25|30|50|60)?)\+?\s+(\D+?)\s*$/iu;
/* Lo que sí distingue un canal y no se quita nunca de detrás: números, competiciones, «Bar», «PPV»… */
const ACE_TAIL_DISTINCT_RE =
  /\d|hyper|smartbank|segunda|liga|champions|campeones|europa|conference|premier|copa|f1|moto|femen|women|\bbar\b|ppv|evento|uhd|4k|\b(?:es|en|eng|fr|de|pt|it|cat)\b/iu;

/*
 * El nombre de la lista (o del que la sube) que las listas de AceStream ponen detrás del canal sin flecha. Solo
 * si va en mayúsculas o entre corchetes y no dice nada del canal (ver `ACE_TAIL_DISTINCT_RE`): «TV Canaria
 * (RTVC)» pierde «(RTVC)», pero «LaLiga TV (Hypermotion)» y «M+ LaLiga TV - Bar» se quedan como están.
 */
function aceListTail(value: string): string {
  let text = value.trim();
  for (let guard = 0; guard < 3; guard += 1) {
    const note = ACE_TAIL_NOTE_RE.exec(text);
    if (note && note.index > 0 && !ACE_TAIL_DISTINCT_RE.test(note[1] ?? '')) {
      text = text.slice(0, note.index).trim();
      continue;
    }
    const bar = ACE_TAIL_BAR_RE.exec(text);
    const barText = bar?.[1] ?? '';
    if (
      bar &&
      bar.index > 0 &&
      barText === barText.toUpperCase() &&
      /\p{L}{2}/u.test(barText) &&
      !ACE_TAIL_DISTINCT_RE.test(barText)
    ) {
      text = text.slice(0, bar.index).trim();
      continue;
    }
    const tail = ACE_TAIL_QUALITY_RE.exec(text);
    const tailText = tail?.[1] ?? '';
    if (tail && tailText === tailText.toUpperCase() && !ACE_TAIL_DISTINCT_RE.test(tailText)) {
      text = text.slice(0, text.length - tailText.length).trim();
      continue;
    }
    break;
  }
  return text || value;
}

/**
 * Un nombre de canal de las listas de AceStream (o de la agenda) listo para
 * compararlo con la IPTV (docs/iptv.md §18): sin lo que va tras la flecha
 * («LA 1 4K --> NEW ERA» → «LA 1»), sin asteriscos, sin marcas de calidad,
 * códec ni fotogramas en cualquier sitio («La 1 TVE 720p *» → «La 1»), y sin
 * «TVE»/«RTVE» detrás de un canal de RTVE. Si no queda nada, el original.
 */
export function aceChannelTitle(title: string): string {
  const original = String(title ?? '').trim();
  let text = aceListTail(original.replace(ACE_PROVIDER_RE, ' ').replace(/[*]+/g, ' '));
  text = text.replace(HEVC_RE, ' ').replace(FPS_RE, ' ').replace(TECH_RE, ' ');
  for (const [re] of QUALITY_TOKENS) text = text.replace(re, ' ');
  text = text.replace(BROADCASTER_INNER_RE, '$1');
  text = collapse(text).replace(BROADCASTER_SUFFIX_RE, '').trim();
  return text || original;
}

/**
 * Cómo busca la IPTV un canal de la agenda o de una lista de AceStream (docs/iptv.md §4.3 y §18): null si es una
 * plataforma de internet (no se empareja por nombre: solo la guía puede confirmarla), limpio como
 * `aceChannelTitle` y sin la cadena del final («La 1 TVE» → «La 1»), que las listas no ponen. Solo para la IPTV:
 * el emparejado de AceStream no cambia.
 */
export function iptvAskedChannel(channel: string): string | null {
  const text = String(channel ?? '').trim();
  if (!text) return null;
  const clean = aceChannelTitle(text);
  if (PLATFORM_RE.test(clean)) return null;
  /* «LaLiga+» es otra marca: en una palabra, para que el «+» no se pierda al puntuar (§19). */
  return clean.replace(LALIGA_PLUS_RE, 'LaLigaPlus ').replace(/\s+/g, ' ').trim();
}

/* «LaLiga+», «LALIGA +», «LaLiga Plus» (la marca de la plataforma, no LaLiga TV). */
const LALIGA_PLUS_RE = /\bla\s*liga\s*(?:\+|plus\b)/giu;

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
