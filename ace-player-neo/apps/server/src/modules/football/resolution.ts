/* Resolución de un partido a fuentes (server.js:3655-3760, 4143-4335;
   backend-modulos §3.12; B-147 a B-181).

   Se consultan SIEMPRE todas las capas (vínculos guardados, listas M3U,
   favoritos, historial, buscador del motor y, si está, la IA), se aplica lo
   aprendido una sola vez, se filtra por umbral y se ordena. El orden final
   (`mergeResolutionCandidates`) es de `sources` y se importa de allí: una
   sola implementación, como el emparejado de nombres de @ace/shared (T-088).

   Todo lo de fuera llega inyectado (`ResolveDeps`): el servicio pasa el
   buscador con `via: 'auto'` (con reproducción activa va al comprobador,
   arquitectura §5.10), las reglas aprendidas del servicio de fuentes y el
   refresco de listas de `directories`; la fachada antigua, los suyos. */

import {
  LIBRARY_MIN_SCORE,
  RESOLUTION_EXACT_SCORE,
  channelAllowsFamilyFallback,
  channelMatchScore,
  cleanTitle,
  esFamiliaDe,
  normalizeChannelKey,
  type ResolutionCandidate,
  type SourceStats,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { mergeResolutionCandidates } from '../sources/index.js';
import { applySemanticCandidateScores, type SemanticOptions } from './ai.js';
import {
  MAX_RESOLUTION_CHANNELS,
  MAX_SEARCH_QUERIES,
  REMOTE_MIN_SCORE_WITHOUT_AI,
  SEARCH_QUERY_CHARS,
} from './constants.js';

/**
 * HDR, Bar o UHD son el MISMO canal en otra calidad o para otro local
 * (server.js:3982). Es el mismo conjunto que usa `canalEsGenerico` en
 * sources/ranking.ts; no está exportado desde sources/index.ts (pedido en
 * docs/cobertura/football.md, "Cambios de contrato pedidos").
 */
const CHANNEL_VARIANT_TOKENS: ReadonlySet<string> = new Set([
  'hdr',
  'bar',
  'uhd',
  '4k',
  'fhd',
  'hd',
]);

/** Candidato antes de aplicar lo aprendido (`scoreResolutionCandidate`, api.md §3.13). */
export type BaseCandidate = Omit<
  ResolutionCandidate,
  'learned' | 'reported' | 'rejectedByLearning' | 'quarantined'
>;

/** Lo que la resolución lee de un elemento de biblioteca o del buscador. */
export interface ResolvableItem {
  readonly id: string;
  readonly title: string;
  readonly alias?: string | null;
  readonly ih?: boolean | null;
  readonly listaId?: string | null;
  readonly availability?: unknown;
  readonly bitrate?: unknown;
}

/** Lo que la resolución lee del estado (StateV1 o el objeto suelto de los tests antiguos). */
export interface ResolutionState {
  readonly webSources?: readonly {
    readonly id: string;
    readonly streams: readonly ResolvableItem[];
  }[];
  readonly web?: readonly ResolvableItem[];
  readonly favorites?: readonly ResolvableItem[];
  readonly history?: readonly ResolvableItem[];
  readonly channelBindings?: readonly {
    readonly channel: string;
    readonly id: string;
    readonly title: string;
    readonly ih?: boolean;
  }[];
  readonly sourceStats?: Partial<SourceStats> | null;
}

/* "M+ LALIGA HDR" y "M+ LALIGA" cuentan como uno (server.js:3659-3665). */
function claveDeCanalSinVariante(channel: string): string {
  return normalizeChannelKey(channel)
    .split(' ')
    .filter((token) => token && !CHANNEL_VARIANT_TOKENS.has(token))
    .join(' ');
}

/**
 * `resolutionChannels` (server.js:3667-3685): limpia los rótulos, fusiona las
 * variantes de calidad quedándose el más corto y corta en 8. T-113.
 */
export function resolutionChannels(values: unknown): string[] {
  const output: string[] = [];
  const posicion = new Map<string, number>();
  for (const raw of Array.isArray(values) ? (values as unknown[]) : [values]) {
    const channel = cleanTitle(raw, '');
    const key = normalizeChannelKey(channel);
    if (!channel || !key) continue;
    const variante = claveDeCanalSinVariante(channel) || key;
    const index = posicion.get(variante);
    if (index !== undefined) {
      const previous = output[index] ?? '';
      if (key.split(' ').length < normalizeChannelKey(previous).split(' ').length) {
        output[index] = channel;
      }
      continue;
    }
    if (output.length >= MAX_RESOLUTION_CHANNELS) continue;
    posicion.set(variante, output.length);
    output.push(channel);
  }
  return output;
}

/**
 * `scoreResolutionCandidate` (server.js:3687-3718): puntúa el nombre visible
 * y el `tvg-id` contra cada canal pedido y se queda el mejor. T-056 a T-058.
 */
export function scoreResolutionCandidate(
  channels: readonly string[],
  item: ResolvableItem,
  source: ResolutionCandidate['source'],
): BaseCandidate {
  let score = 0;
  let matchedChannel = channels[0] || '';
  let soloFamilia = false;
  const names = item.alias ? [item.title, item.alias] : [item.title];
  for (const channel of channels) {
    for (const name of names) {
      const candidateScore = channelMatchScore(channel, name);
      if (candidateScore > score) {
        score = candidateScore;
        matchedChannel = channel;
        soloFamilia = esFamiliaDe(channel, name);
      }
    }
  }
  return {
    id: item.id,
    title: item.title,
    alias: cleanTitle(item.alias, '') || null,
    ih: item.ih === true,
    source,
    score,
    matchedChannel,
    soloFamilia,
    familyFallbackAllowed: soloFamilia && channelAllowsFamilyFallback(matchedChannel),
    listaId: item.listaId || null,
    availability: typeof item.availability === 'number' ? item.availability : null,
    bitrate: typeof item.bitrate === 'number' ? item.bitrate : null,
  };
}

type LibrarySource = 'm3u' | 'favorites' | 'history';

/** `libraryResolutionCandidates` (server.js:3720-3752): directorios, favoritos e historial, un hash una vez. */
export function libraryResolutionCandidates(
  state: ResolutionState,
  channels: readonly string[],
  minimumScore: number = LIBRARY_MIN_SCORE,
  options: { readonly sourceOrder?: readonly LibrarySource[] } = {},
): BaseCandidate[] {
  const output: BaseCandidate[] = [];
  const seen = new Set<string>();
  const webSources = state.webSources;
  const directoryItems: readonly ResolvableItem[] | undefined = Array.isArray(webSources)
    ? (webSources as NonNullable<ResolutionState['webSources']>).flatMap((source) =>
        source.streams.map((item: ResolvableItem) => ({ ...item, listaId: source.id })),
      )
    : state.web;
  const sourceItems: Record<LibrarySource, readonly ResolvableItem[]> = {
    m3u: Array.isArray(directoryItems) ? directoryItems : [],
    favorites: Array.isArray(state.favorites) ? state.favorites : [],
    history: Array.isArray(state.history) ? state.history : [],
  };
  const sourceOrder: readonly LibrarySource[] = options.sourceOrder?.length
    ? options.sourceOrder.filter((source) => Object.hasOwn(sourceItems, source))
    : ['m3u', 'favorites', 'history'];
  for (const source of sourceOrder) {
    for (const item of sourceItems[source]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const candidate = scoreResolutionCandidate(channels, item, source);
      /* 70, no 58: con 58 se colaba "LaLiga TV Hypermotion" en Champions (B-162). */
      if (candidate.score >= minimumScore) output.push(candidate);
    }
  }
  return output.sort((a, b) => b.score - a.score);
}

/**
 * `aceSearchQueries` (server.js:4159-4182): los canales tal cual y, con IA,
 * también sin operador ("liga de campeones"); 8 como mucho. T-021.
 */
export function aceSearchQueries(channels: readonly unknown[], semanticEnabled = false): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown): void => {
    const query = cleanTitle(value, '').slice(0, SEARCH_QUERY_CHARS);
    const key = normalizeChannelKey(query);
    if (query.length < 2 || !key || seen.has(key)) return;
    seen.add(key);
    output.push(query);
  };
  for (const channel of channels) {
    add(channel);
    if (semanticEnabled) {
      const core = normalizeChannelKey(channel)
        .split(' ')
        .filter((token) => !['movistar', 'm', 'plus'].includes(token))
        .join(' ');
      add(core);
    }
    if (output.length >= MAX_SEARCH_QUERIES) break;
  }
  return output.slice(0, MAX_SEARCH_QUERIES);
}

