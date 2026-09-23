/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `football`, con los mismos nombres, entradas y salidas
   (comportamientos-tests.md §3.1-3.2). Las usan los tests portados y el
   contraste con la 0.6.59; el código nuevo usa el servicio.

   Fidelidad: estas funciones reproducen la 0.6.59, no la v2. Por eso
   `fetchFutbolEnLaTvSchedule` da ids posicionales y la EPG y TheSportsDB no
   traen `start`: los cambios de la v2 (ids estables, `start` en todas las
   fuentes, plazo global) están en el servicio y en docs/compat.md.

   Lo que en la 0.6.59 eran globales (`footballProgramming`, `scoresCache`,
   `preheatMatches`, `semanticEmbeddingCache`) es aquí una copia propia de la
   fachada. Lo que leía el entorno usa los valores por defecto (sin Ollama:
   la IA solo se activa con `semantic.enabled`, como en los tests antiguos).
   Lo que necesita la agenda o el buscador real recibe el servicio o lanza
   `not_implemented`; la fachada no tiene comprobador (`scanner_offline`). */

import { FETCH_MAX_BYTES, type FootballSchedule } from '@ace/shared';
import { DEFAULTS } from '../../config/index.js';
import { createSystemClock } from '../../core/clock.js';
import { AppError, notImplemented } from '../../core/errors.js';
import { fetchText as legacyNetFetchText } from '../net/legacy-exports.js';
import { applyLearnedSourceRules } from '../sources/legacy-exports.js';
import {
  buildFootballDemoSchedule as buildDemo,
  enrichFootballLeagues as enrichLeagues,
  fetchEpgFootballSchedule as fetchEpg,
  fetchFutbolEnLaTvSchedule as fetchFltv,
  lookupFootballLeague,
  normalizeEpgAirings as normalizeEpg,
  normalizeFootballRows as normalizeRows,
  type AgendaContext,
  type EpgAiring,
  type TextFetcher,
} from './agenda-sources.js';
import {
  applySemanticCandidateScores as applySemantic,
  asVectorStore,
  semanticWarmEmbeddings as warmEmbeddings,
  unavailableEmbedder,
  type EmbedFunction,
  type SemanticCandidate,
  type VectorStore,
  type WarmResult,
} from './ai.js';
import { AGENDA_FETCH_MS, LEGACY_FOOTBALL_DAYS } from './constants.js';
import {
  footballPreheatStage as preheatStage,
  preheatFootballMatch as preheatMatch,
  runPreheatRound,
  type PreheatContext,
  type PreheatRecord,
  type PreheatStage,
} from './preheat.js';
import { ProgrammingCatalog, type ProgramEntry } from './programming.js';
import {
  resolveFootballChannel as resolveCore,
  type BaseCandidate,
  type ResolutionCore,
  type ResolutionState,
  type ResolvableItem,
} from './resolution.js';
import { pruneScoresCache as pruneScores, type LegacyScores, type ScoresCache } from './scores.js';
import { isoDateInMadrid } from './time.js';
import type { FootballService } from './types.js';

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

/* El orden final de candidatos es de sources (una sola implementación). */
export {
  canalEsGenerico,
  mergeResolutionCandidates,
  repartirEntreProveedores,
  resolutionTier,
} from '../sources/index.js';

export { cosineSimilarity, semanticScore } from './ai.js';
export { decodeHtml, epgSplitTeams, parseFutbolEnLaTv } from './agenda-sources.js';
export { footballProgramChannelNames } from './programming.js';
export { aceSearchQueries, resolutionChannels, scoreResolutionCandidate } from './resolution.js';
export {
  bestTeamSimilarity,
  canonicalTeam,
  espnLeaguesFor,
  matchIsInScoreWindow,
  readEspnEvent,
  teamSimilarity,
} from './scores.js';
export { madridDateTime } from './time.js';

// --- Estado propio de la fachada (los globales de server.js:158-173, 2143) ---

const legacyClock = createSystemClock();
const legacyProgramming = new ProgrammingCatalog();
const legacyScores: ScoresCache = new Map();
const legacyPreheats = new Map<string, PreheatRecord>();
const legacyVectors = new Map<string, unknown>();
let legacyPreheatBusy = false;

/** `fetchText` de la fachada de net (filtro anti-SSRF siempre puesto). */
const legacyFetchText: TextFetcher = async (url, options = {}) =>
  String(
    await legacyNetFetchText(
      url,
      0,
      new Set(),
      legacyClock.now() + (options.totalTimeoutMs ?? AGENDA_FETCH_MS),
      options.maxBytes ?? FETCH_MAX_BYTES,
    ),
  );

