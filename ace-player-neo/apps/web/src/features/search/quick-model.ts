/* La ventana rápida de buscar (Ctrl K, rediseño de escritorio, pantalla 6):
   lo que no pinta. Funciones puras, se prueban solas.

   - Partidos: los de la agenda de hoy en adelante cuyo equipo, título o
     competición contiene lo escrito (sin tildes ni mayúsculas). El que está
     en directo, primero; luego por fecha y hora; los terminados, al final.
   - Resaltado: dónde cae lo escrito en el texto ORIGINAL, aunque se compare
     sin tildes («barç» resalta «Barç» de «Barça TV» y «barc» también).
   - Recientes: las 5 últimas búsquedas con las que se abrió algo, en este
     navegador (una comodidad por visor: si el almacenamiento falla, no hay).
   - Chips y filas: los grupos se cuentan enteros, pero con «Todo» cada grupo
     enseña unos pocos y «Ver los N» lleva a su chip. */

import { stripQualityMarks, type FootballMatch, type LiveScore } from '@ace/shared';
import { readJson, writeJson } from '../../lib/storage.ts';
import { channelAbbrev, channelDorsal } from '../../ui/ChannelMark.tsx';
import { foldText } from '../library/model.ts';
import { matchStatus, minutesToMatch, type MatchPhase } from '../agenda/domain.ts';

// ---- Texto ------------------------------------------------------------------------

/** Lo que hace falta escribir para buscar en la agenda, los canales y el catálogo. */
export const QUICK_MIN = 2;

/** Un carácter sin tilde ni mayúscula (la misma regla que foldText, letra a letra). */
function foldChar(ch: string): string {
  return ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * El trozo de `text` que casa con `query` (sin tildes ni mayúsculas), en
 * posiciones del texto original: [inicio, fin). null si no aparece.
 */
export function highlightRange(text: string, query: string): [number, number] | null {
  const q = foldText(query);
  if (!q) return null;
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = foldChar(text[i]!);
    for (let k = 0; k < piece.length; k += 1) origin.push(i);
    folded += piece;
  }
  const at = folded.indexOf(q);
  if (at >= 0) return [origin[at]!, origin[at + q.length - 1]! + 1];
  // Los canales también casan sin espacios ni signos («dazn1» con «DAZN 1»,
  // «laliga» con «La Liga»; filterItems usa la clave del canal): se busca
  // igual, solo con letras y cifras.
  const bare = q.replace(/[^\p{L}\p{N}]/gu, '');
  if (bare.length < QUICK_MIN) return null;
  let compact = '';
  const where: number[] = [];
  for (let k = 0; k < folded.length; k += 1) {
    const ch = folded[k]!;
    if (!/[\p{L}\p{N}]/u.test(ch)) continue;
    compact += ch;
    where.push(origin[k]!);
  }
  const found = compact.indexOf(bare);
  if (found < 0) return null;
  return [where[found]!, where[found + bare.length - 1]! + 1];
}

/** Partes para pintar con <mark>: [antes, resaltado, después]. */
export function highlightParts(text: string, query: string): [string, string, string] {
  const range = highlightRange(text, query);
  if (!range) return [text, '', ''];
  return [text.slice(0, range[0]), text.slice(range[0], range[1]), text.slice(range[1])];
}

// ---- Partidos ---------------------------------------------------------------------

export interface QuickMatch {
  match: FootballMatch;
  phase: MatchPhase | null;
}

const PHASE_ORDER: Record<MatchPhase | 'none', number> = {
  live: 0,
  soon: 1,
  next: 2,
  none: 2,
  done: 3,
};

/**
 * Los partidos que casan con lo escrito, de hoy en adelante: primero lo que
 * está en directo, luego por cuándo empiezan y los terminados al final.
 */
export function searchMatches(
  days: ReadonlyArray<{ date: string; matches: readonly FootballMatch[] }>,
  query: string,
  now: number,
  today: string,
  scores: Readonly<Record<string, LiveScore>> = {},
): QuickMatch[] {
  const q = foldText(query);
  if (q.length < QUICK_MIN) return [];
  const seen = new Set<string>();
  const found: Array<QuickMatch & { left: number }> = [];
  for (const day of days) {
    if (day.date < today) continue;
    for (const match of day.matches) {
      if (seen.has(match.id)) continue;
      const hay = foldText(
        [match.home, match.away, match.title, match.competition].filter(Boolean).join(' · '),
      );
      if (!hay.includes(q)) continue;
      seen.add(match.id);
      const phase = matchStatus(match, now, scores[match.id])?.phase ?? null;
      found.push({ match, phase, left: minutesToMatch(match, now) ?? Number.MAX_SAFE_INTEGER });
    }
  }
  return found
    .sort(
      (a, b) =>
        PHASE_ORDER[a.phase ?? 'none'] - PHASE_ORDER[b.phase ?? 'none'] ||
        (a.phase === 'done' ? b.left - a.left : a.left - b.left),
    )
    .map(({ match, phase }) => ({ match, phase }));
}

