/* Pistas de audio de una película (docs/vod.md §9.9, D-VOD14): cuál suena
   por defecto y cómo se llama cada una en el reproductor. Puro.

   Por defecto:
   1. la pedida (`audio=<n>`), si existe;
   2. la preferencia guardada para la serie o la película (§10.4), por lengua;
   3. la primera en castellano (`spa`, `es`, `esp` o «castellano»/«español» en
      el nombre) que no sea latino ni comentario;
   4. la marcada por defecto;
   5. la primera. */

import type { VodTrack } from './types.js';

const LANGUAGE_LABEL: Readonly<Record<string, string>> = {
  spa: 'Castellano',
  es: 'Castellano',
  esp: 'Castellano',
  'es-es': 'Castellano',
  'es-419': 'Español (Latinoamérica)',
  eng: 'Inglés',
  en: 'Inglés',
  fra: 'Francés',
  fre: 'Francés',
  fr: 'Francés',
  ita: 'Italiano',
  it: 'Italiano',
  deu: 'Alemán',
  ger: 'Alemán',
  de: 'Alemán',
  por: 'Portugués',
  pt: 'Portugués',
  cat: 'Catalán',
  ca: 'Catalán',
  jpn: 'Japonés',
  ja: 'Japonés',
};

const CASTILIAN_CODES = new Set(['spa', 'es', 'esp', 'es-es']);

function lower(value: string | null): string {
  return (value ?? '').toLowerCase();
}

function isLatino(track: VodTrack): boolean {
  return lower(track.lang) === 'es-419' || /latino|latam|latinoam/.test(lower(track.name));
}

function isCommentary(track: VodTrack): boolean {
  return /comentari|commentary/.test(lower(track.name));
}

function isCastilian(track: VodTrack): boolean {
  if (isLatino(track) || isCommentary(track)) return false;
  return CASTILIAN_CODES.has(lower(track.lang)) || /castellano|español/.test(lower(track.name));
}

/** ¿La pista es de esta lengua (la guardada en las preferencias)? */
function sameLanguage(track: VodTrack, lang: string): boolean {
  const wanted = lang.toLowerCase();
  const code = lower(track.lang);
  if (!code) return false;
  if (code === wanted) return true;
  const label = (value: string): string | undefined => LANGUAGE_LABEL[value];
  return label(code) !== undefined && label(code) === label(wanted);
}

/** La pista que suena (o null si el título no tiene audio). */
export function pickVodAudio(
  tracks: readonly VodTrack[],
  options: { readonly requested?: number | undefined; readonly preferredLang?: string | null },
): VodTrack | null {
  if (!tracks.length) return null;
  if (options.requested !== undefined) {
    const asked = tracks.find((track) => track.index === options.requested);
    if (asked) return asked;
  }
  if (options.preferredLang) {
    const lang = options.preferredLang;
    const preferred = tracks.find((track) => sameLanguage(track, lang) && !isCommentary(track));
    if (preferred) return preferred;
  }
  return (
    tracks.find(isCastilian) ?? tracks.find((track) => track.isDefault) ?? (tracks[0] as VodTrack)
  );
}

/** «Castellano 5.1», «Inglés», «Pista 3», con el nombre si dice algo más («Comentarios»). */
export function vodAudioLabel(track: VodTrack, position: number): string {
  const code = lower(track.lang);
  let base: string;
  if (isLatino(track)) base = 'Español (Latinoamérica)';
  else if (code && code !== 'und') base = LANGUAGE_LABEL[code] ?? code.toUpperCase();
  else base = `Pista ${position + 1}`;
  const layout = track.channels === 6 ? ' 5.1' : track.channels === 8 ? ' 7.1' : '';
  let label = `${base}${layout}`;
  const name = (track.name ?? '').trim();
  if (name && !label.toLowerCase().includes(name.toLowerCase()) && isCommentary(track)) {
    label = `${label} · ${name}`;
  }
  return label.slice(0, 40);
}

/* --- Lengua de una pista (§4.11: lo que dice el fichero, para la ficha y el filtro) --- */

/** Código → clave única de su lengua (el castellano y el latino, siempre aparte). */
const LANGUAGE_KEY: Readonly<Record<string, string>> = {
  spa: 'spa',
  es: 'spa',
  esp: 'spa',
  'es-es': 'spa',
  'es-419': 'es-419',
  eng: 'eng',
  en: 'eng',
  fra: 'fra',
  fre: 'fra',
  fr: 'fra',
  ita: 'ita',
  it: 'ita',
  deu: 'deu',
  ger: 'deu',
  de: 'deu',
  por: 'por',
  pt: 'por',
  cat: 'cat',
  ca: 'cat',
  jpn: 'jpn',
  ja: 'jpn',
};

/**
 * La lengua de una pista como clave (`spa`, `es-419`, `eng`, `fra`… o el
 * código tal cual si no está en la tabla), o null si no la dice (`und`,
 * vacía). Una pista «Latino» en el nombre es `es-419` aunque diga `spa`.
 */
export function vodTrackLangKey(track: Pick<VodTrack, 'lang' | 'name'>): string | null {
  const code = lower(track.lang).trim();
  if (code === 'es-419' || /latino|latam|latinoam/.test(lower(track.name))) return 'es-419';
  if (!code || code === 'und' || code === 'mul' || code === 'zxx' || code === 'mis') return null;
  const known = LANGUAGE_KEY[code];
  if (known) return known;
  /* «es-MX», «es-AR»: latino; «en-US», «fr-CA»: su lengua. */
  const base = code.split('-')[0] ?? '';
  if (base === 'es') return 'es-419';
  const fromBase = LANGUAGE_KEY[base];
  if (fromBase) return fromBase;
  return /^[a-z]{2,8}(?:-[a-z0-9]{1,8})?$/.test(code) ? code : null;
}

/** «Castellano», «Español (Latinoamérica)», «Inglés»… (un código raro, en mayúsculas). */
export function vodLanguageLabel(key: string): string {
  return (LANGUAGE_LABEL[key] ?? key.toUpperCase()).slice(0, 40);
}
