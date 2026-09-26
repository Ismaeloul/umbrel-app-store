/* Servicio `football`: agenda, marcadores, resolución, IA, vínculos y
   precalentado (arquitectura §5.10). La lógica portada vive en los ficheros
   de al lado; aquí se guarda el estado de cada instancia (en la 0.6.59, los
   globales `footballCache`, `footballProgramming`, `semanticEmbeddingCache`,
   `scoresCache` y `preheatMatches`) y se enchufan los demás módulos por sus
   interfaces.

   Lo nuevo respecto a la 0.6.59:
   - Plazo global de 60 s para la cadena futbolenlatv → EPG → TheSportsDB; si
     vence, la última agenda buena con `stale: true` (backend-modulos §8.5.27).
   - Ids de futbolenlatv estables y `start` también en la EPG y TheSportsDB.
   - Las búsquedas de la resolución van con `via: 'auto'`: al comprobador si
     hay alguien viendo (arquitectura §5.10, backend-modulos §9.11).
   - El precalentado pide la agenda por `schedule()`, que la refresca si
     caducó (§8.2.13), y no fuerza sondas de un partido que se está viendo.
   - La salud dice `stale` de verdad (api.md §6.11) y cuenta la demo. */

import { createHash } from 'node:crypto';
import {
  TIMEOUTS,
  motivoDeFallo,
  normalizeHash,
  semanticChannelText,
  type FootballSchedule,
  type PreheatPublic,
  type Resolution,
  type ResolutionCandidate,
  type ScanRef,
  type ScoresResponse,
} from '@ace/shared';
import type { Unsubscribe } from '../../core/bus.js';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { ScanCandidateInput, ScanJobRequest } from '../scanner/types.js';
import {
  buildFootballDemoSchedule,
  fetchEpgFootballSchedule,
  fetchFutbolEnLaTvSchedule,
  fetchTheSportsDbSchedule,
  footballScheduleMatches,
  type AgendaContext,
  type TextFetcher,
} from './agenda-sources.js';
import {
  SemanticVectorCache,
  createOllamaEmbedder,
  embeddingKey,
  semanticLibraryTexts,
  semanticWarmEmbeddings,
  unavailableEmbedder,
  type EmbedFunction,
} from './ai.js';
import { buildChannelBinding, withBinding } from './bindings.js';
import {
  FOOTBALL_CACHE_MS,
  PREHEAT_FIRST_RUN_MS,
  PREHEAT_HEALTH_STATES,
  PREHEAT_TICK_MS,
  SCORES_PRUNE_INTERVAL_MS,
} from './constants.js';
import {
  preheatFootballMatch,
  publicPreheatRecord,
  reusablePreheat,
  runPreheatRound,
  type PreheatContext,
  type PreheatRecord,
  type PreheatStage,
} from './preheat.js';
import { ProgrammingCatalog, channelName } from './programming.js';
import {
  resolutionChannels,
  resolveFootballChannel,
  scoreResolutionCandidate,
  type BaseCandidate,
  type ResolutionCore,
  type ResolutionIptv,
  type ResolutionState,
  type ResolvableItem,
  type ResolveScope,
} from './resolution.js';
import type { IptvProgramInput } from '../iptv/types.js';
import {
  computeLiveScores,
  pruneScoresCache,
  type LegacyScores,
  type ScoresCache,
} from './scores.js';
import { isoDateInMadrid, madridLocalToEpoch } from './time.js';
import type { FootballAiHealth, FootballDeps, FootballService, ResolveOptions } from './types.js';

type Loose = Record<string, unknown>;

interface AgendaCache {
  payload: FootballSchedule | null;
  expiresAt: number;
  pending: Promise<FootballSchedule> | null;
  /** El último refresco falló y se sirve la agenda vieja. */
  stale: boolean;
}

function asRecord(value: unknown): Loose {
  return value && typeof value === 'object' ? (value as Loose) : {};
}

/** `channel` de la query: se repite (URLSearchParams.getAll) o llega suelto (v1). */
function channelList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** Clave de cliente del comprobador (server.js:3547): `[a-zA-Z0-9_-]`, 40 como mucho. */
function clientKeyOf(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40);
}

