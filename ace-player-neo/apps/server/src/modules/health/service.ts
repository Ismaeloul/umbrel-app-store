/* Salud (arquitectura §5.14; backend-modulos §3.18; B-207, B-208).

   `/api/health` conserva la forma EXACTA de `systemHealth` (server.js:4612-4671),
   que usa el vigilante del NAS (monitoring/ace-player-neo-healthcheck:55-67
   mira `components.scanner.online`). Diferencia: ya no hace 3 peticiones de
   red por llamada. Sale de:
   - motor: el estado del vigilante (`engine.status()`, cada 10 s);
   - comprobador: `scanner.stats()` y su `online` si lo expone; si no, una
     sonda `get_version` cacheada 30 s;
   - IA: la de football si la expone; si no, `/api/tags` de Ollama cacheado 30 s;
   - agenda y precalentado: `football.healthInfo()`;
   - directorios, informes y aprendizaje: la copia en memoria del estado.
   Un servicio que falla no tumba la salud: su parte sale como caída/vacía y
   queda un aviso (la 0.6.59 tampoco fallaba nunca por ellos). */

import {
  ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
  TIMEOUTS,
  WEB_SYNC_INTERVAL_MS as SHARED_WEB_SYNC_INTERVAL_MS,
  type DiagnosticCause,
  type EngineStatus,
  type HealthLiveResponse,
  type HealthResponse,
  type LegacyHealthResponse,
  type PingResponse,
  type StateV1,
} from '@ace/shared';
import type { Clock } from '../../core/clock.js';
import type { FootballService } from '../football/types.js';
import type { ScannerStats } from '../scanner/types.js';
import type { HealthDeps, HealthProbes, HealthService, OllamaTags } from './types.js';

/** Cada cuánto se repite una sonda de red como mucho. */
export const HEALTH_PROBE_TTL_MS = 30 * 1000;
/** `WEB_SYNC_INTERVAL_MS` (server.js:55): un directorio está rancio pasadas 1,5 veces (4 h 30 min). */
export const WEB_SYNC_INTERVAL_MS = SHARED_WEB_SYNC_INTERVAL_MS;
const STALE_FACTOR = 1.5;

type AiStatus = 'disabled' | 'ready' | 'model_missing' | 'offline';
type LegacyAi = LegacyHealthResponse['components']['ai'];
type Agenda = LegacyHealthResponse['components']['agenda'];
type Warning = HealthResponse['warnings'][number];

/* Lo que exponen scanner (`online`) y football (`ai`) desde el paso 1.3: si
   está (no `null`), se usa y no se sondea nada. Los tipos admiten que falten
   para los fakes de los tests. */
type ScannerStatsWithOnline = Omit<ScannerStats, 'online'> & { readonly online?: boolean | null };
type FootballHealthWithAi = ReturnType<FootballService['healthInfo']> & {
  readonly ai?: { readonly status: AiStatus; readonly modelReady?: boolean } | null;
};

// --- Caché de una sonda ---

interface CachedProbe<T> {
  /** El último valor; si caducó, lo devuelve igual y refresca por detrás. Sin valor, espera. */
  get(): Promise<T>;
}

export function cachedProbe<T>(
  clock: Clock,
  ttlMs: number,
  timeoutMs: number,
  probe: (signal: AbortSignal) => Promise<T>,
  onError: (error: unknown) => T,
): CachedProbe<T> {
  let value: { readonly data: T; readonly at: number } | null = null;
  let inFlight: Promise<T> | null = null;

  const refresh = (): Promise<T> => {
    if (inFlight) return inFlight;
    const controller = new AbortController();
    const timer = clock.setTimeout(
      () => controller.abort(new Error('health_probe_timeout')),
      timeoutMs,
      { unref: true },
    );
    inFlight = probe(controller.signal)
      .catch(onError)
      .then((data) => {
        value = { data, at: clock.now() };
        return data;
      })
      .finally(() => {
        clock.clearTimeout(timer);
        inFlight = null;
      });
    return inFlight;
  };

  return {
    get() {
      if (value && clock.now() - value.at < ttlMs) return Promise.resolve(value.data);
      const pending = refresh();
      return value ? Promise.resolve(value.data) : pending;
    },
  };
}

