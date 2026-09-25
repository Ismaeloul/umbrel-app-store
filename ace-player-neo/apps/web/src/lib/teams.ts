/* Equipos y competiciones de un partido: colores, siglas, escudos y el par de
   colores de la tarjeta versus (plan Palco fase 2, decisión W12).

   `FootballMatch` trae, si el backend los conoce, `homeTeam`/`awayTeam`
   (`TeamBadge`: id, name, short, crest, colors) y `competitionBadge`. Aquí se
   resuelve lo que pintan las vistas SIN que dependan de si vienen o no:
   - colores: `colors.primary` de la API o, si falta, un tono estable sacado
     del nombre (fuera de las franjas de estado, lib/color.ts);
   - siglas: `short` de la API o las iniciales del nombre;
   - escudo: la ruta relativa de mismo origen que da la API, o null (nunca se
     enlaza a terceros: la CSP de nginx solo permite `img-src 'self'`);
   - par de colores de la tarjeta versus: si local y visitante se parecen
     (ΔE en OKLab < VERSUS_DELTA), el visitante usa su segundo color; si siguen
     chocando, se oscurece la mitad más clara (L − 0,18). */

import type { CompetitionBadge, FootballMatch, TeamBadge } from '@ace/shared';
import { hueFromName, oklchToRgb, parseHex, rgbToHex, rgbToOklch, type Oklch } from './color.ts';

export type MatchSide = 'home' | 'away';

export interface TeamPalette {
  /** `#rrggbb` en minúsculas. */
  primary: string;
  secondary: string | null;
  /** De dónde sale: la API (`colors`) o el nombre (`hueFromName`). */
  source: 'api' | 'name';
}

/** Lo mínimo que necesita una pieza de UI para pintar un equipo. */
export interface TeamLike {
  name: string;
  short?: string | null;
  colors?: { primary?: string | null; secondary?: string | null } | null;
  crest?: string | null;
}

export interface VersusPair {
  home: string;
  away: string;
  /** El visitante ha pasado a su segundo color. */
  swapped: boolean;
  /** Se ha oscurecido una mitad porque seguían pareciéndose. */
  darkened: boolean;
}

/* Dos colores con ΔE (OKLab) por debajo de esto se leen como «el mismo»: dos
   rojos (Sevilla–Girona 0,02; Arsenal–Liverpool 0,08), rojo y granate
   (Atlético–Barça 0,12). Negro y azul marino (Juventus–Inter, 0,21) o
   azulgrana y negro (Barça–Juventus, 0,34) ya se distinguen. */
export const VERSUS_DELTA = 0.14;
/** Cuánto se oscurece una mitad cuando ni el segundo color la salva. */
export const VERSUS_DARKEN = 0.18;

const SKIP = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'fc',
  'cf',
  'cd',
  'sd',
  'ud',
  'sc',
  'ac',
  'afc',
  'club',
  'y',
]);

/** «Atlético de Madrid» → «AM»; «Tottenham» → «TOT»; «Real Madrid» → «RM». */
export function teamInitials(name: string, short?: string | null): string {
  if (short && short.trim()) return short.trim().slice(0, 4).toUpperCase();
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s.-]+/)
    .filter((word) => word && !SKIP.has(word.toLowerCase()));
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function teamBadge(match: FootballMatch, side: MatchSide): TeamBadge | null {
  return (side === 'home' ? match.homeTeam : match.awayTeam) ?? null;
}

export function teamName(match: FootballMatch, side: MatchSide): string {
  return side === 'home' ? match.home : match.away;
}

function normalizeHex(value: string | null | undefined): string | null {
  const rgb = parseHex(value);
  return rgb ? rgbToHex(rgb) : null;
}

/** Tono sacado del nombre, con luz y croma para que sirva de mitad de tarjeta bajo texto blanco. */
export function nameTone(name: string): Oklch {
  return { l: 0.5, c: 0.12, h: hueFromName(name) };
}

/** Colores de una pieza de equipo: los de la API o el tono del nombre. */
export function paletteOf(team: TeamLike): TeamPalette {
  const primary = normalizeHex(team.colors?.primary);
  if (primary) return { primary, secondary: normalizeHex(team.colors?.secondary), source: 'api' };
  return { primary: rgbToHex(oklchToRgb(nameTone(team.name))), secondary: null, source: 'name' };
}