function legacyAgendaContext(): AgendaContext {
  return {
    now: legacyClock.now(),
    generatedAt: () => legacyClock.date().toISOString(),
    days: LEGACY_FOOTBALL_DAYS,
    country: DEFAULTS.footballCountry,
    apiKey: DEFAULTS.footballApiKey,
    flavor: 'legacy',
  };
}

type LegacySchedule = FootballSchedule & { success: true };

function withSuccess(schedule: FootballSchedule): LegacySchedule {
  return { success: true, ...schedule };
}

// --- IA ---

interface LegacyEmbeddingOptions {
  readonly cache?: VectorStore | Map<string, unknown>;
  readonly embed?: EmbedFunction;
  readonly batchSize?: number;
  readonly enabled?: boolean;
}

/** `semanticWarmEmbeddings` (server.js:725). T-100. */
export function semanticWarmEmbeddings(
  values: unknown,
  options: LegacyEmbeddingOptions = {},
): Promise<WarmResult> {
  return warmEmbeddings(values, {
    cache: asVectorStore(options.cache ?? legacyVectors),
    embed: options.embed ?? unavailableEmbedder,
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
  });
}

/** `applySemanticCandidateScores` (server.js:778). T-019, T-081, T-082, T-086. */
export function applySemanticCandidateScores<T extends SemanticCandidate>(
  requested: string[],
  candidates: T[],
  programChannels: unknown,
  options: LegacyEmbeddingOptions = {},
) {
  return applySemantic(requested, candidates, programChannels, {
    enabled: options.enabled ?? false,
    cache: asVectorStore(options.cache ?? legacyVectors),
    embed: options.embed ?? unavailableEmbedder,
  });
}

// --- Agenda ---

/** `normalizeFootballRows` (server.js:1872): filas de TheSportsDB. T-006. */
export function normalizeFootballRows(rows: unknown) {
  return normalizeRows(rows, { country: DEFAULTS.footballCountry });
}

/** `normalizeEpgAirings` (server.js:2430): sin `start`, como la 0.6.59. T-014, T-015. */
export function normalizeEpgAirings(airings: readonly EpgAiring[]) {
  return normalizeEpg(airings);
}

/** `fetchFutbolEnLaTvSchedule` (server.js:2052): sale a internet. */
export async function fetchFutbolEnLaTvSchedule(): Promise<LegacySchedule> {
  return withSuccess(await fetchFltv(legacyFetchText, legacyAgendaContext()));
}

/** `fetchEpgFootballSchedule` (server.js:2467): sale a internet. */
export async function fetchEpgFootballSchedule(): Promise<LegacySchedule> {
  return withSuccess(await fetchEpg(legacyFetchText, legacyAgendaContext()));
}

/** `enrichFootballLeagues` (server.js:1970). T-023. */
export function enrichFootballLeagues<T extends { id: string; competition: string }>(
  matches: T[],
  lookup: (idEvent: string) => Promise<string> = (idEvent) =>
    lookupFootballLeague(legacyFetchText, DEFAULTS.footballApiKey, idEvent),
): Promise<T[]> {
  return enrichLeagues(matches, lookup);
}

/** `buildFootballDemoSchedule` (server.js:1917). T-020, T-024. */
export function buildFootballDemoSchedule(
  startDate: string = isoDateInMadrid(legacyClock.now()),
): LegacySchedule {
  return withSuccess(
    buildDemo(startDate, {
      generatedAt: () => legacyClock.date().toISOString(),
      days: LEGACY_FOOTBALL_DAYS,
    }),
  );
}

/**
 * `getFootballSchedule` (server.js:2723). En la 0.6.59 leía la caché global;
 * aquí se le pasa el servicio (sin él, `not_implemented`). T-024.
 */
export async function getFootballSchedule(
  service?: Pick<FootballService, 'schedule'>,
): Promise<LegacySchedule> {
  if (!service) throw notImplemented('getFootballSchedule sin el servicio de fútbol');
  return withSuccess(await service.schedule());
}

/** `rememberFootballProgramming` (server.js:2682), sobre el catálogo de la fachada. T-020. */
export function rememberFootballProgramming(schedule: unknown): void {
  legacyProgramming.remember(schedule);
}

/** `footballProgramMatch` (server.js:2719), del catálogo de la fachada. T-020. */
export function footballProgramMatch(id: unknown): ProgramEntry | null {
  return legacyProgramming.match(id);
}

// --- Marcadores ---

/** `getLiveScores` (server.js:2276): necesita el servicio (agenda y ESPN). */
export async function getLiveScores(
  service?: Pick<FootballService, 'legacyScores'>,
): Promise<LegacyScores> {
  if (!service) throw notImplemented('getLiveScores sin el servicio de fútbol');
  return (await service.legacyScores()) as LegacyScores;
}

