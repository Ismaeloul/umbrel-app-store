/* Resolución contra TheSportsDB (informe de fase 2, §10.2): búsqueda o
   consulta por id, elección del candidato por parecido de nombres (el de los
   marcadores, `teamSimilarity`) con bonus por país y liga, y descarga del
   escudo (versión `/small`, 200 px; si no existe, la original) comprobando
   que es un PNG que sabemos leer. Sin estado: la cola, los reintentos y el
   índice son del servicio.

   Endpoints (API v1, clave `config.football.apiKey`):
   - `searchteams.php?t=<nombre>` → `{ teams: [...] | null }`
   - `lookupteam.php?id=<idTeam>` → `{ teams: [...] }`
   - `search_all_leagues.php?s=Soccer&c=<país>` → `{ countries: [...] }` (sic)
   - `lookupleague.php?id=<idLeague>` → `{ leagues: [...] }` */

import { normalizePreferenceKey } from '@ace/shared';
import { errorCodeOf } from '../../core/errors.js';
import { THESPORTSDB_BASE, teamSimilarity } from '../football/index.js';
import type { FetchOptions, NetClient } from '../net/types.js';
import {
  TEAMS_COUNTRY_BONUS,
  TEAMS_FETCH_TIMEOUT_MS,
  TEAMS_IMAGE_MAX_BYTES,
  TEAMS_IMAGE_MAX_DIMENSION,
  TEAMS_IMAGE_SIZE_SUFFIX,
  TEAMS_LEAGUE_BONUS,
  TEAMS_MIN_MARGIN,
  TEAMS_MIN_SCORE,
  TEAMS_SEARCH_MAX_BYTES,
} from './constants.js';
import { countryMatches, isReserveName, type TeamOverride } from './normalize.js';
import { PngError, checkPngHeader, readPngHeader } from './png.js';

type Loose = Record<string, unknown>;

/** Fila de `searchteams.php`/`lookupteam.php` con lo que usamos (nombres de campo de la API). */
export interface ApiTeam {
  readonly idTeam: string;
  readonly strTeam: string;
  readonly strTeamShort: string | null;
  /** Otros nombres separados por comas ("Club Atlético de Madrid, Atlético de Madrid, Atléti"). */
  readonly strAlternate: string | null;
  readonly strLeague: string | null;
  readonly idLeague: string | null;
  readonly strCountry: string | null;
  readonly strSport: string | null;
  readonly strBadge: string | null;
  readonly strColour1: string | null;
  readonly strColour2: string | null;
}

/** Fila de `lookupleague.php`/`search_all_leagues.php`. */
export interface ApiLeague {
  readonly idLeague: string;
  readonly strLeague: string;
  readonly strSport: string | null;
  readonly strCountry: string | null;
  readonly strBadge: string | null;
  readonly strLogo: string | null;
}

function text(value: unknown): string | null {
  const clean = String(value ?? '').trim();
  return clean ? clean : null;
}

/* Los ids van a una URL nuestra (`SafeIdSchema`): una fila con un id raro se ignora. */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(value: unknown): string | null {
  const id = text(value);
  return id && SAFE_ID_RE.test(id) ? id : null;
}

/* La primera clave que traiga una lista (`teams`, `leagues`, `countries`); `null` = sin resultados. */
function rows(body: unknown, keys: readonly string[]): Loose[] {
  const record = body && typeof body === 'object' ? (body as Loose) : {};
  for (const key of keys) {
    const list = record[key];
    if (Array.isArray(list)) {
      return list.filter((row): row is Loose => !!row && typeof row === 'object');
    }
  }
  return [];
}

export function readApiTeams(body: unknown): ApiTeam[] {
  return rows(body, ['teams']).flatMap((row) => {
    const idTeam = safeId(row.idTeam);
    const strTeam = text(row.strTeam);
    if (!idTeam || !strTeam) return [];
    return [
      {
        idTeam,
        strTeam,
        strTeamShort: text(row.strTeamShort),
        strAlternate: text(row.strAlternate),
        strLeague: text(row.strLeague),
        idLeague: text(row.idLeague),
        strCountry: text(row.strCountry),
        strSport: text(row.strSport),
        strBadge: text(row.strBadge),
        strColour1: text(row.strColour1),
        strColour2: text(row.strColour2),
      },
    ];
  });
}

