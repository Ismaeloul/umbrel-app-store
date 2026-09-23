/* Fábrica del módulo `directories` (directorios M3U/HTML/IPFS y su
   sincronización, arquitectura §5.11; B-191 a B-198).

   Porta `POST /api/streams/{sync,activate,delete}` (server.js:4960-5027),
   `anotarFalloDeDirectorio` y `autoSyncWeb` (server.js:5082-5126),
   `refrescarListasSiTocan` (server.js:4143-4157) y el temporizador de 3 h
   (server.js:5141, 5159). Lo nuevo (backend-modulos §8.2.6 y §8.2.7):

   - UN cerrojo (cola FIFO) para todas las descargas: arranque, periódica,
     la de la resolución y la manual. La automática lo toma directorio a
     directorio, así que una manual espera como mucho al directorio en curso.
   - El resultado de una descarga automática solo se aplica si la URL y el
     tipo del directorio no cambiaron mientras tanto.
   - Espera exponencial (5 min → 3 h) para un directorio que falla siempre:
     deja de relanzarse en cada resolución.
   - El motivo del último fallo se guarda en el directorio (la tarjeta lo
     enseña) y un fallo automático va también al registro de diagnóstico. */

import { promises as dns } from 'node:dns';
import {
  MAX_WEB_SOURCES,
  MAX_WEB_STREAMS,
  errorMessage,
  motivoDeFallo,
  type DirectoryView,
  type Item,
  type LegacyDirectoryResponse,
  type StateV1,
  type WebSource,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { createDirectoryFetcher } from './fetcher.js';
import { normalizeItems, normalizeWebSource, normalizeWebUrl } from './normalize.js';
import { parseHtml, parseM3u, type ParsedStream } from './parsers.js';
import type { DirectoriesDeps, DirectoriesService, SyncReason } from './types.js';

export type * from './types.js';

const MINUTE = 60 * 1000;

/** Sincronización periódica (server.js:55). */
export const WEB_SYNC_INTERVAL_MS = 3 * 60 * MINUTE;
/** Una lista más vieja que esto se refresca al resolver un partido (server.js:4143). */
export const WEB_SYNC_ON_RESOLVE_MS = 30 * MINUTE;
/** Espera exponencial de un directorio que falla: 5 min, 10, 20… (nuevo, §8.2.7). */
export const DIRECTORY_RETRY_BASE_MS = 5 * MINUTE;
/** ...hasta 3 h, la misma cadencia que la periódica. */
export const DIRECTORY_RETRY_MAX_MS = WEB_SYNC_INTERVAL_MS;

const SCOPES = { scopes: ['directories'] as const };

/** Cola FIFO: cada tarea empieza cuando acaba la anterior (falle o no). */
function createLock(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

interface FailureRecord {
  /** `tipo|url` que falló: si cambian, la cuenta vuelve a empezar. */
  readonly key: string;
  readonly count: number;
  readonly retryAt: number;
}

const failureKey = (source: Pick<WebSource, 'url' | 'type'>): string =>
  `${source.type}|${source.url}`;

export function createDirectoriesService(deps: DirectoriesDeps): DirectoriesService {
  const { config, clock, logger, bus, state } = deps;
  const random = deps.random ?? Math.random;
  const fetcher = createDirectoryFetcher({
    net: deps.net,
    logger,
    resolveTxt: deps.resolveTxt ?? ((hostname) => dns.resolveTxt(hostname)),
    delegatedRouting: config.sync.ipfsDelegatedRouting,
    trustlessGateway: config.sync.ipfsTrustlessGateway,
  });
  const lock = createLock();
  const failures = new Map<string, FailureRecord>();
  let autoRun: Promise<void> | null = null;
  let timer: TimerHandle | null = null;
  let started = false;
  let lifecycle = new AbortController();

  const nowIso = (): string => clock.date().toISOString();
  const normalizeContext = () => ({ defaultUrl: config.sync.defaultWebSyncUrl, now: clock.date() });

  function parse(type: WebSource['type'], text: string): ParsedStream[] {
    return (type === 'html' ? parseHtml(text) : parseM3u(text)).slice(0, MAX_WEB_STREAMS);
  }

  /* Descarga y parsea (server.js:4975-4977 y 5096-5098). */
  async function download(url: string, type: WebSource['type']): Promise<ParsedStream[]> {
    const text = await fetcher.fetchDirectoryText(url, lifecycle.signal);
    const streams = parse(type, text);
    if (!streams.length) throw new AppError('empty_directory');
    return streams;
  }

  /* Deja el estado como lo dejaba writeState: `web` y `webSyncedAt` son los
     del directorio activo, y el activo existe (server.js:1068-1086). */
  function commit(draft: StateV1, webSources: WebSource[], activeId?: string): void {
    draft.webSources = webSources;
    const wanted = activeId ?? draft.activeWebSourceId;
    const active = webSources.find((source) => source.id === wanted) ?? webSources[0];
    if (!active) return;
    draft.activeWebSourceId = active.id;
    draft.web = active.streams;
    draft.webSyncedAt = active.syncedAt;
  }

  function noteFailure(source: Pick<WebSource, 'id' | 'url' | 'type'>): void {
    const key = failureKey(source);
    const previous = failures.get(source.id);
    const count = previous && previous.key === key ? previous.count + 1 : 1;
    const delay = Math.min(DIRECTORY_RETRY_BASE_MS * 2 ** (count - 1), DIRECTORY_RETRY_MAX_MS);
    failures.set(source.id, { key, count, retryAt: clock.now() + delay });
  }

  /* ¿Le toca refrescarse al resolver? Más de 30 min sin sincronizar
     (server.js:4149-4153) y sin espera exponencial pendiente. */
  function isDue(source: WebSource): boolean {
    const now = clock.now();
    const marca = source.syncedAt ? Date.parse(source.syncedAt) : 0;
    const stale = !Number.isFinite(marca) || now - marca > WEB_SYNC_ON_RESOLVE_MS;
    if (!stale) return false;
    const failure = failures.get(source.id);
    if (!failure || failure.key !== failureKey(source)) return true;
    return now >= failure.retryAt;
  }

  /* `anotarFalloDeDirectorio` (server.js:5082-5089): el directorio conserva
     sus canales y apunta cuándo y por qué falló. */
  async function anotarFallo(sourceId: string, error: unknown): Promise<void> {
    await state.enqueue((draft) => {
      const webSources = draft.webSources.map((source) =>
        source.id === sourceId
          ? { ...source, lastErrorAt: nowIso(), lastError: motivoDeFallo(error) }
          : source,
      );
      commit(draft, webSources);
    }, SCOPES);
  }

  /* Un directorio guardado, dentro del cerrojo (autoSyncWeb, server.js:5093-5125). */
  async function syncSaved(sourceId: string): Promise<void> {
    const source = state.get().webSources.find((item) => item.id === sourceId);
    if (!source) return;
    const { url, type, name } = source;
    let update: Record<string, unknown>;
    try {
      const streams = await download(url, type);
      update = { streams, syncedAt: nowIso(), lastErrorAt: null, lastError: null };
      failures.delete(sourceId);
      logger.info({ source: name, count: streams.length }, '[auto-sync] directorio actualizado');
    } catch (error) {
      if (lifecycle.signal.aborted) return; // apagado: no es un fallo del directorio
      const code = motivoDeFallo(error);
      update = { lastErrorAt: nowIso(), lastError: code };
      noteFailure(source);
      logger.warn({ source: name, errorCode: code, err: error }, '[auto-sync] falló un directorio');
      bus.emit('diagnostics.report', {
        cause: 'network',
        code,
        message: `Directorio «${name}»: ${errorMessage(code)}`,
      });
    }
    await state.enqueue((draft) => {
      const index = draft.webSources.findIndex((item) => item.id === sourceId);
      const current = draft.webSources[index];
      /* Solo si nadie cambió la URL ni el tipo mientras se descargaba. */
      if (!current || current.url !== url || current.type !== type) return;
      const next = normalizeWebSource({ ...current, ...update }, index, normalizeContext());
      if (!next) return;
      commit(
        draft,
        draft.webSources.map((item, position) => (position === index ? next : item)),
      );
    }, SCOPES);
  }

  function autoSync(reason: SyncReason): Promise<void> {
    /* AUTO_SYNC=false: los tests no tienen por qué salir a internet (server.js:5092). */
    if (reason !== 'manual' && !config.sync.autoSync) return Promise.resolve();
    if (autoRun) return autoRun;
    const run = (async () => {
      const sources = state.get().webSources;
      const targets = reason === 'resolution' ? sources.filter(isDue) : sources;
      for (const target of targets) {
        if (lifecycle.signal.aborted) break;
        await lock(() => syncSaved(target.id));
      }
    })().finally(() => {
      autoRun = null;
    });
    autoRun = run;
    return run;
  }

  const logRunFailure =
    (reason: SyncReason) =>
    (error: unknown): void => {
      logger.error({ reason, err: error }, '[auto-sync] la sincronización falló');
    };

  function directoryView(): DirectoryView {
    const { web, webSyncedAt, webSources, activeWebSourceId } = state.directoryResponse();
    return { web, webSyncedAt, webSources, activeWebSourceId };
  }

  function normalized(streams: ParsedStream[]): Item[] {
    return normalizeItems(streams.slice(0, MAX_WEB_STREAMS), 'web', MAX_WEB_STREAMS, clock.date());
  }

  return {
    async start() {
      if (started) return;
      started = true;
      lifecycle = new AbortController();
      if (!config.sync.autoSync) return;
      timer = clock.setInterval(
        () => void autoSync('periodic').catch(logRunFailure('periodic')),
        WEB_SYNC_INTERVAL_MS,
        { unref: true },
      );
      void autoSync('startup').catch(logRunFailure('startup'));
    },

    async stop() {
      if (!started) return;
      started = false;
      clock.clearInterval(timer);
      timer = null;
      lifecycle.abort(new Error('directories_stopped'));
      await autoRun?.catch(() => undefined);
      await lock(async () => undefined);
    },

    view: directoryView,

    /* POST /api/streams/sync (server.js:4960-5008). */
    async sync(rawBody): Promise<LegacyDirectoryResponse> {
      const body: Record<string, unknown> = isRecord(rawBody) ? rawBody : {};
      const type: WebSource['type'] = body.type === 'html' ? 'html' : 'm3u';
      const url = normalizeWebUrl(body.url);
      if (!url) throw new AppError('bad_url');
      const requestedSourceId = String(body.sourceId || '');
      const pick = (sources: readonly WebSource[]): WebSource | undefined => {
        const source = requestedSourceId
          ? sources.find((item) => item.id === requestedSourceId)
          : sources.find((item) => item.url === url && item.type === type);
        if (requestedSourceId && !source) throw new AppError('source_not_found');
        if (!source && sources.length >= MAX_WEB_SOURCES) throw new AppError('source_limit');
        return source;
      };
      pick(state.get().webSources); // falla pronto, sin esperar al cerrojo

      await lock(async () => {
        const snapshotSource = pick(state.get().webSources);
        let streams: ParsedStream[];
        try {
          streams = await download(url, type);
        } catch (error) {
          // un directorio ya guardado conserva su caché y apunta el motivo
          if (snapshotSource) {
            await anotarFallo(snapshotSource.id, error);
            if (snapshotSource.url === url && snapshotSource.type === type) {
              noteFailure(snapshotSource);
            }
          }
          throw error;
        }
        /* La descarga puede tardar: se relee dentro de la cola del estado para
           no pisar favoritos, historial ni cambios de otro dispositivo. */
        const syncedAt = nowIso();
        const id = await state.enqueue((draft) => {
          const source = pick(draft.webSources);
          const id =
            source?.id ||
            `directorio-${clock.now().toString(36)}-${random().toString(36).slice(2, 7)}`;
          const synced = normalizeWebSource(
            {
              ...source,
              id,
              name: body.name || source?.name,
              url,
              type,
              streams,
              syncedAt,
              lastErrorAt: null,
              lastError: null,
            },
            draft.webSources.length,
            normalizeContext(),
          );
          if (!synced) throw new AppError('bad_url');
          const webSources = source
            ? draft.webSources.map((item) => (item.id === source.id ? synced : item))
            : [...draft.webSources, synced];
          commit(draft, webSources, id);
          return id;
        }, SCOPES);
        failures.delete(id);
      });
      return state.directoryResponse();
    },

    /* POST /api/streams/activate (server.js:5010-5016). */
    async activate(sourceId) {
      await state.enqueue((draft) => {
        if (!draft.webSources.some((source) => source.id === sourceId)) {
          throw new AppError('source_not_found');
        }
        commit(draft, draft.webSources, sourceId);
      }, SCOPES);
      return state.directoryResponse();
    },

    /* POST /api/streams/delete (server.js:5018-5027): nunca el último; si
       era el activo, pasa a activo el primero que quede. */
    async remove(sourceId) {
      await state.enqueue((draft) => {
        if (!draft.webSources.some((source) => source.id === sourceId)) {
          throw new AppError('source_not_found');
        }
        if (draft.webSources.length <= 1) throw new AppError('last_source');
        const webSources = draft.webSources.filter((source) => source.id !== sourceId);
        const activeId =
          draft.activeWebSourceId === sourceId ? webSources[0]!.id : draft.activeWebSourceId;
        commit(draft, webSources, activeId);
      }, SCOPES);
      failures.delete(sourceId);
      return state.directoryResponse();
    },

    autoSync,

    /* `refrescarListasSiTocan` (server.js:4146-4157): sin esperar, una sola a la vez. */
    refreshStaleInBackground() {
      if (!config.sync.autoSync || autoRun) return;
      if (!state.get().webSources.some(isDue)) return;
      void autoSync('resolution').catch(logRunFailure('resolution'));
    },

    parseM3u: (text) => normalized(parseM3u(text)),
    parseHtml: (text) => normalized(parseHtml(text)),
  };
}
