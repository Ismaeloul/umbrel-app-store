/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `football`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';
import type {
  FootballMatch,
  FootballSchedule,
  LiveScore,
  PreheatPublic,
  Resolution,
  ResolutionCandidate,
  StateV1,
} from '@ace/shared';

/* El emparejado de nombres ya está portado en @ace/shared (T-017, T-045 a
   T-049, T-059 a T-062, T-088): aquí se reexporta el de verdad. */
export {
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  channelMatchScore,
  esFamiliaDe,
  normalizeChannelKey,
  semanticChannelText,
  semanticNumbersCompatible,
} from '@ace/shared';

/** `cosineSimilarity` (server.js:641). */
export function cosineSimilarity(_left: number[], _right: number[]): number {
  throw notImplemented('cosineSimilarity');
}

/** `semanticWarmEmbeddings` (server.js:725). T-100. */
export async function semanticWarmEmbeddings(
  _values: string[],
  _options?: Record<string, unknown>,
): Promise<{ total: number; requested: number; failed: number; error: string | null }> {
  throw notImplemented('semanticWarmEmbeddings');
}

/** `applySemanticCandidateScores` (server.js:778). T-019, T-081, T-082, T-086. */
export async function applySemanticCandidateScores(
  _requested: string[],
  _candidates: ResolutionCandidate[],
  _programChannels: string[],
  _options?: Record<string, unknown>,
): Promise<{
  candidates: ResolutionCandidate[];
  used: boolean;
  error: string | null;
  catalogSize: number;
}> {
  throw notImplemented('applySemanticCandidateScores');
}

/** `semanticScore` (server.js:767). T-084. */
export function semanticScore(_similarity: number): number {
  throw notImplemented('semanticScore');
}

/** `normalizeFootballRows` (server.js:1872): filas de TheSportsDB. T-006. */
export function normalizeFootballRows(_rows: unknown[]): FootballMatch[] {
  throw notImplemented('normalizeFootballRows');
}

/** `normalizeEpgAirings` (server.js:2430). T-014, T-015. */
export function normalizeEpgAirings(_airings: unknown[]): FootballMatch[] {
  throw notImplemented('normalizeEpgAirings');
}

/** `parseFutbolEnLaTv` (server.js:2016). T-007, T-008. */
export function parseFutbolEnLaTv(_html: string, _window: Set<string> | null): unknown[] {
  throw notImplemented('parseFutbolEnLaTv');
}

/** `espnLeaguesFor` (server.js:2145). T-039. */
export function espnLeaguesFor(_competition: string): string[] | null {
  throw notImplemented('espnLeaguesFor');
}

/** `teamSimilarity` (server.js:2185). T-040, T-041. */
export function teamSimilarity(_a: string, _b: string): number {
  throw notImplemented('teamSimilarity');
}

/** `bestTeamSimilarity` (server.js:2201). */
export function bestTeamSimilarity(_mine: string, _side: unknown): number {
  throw notImplemented('bestTeamSimilarity');
}

/** `canonicalTeam` (server.js:2177). */
export function canonicalTeam(_value: string): string {
  throw notImplemented('canonicalTeam');
}

/** `readEspnEvent` (server.js:2242). T-043, T-044. */
export function readEspnEvent(
  _event: unknown,
): { homeScore: number; awayScore: number; state: string; clock: string; start: number } | null {
  throw notImplemented('readEspnEvent');
}

/** `matchIsInScoreWindow` (server.js:2267). T-042. */
export function matchIsInScoreWindow(_match: { start?: number }, _now: number): boolean {
  throw notImplemented('matchIsInScoreWindow');
}

/** `getLiveScores` (server.js:2276). */
export async function getLiveScores(): Promise<{
  success: boolean;
  scores: Record<string, LiveScore>;
}> {
  throw notImplemented('getLiveScores');
}

/** `fetchFutbolEnLaTvSchedule` (server.js:2052). */
export async function fetchFutbolEnLaTvSchedule(): Promise<FootballSchedule> {
  throw notImplemented('fetchFutbolEnLaTvSchedule');
}

/** `decodeHtml` (server.js:2001). */
export function decodeHtml(_value: string): string {
  throw notImplemented('decodeHtml');
}

/** `epgSplitTeams` (server.js:2384). T-013. */
export function epgSplitTeams(_title: string): { home: string; away: string } | null {
  throw notImplemented('epgSplitTeams');
}

/** `fetchEpgFootballSchedule` (server.js:2467). */
export async function fetchEpgFootballSchedule(): Promise<FootballSchedule> {
  throw notImplemented('fetchEpgFootballSchedule');
}

/** `madridDateTime` (server.js:1841): hora UTC de TheSportsDB a Madrid. T-016. */
export function madridDateTime(
  _dateEvent: string,
  _strTime: string,
): { date: string; time: string } | null {
  throw notImplemented('madridDateTime');
}