export function readApiLeagues(body: unknown): ApiLeague[] {
  return rows(body, ['leagues', 'countries']).flatMap((row) => {
    const idLeague = safeId(row.idLeague);
    const strLeague = text(row.strLeague);
    if (!idLeague || !strLeague) return [];
    return [
      {
        idLeague,
        strLeague,
        strSport: text(row.strSport),
        strCountry: text(row.strCountry),
        strBadge: text(row.strBadge),
        strLogo: text(row.strLogo),
      },
    ];
  });
}

export interface ResolverDeps {
  readonly net: NetClient;
  readonly apiKey: string;
  /** Se aborta en `stop()`. */
  readonly signal?: AbortSignal | undefined;
}

export function apiUrl(apiKey: string, endpoint: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${THESPORTSDB_BASE}/${apiKey}/${endpoint}?${query}`;
}

function jsonOptions(deps: ResolverDeps): FetchOptions {
  return {
    maxBytes: TEAMS_SEARCH_MAX_BYTES,
    totalTimeoutMs: TEAMS_FETCH_TIMEOUT_MS,
    ...(deps.signal ? { signal: deps.signal } : {}),
  };
}

async function getJson(deps: ResolverDeps, endpoint: string, params: Record<string, string>) {
  return (await deps.net.fetchJson(apiUrl(deps.apiKey, endpoint, params), jsonOptions(deps))).body;
}

export async function searchTeams(deps: ResolverDeps, query: string): Promise<ApiTeam[]> {
  return readApiTeams(await getJson(deps, 'searchteams.php', { t: query }));
}

export async function lookupTeam(deps: ResolverDeps, idTeam: string): Promise<ApiTeam[]> {
  return readApiTeams(await getJson(deps, 'lookupteam.php', { id: idTeam }));
}

export async function searchLeagues(deps: ResolverDeps, country: string): Promise<ApiLeague[]> {
  return readApiLeagues(await getJson(deps, 'search_all_leagues.php', { s: 'Soccer', c: country }));
}

export async function lookupLeague(deps: ResolverDeps, idLeague: string): Promise<ApiLeague[]> {
  return readApiLeagues(await getJson(deps, 'lookupleague.php', { id: idLeague }));
}

// --- Escudo ---

/** La imagen no es un PNG que sepamos leer (o no existe): `bad_image`, sin reintento inmediato. */
export class BadgeImageError extends Error {
  override readonly name = 'BadgeImageError';
  constructor(
    readonly reason: string,
    readonly url: string,
  ) {
    super('bad_image');
  }
}

/**
 * Descarga el escudo: primero `<url>/small` (200 px); si no existe (404) o
 * no es un PNG legible, la original. Los fallos de red y los 429/5xx salen
 * tal cual (los trata el servicio); un 404 de la original o un PNG malo es
 * `BadgeImageError`.
 */
export async function fetchBadge(deps: ResolverDeps, url: string): Promise<Buffer> {
  const options: FetchOptions = {
    maxBytes: TEAMS_IMAGE_MAX_BYTES,
    totalTimeoutMs: TEAMS_FETCH_TIMEOUT_MS,
    accept: 'image/png,image/*;q=0.8',
    ...(deps.signal ? { signal: deps.signal } : {}),
  };
  const attempt = async (target: string, fallback: boolean): Promise<Buffer | null> => {
    let body: Buffer;
    try {
      body = (await deps.net.fetchBuffer(target, options)).body;
    } catch (error) {
      if (errorCodeOf(error) !== 'http_404') throw error;
      if (fallback) return null;
      throw new BadgeImageError('missing', target);
    }
    try {
      checkPngHeader(readPngHeader(body), TEAMS_IMAGE_MAX_DIMENSION);
    } catch (error) {
      if (!(error instanceof PngError)) throw error;
      if (fallback) return null;
      throw new BadgeImageError(error.reason, target);
    }
    return body;
  };
  const small = await attempt(`${url}${TEAMS_IMAGE_SIZE_SUFFIX}`, true);
  return small ?? ((await attempt(url, false)) as Buffer);
}

// --- Elección del candidato ---

export interface TeamContext {
  /** Nombre tal y como sale en la agenda. */
  readonly name: string;
  /** Término con el que se buscó. */
  readonly query: string;
  /** País del partido según la agenda ("España" en futbolenlatv, siempre). */
  readonly country: string | null;
  readonly competition: string | null;
  readonly override?: TeamOverride | undefined;
}

export type TeamChoice =
  | { readonly kind: 'chosen'; readonly team: ApiTeam; readonly score: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly best: ApiTeam; readonly second: ApiTeam };

/* TheSportsDB antepone el gentilicio: "Spanish La Liga", "English Premier League". */
const COUNTRY_ADJECTIVES =
  /^(?:spanish|english|italian|german|french|portuguese|dutch|scottish|belgian|turkish|greek|mexican|argentinian|argentine|brazilian|american|us|ecuadorian|colombian|uruguayan|moroccan|saudi|swiss|austrian|danish|swedish|norwegian|russian|ukrainian|polish|czech|croatian|serbian)\s+/;

/** Clave compacta de una liga: "Spanish La Liga" → `laliga`, "LaLiga" → `laliga`. */
export function leagueKey(name: unknown): string {
  return normalizePreferenceKey(name).replace(COUNTRY_ADJECTIVES, '').replace(/\s+/g, '');
}

/** ¿La liga de la API es la competición de la agenda ("Spanish La Liga" ~ "LaLiga")? */
export function leagueMatches(apiLeague: unknown, competition: unknown): boolean {
  const a = leagueKey(apiLeague);
  const b = leagueKey(competition);
  if (!a || !b) return false;
  if (a.length < 4 || b.length < 4) return a === b;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Puntuación de un candidato: el mejor parecido entre el nombre de la agenda
 * (o el término buscado) y `strTeam`/`strAlternate`, más 0,15 si el país
 * cuadra (con override de país, -0,3 si no cuadra) y 0,1 si la liga es la
 * competición. Un filial y un primer equipo nunca casan. Puede pasar de 1:
 * los bonus deciden entre dos nombres iguales.
 */
export function scoreTeam(team: ApiTeam, ctx: TeamContext): number {
  if (team.strSport && team.strSport !== 'Soccer') return 0;
  if (isReserveName(ctx.name) !== isReserveName(team.strTeam)) return 0;
  const names = [team.strTeam, ...(team.strAlternate?.split(',') ?? [])]
    .map((name) => name.trim())
    .filter(Boolean);
  let score = 0;
  for (const candidate of names) {
    score = Math.max(
      score,
      teamSimilarity(ctx.name, candidate),
      teamSimilarity(ctx.query, candidate),
    );
  }
  if (score === 0) return 0;
  const wantedCountry = ctx.override?.country ?? null;
  if (wantedCountry) {
    score += countryMatches(team.strCountry, wantedCountry)
      ? TEAMS_COUNTRY_BONUS
      : -2 * TEAMS_COUNTRY_BONUS;
  } else if (ctx.country && countryMatches(team.strCountry, ctx.country)) {
    score += TEAMS_COUNTRY_BONUS;
  }
  if (ctx.competition && team.strLeague && leagueMatches(team.strLeague, ctx.competition)) {
    score += TEAMS_LEAGUE_BONUS;
  }
  return Math.max(0, score);
}

/** El mejor candidato con ≥ 0,6 y margen ≥ 0,2 sobre el segundo; si no, `ambiguous` o `none`. */
export function chooseTeam(candidates: readonly ApiTeam[], ctx: TeamContext): TeamChoice {
  const scored = candidates
    .map((team) => ({ team, score: scoreTeam(team, ctx) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < TEAMS_MIN_SCORE) return { kind: 'none' };
  const second = scored[1];
  if (
    second &&
    second.score >= TEAMS_MIN_SCORE &&
    best.score - second.score < TEAMS_MIN_MARGIN &&
    second.team.idTeam !== best.team.idTeam
  ) {
    return { kind: 'ambiguous', best: best.team, second: second.team };
  }
  return { kind: 'chosen', team: best.team, score: best.score };
}

/** La liga cuyo nombre compacto es el buscado; si no hay exacta, la más corta que lo contenga. */
export function chooseLeague(
  candidates: readonly ApiLeague[],
  ctx: { readonly name: string; readonly query: string },
): ApiLeague | null {
  const soccer = candidates.filter((league) => !league.strSport || league.strSport === 'Soccer');
  const wanted = [leagueKey(ctx.query), leagueKey(ctx.name)].filter((key) => key.length >= 3);
  if (!wanted.length) return null;
  const exact = soccer.find((league) => wanted.includes(leagueKey(league.strLeague)));
  if (exact) return exact;
  const loose = soccer
    .filter((league) => wanted.some((key) => leagueMatches(league.strLeague, key)))
    .sort((a, b) => a.strLeague.length - b.strLeague.length);
  return loose[0] ?? null;
}
