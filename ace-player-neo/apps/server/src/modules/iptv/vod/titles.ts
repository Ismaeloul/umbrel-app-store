/* Títulos de Películas y series: título limpio, año y distintivos
   (docs/vod.md §4.4, D-VOD6). Puro.

   `cleanVodTitle(raw, categoryName)` NO reutiliza nada de la limpieza de
   canales (T8: `cleanIptvTitle` borra «Reserva», «Multi» o «España», cambia
   «M+» y tira los títulos no latinos). Es conservadora a propósito:
   - quita prefijos de lengua o calidad SOLO al principio («ES - »,
     «|ES| », «LAT: », «[4K] », «4K - »);
   - quita etiquetas SOLO al final («[4K]», «(MULTI)», «(VOSE)», «1080p»,
     «HEVC»…), entre corchetes o paréntesis o sueltas en mayúsculas;
   - el año sale de «(2023)» al final, o de «- 2023» al final;
   - nunca borra palabras del medio, nunca toca «M+» y deja los títulos no
     latinos como vienen. Si la limpieza deja el título vacío, vale el
     original.

   Los distintivos (castellano, latino, VOSE, multi, 4K) salen de lo que se
   ha quitado y del nombre de la categoría («VOD | 4K», «PELIS LATINO»). */

import { VOD_TAGS, type VodTag } from '@ace/shared';

export interface CleanVodTitle {
  readonly title: string;
  /** Año sacado del título, o null. */
  readonly year: number | null;
  /** Bits de `VOD_TAGS` (bit i = `VOD_TAGS[i]`). */
  readonly tags: number;
}

const TAG_BIT: Readonly<Record<VodTag, number>> = Object.fromEntries(
  VOD_TAGS.map((tag, index) => [tag, 1 << index]),
) as Record<VodTag, number>;

export const VOD_YEAR_MIN = 1880;
export const VOD_YEAR_MAX = 2100;

/** Bit de un distintivo. */
export function tagBit(tag: VodTag): number {
  return TAG_BIT[tag];
}

/** Bits → distintivos, en el orden de los chips. */
export function tagsOf(bits: number): VodTag[] {
  return VOD_TAGS.filter((tag) => (bits & TAG_BIT[tag]) !== 0);
}

/**
 * Distintivos de un texto (un trozo quitado del título o el nombre de la
 * categoría). Los códigos cortos (`ES`, `LAT`, `VOS`, `SUB`) solo en
 * mayúsculas y como palabra; las palabras largas, en cualquier caja.
 */
export function detectTags(text: string): number {
  if (!text) return 0;
  let bits = 0;
  const latino =
    /(?:^|[^A-Za-z])(?:LAT|LATAM)(?![A-Za-z])/.test(text) ||
    /latino|latinoam[eé]rica|es-419/i.test(text);
  if (latino) bits |= TAG_BIT.latino;
  const castellano =
    /(?:^|[^A-Za-z])(?:ES|ESP|SPA)(?![A-Za-z])/.test(text) || /castellano|español|españa/i.test(text);
  if (castellano && !latino) bits |= TAG_BIT.castellano;
  if (/(?:^|[^A-Za-z])(?:VOSE|VOS|SUB)(?![A-Za-z])/.test(text) || /vose|subtitulad[ao]/i.test(text)) {
    bits |= TAG_BIT.vose;
  }
  if (/(?:^|[^A-Za-z])(?:multi|dual)(?![A-Za-z])/i.test(text) || /multi[\s-]?audio/i.test(text)) {
    bits |= TAG_BIT.multi;
  }
  if (/(?:^|[^A-Za-z0-9])(?:4K|UHD|2160p)(?![A-Za-z0-9])/i.test(text)) bits |= TAG_BIT['4k'];
  return bits;
}

/* Prefijos al principio: códigos de 2-3 mayúsculas con separador («ES - »,
   «|ES| », «LAT: »), códigos entre corchetes y calidades. */
