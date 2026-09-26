/* Gestor del remux: ffmpeg a HLS fMP4 para el iPhone (arquitectura §5.7;
   backend-modulos §3.16; B-217 a B-226).

   Es `ensureRemux` y compañía de la 0.6.59 (server.js:174-337, 4886-4939)
   con lo que pide la v2:
   - la entrada es la `playbackUrl` de la sesión del backend (nunca un
     `getstream` propio); si la sesión cambia de URL (pasa a HLS o se reabre
     tras un reinicio del motor), ffmpeg se relanza con los mismos visores;
   - como mucho 3 sesiones y NUNCA se expulsa a un espectador (503
     `remux_busy`, T-112);
   - grupo de procesos, nice 10, log en un búfer de 64 KiB y huérfanos;
   - espera del arranque (3 segmentos y la distancia que pide el reproductor,
     `max(4 s, 3 × TARGETDURATION + 1 s)`, o 1 segmento pasados 20 s; 45 s
     como máximo; docs/multidispositivo.md §4.3) sin `readFileSync` cada
     400 ms: vigila la carpeta y relee sin bloquear, y se corta si el cliente
     cuelga;
   - `EXT-X-TARGETDURATION` fijado al quedar lista la lista y servido igual en
     las tres formas de entregarla (con token, sin token y `/remux/`); las
     listas de `/remux/` llevan además `EXT-X-START` con los 6 s de antes;
   - IPTV: plazo desde el primer byte entregado a ffmpeg, tope desde que se
     abrió el relé y, si el análisis corto (2 MB / 2 s) no encuentra los
     parámetros, UN reinicio con 5 MB / 5 s sin soltar la conexión con el
     proveedor (el relé se prepara antes, §4.5);
   - reengancharse a la misma sesión reutiliza el ffmpeg vivo (P9);
   - sin ffmpeg, `ffmpeg_missing` y el resto sigue funcionando.

   Todas las altas y bajas del registro pasan por una cola en serie: nunca
   hay dos ffmpeg para el mismo canal ni se borra la carpeta de uno nuevo. */

import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  HASH_RE,
  IPTV_REMUX_OPEN_MAX_MS,
  IPTV_REMUX_READY_MS,
  MAX_REMUX_SESSIONS,
  REMUX_TIMINGS,
  TIMEOUTS,
  normalizeHash,
  remuxReadySeconds,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { redactText } from '../../core/logger.js';
import { buildRemuxArgs } from './args.js';
import { elegirSesionRemuxADesalojar, type EvictionCandidate } from './eviction.js';
import {
  initialTargetDuration,
  parseByteRange,
  pinTargetDuration,
  playlistStatsFromText,
  rewritePlaylist,
  segmentSpread,
  sendBare,
  sendBuffer,
  sendFile,
  withStartOffset,
  type FileObservation,
  type SegmentSpread,
} from './files.js';
import { SerialLock } from './lock.js';
import { RingLog, createSpawnLauncher, findOrphanPids, killProcessTree } from './process.js';
import type {
  RemuxCloseReason,
  RemuxDeps,
  RemuxHandle,
  RemuxListener,
  RemuxProcess,
  RemuxService,
  RemuxSource,
} from './types.js';

/** Relectura de la lista mientras se espera el arranque si `fs.watch` no avisa. */
export const READY_POLL_MS = 1000;

/** Ficheros que genera ffmpeg y que sirve /api/v1/video (nunca un log). */
const VIDEO_FILE_RE = /^(?:index\.m3u8|init\.mp4|index\d{1,9}\.m4s)$/;

const LEGACY_PREFIX = '/remux/';

interface LegacyClient {
  readonly token: string;
  readonly viewerId: string;
}