export class FootballServiceImpl implements FootballService {
  private readonly programming = new ProgrammingCatalog();
  private readonly vectors = new SemanticVectorCache();
  private readonly scoresCache: ScoresCache = new Map();
  private readonly preheats = new Map<string, PreheatRecord>();
  private readonly agenda: AgendaCache = {
    payload: null,
    expiresAt: 0,
    pending: null,
    stale: false,
  };
  private readonly embed: EmbedFunction;
  private demoPayload: FootballSchedule | null = null;
  private warmSignature = '';
  private warmPending: Promise<void> | null = null;
  private preheatBusy = false;
  private preheatRun: Promise<void> | null = null;
  private watched: ReadonlySet<string> = new Set();
  private timers: TimerHandle[] = [];
  private subscriptions: Unsubscribe[] = [];
  private started = false;

  /** Última vez que Ollama respondió bien a un `embed` (para `healthInfo().ai`, paso 1.3). */
  private aiReadyAt: number | null = null;

  constructor(private readonly deps: FootballDeps) {
    const { ai } = deps.config;
    const embed =
      deps.embed ??
      (ai.enabled
        ? createOllamaEmbedder({
            baseUrl: ai.ollamaBaseUrl,
            model: ai.embedModel,
            timeoutMs: ai.timeoutMs,
            clock: deps.clock,
            fetch: deps.ollamaFetch ?? globalThis.fetch,
          })
        : unavailableEmbedder);
    /* Cada respuesta buena de Ollama dice a la salud que la IA está lista sin
       que tenga que preguntar a /api/tags; un fallo lo borra (la salud vuelve
       a preguntar y distingue "sin modelo" de "caído"). */
    this.embed = async (texts) => {
      try {
        const vectors = await embed(texts);
        this.aiReadyAt = deps.clock.now();
        return vectors;
      } catch (error) {
        this.aiReadyAt = null;
        throw error;
      }
    };
  }