// --- Sondas reales ---

/**
 * Sondas de verdad. Con `scanner` (lo normal desde el paso 1.3), el
 * `get_version` del comprobador lo hace el propio comprobador con su
 * transporte (`scanner.ping()`); sin él, un `fetch` directo (tests).
 */
export function defaultProbes(
  deps: Pick<HealthDeps, 'config'> & Partial<Pick<HealthDeps, 'scanner'>>,
): HealthProbes {
  const { config, scanner } = deps;
  return {
    async ollamaTags(signal) {
      const response = await fetch(`${config.ai.ollamaBaseUrl}/api/tags`, { signal });
      const data = (await response.json().catch(() => ({}))) as { models?: unknown };
      const models = Array.isArray(data?.models)
        ? data.models.map((item: unknown) => {
            const entry = (item ?? {}) as { name?: unknown; model?: unknown };
            return String(entry.name || entry.model || '');
          })
        : [];
      return { ok: response.ok, models };
    },
    async scannerVersion(signal) {
      if (scanner) return (await scanner.ping(signal)).online;
      const url = `http://${config.scanner.host}:${config.scanner.port}/webui/api/service?method=get_version`;
      const response = await fetch(url, { signal });
      await response.body?.cancel().catch(() => undefined);
      return response.status >= 200 && response.status < 300;
    },
  };
}

/** `ollamaHealth` (server.js:4594-4610) sobre la respuesta de `/api/tags`. */
export function aiFromTags(model: string, tags: OllamaTags): LegacyAi {
  const wanted = model.split(':')[0];
  const modelReady = tags.models.some((name) => name === model || name.split(':')[0] === wanted);
  return {
    status: tags.ok && modelReady ? 'ready' : tags.ok ? 'model_missing' : 'offline',
    online: tags.ok,
    model,
    modelReady,
  };
}

// --- Piezas comunes a las dos salidas ---

export interface DirectoryRow {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly syncedAt: string | null;
  readonly lastErrorAt: string | null;
  readonly stale: boolean;
}

/** `sourceRows` de systemHealth (server.js:4627-4634). */
export function directoryRows(state: Readonly<StateV1>, now: number): DirectoryRow[] {
  return state.webSources.map((source) => ({
    id: source.id,
    name: source.name,
    count: source.streams.length,
    syncedAt: source.syncedAt,
    lastErrorAt: source.lastErrorAt,
    stale:
      !source.syncedAt || now - Date.parse(source.syncedAt) > WEB_SYNC_INTERVAL_MS * STALE_FACTOR,
  }));
}

export function directoriesStatus(rows: readonly DirectoryRow[]): 'ready' | 'degraded' | 'empty' {
  return rows.some((row) => row.lastErrorAt && row.stale)
    ? 'degraded'
    : rows.length
      ? 'ready'
      : 'empty';
}

/** `reports` de systemHealth (server.js:4660-4664). */
export function reportCounts(
  state: Readonly<StateV1>,
  now: number,
): LegacyHealthResponse['reports'] {
  return {
    total: state.sourceReports.length,
    quarantined: state.sourceReports.filter(
      (report) => Date.parse(report.quarantineUntil || '') > now,
    ).length,
    learningCount: state.channelFeedback.length,
  };
}

const EMPTY_SCANNER: ScannerStatsWithOnline = {
  enabled: false,
  busy: false,
  queue: 0,
  activeJobs: 0,
  cachedSources: 0,
  leakedSessionsLastHour: 0,
};

const EMPTY_AGENDA: Agenda = { status: 'warming', generatedAt: null, matches: 0, preheated: 0 };

export function unknownEngineStatus(): EngineStatus {
  return {
    status: 'unknown',
    online: false,
    since: null,
    checkedAt: null,
    engineVersion: null,
    autoRestarts: {
      lastHour: 0,
      max: ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
      nextAllowedAt: null,
      exhausted: false,
    },
  };
}