/* `minimumResolutionScore` (server.js:4184-4192). */
function minimumResolutionScore(
  candidate: { readonly source: string },
  semanticUsed: boolean,
): number {
  if (candidate.source === 'saved') return RESOLUTION_EXACT_SCORE;
  if (candidate.source === 'acestream' && !semanticUsed) return REMOTE_MIN_SCORE_WITHOUT_AI;
  return LIBRARY_MIN_SCORE;
}

/** Lo que la resolución necesita de fuera. */
export interface ResolveDeps {
  /** Una búsqueda en el motor (resultados `{ id, title, ih, availability… }`). */
  readonly search: (query: string) => Promise<readonly ResolvableItem[]>;
  /** `applyLearnedSourceRules` (sources): quita cuarentenas y rechazados, sube a 98 lo confirmado. */
  readonly applyLearned: (
    channels: readonly string[],
    candidates: readonly BaseCandidate[],
  ) => ResolutionCandidate[];
  /** `refrescarListasSiTocan` (server.js:4146-4157): en segundo plano, sin esperar. */
  readonly refreshLists: () => void;
  readonly semantic: SemanticOptions;
  /** Modelo que se anuncia en `ai.model` si la IA está activa. */
  readonly model: string;
  /** Canales de toda la agenda (catálogo de programación). */
  readonly programChannels: readonly string[];
}