  // --- Ciclo de vida ---

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { bus, clock } = this.deps;
    this.subscriptions.push(
      bus.on('scan.jobDone', (event) => this.onScanJobDone(event)),
      bus.on('playback.activity', (activity) => {
        this.watched = new Set(activity.watching ? activity.hashes : []);
      }),
    );
    const tick = (): void => {
      this.preheatRun = this.runPreheat().catch((error: unknown) =>
        this.deps.logger.warn({ errorCode: motivoDeFallo(error) }, '[preheat] fallo'),
      );
    };
    this.timers.push(
      clock.setInterval(tick, PREHEAT_TICK_MS, { unref: true }),
      clock.setTimeout(tick, PREHEAT_FIRST_RUN_MS, { unref: true }),
      clock.setInterval(
        () => pruneScoresCache(this.scoresCache, clock.now()),
        SCORES_PRUNE_INTERVAL_MS,
        { unref: true },
      ),
    );
  }

  async stop(): Promise<void> {
    const { clock } = this.deps;
    for (const timer of this.timers) {
      clock.clearInterval(timer);
      clock.clearTimeout(timer);
    }
    this.timers = [];
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    this.started = false;
  }

  // --- Agenda ---

  /** `getFootballSchedule` (server.js:2723-2749) con el plazo global de 60 s. */
  schedule(): Promise<FootballSchedule> {
    const { clock, config } = this.deps;
    if (config.football.demoOnly) {
      const payload = buildFootballDemoSchedule(isoDateInMadrid(clock.now()), this.agendaContext());
      this.demoPayload = payload;
      this.rememberProgramming(payload);
      return Promise.resolve(payload);
    }
    if (this.agenda.payload && clock.now() < this.agenda.expiresAt) {
      return Promise.resolve(this.agenda.payload);
    }
    if (this.agenda.pending) return this.agenda.pending;
    const pending = this.refreshAgenda().finally(() => {
      this.agenda.pending = null;
    });
    this.agenda.pending = pending;
    return pending;
  }

  private agendaContext(): AgendaContext {
    const { clock, config } = this.deps;
    return {
      now: clock.now(),
      generatedAt: () => clock.date().toISOString(),
      days: config.football.days,
      country: config.football.country,
      apiKey: config.football.apiKey,
      flavor: 'stable',
    };
  }

  private async refreshAgenda(): Promise<FootballSchedule> {
    const { clock, logger, net } = this.deps;
    const controller = new AbortController();
    let rejectDeadline: (error: unknown) => void = () => {};
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const timer = clock.setTimeout(
      () => {
        controller.abort();
        rejectDeadline(
          new AppError('football_unavailable', { detail: 'plazo global de la agenda (60 s)' }),
        );
      },
      TIMEOUTS.agendaTotalMs,
      { unref: true },
    );
    const fetchText: TextFetcher = async (url, options = {}) =>
      (await net.fetchText(url, { ...options, signal: controller.signal })).body;
    const ctx = this.agendaContext();
    const failed = (source: string) => (error: unknown) => {
      logger.warn({ errorCode: motivoDeFallo(error), source }, 'agenda: fuente sin datos');
    };
    /* Cadena de respaldo, de más a menos completa (server.js:2733-2736). */
    const chain = fetchFutbolEnLaTvSchedule(fetchText, ctx)
      .catch((error: unknown) => {
        failed('futbolenlatv')(error);
        return fetchEpgFootballSchedule(fetchText, ctx);
      })
      .catch((error: unknown) => {
        failed('movistarplus')(error);
        return fetchTheSportsDbSchedule(fetchText, ctx);
      });
    chain.catch(() => {});
    deadline.catch(() => {});
    try {
      const payload = await Promise.race([chain, deadline]);
      this.agenda.payload = payload;
      this.agenda.expiresAt = clock.now() + FOOTBALL_CACHE_MS;
      this.agenda.stale = false;
      this.rememberProgramming(payload);
      return payload;
    } catch (error) {
      logger.warn({ errorCode: motivoDeFallo(error) }, 'agenda: ninguna fuente respondió a tiempo');
      if (this.agenda.payload) {
        this.agenda.stale = true;
        return { ...this.agenda.payload, stale: true };
      }
      throw error instanceof AppError && error.code === 'football_unavailable'
        ? error
        : new AppError('football_unavailable', { cause: error });
    } finally {
      clock.clearTimeout(timer);
      controller.abort();
    }
  }

  /**
   * `rememberFootballProgramming` (server.js:2682-2717): guarda el catálogo,
   * reserva sitio en el LRU para sus canales y calienta los vectores en
   * segundo plano (una vez por firma; un lote fallido se reintenta la próxima).
   */
  private rememberProgramming(payload: FootballSchedule): void {
    const { config, logger, state } = this.deps;
    const channels = this.programming.remember(payload);
    this.vectors.reserve(
      channels.map((channel) => embeddingKey(semanticChannelText(channel))).filter(Boolean),
    );
    if (!config.ai.enabled || !channels.length) return;
    let library: string[] = [];
    try {
      library = semanticLibraryTexts(state.get());
    } catch {}
    const texts = [...channels.map(semanticChannelText), ...library].filter(Boolean);
    const signature = createHash('sha256').update(texts.join('\n')).digest('hex');
    if (signature === this.warmSignature || this.warmPending) return;
    this.warmPending = semanticWarmEmbeddings(texts, { cache: this.vectors, embed: this.embed })
      .then((result) => {
        if (!result.failed) {
          this.warmSignature = signature;
          return;
        }
        this.warmSignature = '';
        logger.warn(
          { errorCode: motivoDeFallo({ message: result.error }), failed: result.failed },
          '[ia-programacion] índice parcial',
        );
      })
      .catch((error: unknown) => {
        this.warmSignature = '';
        logger.warn({ errorCode: motivoDeFallo(error) }, '[ia-programacion] sin índice');
      })
      .finally(() => {
        this.warmPending = null;
      });
  }

  /** Espera a la vuelta de precalentado y al calentado de la IA en curso (tests y apagado). */
  async idle(): Promise<void> {
    await this.preheatRun;
    await this.warmPending;
  }

  programChannels(matchId: string): string[] {
    return [...(this.programming.match(matchId)?.channels ?? [])];
  }

  // --- Resolución ---

  private refreshLists(): void {
    try {
      this.deps.directories.refreshStaleInBackground();
    } catch (error) {
      this.deps.logger.warn({ errorCode: motivoDeFallo(error) }, '[sync-al-resolver] fallo');
    }
  }

  /** El partido para la guía de la IPTV (con el saque aunque la agenda no traiga `start`). */
  private iptvProgram(program: Readonly<Record<string, unknown>> | null): IptvProgramInput | null {
    if (!program) return null;
    const start = Number(program.start) || madridLocalToEpoch(program.date, program.time) || null;
    const channels = (Array.isArray(program.channels) ? (program.channels as unknown[]) : [])
      .map((channel) => channelName(channel))
      .filter(Boolean);
    return {
      id: String(program.id ?? ''),
      home: String(program.home ?? ''),
      away: String(program.away ?? ''),
      competition: String(program.competition ?? ''),
      title: String(program.title ?? ''),
      start,
      channels,
    };
  }

  /** Capa IPTV de la resolución (docs/iptv.md §4.3), si hay IPTV activa. */
  private iptvLayer(): ResolutionIptv | undefined {
    const { iptv, sources } = this.deps;
    if (!iptv?.active()) return undefined;
    return {
      resolve: (channels, program) =>
        iptv.resolve({
          channels,
          program: this.iptvProgram(program),
          scorer: (wanted, item) => scoreResolutionCandidate(wanted, item, 'iptv'),
          reliability: (id) => {
            try {
              return sources.reliability({ id, title: '', listaId: null, source: 'iptv' });
            } catch {
              return null;
            }
          },
        }),
      classify: (id) => iptv.classify(id),
      convert: (id, match) => iptv.candidateFor(id, match),
      tapped: (id) => iptv.tappedCandidates(id),
      sameChannel: (channel, title) => iptv.sameChannelScore(channel, title),
    };
  }

  /* Sin IPTV activa pero con la búsqueda inversa (un favorito IPTV con la IPTV
     en pausa, §14.4): la decisión de §4.1 sigue valiendo para descartar ids
     IPTV que devuelva el motor. */
  private iptvClassifier(): ResolutionIptv | undefined {
    const { iptv } = this.deps;
    if (!iptv) return undefined;
    return {
      resolve: () => ({ candidates: [], hints: [], consulted: false }),
      classify: (id) => iptv.classify(id),
      convert: () => null,
      tapped: () => [],
      sameChannel: (channel, title) => iptv.sameChannelScore(channel, title),
    };
  }

  private resolveChannels(
    state: ResolutionState,
    values: unknown,
    options: {
      readonly program?: Readonly<Record<string, unknown>> | null;
      readonly mode?: 'research' | 'default';
      readonly signal?: AbortSignal;
      readonly scope?: ResolveScope;
      readonly iptvId?: string | null;
      readonly engine?: boolean;
    },
  ): Promise<ResolutionCore> {
    const { config, search, sources } = this.deps;
    const iptv =
      this.iptvLayer() ??
      (options.scope === 'channel' && options.engine ? this.iptvClassifier() : undefined);
    return resolveFootballChannel(
      state,
      values,
      {
        search: async (query): Promise<readonly ResolvableItem[]> =>
          (await search.search(query, { via: 'auto', signal: options.signal })).results,
        applyLearned: (channels, candidates) =>
          sources.applyLearnedRules(
            channels,
            candidates as readonly BaseCandidate[] as readonly ResolutionCandidate[],
          ),
        refreshLists: () => this.refreshLists(),
        semantic: { enabled: config.ai.enabled, embed: this.embed, cache: this.vectors },
        model: config.ai.embedModel,
        programChannels: this.programming.channels,
        ...(iptv ? { iptv } : {}),
      },
      {
        program: options.program ?? null,
        mode: options.mode ?? 'default',
        scope: options.scope ?? 'match',
        ...(options.iptvId ? { iptvId: options.iptvId } : {}),
        ...(options.engine ? { engine: true } : {}),
      },
    );
  }

  private enqueueScan(request: ScanJobRequest): ScanRef | null {
    try {
      return this.deps.scanner.enqueue(request);
    } catch (error) {
      this.deps.logger.error(
        { errorCode: motivoDeFallo(error) },
        'comprobador: no se pudo encolar',
      );
      return null;
    }
  }

  /** La ruta `/api/football/resolve` (server.js:4768-4813). */
  async resolve(
    query: Record<string, unknown> | object,
    options: ResolveOptions = {},
  ): Promise<Resolution> {
    const { clock, sources, state } = this.deps;
    const input = asRecord(query);
    const research = String(input.research ?? '') === '1';
    const matchId = typeof input.match === 'string' ? input.match : '';
    /* Una resolución va a usar la IPTV: lista y cuenta frescas, de fondo (docs/iptv.md §3.5). */
    this.deps.iptv?.touch(research ? 'research' : 'default');
    /* Canal suelto (docs/iptv.md §5.2): solo vínculos, biblioteca e IPTV. */
    if (input.scope === 'channel') return this.resolveLooseChannel(input, options);
    /* Los canales salen de la agenda real si el partido está en ella (B-231). */
    const program = this.programming.match(matchId);
    const announced = program?.channels.length ? program.channels : channelList(input.channel);
    /* Partido sin canales con IPTV activa: solo la guía (docs/iptv.md §4.5). */
    if (program && !announced.length && this.iptvLayer()) {
      return this.resolveByGuide(input, program, options);
    }
    /* "Rebuscar" siempre hace una pasada nueva (B-180, B-214). */
    const preheated = research ? null : reusablePreheat(this.preheats, matchId, clock.now());
    let result: ResolutionCore & { preheated?: true };
    if (preheated?.result) {
      const candidates = sources.applyLearnedRules(
        resolutionChannels(announced),
        preheated.result.candidates || [],
      );
      const chosenId = preheated.result.candidate?.id;
      const candidate = candidates.find((item) => item.id === chosenId) || candidates[0] || null;
      result = {
        ...preheated.result,
        status: candidate ? 'found' : 'not_found',
        candidate,
        candidates,
        preheated: true,
      };
    } else {
      result = await this.resolveChannels(state.get(), announced, {
        program: program ? { ...program } : null,
        mode: research ? 'research' : 'default',
        ...(options.signal ? { signal: options.signal } : {}),
      });
    }
    const scanCandidates: ScanCandidateInput[] = result.candidates.map((candidate) => ({
      id: candidate.id,
      ih: candidate.ih,
      title: candidate.title,
    }));
    const currentId = research ? normalizeHash(input.current) : '';
    if (
      scanCandidates.length &&
      currentId &&
      !scanCandidates.some((item) => item.id === currentId)
    ) {
      scanCandidates.push({
        id: currentId,
        ih: String(input.current_ih ?? input.currentIh ?? '') === '1',
      });
    }
    const scan = scanCandidates.length
      ? this.enqueueScan({
          kind: research ? 'research' : 'interactive',
          candidates: scanCandidates,
          clientKey: clientKeyOf(input.client),
          matchId,
          force: research,
          priority: true,
        })
      : null;
    return { ...result, preheat: publicPreheatRecord(preheated), scan } as Resolution;
  }

  /* Trabajo del comprobador de una resolución IPTV: las AceStream y la
     comprobación de cuenta de las IPTV (su carril; nunca una sonda de stream
     IPTV desde una resolución interactiva, docs/iptv.md §5.2 y §7.3). */
  private scanFor(
    result: ResolutionCore,
    input: Record<string, unknown>,
    matchId: string,
  ): ScanRef | null {
    if (result.status === 'not_found' || !result.candidates.length) return null;
    return this.enqueueScan({
      kind: 'interactive',
      candidates: result.candidates.map((candidate) => ({
        id: candidate.id,
        ih: candidate.ih,
        title: candidate.title,
      })),
      clientKey: clientKeyOf(input.client),
      matchId,
      force: false,
      priority: true,
    });
  }

  /**
   * `footballResolve` con `scope=channel` (docs/iptv.md §5.2): el título del
   * canal que se abre como único canal pedido. Sin ninguna IPTV responde
   * `not_found` sin trabajo del comprobador y la web sigue como hoy.
   */
  private async resolveLooseChannel(
    input: Record<string, unknown>,
    options: ResolveOptions,
  ): Promise<Resolution> {
    const channels = channelList(input.channel);
    /* §14.4: el canal IPTV tocado (si no es un id IPTV vigente se ignora) y la búsqueda inversa. */
    const iptvId = typeof input.iptv === 'string' ? normalizeHash(input.iptv) || null : null;
    const engine = String(input.engine ?? '') === '1';
    if (!this.iptvLayer() && !engine) {
      const clean = resolutionChannels(channels);
      if (!clean.length) throw new AppError('channel_required');
      return {
        status: 'not_found',
        channels: clean,
        checked: [],
        candidate: null,
        candidates: [],
        engineAvailable: true,
        ai: {
          enabled: this.deps.config.ai.enabled,
          used: false,
          model: this.deps.config.ai.enabled ? this.deps.config.ai.embedModel : null,
          catalogSize: 0,
          error: null,
        },
        program: null,
        research: false,
        preheat: null,
        scan: null,
      };
    }
    const result = await this.resolveChannels(this.deps.state.get(), channels, {
      scope: 'channel',
      ...(iptvId ? { iptvId } : {}),
      ...(engine ? { engine: true } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return { ...result, preheat: null, scan: this.scanFor(result, input, '') } as Resolution;
  }

  /** Partido sin canales anunciados: solo la guía de la IPTV y sus pistas (docs/iptv.md §4.5). */
  private async resolveByGuide(
    input: Record<string, unknown>,
    program: NonNullable<ReturnType<ProgrammingCatalog['match']>>,
    options: ResolveOptions,
  ): Promise<Resolution> {
    const result = await this.resolveChannels(this.deps.state.get(), [], {
      program: { ...program },
      scope: 'guide',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      ...result,
      preheat: null,
      scan: this.scanFor(result, input, program.id),
    } as Resolution;
  }

  // --- Vínculos ---

  /** `saveChannelBinding` (server.js:4463-4469). Lanza `bad_binding`. */
  async bind(body: Record<string, unknown> | object) {
    const nowIso = this.deps.clock.date().toISOString();
    const binding = buildChannelBinding({ ...asRecord(body), updatedAt: nowIso }, nowIso);
    if (!binding) throw new AppError('bad_binding');
    const channelBindings = await this.deps.state.enqueue(
      (draft) => {
        const next = withBinding(draft.channelBindings, binding);
        draft.channelBindings = next;
        return next;
      },
      { scopes: ['bindings'] },
    );
    return { success: true as const, binding, channelBindings };
  }

  // --- Marcadores ---

  /** `getLiveScores` (server.js:2276-2337): las tres formas de la ruta antigua. */
  async legacyScores(): Promise<LegacyScores> {
    const { clock, net } = this.deps;
    let schedule: FootballSchedule | null;
    try {
      schedule = await this.schedule();
    } catch {
      schedule = null;
    }
    pruneScoresCache(this.scoresCache, clock.now());
    return computeLiveScores(
      {
        cache: this.scoresCache,
        fetchText: async (url, options) => (await net.fetchText(url, options)).body,
        now: () => clock.now(),
        nowIso: () => clock.date().toISOString(),
      },
      schedule,
    );
  }

  async scores(): Promise<ScoresResponse> {
    const legacy = await this.legacyScores();
    if (!legacy.success) {
      return {
        available: false,
        generatedAt: null,
        source: 'espn',
        attribution: null,
        leagues: 0,
        scores: {},
      };
    }
    return {
      available: true,
      generatedAt: legacy.generatedAt,
      source: 'espn',
      attribution: 'attribution' in legacy ? legacy.attribution : null,
      leagues: legacy.leagues,
      scores: legacy.scores,
    };
  }

  /** La caché de marcadores de esta instancia (`scoresCache` de la 0.6.59; T-114). */
  scoresCacheMap(): ScoresCache {
    return this.scoresCache;
  }

  // --- Precalentado ---

  preheat(matchId: string): PreheatPublic | null {
    return publicPreheatRecord(this.preheats.get(String(matchId || '')));
  }

  private preheatContext(): PreheatContext {
    const { clock, state } = this.deps;
    return {
      records: this.preheats,
      now: () => clock.now(),
      state: () => state.get(),
      refreshLists: () => this.refreshLists(),
      resolve: (current, channels, options) =>
        this.resolveChannels(current, channels, { program: options.program }),
      enqueue: (request) => this.enqueueScan(request),
      isWatched: (hash) => this.watched.has(hash),
    };
  }

  /** `runFootballPreheat` (server.js:4431-4450): sin solapes; pide la agenda si no se la dan. */
  async runPreheat(
    options: { readonly now?: number; readonly payload?: unknown } = {},
  ): Promise<void> {
    if (this.preheatBusy) return;
    this.preheatBusy = true;
    try {
      const now = Number(options.now) || this.deps.clock.now();
      const payload = options.payload ?? (await this.schedule());
      await runPreheatRound(this.preheatContext(), payload, now);
    } finally {
      this.preheatBusy = false;
    }
  }

  /** `preheatFootballMatch` (server.js:4372) de un partido y fase concretos (tests y fachada). */
  preheatMatch(match: unknown, stage: PreheatStage, now?: number): Promise<PreheatRecord | null> {
    return preheatFootballMatch(
      this.preheatContext(),
      match,
      stage,
      Number(now) || this.deps.clock.now(),
    );
  }

  /* `updatePreheatFromScanner` (server.js:4363-4370), por `scan.jobDone`. */
  private onScanJobDone(event: {
    readonly jobId: string;
    readonly kind: string;
    readonly status: string;
    readonly matchId: string | null;
    readonly total: number;
    readonly playable: number;
  }): void {
    if (event.kind !== 'preheat' || event.status !== 'complete' || !event.matchId) return;
    const record = this.preheats.get(event.matchId);
    if (!record) return;
    let scan = { checked: event.total, playable: event.playable, total: event.total };
    try {
      const job = this.deps.scanner.job(event.jobId);
      scan = { checked: job.checked, playable: job.playable, total: job.total };
    } catch {}
    record.scan = scan;
    record.status = 'ready';
    record.updatedAt = this.deps.clock.now();
  }

  // --- Salud ---

  healthInfo() {
    const { config } = this.deps;
    const payload = config.football.demoOnly ? this.demoPayload : this.agenda.payload;
    let preheated = 0;
    for (const record of this.preheats.values()) {
      if (PREHEAT_HEALTH_STATES.has(record.status)) preheated += 1;
    }
    return {
      status: !payload
        ? ('warming' as const)
        : this.agenda.stale && !config.football.demoOnly
          ? ('stale' as const)
          : ('ready' as const),
      generatedAt: payload?.generatedAt ?? null,
      matches: footballScheduleMatches(payload).length,
      preheated,
      aiEnabled: config.ai.enabled,
      ai: this.aiHealth(),
    };
  }

  /**
   * `ai` de la salud (paso 1.3): `disabled` sin Ollama configurado, `ready`
   * si respondió bien hace menos de AI_HEALTH_FRESH_MS; si no, `null` y la
   * salud pregunta a `/api/tags` (cacheado 30 s).
   */
  private aiHealth(): FootballAiHealth | null {
    if (!this.deps.config.ai.enabled) return { status: 'disabled', modelReady: false };
    const at = this.aiReadyAt;
    if (at !== null && this.deps.clock.now() - at < AI_HEALTH_FRESH_MS) {
      return { status: 'ready', modelReady: true };
    }
    return null;
  }
}

/** Una respuesta buena de Ollama vale para la salud durante este rato. */
export const AI_HEALTH_FRESH_MS = 5 * 60 * 1000;