/** `enrichFootballLeagues` (server.js:1970). T-023. */
export async function enrichFootballLeagues(
  _matches: FootballMatch[],
  _lookup?: (idEvent: string) => Promise<string>,
): Promise<void> {
  throw notImplemented('enrichFootballLeagues');
}

/** `buildFootballDemoSchedule` (server.js:1917). T-020, T-024. */
export function buildFootballDemoSchedule(_start?: string): FootballSchedule {
  throw notImplemented('buildFootballDemoSchedule');
}

/** `getFootballSchedule` (server.js:2723). T-024. */
export async function getFootballSchedule(): Promise<FootballSchedule> {
  throw notImplemented('getFootballSchedule');
}

/** `footballProgramChannelNames` (server.js:2564). T-020. */
export function footballProgramChannelNames(_schedule: FootballSchedule): string[] {
  throw notImplemented('footballProgramChannelNames');
}

/** `rememberFootballProgramming` (server.js:2682). T-020. */
export function rememberFootballProgramming(_schedule: FootballSchedule): void {
  throw notImplemented('rememberFootballProgramming');
}

/** `footballProgramMatch` (server.js:2719). T-020. */
export function footballProgramMatch(_id: string): Record<string, unknown> | null {
  throw notImplemented('footballProgramMatch');
}

/** `footballPreheatStage` (server.js:4337). T-078. */
export function footballPreheatStage(
  _start: number,
  _now?: number,
): 'discovery' | 'scan' | 'kickoff' | 'live' | null {
  throw notImplemented('footballPreheatStage');
}

/** `preheatFootballMatch` (server.js:4372). */
export async function preheatFootballMatch(
  _match: FootballMatch,
  _stage: string,
  _options?: Record<string, unknown>,
): Promise<PreheatPublic | null> {
  throw notImplemented('preheatFootballMatch');
}

/** `runFootballPreheat` (server.js:4431). */
export async function runFootballPreheat(_options?: Record<string, unknown>): Promise<void> {
  throw notImplemented('runFootballPreheat');
}

/** `repartirEntreProveedores` (server.js:3786). T-064. */
export function repartirEntreProveedores(
  _candidates: ResolutionCandidate[],
): ResolutionCandidate[] {
  throw notImplemented('repartirEntreProveedores');
}

/** `scoreResolutionCandidate` (server.js:3687). T-056 a T-058. */
export function scoreResolutionCandidate(
  _channels: string[],
  _item: Record<string, unknown>,
  _source: string,
): ResolutionCandidate {
  throw notImplemented('scoreResolutionCandidate');
}

/** `mergeResolutionCandidates` (server.js:4004). T-050 a T-058, T-065, T-066, T-068 a T-071, T-085, T-086, T-092, T-093, T-096, T-097. */
export function mergeResolutionCandidates(
  _candidates: ResolutionCandidate[],
  _options?: Record<string, unknown>,
): ResolutionCandidate[] {
  throw notImplemented('mergeResolutionCandidates');
}

/** `canalEsGenerico` (server.js:3989). T-095, T-098. */
export function canalEsGenerico(_canal: string, _pedidos: string[]): boolean {
  throw notImplemented('canalEsGenerico');
}

/** `resolutionTier` (server.js:3762). */
export function resolutionTier(_candidate: ResolutionCandidate): number {
  throw notImplemented('resolutionTier');
}

/** `aceSearchQueries` (server.js:4159). T-021. */
export function aceSearchQueries(_channels: string[], _semanticEnabled?: boolean): string[] {
  throw notImplemented('aceSearchQueries');
}

/** `resolveFootballChannel` (server.js:4227): lanza `channel_required`. T-009 a T-012, T-021, T-022, T-026, T-028, T-029, T-067, T-099, T-114. */
export async function resolveFootballChannel(
  _state: StateV1,
  _channels: string[],
  _search?: (query: string) => Promise<unknown[]>,
  _options?: Record<string, unknown>,
): Promise<Resolution & { success: true }> {
  throw notImplemented('resolveFootballChannel');
}

/** `resolutionChannels` (server.js:3667): hasta 8. T-113. */
export function resolutionChannels(_values: unknown[]): string[] {
  throw notImplemented('resolutionChannels');
}

/** `pruneScoresCache` (server.js:3355). T-114. */
export function pruneScoresCache(_now?: number): void {
  throw notImplemented('pruneScoresCache');
}

/**
 * `scoresCache` (server.js:2143). En la 0.6.59 es un `Map` global; en la v2
 * no hay globales, así que es una función que devuelve la caché del servicio
 * (T-114 la usará así).
 */
export function scoresCache(): Map<
  string,
  { payload: unknown; expiresAt: number; pending: unknown }
> {
  throw notImplemented('scoresCache');
}