export interface ResolveOptions {
  /** `research` = "Rebuscar" (B-214). */
  readonly mode?: 'research' | 'default';
  /** Partido de la agenda (`footballProgramMatch`), o el partido completo en el precalentado. */
  readonly program?: Readonly<Record<string, unknown>> | null;
  /** Canales de parrilla para la IA; por defecto, los del catálogo. */
  readonly programChannels?: readonly unknown[];
}

export interface AiInfo {
  enabled: boolean;
  used: boolean;
  model: string | null;
  catalogSize: number;
  error: string | null;
}

/** Resultado de `resolveFootballChannel` sin `success` ni lo que añade la ruta (`preheat`, `scan`). */
export interface ResolutionCore {
  status: 'found' | 'choices' | 'not_found';
  channels: string[];
  checked: string[];
  candidate?: ResolutionCandidate | null;
  candidates: ResolutionCandidate[];
  engineAvailable: boolean;
  ai: AiInfo;
  program: Readonly<Record<string, unknown>> | null;
  research: boolean;
}

/**
 * `resolveFootballChannel` (server.js:4227-4335). Lanza `channel_required` si
 * no queda ningún canal. T-009 a T-012, T-021, T-022, T-026, T-028, T-029,
 * T-067, T-099, T-114.
 */
export async function resolveFootballChannel(
  state: ResolutionState,
  values: unknown,
  deps: ResolveDeps,
  options: ResolveOptions = {},
): Promise<ResolutionCore> {
  const channels = resolutionChannels(values);
  if (!channels.length) throw new AppError('channel_required');

  const research = options.mode === 'research';
  const semanticEnabled = deps.semantic.enabled;
  const checked = research
    ? ['favorites', 'm3u', 'acestream']
    : ['saved', 'm3u', 'library', 'acestream'];
  if (semanticEnabled) checked.push('ai-programming');

  deps.refreshLists();

  const bindings: BaseCandidate[] = research
    ? []
    : (state.channelBindings || [])
        .map((binding) => {
          const scored = scoreResolutionCandidate(
            channels,
            { ...binding, title: binding.channel },
            'saved',
          );
          return { ...scored, title: binding.title, ih: binding.ih as boolean };
        })
        .filter((candidate) => candidate.score >= RESOLUTION_EXACT_SCORE);

  /* Se conservan todas las entradas: las que el emparejado clásico no
     entienda tienen una segunda oportunidad en la IA; después, el umbral. */
  const local = libraryResolutionCandidates(
    state,
    channels,
    0,
    research ? { sourceOrder: ['favorites', 'm3u'] } : {},
  );

  const queries = aceSearchQueries(channels, semanticEnabled);
  const searched = await Promise.allSettled(queries.map((query) => deps.search(query)));
  const engineAvailable = searched.some((result) => result.status === 'fulfilled');
  const remote: BaseCandidate[] = [];
  for (const result of searched) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value)
      remote.push(scoreResolutionCandidate(channels, item, 'acestream'));
  }

  const program = options.program || null;
  const programChannels = [
    ...(Array.isArray(program?.channels) ? (program.channels as unknown[]) : []),
    ...(Array.isArray(options.programChannels) ? options.programChannels : deps.programChannels),
  ];
  const semanticResult = await applySemanticCandidateScores(
    channels,
    [...local, ...remote],
    programChannels,
    deps.semantic,
  );
  /* Lo aprendido se aplica UNA vez, sobre todas las capas y antes del umbral:
     la subida a 98 de una fuente confirmada cuenta para pasar el corte (B-181). */
  const learned = deps.applyLearned(channels, [...bindings, ...semanticResult.candidates]);
  const qualified = learned.filter(
    (candidate) => candidate.score >= minimumResolutionScore(candidate, semanticResult.used),
  );
  const candidates = mergeResolutionCandidates(
    qualified,
    research
      ? {
          sourceOrder: ['favorites', 'm3u', 'acestream'],
          sourceStats: state.sourceStats ?? null,
          requestedChannels: channels,
        }
      : { sourceStats: state.sourceStats ?? null, requestedChannels: channels },
  );
  const ai: AiInfo = {
    enabled: semanticEnabled,
    used: semanticResult.used,
    model: semanticEnabled ? deps.model : null,
    catalogSize: semanticResult.catalogSize,
    error: semanticResult.error,
  };
  if (!candidates.length) {
    return {
      status: 'not_found',
      channels,
      checked,
      candidates: [],
      engineAvailable,
      ai,
      program,
      research,
    };
  }

  /* Un vínculo guardado manda si sigue en cabeza tras el orden (la regla de
     la marca puede haberlo apartado, B-178). Si no, se reproduce el mejor ≥ 92
     aunque haya canales distintos empatados: el selector deja cambiar. */
  const guardado = !research && candidates[0]?.source === 'saved' ? candidates[0] : null;
  const cabeza = candidates.filter((candidate) => candidate.score >= RESOLUTION_EXACT_SCORE);
  const canalesEnCabeza = new Set(cabeza.map((candidate) => normalizeChannelKey(candidate.title)));
  const inequivoco = cabeza.length > 0 && canalesEnCabeza.size === 1;
  const elegido = guardado || (inequivoco ? cabeza[0] : null) || cabeza[0] || null;

  if (elegido) {
    return {
      status: 'found',
      channels,
      checked,
      candidate: elegido,
      candidates,
      engineAvailable,
      ai,
      program,
      research,
    };
  }
  return {
    status: 'choices',
    channels,
    checked,
    candidates,
    engineAvailable,
    ai,
    program,
    research,
  };
}