const PREFIX_CODE = /^(?:\|?[A-Z]{2,3}\|?\s*[-:|]\s*)+/;
const PREFIX_BRACKET = /^\[[A-Z0-9 ]{2,8}\]\s*/;
const PREFIX_QUALITY = /^(?:4K|UHD|FHD|HD|SD)[\s\-|:]+/;

/* Palabras de etiqueta al final. Entre corchetes o paréntesis, en cualquier
   caja; sueltas, solo en mayúsculas (o `1080p`), para no comerse palabras
   del título. */
const TAIL_WORDS =
  '4K|UHD|FHD|HD|SD|MULTI|MULTI[ -]?AUDIO|MULTIAUDIO|DUAL|VOSE|VOS|SUB|SUBS|SUBTITULAD[AO]|LATINO|LAT|LATAM|' +
  'CASTELLANO|ESPAÑOL|ESP|ES|SPA|HEVC|H265|H\\.265|X265|HDR|HDR10|DV|1080P|720P|2160P|3D';
const TAIL_BRACKETED = new RegExp(`\\s*[\\[(]\\s*(?:${TAIL_WORDS})\\s*[\\])]\\s*$`, 'i');
/* Sueltas: sin los códigos de 2 letras que pueden ser palabras de verdad. */
const TAIL_LOOSE =
  /(?:^|[\s\-|:])(4K|UHD|FHD|MULTI|DUAL|VOSE|LATINO|CASTELLANO|HEVC|H265|X265|HDR|HDR10|1080p|720p|2160p)\s*$/;
const TAIL_SEPARATOR = /\s*[-|:–]\s*$/;
const YEAR_PAREN = /\s*\(((?:18|19|20)\d{2})\)\s*$/;
const YEAR_DASH = /\s+[-|–]\s+((?:18|19|20)\d{2})\s*$/;

function validYear(value: number): number | null {
  return Number.isInteger(value) && value >= VOD_YEAR_MIN && value <= VOD_YEAR_MAX ? value : null;
}

/**
 * Título limpio, año y distintivos de un título del panel (§4.4). `raw` ya
 * viene sin caracteres de control ni entidades (parse.ts).
 */
export function cleanVodTitle(raw: string, categoryName = ''): CleanVodTitle {
  const original = raw.trim();
  let title = original;
  let removed = '';
  let year: number | null = null;

  /* Prefijos: cada forma una vez, solo al principio (dos vueltas para «[ES] 4K - …»). */
  for (let round = 0; round < 2; round += 1) {
    for (const pattern of [PREFIX_BRACKET, PREFIX_CODE, PREFIX_QUALITY]) {
      const match = pattern.exec(title);
      if (match && match[0].length < title.length) {
        removed += ` ${match[0]}`;
        title = title.slice(match[0].length).trimStart();
      }
    }
  }

  /* Final: etiquetas y año, hasta que no cambie nada (con tope). */
  for (let round = 0; round < 8; round += 1) {
    const before = title;
    const bracketed = TAIL_BRACKETED.exec(title);
    if (bracketed && bracketed.index > 0) {
      removed += ` ${bracketed[0]}`;
      title = title.slice(0, bracketed.index);
    }
    const loose = TAIL_LOOSE.exec(title);
    if (loose && loose.index > 0) {
      removed += ` ${loose[1] ?? ''}`;
      title = title.slice(0, loose.index);
    }
    if (year === null) {
      const paren = YEAR_PAREN.exec(title) ?? YEAR_DASH.exec(title);
      if (paren && paren.index > 0) {
        year = validYear(Number(paren[1]));
        title = title.slice(0, paren.index);
      }
    }
    title = title.replace(TAIL_SEPARATOR, '');
    if (title === before) break;
  }

  title = title.trim();
  if (!title) title = original;
  const tags = detectTags(removed) | detectTags(categoryName);
  /* Latino manda sobre castellano aunque vengan de sitios distintos. */
  const fixed = tags & TAG_BIT.latino ? tags & ~TAG_BIT.castellano : tags;
  return { title, year, tags: fixed };
}