/** `pruneScoresCache` (server.js:3355) sobre la caché de la fachada. T-114. */
export function pruneScoresCache(now: number = legacyClock.now()): void {
  pruneScores(legacyScores, now);
}

/**
 * `scoresCache` (server.js:2143). En la 0.6.59 es un `Map` global; en la v2
 * no hay globales, así que es una función que devuelve la caché de la
 * fachada (la del servicio es `FootballServiceImpl.scoresCacheMap()`). T-114.
 */
export function scoresCache(): ScoresCache {
  return legacyScores;
}

// --- Resolución ---

type LegacySearch = (query: string) => Promise<readonly ResolvableItem[]>;

/* Sin motor en la fachada: la búsqueda falla como contra el host por
   defecto en los tests de la 0.6.59 (comportamientos-tests §1.4). */
const engineUnavailable: LegacySearch = async () => {
  throw new AppError('engine_unavailable');
};

interface LegacyResolveOptions {
  readonly mode?: 'research' | 'default';
  readonly program?: Readonly<Record<string, unknown>> | null;
  readonly programChannels?: readonly unknown[];
  readonly semantic?: LegacyEmbeddingOptions;
}

/**
 * `resolveFootballChannel` (server.js:4227): lanza `channel_required`.
 * T-009 a T-012, T-021, T-022, T-026, T-028, T-029, T-067, T-099, T-114.
 */
export async function resolveFootballChannel(
  state: unknown,
  channels: unknown,
  search: LegacySearch = engineUnavailable,
  options: LegacyResolveOptions = {},
): Promise<ResolutionCore & { success: true }> {
  const current = (state && typeof state === 'object' ? state : {}) as ResolutionState;
  const semantic = options.semantic ?? {};
  const result = await resolveCore(
    current,
    channels,
    {
      search,
      applyLearned: (requested, candidates: readonly BaseCandidate[]) =>
        applyLearnedSourceRules(
          current as Parameters<typeof applyLearnedSourceRules>[0],
          requested,
          candidates,
        ),
      refreshLists: () => {},
      semantic: {
        enabled: semantic.enabled ?? false,
        embed: semantic.embed ?? unavailableEmbedder,
        cache: asVectorStore(semantic.cache ?? legacyVectors),
      },
      model: DEFAULTS.ollamaEmbedModel,
      programChannels: legacyProgramming.channels,
    },
    {
      mode: options.mode ?? 'default',
      program: options.program ?? null,
      ...(options.programChannels ? { programChannels: options.programChannels } : {}),
    },
  );
  return { success: true, ...result };
}

// --- Precalentado ---

/** `footballPreheatStage` (server.js:4337). T-078. */
export function footballPreheatStage(
  start: unknown,
  now: number = legacyClock.now(),
): PreheatStage | null {
  return preheatStage(start, now);
}

interface LegacyPreheatOptions {
  readonly now?: number;
  readonly state?: unknown;
  readonly search?: LegacySearch;
  readonly payload?: unknown;
  readonly resolve?: (
    state: unknown,
    channels: string[],
    search: LegacySearch,
    options: { readonly program: Readonly<Record<string, unknown>> },
  ) => Promise<ResolutionCore>;
}

function legacyPreheatContext(options: LegacyPreheatOptions): PreheatContext {
  const search = options.search ?? engineUnavailable;
  const resolve = options.resolve ?? resolveFootballChannel;
  return {
    records: legacyPreheats,
    now: () => legacyClock.now(),
    state: () => (options.state ?? {}) as ResolutionState,
    refreshLists: () => {},
    resolve: (state, channels, resolveOptions) => resolve(state, channels, search, resolveOptions),
    enqueue: () => null,
  };
}

/** `preheatFootballMatch` (server.js:4372): sin comprobador en la fachada, `scanner_offline`. */
export function preheatFootballMatch(
  match: unknown,
  stage: PreheatStage,
  options: LegacyPreheatOptions = {},
): Promise<PreheatRecord | null> {
  return preheatMatch(
    legacyPreheatContext(options),
    match,
    stage,
    Number(options.now) || legacyClock.now(),
  );
}

/** `runFootballPreheat` (server.js:4431): con `payload` (la fachada no tiene agenda propia). */
export async function runFootballPreheat(options: LegacyPreheatOptions = {}): Promise<void> {
  if (options.payload === undefined) throw notImplemented('runFootballPreheat sin agenda');
  if (legacyPreheatBusy) return;
  legacyPreheatBusy = true;
  try {
    await runPreheatRound(
      legacyPreheatContext(options),
      options.payload,
      Number(options.now) || legacyClock.now(),
    );
  } finally {
    legacyPreheatBusy = false;
  }
}