export function teamPalette(match: FootballMatch, side: MatchSide): TeamPalette {
  return paletteOf({ name: teamName(match, side), colors: teamBadge(match, side)?.colors });
}

/** Siglas de hasta 4 letras: `short` de la API o las iniciales del nombre. */
export function teamShort(match: FootballMatch, side: MatchSide): string {
  return teamInitials(teamName(match, side), teamBadge(match, side)?.short);
}

/** Ruta relativa del escudo (mismo origen) o null; en demo siempre null. */
export function teamCrest(match: FootballMatch, side: MatchSide): string | null {
  return sameOrigin(teamBadge(match, side)?.crest);
}

export function competitionBadge(match: FootballMatch): CompetitionBadge | null {
  return match.competitionBadge ?? null;
}

/** Ruta relativa del logo de la competición o null. */
export function competitionLogo(match: FootballMatch): string | null {
  return sameOrigin(match.competitionBadge?.logo);
}

/** Solo rutas relativas del propio servidor: nada de enlazar a terceros. */
function sameOrigin(path: string | null | undefined): string | null {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

const COMPETITION_SHORT: ReadonlyArray<readonly [RegExp, string]> = [
  [/champions/i, 'UCL'],
  [/europa league/i, 'UEL'],
  [/conference/i, 'UECL'],
  [/nations league/i, 'UNL'],
  [/premier/i, 'PL'],
  [/laliga|la liga/i, 'LaLiga'],
  [/hypermotion|segunda/i, 'LaLiga 2'],
  [/copa del rey/i, 'Copa'],
  [/serie a/i, 'Serie A'],
  [/bundesliga/i, 'BL'],
  [/ligue 1/i, 'L1'],
  [/mundial|world cup/i, 'Mundial'],
  [/eurocopa|euro /i, 'Euro'],
];

/** «Champions League» → «UCL»; «LaLiga» → «LaLiga»; un nombre largo → sus iniciales. */
export function competitionShort(name: string): string {
  const clean = name.trim();
  if (!clean) return 'Fútbol';
  for (const [pattern, short] of COMPETITION_SHORT) if (pattern.test(clean)) return short;
  if (clean.length <= 10) return clean;
  const initials = clean
    .split(/[\s-]+/)
    .filter((word) => word && !SKIP.has(word.toLowerCase()))
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 4) || clean.slice(0, 10);
}

/** Distancia perceptual (ΔE en OKLab, 0 = igual; ~1 = blanco a negro). */
export function colorDistance(a: string, b: string): number {
  const x = lab(a);
  const y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function lab(hex: string): [number, number, number] {
  const rgb = parseHex(hex) ?? { r: 0.5, g: 0.5, b: 0.5 };
  const { l, c, h } = rgbToOklch(rgb);
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

function darken(hex: string, by = VERSUS_DARKEN): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const color = rgbToOklch(rgb);
  return rgbToHex(oklchToRgb({ ...color, l: Math.max(0.12, color.l - by) }));
}

/** Los dos colores definitivos de la tarjeta versus (ver cabecera). */
export function versusPair(home: TeamPalette, away: TeamPalette): VersusPair {
  let h = home.primary;
  let a = away.primary;
  let swapped = false;
  let darkened = false;
  if (colorDistance(h, a) < VERSUS_DELTA) {
    if (away.secondary && colorDistance(h, away.secondary) >= VERSUS_DELTA) {
      a = away.secondary;
      swapped = true;
    }
    if (colorDistance(h, a) < VERSUS_DELTA) {
      const lighterIsAway = lab(a)[0] >= lab(h)[0];
      if (lighterIsAway) a = darken(a);
      else h = darken(h);
      darkened = true;
    }
  }
  return { home: h, away: a, swapped, darkened };
}

/** Atajo: el par de colores de un `FootballMatch`. */
export function matchVersusPair(match: FootballMatch): VersusPair {
  return versusPair(teamPalette(match, 'home'), teamPalette(match, 'away'));
}
