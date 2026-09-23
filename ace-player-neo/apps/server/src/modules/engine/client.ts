/* Cliente HTTP del motor AceStream principal (arquitectura §5.5).

   Cada llamada tiene su plazo de `TIMEOUTS` y el tope de 512 KiB, y las URL
   que devuelve el motor se reducen a ruta relativa (`engineRelativePath`).
   Los errores se traducen al catálogo:

   | Llamada        | Plazo  | Vence            | Sin conexión / fuera de 2xx | JSON raro             |
   |----------------|--------|------------------|-----------------------------|-----------------------|
   | `openSession`  | 12 s   | `engine_timeout` | `engine_unavailable`        | `engine_bad_response` |
   | `getStat`      | 3 s    | `engine_timeout` | `engine_unavailable`        | `engine_bad_response` |
   | `stop`         | 2,5 s  | nunca lanza: se anota en diagnóstico                                   |
   | `version`      | 3 s    | `engine_timeout` | `engine_unavailable`        | `engine_bad_response` |
   | `searchRaw`    | 12 s   | `ace_timeout`    | `engine_unavailable`        | (lo interpreta search)|

   `searchRaw` conserva los códigos de `searchAceStreams` (server.js:3642-3653):
   el plazo vencido es `ace_timeout` (400 en las rutas antiguas) y no
   `engine_timeout`. Un cuerpo de más de 512 KiB es `engine_bad_response`.

   El cliente cuenta lo que ve de las estadísticas al vigilante
   (`EngineClientObserver`): así detecta un motor que responde a
   `get_version` pero no entrega datos (arquitectura §5.5). */

import { ENGINE_MAX_BODY_BYTES, HASH_RE, TIMEOUTS, type AnyErrorCode } from '@ace/shared';
import type { DomainBus } from '../../core/bus.js';
import type { Clock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { EngineHttpError, engineHttp, type EngineHttpResponse } from './http.js';
import { engineRelativePath, engineStopPath } from './paths.js';
import type { EngineClient, EngineSessionMeta, EngineStat, OpenSessionRequest } from './types.js';

/** Lo que el vigilante quiere saber de las estadísticas que pasan por el cliente. */
export interface EngineClientObserver {
  /** Una estadística leída bien (`key` = la ruta de `stat_url`). */
  onStat(key: string, stat: EngineStat): void;
  /** `stat_url` no respondió a tiempo: el motor no entrega ni sus propias estadísticas. */
  onStatTimeout(key: string): void;
}

export interface EngineClientOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly bus: DomainBus;
  /** `http://host:6878` sin barra final. */
  readonly baseUrl: string;
  readonly observer?: EngineClientObserver;
}

/** Resultado de `get_version` para el vigilante: nunca lanza. */
export interface VersionProbe {
  /** 2xx, como `online` en /api/engine/status (server.js:4952). */
  readonly ok: boolean;
  /** Cuerpo de la respuesta si la hubo ('' si no llegó a responder). */
  readonly raw: string;
  readonly version: string | null;
  readonly failure: 'timeout' | 'network' | 'too_large' | 'http' | null;
}

export const VERSION_PATH = '/webui/api/service?method=get_version';

/** Número finito y no negativo, o el valor por defecto. */
function nonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/* Fallo de transporte → código del catálogo. `timeoutCode` cambia según la
   llamada (search conserva `ace_timeout`). Lo que no es EngineHttpError es
   el motivo de la señal de quien llama: se relanza tal cual. */
function transportError(error: unknown, timeoutCode: AnyErrorCode, what: string): unknown {
  if (!(error instanceof EngineHttpError)) return error;
  switch (error.kind) {
    case 'timeout':
      return new AppError(timeoutCode, { detail: `${what}: sin respuesta a tiempo`, cause: error });
    case 'too_large':
      return new AppError('engine_bad_response', {
        detail: `${what}: respuesta de más de ${ENGINE_MAX_BODY_BYTES} bytes`,
      });
    default:
      return new AppError('engine_unavailable', { detail: `${what}: sin conexión`, cause: error });
  }
}

