/* Preferencias de fútbol («Tu agenda», inventario §4): el catálogo de chips,
   la limpieza de listas y el resumen que enseña Ajustes. Funciones puras.

   Topes y longitudes: los mismos que aplica el servidor (@ace/shared,
   state/v1.ts): 12 ligas, 24 equipos y 24 nacionalidades; 60, 80 y 60
   caracteres. Se deduplica por la clave normalizada (normalizePreferenceKey,
   la misma que usan las reglas de «Para ti»). */

import {
  footballTeamNameMatches,
  leagueMatches,
  MAX_FOOTBALL_LEAGUES,
  MAX_FOOTBALL_NATIONALITIES,
  MAX_FOOTBALL_TEAMS,
  normalizePreferenceKey,
  TEXT_LIMITS,
  type Preferences,
} from '@ace/shared';

export type PreferenceKind = 'leagues' | 'teams' | 'nationalities';

/** Chips fijos de la 0.6.59 (index.html:2675-2682), en su orden. */
export const LEAGUE_OPTIONS = [
  'LaLiga',
  'LaLiga Hypermotion',
  'Champions League',
  'Premier League',
  'Europa League',
  'Copa del Rey',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
] as const;

export const TEAM_OPTIONS = [
  'Real Madrid',
  'Barcelona',
  'Atlético de Madrid',
  'Athletic Club',
  'Real Betis',
  'Real Sociedad',
  'Villarreal',
  'Sevilla',
  'Manchester City',
  'Arsenal',
  'Liverpool',
  'Inter',
] as const;

/** País y bandera (emoji); los personalizados llevan el globo terráqueo. */
export const NATIONALITY_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['España', '🇪🇸'],
  ['Argentina', '🇦🇷'],
  ['Brasil', '🇧🇷'],
  ['Inglaterra', '🇬🇧'],
  ['Francia', '🇫🇷'],
  ['Italia', '🇮🇹'],
  ['Alemania', '🇩🇪'],
  ['Portugal', '🇵🇹'],
  ['Países Bajos', '🇳🇱'],
  ['Marruecos', '🇲🇦'],
  ['México', '🇲🇽'],
  ['Estados Unidos', '🇺🇸'],
  ['Uruguay', '🇺🇾'],
  ['Colombia', '🇨🇴'],
];
export const CUSTOM_FLAG = '🌍';

export function flagFor(name: string): string {
  return NATIONALITY_OPTIONS.find(([item]) => item === name)?.[1] ?? CUSTOM_FLAG;
}

export const PREFERENCE_MAX: Record<PreferenceKind, number> = {
  leagues: MAX_FOOTBALL_LEAGUES,
  teams: MAX_FOOTBALL_TEAMS,
  nationalities: MAX_FOOTBALL_NATIONALITIES,
};

export const PREFERENCE_TEXT_MAX: Record<PreferenceKind, number> = {
  leagues: TEXT_LIMITS.preferenceLeague,
  teams: TEXT_LIMITS.preferenceTeam,
  nationalities: TEXT_LIMITS.preferenceNationality,
};

export const PREFERENCE_OPTIONS: Record<PreferenceKind, readonly string[]> = {
  leagues: LEAGUE_OPTIONS,
  teams: TEAM_OPTIONS,
  nationalities: NATIONALITY_OPTIONS.map(([name]) => name),
};