interface Entry {
  readonly hash: string;
  readonly sessionId: string;
  readonly playbackUrl: string;
  /** Lo que identifica la entrada: la URL del relé (IPTV) o la `playbackUrl`. */
  readonly inputKey: string;
  /** La fuente con la que se lanzó (para reiniciar en la misma sesión). */
  readonly source: RemuxSource;
  readonly origin: 'engine' | 'iptv';
  readonly dir: string;
  readonly startedAt: number;
  lastAccess: number;
  /** Última vez que se vio cambiar la lista (para `remuxStalled`). */
  lastChangeAt: number;
  observed: string | null;
  proc: RemuxProcess | null;
  exited: boolean;
  exitCode: number | null;
  /** Lo matamos nosotros (no es una muerte que haya que diagnosticar). */
  killed: boolean;
  closed: boolean;
  /** `spawn` dio ENOENT: no hay ffmpeg. */
  missing: boolean;
  ready: boolean;
  /** Visores de la app nativa (v1). */
  readonly viewers: Set<string>;
  /** Clientes 0.6.x con su ficha (`clients` de server.js:322). */
  readonly legacyClients: Map<string, LegacyClient>;
  /** Visores 0.6.x sin `dev` o soltados con `keepAlive`: no cuentan como clientes. */
  readonly lingering: Set<string>;
  readonly log: RingLog;
  readonly wakers: Set<() => void>;
  watcher: FSWatcher | null;
  /** TARGETDURATION fijado al quedar lista la lista (docs/multidispositivo.md §4.3). */
  targetS: number | null;
  /** Lo que duran de verdad los segmentos de la ventana (§4.2). */
  segments: SegmentSpread | null;
  /** Última línea de registro de los segmentos (para no repetirla). */
  segLogKey: string;
  segLogAt: number;
  /** Análisis de la entrada IPTV con el que se lanzó (§4.5). */
  readonly probe: 'short' | 'fallback';
  /** Ya se probó el reinicio con 5 MB / 5 s desde esta entrada. */
  probeRetried: boolean;
  /** La entrada que la sustituye tras ese reinicio (quien espera la lista la sigue). */
  replacedBy: Promise<Entry> | null;
  /** Lanzada al abrir la sesión (no en un reinicio): solo aquí cuenta el tope desde la apertura del relé. */
  readonly firstLaunch: boolean;
}

interface LaunchOptions {
  readonly probe?: 'short' | 'fallback';
  readonly firstLaunch?: boolean;
}

interface Carry {
  readonly viewers: string[];
  readonly legacyClients: [string, LegacyClient][];
  readonly lingering: string[];
}

export interface RemuxEntryInfo {
  readonly sessionId: string;
  readonly hash: string;
  readonly pid: number | undefined;
  readonly exited: boolean;
  readonly ready: boolean;
  readonly viewers: readonly string[];
  readonly log: string;
  readonly targetS: number | null;
  readonly args: readonly string[];
}

export interface RemuxRuntime {
  readonly service: RemuxService;
  /** Estado interno para los tests y la salud. */
  entries(): RemuxEntryInfo[];
  /** Una vuelta del recolector (la que hace el temporizador cada 15 s). */
  reap(): Promise<void>;
  /** Espera a que la cola del registro quede vacía. */
  idle(): Promise<void>;
}

function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function clientsCount(entry: Entry): number {
  return entry.viewers.size + entry.legacyClients.size;
}

function allViewers(entry: Entry): string[] {
  return [
    ...entry.viewers,
    ...[...entry.legacyClients.values()].map((client) => client.viewerId),
    ...entry.lingering,
  ];
}

function clearViewers(entry: Entry): void {
  entry.viewers.clear();
  entry.legacyClients.clear();
  entry.lingering.clear();
}

function carryOf(entry: Entry): Carry {
  return {
    viewers: [...entry.viewers],
    legacyClients: [...entry.legacyClients],
    lingering: [...entry.lingering],
  };
}

/** «ffmpeg no encontró los parámetros de un stream» con el análisis corto de la IPTV. */
const PROBE_FAILED_RE = /Could not find codec parameters/i;

