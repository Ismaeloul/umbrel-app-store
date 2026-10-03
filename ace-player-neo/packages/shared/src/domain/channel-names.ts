/* Grafías de nombres de canal que comparten el buscador y el emparejado de la
   IPTV, la web y la app (docs/iptv.md §18). Pura y sin estado.

   `normalizeChannelKey` (channels.ts) tiene la matriz 0.6.59 congelada y NO
   se toca: esto va ANTES, sobre el nombre, y solo lo usan los que lo piden
   (la IPTV en el servidor y, al portarlo, la web y la app). Todo lo de aquí
   es seguro para el emparejado automático: dos nombres que dan lo mismo son
   el mismo canal escrito de otra forma. Las erratas y los alias «humanos»
   (Champions, Barça…) NO van aquí: son del buscador.

   1. Movistar: «M.», «M .», «M.» pegado («M.LALIGA»), «M+», «MOVISTAR+»,
      «MOVISTAR PLUS+», «Movistar Plus», «MOVIESTAR» (sic) y «M+ PLUS» al
      principio y seguidos de otra palabra → «Movistar …». Nunca «M6», «M95»
      ni «MTV» (sin punto ni «+»).
   2. LaLiga: «la liga» (con o sin espacio, cualquier caja) → «LaLiga»;
      «LALIGA+» (o «LaLiga Plus») es otra marca → «LaLigaPlus», una sola
      palabra: «plus» suelto es relleno al puntuar y «LaLiga+» casaba con
      «Movistar LaLiga» (docs/iptv.md §19).
   3. Compuestos que las listas escriben juntos o separados: «LA SEXTA» =
      «LASEXTA», «TELE CINCO» = «TELE 5» = «TELE5» = «TELECINCO», «ANTENA3»
      = «ANTENA 3» (y «A3» a secas), «A3 SERIES» = «ATRESERIES», «TELE
      DEPORTE», «TELE MADRID», «ONE TORO», «BE MAD», «MOTO GP», y «TRECETV» =
      «TRECE TV».
   4. Erratas fijas de las listas: «SUPER CUPA» → «Supercopa».
   5. «R.» delante de un club → «Real» («R. MADRID TV»); «INT.» →
      «Internacional».

   `channelSearchKey`: la clave para FILTRAR por nombre (el filtro de
   Canales, «En tu biblioteca» del buscador y sus candidatos en el servidor):
   esta grafía, «m» o «mov» sueltos delante como Movistar y
   `normalizeChannelKey`.

   Además, las marcas de calidad y códec que NO son el número del canal
   («La 1 TVE 720p» → el canal es «La 1»): `stripQualityMarks` y
   `isQualityNumber`, que usan el dorsal y el nombre de los carteles. */

import { normalizeChannelKey } from './channels.js';