function expectOk(response: EngineHttpResponse, what: string): void {
  if (response.status < 200 || response.status >= 300) {
    throw new AppError('engine_unavailable', { detail: `${what}: HTTP ${response.status}` });
  }
}

/* Errores de la meta que da el motor con `{"response": null, "error": "…"}`
   (motor-real §1; el motor falso los emula). Un id mal formado es un fallo
   nuestro; "failed to load content" y el resto son de la fuente. */
function metaErrorCode(message: string): AnyErrorCode {
  return /missing content id|invalid content id/i.test(message) ? 'bad_request' : 'source_no_peers';
}

export function createEngineClient(options: EngineClientOptions): EngineClient & {
  probeVersion(signal?: AbortSignal): Promise<VersionProbe>;
} {
  const { clock, logger, bus, baseUrl, observer } = options;

  const get = (
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<EngineHttpResponse> =>
    engineHttp(clock, {
      url: `${baseUrl}${path}`,
      timeoutMs,
      maxBytes: ENGINE_MAX_BODY_BYTES,
      ...(signal ? { signal } : {}),
    });

  async function openSession(request: OpenSessionRequest): Promise<EngineSessionMeta> {
    const hash = String(request.hash || '')
      .trim()
      .toLowerCase();
    if (!HASH_RE.test(hash)) throw new AppError('bad_request', { detail: 'hash no válido' });
    /* B-001: `infohash=` para lo que viene del buscador y `id=` para el resto.
       Siempre `format=json` para tener `command_url` (B-002, B-003). */
    const param = request.kind === 'infohash' ? 'infohash' : 'id';
    const endpoint = request.mode === 'hls' ? '/ace/manifest.m3u8' : '/ace/getstream';
    let response: EngineHttpResponse;
    try {
      response = await get(
        `${endpoint}?${param}=${hash}&format=json`,
        TIMEOUTS.engineSessionMetaMs,
        request.signal,
      );
    } catch (error) {
      throw transportError(error, 'engine_timeout', 'meta de sesión');
    }
    expectOk(response, 'meta de sesión');
    const json = parseJson(response.body);
    if (!isRecord(json)) throw new AppError('engine_bad_response', { detail: 'meta sin JSON' });
    const meta = json.response;
    if (!isRecord(meta)) {
      const message = typeof json.error === 'string' ? json.error : '';
      if (message) throw new AppError(metaErrorCode(message), { detail: `motor: ${message}` });
      throw new AppError('engine_bad_response', { detail: 'meta sin response' });
    }
    const playbackUrl = engineRelativePath(meta.playback_url);
    const statUrl = engineRelativePath(meta.stat_url);
    const commandUrl = engineRelativePath(meta.command_url);
    if (!playbackUrl || !statUrl || !commandUrl) {
      throw new AppError('engine_bad_response', { detail: 'meta sin URL del motor' });
    }
    const infohash =
      typeof meta.infohash === 'string' && HASH_RE.test(meta.infohash)
        ? meta.infohash.toLowerCase()
        : null;
    const live = meta.is_live;
    const isLive = live === 1 || live === true ? true : live === 0 || live === false ? false : null;
    return { playbackUrl, statUrl, commandUrl, infohash, isLive };
  }

  async function getStat(statUrl: string, signal?: AbortSignal): Promise<EngineStat> {
    const path = engineRelativePath(statUrl);
    if (!path) throw new AppError('bad_request', { detail: 'stat_url no es del motor' });
    let response: EngineHttpResponse;
    try {
      response = await get(path, TIMEOUTS.engineStatMs, signal);
    } catch (error) {
      if (error instanceof EngineHttpError && error.kind === 'timeout')
        observer?.onStatTimeout(path);
      throw transportError(error, 'engine_timeout', 'estadística');
    }
    expectOk(response, 'estadística');
    const json = parseJson(response.body);
    if (!isRecord(json)) throw new AppError('engine_bad_response', { detail: 'stat sin JSON' });
    const data = json.response;
    if (!isRecord(data)) {
      /* "unknown playback session id": la sesión ya no existe en el motor
         (caducó, se paró o el motor se reinició). */
      const message = typeof json.error === 'string' ? json.error : 'sin response';
      throw new AppError('session_expired', { detail: `motor: ${message}` });
    }
    const stat: EngineStat = {
      status: typeof data.status === 'string' ? data.status : '',
      peers: nonNegative(data.peers, 0),
      speedDown: nonNegative(data.speed_down, 0),
      speedUp: nonNegative(data.speed_up, 0),
      downloaded:
        typeof data.downloaded === 'number' &&
        Number.isFinite(data.downloaded) &&
        data.downloaded >= 0
          ? data.downloaded
          : null,
    };
    observer?.onStat(path, stat);
    return stat;
  }

  async function stop(commandUrl: string): Promise<void> {
    const path = engineStopPath(commandUrl);
    let problem: string | null = null;
    if (!path) {
      problem = 'command_url no es del motor';
    } else {
      try {
        const response = await get(path, TIMEOUTS.engineStopMs);
        const json = parseJson(response.body);
        const answer = isRecord(json) ? json : {};
        const unknownSession =
          typeof answer.error === 'string' && /unknown playback session/i.test(answer.error);
        /* `{"response": "ok"}`; si el motor ya no la conoce, ya está cerrada. */
        if (response.status < 200 || response.status >= 300) problem = `HTTP ${response.status}`;
        else if (answer.response !== 'ok' && !unknownSession) problem = 'respuesta inesperada';
      } catch (error) {
        problem =
          error instanceof EngineHttpError && error.kind === 'timeout'
            ? 'sin respuesta a tiempo'
            : 'sin conexión';
      }
    }
    if (problem === null) return;
    logger.warn(
      { errorCode: 'engine_stop_failed', problem },
      'no se pudo parar una sesión del motor',
    );
    bus.emit('diagnostics.report', {
      cause: 'engine',
      code: 'engine_stop_failed',
      message: `No se pudo cerrar una sesión del motor (${problem}): puede quedar una descarga zombi.`,
    });
  }

  async function probeVersion(signal?: AbortSignal): Promise<VersionProbe> {
    let response: EngineHttpResponse;
    try {
      response = await get(VERSION_PATH, TIMEOUTS.engineVersionMs, signal);
    } catch (error) {
      if (!(error instanceof EngineHttpError)) throw error;
      return { ok: false, raw: '', version: null, failure: error.kind };
    }
    const ok = response.status >= 200 && response.status < 300;
    const json = parseJson(response.body);
    const result = isRecord(json) && isRecord(json.result) ? json.result : null;
    const version = result && typeof result.version === 'string' ? result.version : null;
    return { ok, raw: response.body, version, failure: ok ? null : 'http' };
  }

  async function version(signal?: AbortSignal): Promise<string> {
    const probe = await probeVersion(signal);
    if (probe.failure === 'timeout')
      throw new AppError('engine_timeout', { detail: 'get_version' });
    if (probe.failure === 'too_large')
      throw new AppError('engine_bad_response', { detail: 'get_version' });
    if (!probe.ok) throw new AppError('engine_unavailable', { detail: 'get_version' });
    if (probe.version === null)
      throw new AppError('engine_bad_response', { detail: 'get_version sin versión' });
    return probe.version;
  }

  async function searchRaw(query: string, signal?: AbortSignal): Promise<string> {
    let response: EngineHttpResponse;
    try {
      /* server.js:3643: la misma consulta y el mismo tamaño de página. */
      response = await get(
        `/search?query=${encodeURIComponent(query)}&page_size=60`,
        TIMEOUTS.engineSearchMs,
        signal,
      );
    } catch (error) {
      throw transportError(error, 'ace_timeout', 'búsqueda');
    }
    expectOk(response, 'búsqueda');
    return response.body;
  }

  return { openSession, getStat, stop, version, searchRaw, probeVersion };
}