// ---- Grupos y chips -----------------------------------------------------------------

export type QuickGroup = 'partidos' | 'canales' | 'titulos';
export type QuickFilter = 'todo' | QuickGroup;

export const GROUP_TITLE: Record<QuickGroup, string> = {
  partidos: 'Partidos',
  canales: 'Canales',
  titulos: 'Pelis y series',
};

/** Cuántas filas de cada grupo se ven con «Todo» (el resto, en su chip). */
export const GROUP_PEEK: Record<QuickGroup, number> = {
  partidos: 3,
  canales: 3,
  titulos: 4,
};

/** «Ver los 3» (partidos, canales) o «Ver las 4» (pelis y series). */
export function seeAllText(group: QuickGroup, total: number): string {
  return group === 'titulos' ? `Ver las ${total}` : `Ver los ${total}`;
}

/** Las filas que se ven de un grupo con el chip elegido (0 si el chip es de otro grupo). */
export function visibleCount(group: QuickGroup, total: number, filter: QuickFilter): number {
  if (filter === 'todo') return Math.min(total, GROUP_PEEK[group]);
  return filter === group ? total : 0;
}

// ---- Recientes ------------------------------------------------------------------------

export const RECENTS_KEY = 'aceneo-buscar-recientes';
export const RECENTS_MAX = 5;

export function readRecents(): string[] {
  const value = readJson(RECENTS_KEY, (raw): raw is unknown[] => Array.isArray(raw));
  return (value ?? [])
    .filter((item): item is string => typeof item === 'string')
    .slice(0, RECENTS_MAX);
}

/** Apunta una búsqueda arriba del todo (sin repetir, sin tildes en la comparación). */
export function addRecent(list: readonly string[], text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (foldText(clean).length < QUICK_MIN) return [...list];
  const key = foldText(clean);
  return [clean, ...list.filter((item) => foldText(item) !== key)].slice(0, RECENTS_MAX);
}

export function removeRecent(list: readonly string[], text: string): string[] {
  return list.filter((item) => item !== text);
}

export function saveRecents(list: readonly string[]): void {
  writeJson(RECENTS_KEY, list.slice(0, RECENTS_MAX));
}

// ---- Movimiento con las flechas --------------------------------------------------------

/** La opción siguiente (o anterior) con vuelta, como en las paletas de comandos. */
export function stepIndex(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

// ---- Canales ----------------------------------------------------------------------

/** Texto de la pastilla: el nombre si cabe; si no, la sigla y el número («M+ 2»). */
export function logoText(name: string): string {
  const clean = stripQualityMarks(name).replace(/\s+/g, ' ').trim() || name.trim();
  if (clean.length <= 12) return clean;
  const dorsal = channelDorsal(clean);
  return /\d/.test(dorsal) ? `${channelAbbrev(clean)} ${dorsal}` : channelAbbrev(clean);
}

/** Colores de marca de la pastilla: fondo y letra. */
export interface ChannelBrand {
  bg: string;
  ink: string;
}

/*
 * Los de la maqueta (01-escritorio.html, Guía, Canales y Buscar), por el
 * principio del nombre ya plegado. «M+ …» y «Movistar …» son la marca azul
 * oscuro de los canales de Movistar; «Movistar+» a secas, el azul claro. Los
 * blancos llevan el borde de 1 px de la pastilla para que no se pierdan en
 * el tema claro. El nombre va siempre al lado: la pastilla es decorativa.
 */
const CHANNEL_BRANDS: ReadonlyArray<[RegExp, ChannelBrand]> = [
  [/^barca\b/, { bg: '#a50044', ink: '#fff' }],
  [/^dazn\b/, { bg: '#f8f8f8', ink: '#0c0c0e' }],
  [/^(?:movistar ?(?:\+|plus))$/, { bg: '#00a1e0', ink: '#fff' }],
  [/^(?:m\+|movistar\b)/, { bg: '#1c2a6b', ink: '#fff' }],
  [/^bein\b/, { bg: '#c8102e', ink: '#fff' }],
  [/^la 1\b/, { bg: '#fff', ink: '#1d5a37' }],
  [/^eurosport\b/, { bg: '#ff6a00', ink: '#fff' }],
  [/^cine ?\+/, { bg: '#5b21b6', ink: '#fff' }],
  [/^gol\b/, { bg: '#111', ink: '#ffd60a' }],
];

/** El color de marca de un canal conocido; null si no se sabe (entonces, su tono por el nombre). */
export function channelBrand(name: string): ChannelBrand | null {
  const key = foldText(stripQualityMarks(name)).replace(/\s+/g, ' ');
  return CHANNEL_BRANDS.find(([pattern]) => pattern.test(key))?.[1] ?? null;
}
