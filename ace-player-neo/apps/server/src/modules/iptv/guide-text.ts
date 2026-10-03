/* Limpieza de lo que dice la guía antes de guardarlo (docs/iptv.md §20.4).
   Puro: lo usa la construcción de la guía completa (guide-full.ts). La
   ventana de partidos (guide.ts) sigue leyendo el texto tal cual.

   - Entidades dobles (`&amp;amp;`) y etiquetas HTML sueltas (`<br>`, `<p>`,
     `<b>`…) que algunos paneles meten en la sinopsis: fuera.
   - Caracteres de control y espacios repetidos: un espacio.
   - Recortes por palabra con «…».
   - Relleno: «Programación no disponible», «Sin información», «To be
     announced»… o sin título.
   - Temporada y episodio de `xmltv_ns` (empieza en cero: «1.0.0/1» es T2 E1)
     u `onscreen` («S02E05», «T2 Ep. 5», «2x05»). */

import type { XmltvEpisodeNum } from './xmltv.js';
import { decodeEntities } from './xmltv.js';

const HTML_TAG_RE =
  /<\/?(?:p|b|i|u|em|strong|span|div|font|small|big|center|h[1-6]|ul|ol|li|a)(?:\s[^<>]{0,200})?\/?>/gi;
const BREAK_RE = /<br\s*\/?>/gi;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]+/g;

/** Texto limpio y recortado a `max` letras (por una palabra, con «…»). */
export function cleanGuideText(text: string, max: number): string {
  if (!text) return '';
  let out = text;
  /* Entidades que llegaron escapadas dos veces («&amp;amp;» ya es «&amp;»). */
  if (out.includes('&')) out = decodeEntities(out);
  if (out.includes('<')) out = out.replace(BREAK_RE, ' ').replace(HTML_TAG_RE, '');
  out = out.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  return truncateWords(out, max);
}

/** Recorta por una palabra y añade «…» (nunca pasa de `max` + 1 letras). */
export function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:–-]+$/u, '')}…`;
}

const FILLER_RE =
  /^(?:\(?\s*)?(?:programaci[oó]n no disponible|sin programaci[oó]n|sin informaci[oó]n|informaci[oó]n no disponible|no hay informaci[oó]n|no information|no programme information|no program information|to be announced|tba|tbd|n\/a|pr[oó]ximamente|fin de (?:la )?emisi[oó]n|cierre de emisi[oó]n|off air|close ?down)(?:\s*\)?)?[.!]*$/i;

/** ¿Es un bloque de relleno por su título? (vacío o «Programación no disponible»…). */
export function isFillerTitle(title: string): boolean {
  const text = title.trim();
  return !text || FILLER_RE.test(text);
}

export interface EpisodeInfo {
  readonly season: number | null;
  readonly episode: number | null;
  /** El episodio tal cual si no se entiende como números. */
  readonly text: string | null;
}

const NO_EPISODE: EpisodeInfo = { season: null, episode: null, text: null };

function positive(value: string | undefined, max: number): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}

/** `xmltv_ns`: «temporada.episodio.parte», cada uno con «/total» opcional y empezando en cero. */
function fromXmltvNs(value: string): EpisodeInfo | null {
  const match = /^\s*(\d*)\s*(?:\/\s*\d*)?\s*\.\s*(\d*)\s*(?:\/\s*\d*)?\s*(?:\.|$)/.exec(value);
  if (!match) return null;
  const season = match[1] ? positive(String(Number(match[1]) + 1), 9999) : null;
  const episode = match[2] ? positive(String(Number(match[2]) + 1), 99999) : null;
  return season || episode ? { season, episode, text: null } : null;
}

/** «S02E05», «T2 Ep. 5», «Temporada 2 Capítulo 5», «2x05», «Ep. 5», «Episodio 12». */
function fromText(value: string): EpisodeInfo | null {
  const text = value.trim();
  let match = /\bS\s?(\d{1,4})\s?E\s?(\d{1,5})\b/i.exec(text);
  if (!match) {
    match =
      /\bT(?:emp(?:orada)?)?\.?\s?(\d{1,4})\b.{0,4}?\b(?:E|Ep|Episodio|Cap|Cap[ií]tulo)\.?\s?(\d{1,5})\b/i.exec(
        text,
      );
  }
  if (!match) match = /\b(\d{1,2})x(\d{1,3})\b/i.exec(text);
  if (match) {
    const season = positive(match[1], 9999);
    const episode = positive(match[2], 99999);
    if (season || episode) return { season, episode, text: null };
  }
  const only = /\b(?:E|Ep|Episodio|Cap|Cap[ií]tulo)\.?\s?(\d{1,5})\b/i.exec(text);
  if (only) {
    const episode = positive(only[1], 99999);
    if (episode) return { season: null, episode, text: null };
  }
  return null;
}

/** Temporada y episodio de los `<episode-num>` de un programa. */
export function parseEpisode(nums: readonly XmltvEpisodeNum[] | undefined): EpisodeInfo {
  if (!nums?.length) return NO_EPISODE;
  for (const num of nums) {
    if (num.system === 'xmltv_ns') {
      const parsed = fromXmltvNs(num.value);
      if (parsed) return parsed;
    }
  }
  for (const num of nums) {
    if (num.system === 'xmltv_ns' || num.system === 'dd_progid') continue;
    const parsed = fromText(num.value);
    if (parsed) return parsed;
  }
  const shown = nums.find((num) => num.system === 'onscreen' || num.system === '');
  const text = shown ? cleanGuideText(shown.value, 59) : '';
  return text ? { season: null, episode: null, text } : NO_EPISODE;
}

/** Año de un `<date>` («2019», «20190512»), si es creíble. */
export function parseYear(date: string | undefined): number | null {
  const match = date ? /^\s*(\d{4})/.exec(date) : null;
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1888 && year <= 2100 ? year : null;
}

/** Edad o nota: corto, sin espacios raros (null si queda vacío o es muy largo). */
export function shortLabel(value: string | undefined, max = 20): string | null {
  if (!value) return null;
  const text = cleanGuideText(value, 200);
  return text && text.length <= max ? text : null;
}
