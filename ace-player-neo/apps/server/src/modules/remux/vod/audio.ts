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