/* 1. Movistar al principio, seguido de otra palabra. */
const MOVISTAR_PREFIX_RE =
  /^\s*(?:m\s*\.\s*|m\s*\+\s*(?:plus\s*\+?\s*)?|moviestar\s*\+?\s*|movistar\s*\+?\s*(?:plus\s*\+?\s*)?)(?=[\p{L}\p{N}#])/iu;

/* 3. Compuestos: [patrón, forma única]. «Tele 5» y «Tele5» son Telecinco; «Antena3», Antena 3; «A3» a secas,
   Antena 3, y «A3 Series», Atreseries (0.9.0, docs/buscador.md). */
const COMPOUNDS: readonly (readonly [RegExp, string])[] = [
  [/\bla\s*sexta\b/giu, 'LaSexta'],
  [/\btele\s*(?:cinco|5)\b/giu, 'Telecinco'],
  [/\bantena3\b/giu, 'Antena 3'],
  [/^\s*a3\s*$/iu, 'Antena 3'],
  [/\ba3\s*series\b/giu, 'Atreseries'],
  [/\btele\s*deporte\b/giu, 'Teledeporte'],
  [/\btele\s*madrid\b/giu, 'Telemadrid'],
  [/\bone\s*toro\b/giu, 'OneToro'],
  [/\bbe\s*mad\b/giu, 'BeMad'],
  [/\bmoto\s*gp\b/giu, 'MotoGP'],
  [/\btrece\s*tv\b/giu, 'Trece TV'],
];

/* 4. Erratas fijas vistas en listas reales. */
const FIXED_TYPOS: readonly (readonly [RegExp, string])[] = [[/\bsuper\s*cupa\b/giu, 'Supercopa']];

/* 5. «R. MADRID» → «Real Madrid» (solo delante de un club). */
const REAL_RE =
  /\bR\s*\.\s*(?=(?:madrid|sociedad|betis|oviedo|zaragoza|valladolid|mallorca|racing|sporting)\b)/giu;
const INTERNATIONAL_RE = /\bint\.(?=\s|$)/giu;

/** Las palabras que se leen como la marca Movistar en un nombre ya normalizado. */
export const MOVISTAR_WORDS: ReadonlySet<string> = new Set(['movistar', 'm', 'mov', 'moviestar']);

/**
 * La grafía única de un nombre de canal (reglas 1 a 5). Devuelve el mismo
 * texto si no hay nada que cambiar. No pasa a minúsculas: el resultado se
 * enseña o se normaliza después con `normalizeChannelKey`.
 */
export function channelSpelling(value: string): string {
  let text = String(value ?? '');
  if (!text) return text;
  text = text.replace(MOVISTAR_PREFIX_RE, 'Movistar ');
  text = text
    .replace(/\bla\s*liga\s*(?:\+|plus\b)/giu, 'LaLigaPlus ')
    .replace(/\bla\s*liga\b/giu, 'LaLiga');
  for (const [re, to] of COMPOUNDS) text = text.replace(re, to);
  for (const [re, to] of FIXED_TYPOS) text = text.replace(re, to);
  text = text.replace(REAL_RE, 'Real ').replace(INTERNATIONAL_RE, 'Internacional');
  return text.replace(/\s+/g, ' ').trim();
}

/* «m laliga», «mov laliga»: lo que escribe una persona en un buscador (una lista no lo escribe así). */
const SEARCH_MOVISTAR_RE = /^\s*(?:m|mov)\s+(?=[\p{L}\p{N}])/iu;

/** Lo mínimo que tiene que tener la clave de lo escrito para filtrar con `channelSearchKey`. */
export const CHANNEL_SEARCH_KEY_MIN = 3;

/**
 * La clave de un nombre, o de lo que se escribe, para filtrar por nombre
 * (docs/diagnostico-iptv-0.8.2.md, E3): la grafía de `channelSpelling` (con
 * «m» o «mov» sueltos delante como Movistar) y `normalizeChannelKey`. «m+
 * laliga» y «M. LALIGA 1» dan «movistar laliga…»: el primero encuentra el
 * segundo por la clave aunque el texto plegado no lo contenga.
 */
export function channelSearchKey(value: string): string {
  const text = String(value ?? '').replace(SEARCH_MOVISTAR_RE, 'Movistar ');
  return normalizeChannelKey(channelSpelling(text));
}

/* Resoluciones que un nombre lleva como marca de calidad (nunca como número de canal). */
const QUALITY_NUMBERS: ReadonlySet<string> = new Set([
  '240',
  '360',
  '480',
  '540',
  '576',
  '720',
  '1080',
  '1440',
  '2160',
  '4320',
]);

/**
 * ¿Es este número una marca de calidad y no el del canal? «720», «1080»,
 * «2160»… (las resoluciones de siempre). Para el dorsal: «La 1 TVE 720» → «1».
 */
export function isQualityNumber(value: string): boolean {
  return QUALITY_NUMBERS.has(value);
}

/*
 * Marcas de calidad, códec y fotogramas: «720p», «1080i», «1080p50»,
 * «2160», «4K», «8K», «UHD», «FHD», «HD», «SD», «HEVC», «H264», «H.265»,
 * «x265», «50fps», «60 FPS», «HDR», «HDR10». Solo palabras enteras.
 */
const QUALITY_MARK_RE =
  /(?<![\p{L}\p{N}])(?:(?:240|360|480|540|576|720|1080|1440|2160|4320)(?:[pi](?:\d{2})?)?|[48]k|u?hd|fhd|full\s*hd|sd|hevc|[hx]\.?26[45]|avc|hdr(?:10)?|\d{2,3}\s*fps)\+?(?![\p{L}\p{N}])/giu;

/**
 * El nombre sin las marcas de calidad y códec («La 1 TVE 720p» → «La 1
 * TVE», «DAZN 1 1080p50 HEVC» → «DAZN 1»), ni los asteriscos de copia del
 * final. Si no quedara nada, el nombre tal cual.
 */
export function stripQualityMarks(name: string): string {
  const original = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = original
    .replace(QUALITY_MARK_RE, ' ')
    .replace(/(?:\s*\*)+\s*$/u, ' ')
    .replace(/\s*[/|·-]\s*(?=$)/u, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || original;
}