const ZERO_COUNTS: Readonly<Record<DiagnosticCause, number>> = {
  engine: 0,
  source: 0,
  network: 0,
  codec: 0,
  client: 0,
  state: 0,
};

export function createHealthService(deps: HealthDeps): HealthService {
  const { config, clock, logger } = deps;
  const startedAt = clock.now();
  const probes = deps.probes ?? defaultProbes(deps);
  const model = config.ai.embedModel;

  const aiProbe = cachedProbe<LegacyAi>(
    clock,
    HEALTH_PROBE_TTL_MS,
    Math.min(TIMEOUTS.ollamaHealthMs, config.ai.timeoutMs),
    async (signal) => aiFromTags(model, await probes.ollamaTags(signal)),
    () => ({ status: 'offline', online: false, model, modelReady: false }),
  );
  const scannerProbe = cachedProbe<boolean>(
    clock,
    HEALTH_PROBE_TTL_MS,
    TIMEOUTS.engineVersionMs,
    (signal) => probes.scannerVersion(signal),
    () => false,
  );

  /* Lee de un servicio sin dejar que su fallo tumbe la salud. */
  function read<T>(part: string, warnings: Warning[], reader: () => T, fallback: T): T {
    try {
      return reader();
    } catch (error) {
      logger.warn({ err: error, part }, 'salud: parte no disponible');
      warnings.push({ code: 'component_unavailable', message: `Sin datos de ${part}.` });
      return fallback;
    }
  }

  async function scannerOnline(stats: ScannerStatsWithOnline): Promise<boolean> {
    if (!config.scanner.enabled) return false;
    if (typeof stats.online === 'boolean') return stats.online;
    return scannerProbe.get();
  }

  async function aiInfo(agenda: FootballHealthWithAi | null): Promise<LegacyAi> {
    if (!config.ai.enabled) return { status: 'disabled', online: false, model };
    const fromFootball = agenda?.ai;
    if (fromFootball) {
      return {
        status: fromFootball.status,
        online: fromFootball.status === 'ready' || fromFootball.status === 'model_missing',
        model,
        modelReady: fromFootball.modelReady ?? fromFootball.status === 'ready',
      };
    }
    return aiProbe.get();
  }

  /** Todo lo que comparten las dos salidas, leído una sola vez. */
  async function snapshot() {
    const warnings: Warning[] = [];
    const date = clock.date();
    const now = date.getTime();
    const state = read('estado', warnings, () => deps.state.get(), null);
    const engine = read('motor', warnings, () => deps.engine.status(), unknownEngineStatus());
    const scanner = read(
      'comprobador',
      warnings,
      () => deps.scanner.stats() as ScannerStatsWithOnline,
      EMPTY_SCANNER,
    );
    const football = read(
      'agenda',
      warnings,
      () => deps.football.healthInfo() as FootballHealthWithAi,
      null,
    );
    const [online, ai] = await Promise.all([scannerOnline(scanner), aiInfo(football)]);
    const rows = state ? directoryRows(state, now) : [];
    const reports = state
      ? reportCounts(state, now)
      : { total: 0, quarantined: 0, learningCount: 0 };
    return { warnings, date, now, engine, scanner, online, ai, football, rows, reports };
  }

  function agendaOf(football: FootballHealthWithAi | null): Agenda {
    if (!football) return EMPTY_AGENDA;
    return {
      status: football.status,
      generatedAt: football.generatedAt,
      matches: football.matches,
      preheated: football.preheated,
    };
  }

  const service: HealthService = {
    ping(): PingResponse {
      return {
        ok: true,
        app: 'ace-player-neo',
        version: config.appVersion,
        apiVersion: 1,
        serverTime: clock.now(),
      };
    },

    live(): HealthLiveResponse {
      return { ok: true };
    },

    async legacyHealth(): Promise<LegacyHealthResponse> {
      const { date, now, engine, scanner, online, ai, football, rows, reports } = await snapshot();
      const scannerStatus = !config.scanner.enabled ? 'disabled' : online ? 'ready' : 'offline';
      return {
        success: true,
        version: config.appVersion,
        checkedAt: date.toISOString(),
        uptimeSeconds: Math.max(0, Math.round((now - startedAt) / 1000)),
        components: {
          backend: { status: 'ready', online: true },
          engine: engine.online
            ? { status: 'ready', online: true }
            : { status: 'offline', online: false },
          scanner: {
            status: scannerStatus,
            online,
            busy: scanner.busy,
            queue: scanner.queue,
            activeJobs: scanner.activeJobs,
            cachedSources: scanner.cachedSources,
          },
          ai,
          agenda: agendaOf(football),
          directories: {
            status: directoriesStatus(rows),
            total: rows.length,
            channels: rows.reduce((sum, row) => sum + row.count, 0),
            sources: rows,
          },
        },
        reports,
      };
    },

    async health(): Promise<HealthResponse> {
      const { warnings, date, now, engine, scanner, online, ai, football, rows, reports } =
        await snapshot();
      const load = read('estado', warnings, () => deps.state.loadReport(), null);
      const playback = read('reproducción', warnings, () => deps.playback.status(), null);
      const remux = read('remux', warnings, () => deps.remux.stats(), { sessions: 0, max: 0 });
      const connections = read('eventos', warnings, () => deps.events.connections(), 0);
      const counts24h = read(
        'diagnóstico',
        warnings,
        () => deps.diagnostics.counts24h(),
        ZERO_COUNTS,
      );

      const scannerStatus = !config.scanner.enabled
        ? 'disabled'
        : !online
          ? 'offline'
          : scanner.leakedSessionsLastHour > 0
            ? 'degraded'
            : 'ready';
      if (engine.autoRestarts.exhausted) {
        warnings.push({
          code: 'engine_restart_quota',
          message:
            'El motor ya se ha reiniciado solo 3 veces en la última hora: no se reintenta más.',
        });
      }
      if (scanner.leakedSessionsLastHour > 0) {
        warnings.push({
          code: 'scanner_leaked_sessions',
          message: `El comprobador no pudo cerrar ${scanner.leakedSessionsLastHour} sesiones en la última hora.`,
        });
      }
      if (load?.status === 'recovered') {
        warnings.push({
          code: 'state_recovered',
          message: `El estado guardado se recuperó de la copia ${load.recoveredFrom ?? 'anterior'}.`,
        });
      } else if (load?.status === 'degraded') {
        warnings.push({
          code: 'state_unreadable',
          message:
            'No se pudo leer ninguna copia del estado: se arrancó vacío y los ficheros quedan apartados.',
        });
      }
      if (ai.status === 'model_missing') {
        warnings.push({ code: 'ai_model_missing', message: `Falta el modelo ${model} en Ollama.` });
      }

      const sessions = playback?.sessions ?? [];
      return {
        version: config.appVersion,
        checkedAt: date.toISOString(),
        uptimeSeconds: Math.max(0, Math.round((now - startedAt) / 1000)),
        components: {
          backend: { status: 'ready' },
          engine,
          scanner: {
            status: scannerStatus,
            busy: scanner.busy,
            queue: scanner.queue,
            activeJobs: scanner.activeJobs,
            cachedSources: scanner.cachedSources,
            leakedSessionsLastHour: scanner.leakedSessionsLastHour,
          },
          ai: { status: ai.status, model },
          agenda: agendaOf(football),
          directories: {
            status: directoriesStatus(rows),
            total: rows.length,
            channels: rows.reduce((sum, row) => sum + row.count, 0),
          },
          state: {
            status: !load || load.status === 'fresh' ? 'ready' : load.status,
            recoveredFrom: load?.recoveredFrom ?? null,
          },
          playback: {
            sessions: sessions.length,
            viewers: sessions.reduce((sum, session) => sum + session.viewers.length, 0),
            remuxSessions: remux.sessions,
          },
          events: { connections },
        },
        reports,
        diagnostics: { counts24h: { ...ZERO_COUNTS, ...counts24h } },
        warnings,
      };
    },
  };

  return service;
}