export function createRemuxRuntime(deps: RemuxDeps): RemuxRuntime {
  const { config, clock, bus } = deps;
  const logger = deps.logger.child({ module: 'remux' });
  const launcher = deps.launcher ?? createSpawnLauncher();
  const procRoot =
    deps.procRoot === undefined ? (process.platform === 'linux' ? '/proc' : null) : deps.procRoot;
  const killPid = deps.killPid ?? ((pid: number) => killProcessTree(pid));
  const watchFiles = deps.watchFiles !== false;
  const remuxDir = config.paths.remuxDir;
  const engineBase = `http://${hostForUrl(config.engine.host)}:${config.engine.port}`;

  const redact = deps.redact ?? redactText;
  const inputKeyOf = (source: RemuxSource): string => source.inputUrl ?? source.playbackUrl;
  const byHash = new Map<string, Entry>();
  /** Argumentos con los que se lanzó cada ffmpeg (para los tests y la salud). */
  const entryArgs = new WeakMap<Entry, readonly string[]>();
  const listeners = new Set<RemuxListener>();
  const registry = new SerialLock();
  let ffmpegMissing = false;
  let reaper: TimerHandle | null = null;
  let stopped = false;

  // --- Avisos a playback ---

  function emitDetached(sessionId: string, viewerIds: string[], reason: RemuxCloseReason): void {
    if (!viewerIds.length) return;
    for (const listener of [...listeners]) {
      try {
        listener.onDetached?.(sessionId, viewerIds, reason);
      } catch (error) {
        logger.error({ err: error }, 'un suscriptor del remux ha fallado');
      }
    }
  }

  function touch(entry: Entry, deviceId: string | null): void {
    entry.lastAccess = clock.now();
    for (const listener of [...listeners]) {
      try {
        listener.onAccess?.(entry.sessionId, deviceId);
      } catch (error) {
        logger.error({ err: error }, 'un suscriptor del remux ha fallado');
      }
    }
  }

  // --- Registro ---

  function findBySession(sessionId: string): Entry | undefined {
    for (const entry of byHash.values()) if (entry.sessionId === sessionId) return entry;
    return undefined;
  }

  function wake(entry: Entry): void {
    for (const waker of [...entry.wakers]) waker();
  }

  function noteObservation(entry: Entry, seen: FileObservation): void {
    const key = `${seen.size}:${seen.mtimeMs}`;
    if (key !== entry.observed) {
      entry.observed = key;
      entry.lastChangeAt = clock.now();
    }
  }

  async function observe(entry: Entry): Promise<boolean> {
    try {
      const info = await stat(path.join(entry.dir, 'index.m3u8'));
      noteObservation(entry, { size: info.size, mtimeMs: info.mtimeMs });
      return true;
    } catch {
      return false;
    }
  }

  /** `remuxStalled` (server.js:227-231): arrancado hace más de 45 s y la lista sin tocar en 15 s. */
  async function isStalled(entry: Entry): Promise<boolean> {
    const now = clock.now();
    if (now - entry.startedAt < TIMEOUTS.remuxStartServerMs) return false;
    if (!(await observe(entry))) return true;
    return clock.now() - entry.lastChangeAt > REMUX_TIMINGS.staleMs;
  }

  function kill(entry: Entry): void {
    entry.killed = true;
    const proc = entry.proc;
    entry.proc = null;
    proc?.kill();
  }

  /** `remuxCleanup` (server.js:181-187). Con la cola del registro tomada. */
  async function closeLocked(
    entry: Entry,
    reason: RemuxCloseReason,
    notify: boolean,
    extraViewers: string[] = [],
  ): Promise<void> {
    if (entry.closed) return;
    entry.closed = true;
    if (byHash.get(entry.hash) === entry) byHash.delete(entry.hash);
    const viewers = [...new Set([...extraViewers, ...allViewers(entry)])];
    clearViewers(entry);
    kill(entry);
    entry.watcher?.close();
    entry.watcher = null;
    wake(entry);
    if (notify) emitDetached(entry.sessionId, viewers, reason);
    await rm(entry.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
      () => undefined,
    );
  }

  function onExit(entry: Entry, code: number | null, signal: string | null): void {
    entry.proc = null;
    entry.exited = true;
    entry.exitCode = code;
    wake(entry);
    if (entry.closed || byHash.get(entry.hash) !== entry) return;
    /* server.js:326-334: se conservan los segmentos para que el reproductor
       termine sus peticiones; el recolector lo borra después. */
    entry.lastAccess = clock.now();
    if (entry.killed) return;
    /* IPTV con el análisis corto: si murió por no encontrar los parámetros, se
       relanza con 5 MB / 5 s en vez de dejar a los visores sin vídeo. */
    if (maybeProbeRetry(entry)) return;
    const tail = redact(entry.log.tail(300));
    const cause = /codec|decoder|encoder|invalid data|unsupported|not supported/i.test(tail)
      ? 'codec'
      : 'engine';
    logger.warn(
      { errorCode: 'remux_died', code, signal, sessionId: entry.sessionId, tail },
      'ffmpeg del remux ha terminado solo',
    );
    bus.emit('diagnostics.report', {
      cause,
      code: 'remux_died',
      message: `ffmpeg terminó (${code ?? signal ?? 'sin código'}): ${tail}`.slice(0, 500),
      hash: entry.hash,
      sessionId: entry.sessionId,
    });
    const viewers = allViewers(entry);
    clearViewers(entry);
    emitDetached(entry.sessionId, viewers, 'died');
  }

  function onError(entry: Entry, error: Error & { code?: string }): void {
    if (error.code === 'ENOENT') {
      if (!ffmpegMissing) {
        logger.warn(
          { errorCode: 'ffmpeg_missing' },
          'no hay ffmpeg: el remux del iPhone queda desactivado',
        );
      }
      ffmpegMissing = true;
      entry.missing = true;
    }
    entry.proc = null;
    entry.exited = true;
    wake(entry);
    /* server.js:325: un fallo al lanzar limpia la sesión. */
    void registry.run(() => closeLocked(entry, 'died', !entry.missing));
  }

  /**
   * El análisis corto de la IPTV (2 MB / 2 s) no ha encontrado los parámetros
   * de un stream: UN reinicio con 5 MB / 5 s (docs/multidispositivo.md §4.5).
   * Antes se prepara el relé para que no suelte la conexión con el proveedor
   * al irse este ffmpeg; si ya no está, no se reinicia y sigue el error normal.
   */
  function maybeProbeRetry(entry: Entry): boolean {
    if (
      entry.origin !== 'iptv' ||
      entry.probe !== 'short' ||
      entry.ready ||
      entry.probeRetried ||
      entry.closed ||
      entry.replacedBy ||
      byHash.get(entry.hash) !== entry
    )
      return false;
    if (!PROBE_FAILED_RE.test(entry.log.tail(4096))) return false;
    entry.probeRetried = true;
    let prepared: boolean;
    try {
      prepared = entry.source.prepareRestart?.() ?? false;
    } catch {
      prepared = false;
    }
    if (!prepared) return false;
    logger.info(
      { sessionId: entry.sessionId },
      'remux IPTV: el análisis corto no encontró los parámetros; se relanza con 5 MB / 5 s',
    );
    const replaced = registry.run(async () => {
      const carry = carryOf(entry);
      clearViewers(entry);
      await closeLocked(entry, 'stopped', false);
      return startLocked(entry.source, entry.hash, carry, {
        probe: 'fallback',
        firstLaunch: entry.firstLaunch,
      });
    });
    entry.replacedBy = replaced;
    replaced.catch(() => undefined);
    wake(entry);
    return true;
  }

  /** Lanza ffmpeg para una sesión. Con la cola del registro tomada. */
  async function startLocked(
    source: RemuxSource,
    hash: string,
    carry: Carry | null,
    launch: LaunchOptions = {},
  ): Promise<Entry> {
    const dir = path.join(remuxDir, hash);
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
      () => undefined,
    );
    await mkdir(dir, { recursive: true });
    const now = clock.now();
    const origin = source.origin ?? 'engine';
    const entry: Entry = {
      hash,
      sessionId: source.sessionId,
      playbackUrl: source.playbackUrl,
      inputKey: inputKeyOf(source),
      source,
      origin,
      dir,
      startedAt: now,
      lastAccess: now,
      lastChangeAt: now,
      observed: null,
      proc: null,
      exited: false,
      exitCode: null,
      killed: false,
      closed: false,
      missing: false,
      ready: false,
      viewers: new Set(carry?.viewers ?? []),
      legacyClients: new Map(carry?.legacyClients ?? []),
      lingering: new Set(carry?.lingering ?? []),
      log: new RingLog(),
      wakers: new Set(),
      watcher: null,
      targetS: null,
      segments: null,
      segLogKey: '',
      segLogAt: 0,
      probe: launch.probe ?? 'short',
      probeRetried: false,
      replacedBy: null,
      firstLaunch: launch.firstLaunch === true,
    };
    const args = buildRemuxArgs({
      url: source.inputUrl ?? `${engineBase}${source.playbackUrl}`,
      dir,
      sessionId: source.sessionId,
      origin,
      ...(source.isHls ? { isHls: true } : {}),
      ...(origin === 'iptv' ? { probe: entry.probe } : {}),
    });
    entryArgs.set(entry, args);
    let proc: RemuxProcess;
    try {
      proc = launcher.spawn(args);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') ffmpegMissing = true;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new AppError(code === 'ENOENT' ? 'ffmpeg_missing' : 'remux_died', { cause: error });
    }
    entry.proc = proc;
    byHash.set(hash, entry);
    proc.onStderr((chunk) => {
      entry.log.push(chunk);
      if (entry.origin === 'iptv' && PROBE_FAILED_RE.test(chunk.toString('latin1')))
        maybeProbeRetry(entry);
    });
    proc.onError((error) => onError(entry, error));
    proc.onExit((code, signal) => onExit(entry, code, signal));
    if (watchFiles) {
      try {
        entry.watcher = watch(dir, () => wake(entry));
        entry.watcher.on('error', () => undefined);
      } catch {}
    }
    logger.info(
      {
        sessionId: source.sessionId,
        pid: proc.pid,
        mode: source.mode,
        origin,
        ...(origin === 'iptv' ? { probe: entry.probe } : {}),
      },
      'remux lanzado',
    );
    return entry;
  }

  /** Tope de 3 sesiones: desaloja solo las que no tienen espectadores (server.js:247-255). */
  async function makeRoomLocked(): Promise<void> {
    while (byHash.size >= MAX_REMUX_SESSIONS) {
      const candidates = new Map<string, EvictionCandidate>();
      for (const [key, entry] of byHash) {
        candidates.set(key, {
          lastAccess: entry.lastAccess,
          clients: { size: clientsCount(entry) },
          exited: entry.exited,
        });
      }
      const victim = elegirSesionRemuxADesalojar(candidates);
      if (!victim) throw new AppError('remux_busy');
      await closeLocked(byHash.get(victim) as Entry, 'evicted', true);
    }
  }

  function attach(entry: Entry, viewerId: string, legacy: { device: string } | undefined): string {
    if (!legacy) {
      entry.viewers.add(viewerId);
      entry.lingering.delete(viewerId);
      return '';
    }
    /* server.js:239: ficha nueva en cada petición. */
    const token = randomBytes(8).toString('hex');
    if (legacy.device) {
      entry.legacyClients.set(legacy.device, { token, viewerId });
      entry.lingering.delete(viewerId);
    } else {
      entry.lingering.add(viewerId);
    }
    return token;
  }

  function throwIfGone(entry: Entry): void {
    if (entry.missing) throw new AppError('ffmpeg_missing');
    /* server.js:4917: sustituida o ffmpeg terminado. */
    if (entry.closed || entry.exited || byHash.get(entry.hash) !== entry) {
      throw new AppError('remux_died');
    }
  }

  function waitChange(entry: Entry, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      let timer: TimerHandle | null = null;
      const cleanup = (): void => {
        clock.clearTimeout(timer);
        entry.wakers.delete(done);
        signal?.removeEventListener('abort', onAbort);
      };
      const done = (): void => {
        cleanup();
        resolve();
      };
      const onAbort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error('aborted'));
      };
      timer = clock.setTimeout(done, ms);
      entry.wakers.add(done);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Plazo de la espera de una IPTV (docs/multidispositivo.md §4.5): 20 s desde
   * el primer byte entregado a este ffmpeg (desde que se lanzó si aún no le ha
   * llegado nada), 28 s desde que se abrió el relé (solo al abrir la sesión) y
   * el tope de la petición.
   */
  function iptvDeadline(entry: Entry, deadlineAt: number | undefined): number {
    const first = entry.source.firstByteAt?.() ?? null;
    const base = first === null ? entry.startedAt : Math.max(first, entry.startedAt);
    let limit = base + IPTV_REMUX_READY_MS;
    if (entry.firstLaunch && entry.source.openedAt !== undefined) {
      limit = Math.min(limit, entry.source.openedAt + IPTV_REMUX_OPEN_MAX_MS);
    }
    if (deadlineAt !== undefined) limit = Math.min(limit, deadlineAt);
    return limit;
  }

  async function readText(file: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Espera del arranque (server.js:4914-4924; B-105; docs/multidispositivo.md
   * §4.3): 3 segmentos y `max(4 s, 3 × TD + 1 s)` de vídeo, o 1 segmento
   * pasados 20 s, 45 s como máximo. IPTV: la misma lista lista o
   * `iptv_timeout` (§4.5). Devuelve la entrada que queda lista (otra si hubo
   * que relanzar ffmpeg con el análisis largo).
   */
  async function waitReady(
    start: Entry,
    signal?: AbortSignal,
    deadlineAt?: number,
  ): Promise<Entry> {
    let entry = start;
    if (entry.ready && !entry.replacedBy) {
      throwIfGone(entry);
      return entry;
    }
    const t0 = clock.now();
    let text: string | null = null;
    for (;;) {
      if (entry.replacedBy) {
        entry = await entry.replacedBy;
        if (entry.ready) break;
        continue;
      }
      throwIfGone(entry);
      text = await readText(path.join(entry.dir, 'index.m3u8'));
      if (entry.replacedBy) continue;
      throwIfGone(entry);
      const stats = text === null ? null : playlistStatsFromText(text);
      const need = remuxReadySeconds(text === null ? 1 : initialTargetDuration(text));
      const enough =
        stats !== null && stats.segments >= REMUX_TIMINGS.readySegments && stats.seconds >= need;
      if (enough) break;
      const now = clock.now();
      if (entry.origin === 'iptv') {
        const limit = iptvDeadline(entry, deadlineAt);
        if (now >= limit) throw new AppError('iptv_timeout');
        await waitChange(entry, Math.max(1, Math.min(READY_POLL_MS, limit - now)), signal);
        continue;
      }
      const waited = now - t0;
      if (stats && stats.segments >= 1 && waited > REMUX_TIMINGS.readyFallbackAfterMs) break;
      if (waited > TIMEOUTS.remuxStartServerMs) throw new AppError('remux_timeout');
      await waitChange(entry, READY_POLL_MS, signal);
    }
    if (!entry.ready) {
      entry.ready = true;
      entry.targetS = initialTargetDuration(text ?? '');
      entry.segments = text === null ? null : segmentSpread(text);
      logSegments(entry, false, true);
      /* Primera observación de la lista: desde aquí cuenta el atasco. */
      await observe(entry);
    }
    return entry;
  }

  /**
   * Una línea de registro con la duración real de los segmentos (§4.2): al
   * quedar lista la lista, al subir el TARGETDURATION y, como mucho una vez
   * por minuto, cuando cambia algo. Sin hash ni URL.
   */
  function logSegments(entry: Entry, raised: boolean, first = false): void {
    const now = clock.now();
    const spread = entry.segments;
    const key = `${spread?.minS.toFixed(1) ?? '-'}:${spread?.maxS.toFixed(1) ?? '-'}:${entry.targetS ?? '-'}`;
    if (!first && !raised) {
      if (key === entry.segLogKey || now - entry.segLogAt < REMUX_TIMINGS.segmentLogMs) return;
    }
    entry.segLogKey = key;
    entry.segLogAt = now;
    logger.info(
      {
        sessionId: entry.sessionId,
        origin: entry.origin,
        input: entry.origin === 'iptv' ? (entry.source.isHls ? 'hls' : 'ts') : entry.source.mode,
        segMinS: spread ? Math.round(spread.minS * 100) / 100 : null,
        segMaxS: spread ? Math.round(spread.maxS * 100) / 100 : null,
        targetS: entry.targetS,
        raised,
      },
      raised ? 'remux: TARGETDURATION sube (un segmento no cabía)' : 'remux: segmentos',
    );
  }

  /**
   * La lista tal como se sirve: con el TARGETDURATION fijado (§4.3) y, de
   * paso, la duración real de los segmentos al día (§4.2).
   */
  function adoptPlaylist(entry: Entry, text: string): string {
    if (!entry.ready || entry.targetS === null) return text;
    const pinned = pinTargetDuration(text, entry.targetS);
    entry.targetS = pinned.pinned;
    const spread = segmentSpread(text);
    if (spread) entry.segments = spread;
    logSegments(entry, pinned.raised);
    return pinned.text;
  }

  /** Lee la lista para servirla (y la cuenta como observada para el atasco). Null si no existe. */
  async function playlistBody(entry: Entry, file: string): Promise<string | null> {
    try {
      const info = await stat(file);
      noteObservation(entry, { size: info.size, mtimeMs: info.mtimeMs });
    } catch {
      return null;
    }
    const text = await readText(file);
    return text === null ? null : adoptPlaylist(entry, text);
  }

  function handleOf(entry: Entry, token: string): RemuxHandle {
    return {
      sessionId: entry.sessionId,
      hash: entry.hash,
      dir: entry.dir,
      startedAt: entry.startedAt,
      ready: entry.ready,
      ...(token ? { legacyToken: token } : {}),
      targetDurationS: () => entry.targetS,
      segments: () => (entry.segments ? { ...entry.segments } : null),
    };
  }

  async function reap(): Promise<void> {
    await registry.run(async () => {
      for (const entry of [...byHash.values()]) {
        if (!entry.exited) await observe(entry);
        /* server.js:189-194: 90 s sin pedir ficheros. Los visores de la app
           nativa no caducan aquí: su vida la lleva el latido de playback. */
        if (clock.now() - entry.lastAccess > REMUX_TIMINGS.idleMs && entry.viewers.size === 0) {
          await closeLocked(entry, 'idle', true);
        }
      }
    });
    if (!procRoot) return;
    const known = new Set([...byHash.values()].map((entry) => entry.sessionId));
    const orphans = await findOrphanPids(procRoot, known, process.pid);
    for (const pid of orphans) {
      logger.warn({ pid }, 'ffmpeg huérfano del remux: se mata');
      killPid(pid);
    }
  }

  const service: RemuxService = {
    async start() {
      if (reaper || stopped) return;
      reaper = clock.setInterval(
        () => {
          reap().catch((error: unknown) => logger.error({ err: error }, 'recolector del remux'));
        },
        REMUX_TIMINGS.reaperIntervalMs,
        { unref: true },
      );
    },

    async stop() {
      stopped = true;
      clock.clearInterval(reaper);
      reaper = null;
      await service.stopAll();
    },

    async ensure(source, viewerId, signal, options = {}) {
      if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
      if (ffmpegMissing) throw new AppError('ffmpeg_missing');
      const hash = source.hash.toLowerCase();
      const { entry, token } = await registry.run(async () => {
        let current = byHash.get(hash);
        let carry: Carry | null = null;
        if (current) {
          const sameSession = current.sessionId === source.sessionId;
          const reusable =
            sameSession &&
            current.inputKey === inputKeyOf(source) &&
            !current.exited &&
            !(await isStalled(current));
          if (!reusable) {
            if (sameSession) {
              carry = carryOf(current);
              clearViewers(current);
            }
            await closeLocked(current, 'stopped', !sameSession);
            current = undefined;
          }
        }
        if (!current) {
          await makeRoomLocked();
          if (ffmpegMissing) throw new AppError('ffmpeg_missing');
          current = await startLocked(source, hash, carry, { firstLaunch: carry === null });
        }
        const attached = attach(current, viewerId, options.legacy);
        current.lastAccess = clock.now();
        return { entry: current, token: attached };
      });
      const ready = await waitReady(entry, signal, options.deadlineAt);
      return handleOf(ready, token);
    },

    async retarget(source, signal) {
      if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
      const entry = await registry.run(async () => {
        const current = findBySession(source.sessionId);
        if (!current) return null;
        if (current.inputKey === inputKeyOf(source) && !current.exited) return current;
        const carry = carryOf(current);
        clearViewers(current);
        await closeLocked(current, 'stopped', false);
        return startLocked(source, current.hash, carry, { probe: current.probe });
      });
      if (!entry) return null;
      return handleOf(await waitReady(entry, signal), '');
    },

    async restart(sessionId, signal) {
      if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
      const entry = await registry.run(async () => {
        const current = findBySession(sessionId);
        if (!current) return null;
        const carry = carryOf(current);
        clearViewers(current);
        await closeLocked(current, 'stopped', false);
        return startLocked(current.source, current.hash, carry, { probe: current.probe });
      });
      if (!entry) return null;
      return handleOf(await waitReady(entry, signal), '');
    },

    async detach(sessionId, viewerId) {
      await registry.run(async () => {
        const entry = findBySession(sessionId);
        if (!entry) return;
        entry.viewers.delete(viewerId);
        entry.lingering.delete(viewerId);
        for (const [device, client] of entry.legacyClients) {
          if (client.viewerId === viewerId) entry.legacyClients.delete(device);
        }
        if (!allViewers(entry).length) await closeLocked(entry, 'stopped', false);
      });
    },

    async serveFile(reply, sessionId, file, options) {
      const entry = findBySession(sessionId);
      if (!entry) throw new AppError('session_expired', { detail: 'la sesión no tiene remux' });
      if (!VIDEO_FILE_RE.test(file)) throw new AppError('not_found');
      touch(entry, options.deviceId ?? null);
      const full = path.join(entry.dir, file);
      const send = { rangeHeader: options.rangeHeader, head: options.head };
      if (file === 'index.m3u8') {
        /* Con token (app nativa) o sin él (hls.js de la web con la IPTV): la
           lista con el TARGETDURATION fijado (docs/multidispositivo.md §4.3). */
        const text = await playlistBody(entry, full);
        if (text === null) {
          await sendBare(reply, 404, { 'cache-control': 'no-store' });
          return;
        }
        const body = options.videoToken ? rewritePlaylist(text, options.videoToken) : text;
        await sendBuffer(reply, full, Buffer.from(body), send);
        return;
      }
      await sendFile(reply, full, send);
    },

    async serveLegacyFile(reply, url, options) {
      /* server.js:4928-4938. */
      let rel: string;
      try {
        rel = decodeURIComponent(url.split('?')[0] ?? '').slice(LEGACY_PREFIX.length);
      } catch {
        /* Escapes rotos: 404 como el resto de la app (contratos §11). */
        throw new AppError('not_found');
      }
      const parts = rel.split('/');
      if (parts.length < 2 || !HASH_RE.test(parts[0] ?? '') || rel.includes('\\')) {
        await sendBare(reply, 403);
        return;
      }
      const entry = byHash.get((parts[0] as string).toLowerCase());
      if (entry) touch(entry, null);
      const root = path.resolve(remuxDir);
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) {
        await sendBare(reply, 403);
        return;
      }
      if (entry && file === path.resolve(entry.dir, 'index.m3u8')) {
        /* 0.6.x: el TARGETDURATION fijado y el arranque a 6 s del final (§4.3). */
        const text = await playlistBody(entry, file);
        if (text === null) {
          await sendBare(reply, 404, { 'cache-control': 'no-store' });
          return;
        }
        await sendBuffer(reply, file, Buffer.from(withStartOffset(text)), options);
        return;
      }
      await sendFile(reply, file, options);
    },

    async legacyStop(body) {
      /* server.js:4886-4904 (B-222). */
      const input = (body ?? {}) as Record<string, unknown>;
      const id = normalizeHash(input.id);
      if (!id) throw new AppError('bad_request');
      return registry.run(async () => {
        const entry = byHash.get(id.toLowerCase());
        const deviceId = String(input.dev || '')
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 40);
        const token = String(input.token || '')
          .trim()
          .replace(/[^a-f0-9]/g, '')
          .slice(0, 32);
        const client = entry && deviceId ? entry.legacyClients.get(deviceId) : undefined;
        /* Parada de un enganche anterior: no se toca la sesión que se está viendo. */
        if (entry && deviceId && token && client && client.token !== token) {
          return {
            success: true as const,
            stopped: false as const,
            detached: false as const,
            stale: true as const,
          };
        }
        let released: string | null = null;
        if (entry && client) {
          entry.legacyClients.delete(deviceId);
          /* keepAlive: el visor se queda hasta que lo recoja el recolector (reenganche, P9). */
          if (input.keepAlive === true) entry.lingering.add(client.viewerId);
          else released = client.viewerId;
        }
        let stopped =
          !!entry && input.keepAlive !== true && (!deviceId || clientsCount(entry) === 0);
        /* v2: nunca se deja sin vídeo a un visor de la app nativa (arquitectura §5.7). */
        if (stopped && entry && entry.viewers.size > 0) stopped = false;
        if (stopped && entry) {
          await closeLocked(entry, 'stopped', true, released ? [released] : []);
        } else if (entry && released) {
          emitDetached(entry.sessionId, [released], 'stopped');
        }
        return { success: true as const, stopped, detached: !!entry && !!deviceId };
      });
    },

    stats() {
      return { sessions: byHash.size, max: MAX_REMUX_SESSIONS, ffmpegMissing };
    },

    async stopAll() {
      await registry.run(async () => {
        for (const entry of [...byHash.values()]) await closeLocked(entry, 'shutdown', true);
      });
    },

    async cleanWorkDir() {
      /* server.js:5134-5135. */
      await rm(remuxDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
        () => undefined,
      );
      await mkdir(remuxDir, { recursive: true });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    viewersOf(sessionId) {
      const entry = findBySession(sessionId);
      return entry ? allViewers(entry) : [];
    },

    buildArgs: (input) => buildRemuxArgs(input),
    parseByteRange: (header, size) => parseByteRange(header, size),
  };

  return {
    service,
    entries: () =>
      [...byHash.values()].map((entry) => ({
        sessionId: entry.sessionId,
        hash: entry.hash,
        pid: entry.proc?.pid,
        exited: entry.exited,
        ready: entry.ready,
        viewers: allViewers(entry),
        log: entry.log.text(),
        targetS: entry.targetS,
        args: entryArgs.get(entry) ?? [],
      })),
    reap,
    idle: () => registry.idle(),
  };
}
