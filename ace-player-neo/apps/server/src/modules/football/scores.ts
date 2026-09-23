/* Marcadores en vivo con la API pública de ESPN (server.js:2088-2337,
   3355-3360; backend-modulos §3.9; B-128, B-130, B-131).

   La unión agenda-ESPN se hace por hora de saque (±45 min) MÁS parecido de
   nombres: solo con el nombre no basta ("O. Lyonnais" allí es "Lyon") y solo
   con la hora tampoco (a las 21:00 juegan diez a la vez). */

import type { LiveScore } from '@ace/shared';
import {
  ESPN_BASE,
  SCORES_CACHE_MS,
  SCORES_CACHE_STALE_MS,
  SCORES_FETCH_MS,
  SCORES_MAX_BYTES,
  SCORES_MAX_LEAGUES,
  SCORES_WINDOW_AFTER_MS,
  SCORES_WINDOW_BEFORE_MS,
  SCORE_MAX_START_DRIFT_MS,
  SCORE_MIN_ANCHOR,
  SCORE_MIN_SIMILARITY,
} from './constants.js';
import { footballScheduleMatches, type TextFetcher } from './agenda-sources.js';

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose {
  return value && typeof value === 'object' ? (value as Loose) : {};
}

function flat(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/* Competición tal como la rotula futbolenlatv → código de liga en ESPN
   (server.js:2111-2141). Todos comprobados uno por uno contra el endpoint. */
const ESPN_LEAGUES: Readonly<Record<string, readonly string[]>> = {
  'la liga ea sports': ['esp.1'],
  laliga: ['esp.1'],
  'laliga hypermotion': ['esp.2'],
  'copa del rey': ['esp.copa_del_rey'],
  'premier league': ['eng.1'],
  championship: ['eng.2'],
  'national league': ['eng.5'],
  'serie a italiana': ['ita.1'],
  'serie b italiana': ['ita.2'],
  bundesliga: ['ger.1'],
  '2. liga': ['ger.2'],
  'copa de alemania': ['ger.dfb_pokal'],
  'francia ligue 1': ['fra.1'],
  'ligue 1': ['fra.1'],
  eredivisie: ['ned.1'],
  'primeira liga': ['por.1'],
  mls: ['usa.1'],
  'primera division argentina': ['arg.1'],
  'serie a brasil': ['bra.1'],
  'liga pro ecuador': ['ecu.1'],
  'liga 1 peru': ['per.1'],
  'champions league': ['uefa.champions', 'uefa.champions_qual'],
  'europa league': ['uefa.europa', 'uefa.europa_qual'],
  'conference league': ['uefa.europa.conf'],
  'liga mx': ['mex.1'],
  'primera a colombia': ['col.1'],
  'primera division uruguay': ['uru.1'],
  'premiership escocesa': ['sco.1'],
  'superliga turca': ['tur.1'],
};

/** `espnLeaguesFor` (server.js:2145-2149): ligas de ESPN de una competición, o null. T-039. */
export function espnLeaguesFor(competition: unknown): string[] | null {
  const key = flat(competition).replace(/\s+/g, ' ').trim();
  const leagues = Object.hasOwn(ESPN_LEAGUES, key) ? ESPN_LEAGUES[key] : undefined;
  return leagues ? [...leagues] : null;
}

/* Palabras de un equipo sin tildes ni coletillas de club (server.js:2153-2158). */
function teamTokens(value: unknown): Set<string> {
  const words = flat(value)
    .replace(/\b(fc|cf|sc|ac|cd|ud|sd|afc|if|fk|sk|club|de|del|la|el|los|las)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return new Set(words.split(' ').filter((word) => word.length > 2));
}

/* Clubes que cada web escribe de forma irreconciliable (server.js:2164-2175). */
const TEAM_ALIASES: Readonly<Record<string, string>> = {
  lyonnais: 'lyon',
  olympiquelyonnais: 'lyon',
  interdemilan: 'internazionale',
  inter: 'internazionale',
  bayernmunich: 'bayern',
  munich: 'bayern',
  dortmund: 'dortmund',
  borussiadortmund: 'dortmund',
  parissaintgermain: 'psg',
  oporto: 'porto',
  napoles: 'napoli',
  milan: 'milan',
  sportingdeportugal: 'sportingcp',
  sportinglisboa: 'sportingcp',
  estrellaroja: 'redstar',
  copenhague: 'copenhagen',
  brujas: 'brugge',
  salzburgo: 'salzburg',
  marsella: 'marseille',
  colonia: 'koln',
  moenchengladbach: 'monchengladbach',
};

/** `canonicalTeam` (server.js:2177-2183): alias reconocido de un equipo, o null. */
export function canonicalTeam(value: unknown): string | null {
  // futbolenlatv abrevia el primer nombre: "O. Lyonnais", "B. Dortmund"
  const key = flat(value)
    .replace(/^[a-z][.][ ]*/, '')
    .replace(/[^a-z0-9]+/g, '');
  return (Object.hasOwn(TEAM_ALIASES, key) ? TEAM_ALIASES[key] : undefined) || null;
}

/** `teamSimilarity` (server.js:2185-2197): 0..1 de que dos rótulos sean el mismo equipo. T-040, T-041. */
export function teamSimilarity(a: unknown, b: unknown): number {
  const ca = canonicalTeam(a);
  const cb = canonicalTeam(b);
  if (ca && cb && ca === cb) return 1;
  if (ca && teamTokens(b).has(ca)) return 1;
  if (cb && teamTokens(a).has(cb)) return 1;

  const left = teamTokens(a);
  const right = teamTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** `bestTeamSimilarity` (server.js:2201-2207): el mejor de los tres rótulos de ESPN. */
export function bestTeamSimilarity(mine: unknown, side: unknown): number {
  const team = asRecord(side);
  return Math.max(
    teamSimilarity(mine, team.displayName),
    teamSimilarity(mine, team.shortDisplayName),
    teamSimilarity(mine, team.name),
  );
}

/* ESPN indexa por SU fecha: se pide de ayer a mañana (server.js:2212-2216). */
export function espnDateRange(now: number): string {
  const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const day = 24 * 60 * 60 * 1000;
  return `${stamp(now - day)}-${stamp(now + day)}`;
}

/** Evento de ESPN ya leído (`readEspnEvent`). */
export interface EspnEvent {
  start: number;
  homeTeam: Loose;
  awayTeam: Loose;
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  state: string;
  clock: string;
  detail: string;
}

/** `readEspnEvent` (server.js:2242-2263): null si falta alguno de los dos equipos. T-043, T-044. */
export function readEspnEvent(event: unknown): EspnEvent | null {
  const value = asRecord(event);
  const competitions = Array.isArray(value.competitions) ? value.competitions : [];
  const competition = asRecord(competitions[0]);
  const competitors = (Array.isArray(competition.competitors) ? competition.competitors : []).map(
    asRecord,
  );
  const home = competitors.find((side) => side.homeAway === 'home');
  const away = competitors.find((side) => side.homeAway === 'away');
  if (!home || !away) return null;
  const status = asRecord(value.status);
  const type = asRecord(status.type);
  const homeTeam = asRecord(home.team);
  const awayTeam = asRecord(away.team);
  return {
    start: Date.parse(String(value.date)),
    homeTeam,
    awayTeam,
    homeName: String(homeTeam.displayName || ''),
    awayName: String(awayTeam.displayName || ''),
    homeScore: Number.parseInt(String(home.score), 10),
    awayScore: Number.parseInt(String(away.score), 10),
    state: String(type.state || ''),
    clock: String(status.displayClock || ''),
    detail: String(type.shortDetail || ''),
  };
}

/** `matchIsInScoreWindow` (server.js:2267-2270): de 15 min antes a 3 h 30 min después del saque. T-042. */
export function matchIsInScoreWindow(match: unknown, now: number): boolean {
  const start = asRecord(match).start;
  if (typeof start !== 'number' || !Number.isFinite(start)) return false;
  return now >= start - SCORES_WINDOW_BEFORE_MS && now <= start + SCORES_WINDOW_AFTER_MS;
}

// --- Caché por liga (server.js:2143, 2218-2240, 3355-3360) ---

export interface ScoresCacheEntry {
  payload: unknown[] | null;
  expiresAt: number;
  pending: Promise<unknown[]> | null;
}

/** `liga@rango` → última respuesta. */
export type ScoresCache = Map<string, ScoresCacheEntry>;

/** `pruneScoresCache` (server.js:3355-3360): borra lo caducado hace más de 24 h (no lo que está en vuelo). T-114. */
export function pruneScoresCache(cache: ScoresCache, now: number): void {
  for (const [key, entry] of cache) {
    if (entry.pending) continue;
    if (now - (Number(entry.expiresAt) || 0) > SCORES_CACHE_STALE_MS) cache.delete(key);
  }
}

export interface ScoresContext {
  readonly cache: ScoresCache;
  readonly fetchText: TextFetcher;
  readonly now: () => number;
}

/**
 * `fetchEspnLeague` (server.js:2218-2240): 8 s de caché por `liga@rango`, una
 * sola descarga a la vez y, si falla, la última respuesta (una liga caída no
 * tumba el resto del marcador).
 */
export function fetchEspnLeague(
  ctx: ScoresContext,
  league: string,
  range: string,
): Promise<unknown[]> {
  const key = `${league}@${range}`;
  const entry = ctx.cache.get(key);
  if (entry && entry.payload && ctx.now() < entry.expiresAt) return Promise.resolve(entry.payload);
  if (entry && entry.pending) return entry.pending;

  const pending = ctx
    .fetchText(`${ESPN_BASE}/${league}/scoreboard?dates=${range}`, {
      totalTimeoutMs: SCORES_FETCH_MS,
      maxBytes: SCORES_MAX_BYTES,
    })
    .then((body) => {
      const events = asRecord(JSON.parse(body) as unknown).events;
      const payload = Array.isArray(events) ? (events as unknown[]) : [];
      ctx.cache.set(key, { payload, expiresAt: ctx.now() + SCORES_CACHE_MS, pending: null });
      return payload;
    })
    .catch(() => {
      const previous = ctx.cache.get(key);
      const kept = previous?.payload || [];
      ctx.cache.set(key, { payload: kept, expiresAt: ctx.now() + SCORES_CACHE_MS, pending: null });
      return kept;
    });

  ctx.cache.set(key, { ...(entry || { payload: null, expiresAt: 0 }), pending });
  return pending;
}

/** Respuesta de `/api/scores` (api.md §4.13): sus tres formas. */
export type LegacyScores =
  | {
      success: true;
      generatedAt: string;
      source: 'espn';
      attribution: 'ESPN';
      leagues: number;
      scores: Record<string, LiveScore>;
    }
  | {
      success: true;
      generatedAt: string;
      source: 'espn';
      leagues: 0;
      scores: Record<string, never>;
    }
  | { success: false; error: 'sin_agenda'; scores: Record<string, never> };

/**
 * `getLiveScores` (server.js:2276-2337) sobre una agenda ya obtenida (null =
 * sin agenda). Solo partidos en su ventana y con liga conocida; como mucho 8
 * ligas; empareja por saque (±45 min) y nombres (media ≥ 0,5 y uno ≥ 0,6).
 */
export async function computeLiveScores(
  ctx: ScoresContext & { readonly nowIso: () => string },
  schedule: unknown,
): Promise<LegacyScores> {
  if (schedule === null) return { success: false, error: 'sin_agenda', scores: {} };
  const now = ctx.now();
  const candidates: { match: Loose; leagues: string[] }[] = [];
  for (const match of footballScheduleMatches(schedule)) {
    if (!matchIsInScoreWindow(match, now)) continue;
    const leagues = espnLeaguesFor(match.competition);
    if (!leagues) continue;
    candidates.push({ match, leagues });
  }
  if (!candidates.length) {
    return { success: true, generatedAt: ctx.nowIso(), source: 'espn', leagues: 0, scores: {} };
  }

  const wanted = [...new Set(candidates.flatMap((entry) => entry.leagues))].slice(
    0,
    SCORES_MAX_LEAGUES,
  );
  const range = espnDateRange(now);
  const fetched = await Promise.all(
    wanted.map((league) =>
      fetchEspnLeague(ctx, league, range).then((events) => [league, events] as const),
    ),
  );
  const byLeague = new Map<string, unknown[]>(fetched);

  const scores: Record<string, LiveScore> = {};
  for (const { match, leagues } of candidates) {
    let best: EspnEvent | null = null;
    let bestScore = 0;
    const start = Number(match.start);
    for (const league of leagues) {
      for (const event of byLeague.get(league) || []) {
        const parsed = readEspnEvent(event);
        if (!parsed) continue;
        // la hora de saque descarta de golpe a los que juegan otro día
        if (Math.abs(parsed.start - start) > SCORE_MAX_START_DRIFT_MS) continue;
        const local = bestTeamSimilarity(match.home, parsed.homeTeam);
        const visitante = bestTeamSimilarity(match.away, parsed.awayTeam);
        // dos parecidos flojos no valen: al menos uno tiene que ser claro
        if (Math.max(local, visitante) < SCORE_MIN_ANCHOR) continue;
        const similarity = (local + visitante) / 2;
        if (similarity > bestScore) {
          bestScore = similarity;
          best = parsed;
        }
      }
    }
    if (!best || bestScore < SCORE_MIN_SIMILARITY) continue;
    if (!Number.isFinite(best.homeScore) || !Number.isFinite(best.awayScore)) continue;
    scores[String(match.id)] = {
      home: best.homeScore,
      away: best.awayScore,
      state: best.state,
      clock: best.clock,
      detail: best.detail,
      confidence: Number(bestScore.toFixed(2)),
    };
  }

  return {
    success: true,
    generatedAt: ctx.nowIso(),
    source: 'espn',
    attribution: 'ESPN',
    leagues: wanted.length,
    scores,
  };
}