const collapse = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** `cleanPreferenceList` (index.html:2588-2599): sin vacíos ni repetidos por clave, cortado y con tope. */
export function cleanPreferenceList(
  values: readonly unknown[] | null | undefined,
  max: number,
  maxLength: number,
): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = collapse(raw).slice(0, maxLength);
    const key = normalizePreferenceKey(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

/**
 * Texto de un valor personalizado listo para añadir, o null si no vale: menos
 * de 2 caracteres se ignora (index.html:2877-2886).
 */
export function cleanCustomValue(value: string, kind: PreferenceKind): string | null {
  const clean = collapse(value).slice(0, PREFERENCE_TEXT_MAX[kind]);
  return clean.length >= 2 ? clean : null;
}

/** Busca en la lista un valor con la misma clave («real madrid» = «Real Madrid»). */
export function findSameKey(list: readonly string[], value: string): string | null {
  const key = normalizePreferenceKey(value);
  return list.find((item) => normalizePreferenceKey(item) === key) ?? null;
}

export interface PreferenceDraft {
  leagues: string[];
  teams: string[];
  nationalities: string[];
}

export function draftFrom(preferences: Partial<Preferences> | null | undefined): PreferenceDraft {
  return {
    leagues: cleanPreferenceList(
      preferences?.leagues,
      PREFERENCE_MAX.leagues,
      PREFERENCE_TEXT_MAX.leagues,
    ),
    teams: cleanPreferenceList(preferences?.teams, PREFERENCE_MAX.teams, PREFERENCE_TEXT_MAX.teams),
    nationalities: cleanPreferenceList(
      preferences?.nationalities,
      PREFERENCE_MAX.nationalities,
      PREFERENCE_TEXT_MAX.nationalities,
    ),
  };
}

/** Marca o desmarca un valor. Con la lista llena no se añade nada (tope del servidor). */
export function toggleValue(
  draft: PreferenceDraft,
  kind: PreferenceKind,
  value: string,
): PreferenceDraft {
  const list = draft[kind];
  if (list.includes(value)) return { ...draft, [kind]: list.filter((item) => item !== value) };
  if (list.length >= PREFERENCE_MAX[kind]) return draft;
  return { ...draft, [kind]: [...list, value] };
}

/**
 * Añade un valor escrito a mano. Si ya existe uno con la misma clave (un chip
 * fijo o uno tuyo), se marca ese en vez de duplicarlo. Devuelve el borrador
 * (igual si no cabe o no vale) y el nombre que ha quedado marcado.
 */
export function addCustomValue(
  draft: PreferenceDraft,
  kind: PreferenceKind,
  raw: string,
): { draft: PreferenceDraft; added: string | null; full: boolean } {
  const clean = cleanCustomValue(raw, kind);
  if (!clean) return { draft, added: null, full: false };
  const existing = findSameKey([...PREFERENCE_OPTIONS[kind], ...draft[kind]], clean) ?? clean;
  if (draft[kind].includes(existing)) return { draft, added: existing, full: false };
  if (draft[kind].length >= PREFERENCE_MAX[kind]) return { draft, added: null, full: true };
  return { draft: { ...draft, [kind]: [...draft[kind], existing] }, added: existing, full: false };
}

/** Chips de una sección: los fijos y, detrás, los tuyos que no están entre los fijos. */
export function chipsFor(kind: PreferenceKind, draft: PreferenceDraft): string[] {
  const fixed = PREFERENCE_OPTIONS[kind];
  return [...fixed, ...draft[kind].filter((value) => !fixed.includes(value))];
}

export function hasAny(draft: Pick<PreferenceDraft, PreferenceKind>): boolean {
  return draft.leagues.length > 0 || draft.teams.length > 0 || draft.nationalities.length > 0;
}

const listFormat = new Intl.ListFormat('es-ES', { type: 'conjunction' });

/** Resumen de Ajustes (index.html:2832-2840). */
export function preferenceSummary(
  preferences: Partial<PreferenceDraft> | null | undefined,
): string {
  const parts: string[] = [];
  const leagues = preferences?.leagues?.length ?? 0;
  const teams = preferences?.teams?.length ?? 0;
  const nationalities = preferences?.nationalities?.length ?? 0;
  if (leagues) parts.push(`${leagues} ${leagues === 1 ? 'liga' : 'ligas'}`);
  if (teams) parts.push(`${teams} ${teams === 1 ? 'equipo' : 'equipos'}`);
  if (nationalities)
    parts.push(`${nationalities} ${nationalities === 1 ? 'nacionalidad' : 'nacionalidades'}`);
  return parts.length
    ? `Tu agenda prioriza ${listFormat.format(parts)}.`
    : 'Personaliza la agenda con tus ligas, equipos y nacionalidades.';
}

// ---- Seguir desde la agenda (menú contextual de la franja) ---------------------

/** ¿Ya sigues a este equipo? Con las mismas reglas que «Para ti» (alias, sin FC/CF, nunca «incluye»). */
export function followedTeam(
  preferences: Partial<Preferences> | null | undefined,
  team: string,
): string | null {
  return (preferences?.teams ?? []).find((item) => footballTeamNameMatches(item, team)) ?? null;
}

/** ¿Ya sigues esta competición? (misma clave con alias que «Para ti»). */
export function followedLeague(
  preferences: Partial<Preferences> | null | undefined,
  competition: string,
): string | null {
  return (preferences?.leagues ?? []).find((item) => leagueMatches(item, competition)) ?? null;
}

/**
 * Seguir o dejar de seguir un equipo o una competición. Devuelve el borrador
 * nuevo, o null si la lista ya está llena (el servidor recortaría).
 */
export function toggleFollow(
  preferences: Partial<Preferences> | null | undefined,
  kind: 'teams' | 'leagues',
  value: string,
): PreferenceDraft | null {
  const draft = draftFrom(preferences);
  const existing =
    kind === 'teams' ? followedTeam(preferences, value) : followedLeague(preferences, value);
  if (existing) return { ...draft, [kind]: draft[kind].filter((item) => item !== existing) };
  if (draft[kind].length >= PREFERENCE_MAX[kind]) return null;
  return {
    ...draft,
    [kind]: [...draft[kind], collapse(value).slice(0, PREFERENCE_TEXT_MAX[kind])],
  };
}

/** Cuerpo del PUT (sustituye, como POST /api/preferences): siempre entero. */
export function preferencesBody(
  current: Partial<Preferences> | null | undefined,
  draft: PreferenceDraft,
): Preferences {
  return {
    onboardingComplete: true,
    country: current?.country || 'Spain',
    leagues: draft.leagues,
    teams: draft.teams,
    nationalities: draft.nationalities,
  };
}
