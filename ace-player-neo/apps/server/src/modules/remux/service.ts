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
   - espera del arranque (2 segmentos y 6 s, o 1 y 20 s, 45 s como máximo)
     sin `readFileSync` cada 400 ms: vigila la carpeta y relee sin bloquear,
     y se corta si el cliente cuelga;
   - reengancharse a la misma sesión reutiliza el ffmpeg vivo (P9);
   - sin ffmpeg, `ffmpeg_missing` y el resto sigue funcionando.

   Todas las altas y bajas del registro pasan por una cola en serie: nunca
   hay dos ffmpeg para el mismo canal ni se borra la carpeta de uno nuevo.

   IPTV (diagnostico-iptv-0.8.2 B2 y B3):
   - `restart()` es continuo: el ffmpeg nuevo es otra «generación» en la MISMA
     carpeta, que sigue la numeración (`-start_number`), marca la costura
     (`discont_start`) y escribe su propio `init_<n>.mp4`. Mientras no hay
     lista nueva se sirve la vieja (congelada) y sus segmentos; los ficheros
     viejos se borran un TD después de que la nueva esté (lo que se estuviera
     bajando de la vieja aún llega). Así el hls.js que ya estaba no ve la lista
     volver a 0 (el salto atrás de 30-58 s, P3).
   - Vigilante de salida: una IPTV con clientes cuya lista no cambia en
     `max(10 s, 3×TD)` (el TD de la lista de ese momento) avisa `onStalled`
     (una vez por atasco) para que playback reconecte el relé; `ensure()` con
     un ffmpeg atascado va por el mismo camino en vez de relanzarlo por su
     cuenta, salvo que el aviso lleve mucho sin efecto o nunca llegara a estar
     lista (entonces se relanza como antes). */

/* Películas y series (docs/vod.md §9.7-§9.8, VOD-5): `openVod` lee el índice
   por el relé VOD (caché de 8 por título), elige el audio y abre un
   `VodProducer` en `remuxDir/vod-<sid>`, registrado aparte de los remux del
   directo pero contando en el tope de 3. `serveFile` sirve sus ficheros
   (la lista desde el índice con `EXT-X-START`; los segmentos, cuando el
   productor los tiene; 503 con `Retry-After: 1` si aún no). Al arrancar se
   barren las carpetas `vod-*` que no son de nadie. */

import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  HASH_RE,
  IPTV_REMUX_READY_MS,
  MAX_REMUX_SESSIONS,
  REMUX_TIMINGS,
  TIMEOUTS,
  normalizeHash,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { redactText } from '../../core/logger.js';
import { buildRemuxArgs } from './args.js';
import { elegirSesionRemuxADesalojar, type EvictionCandidate } from './eviction.js';
import {
  NOT_YET_HEADERS,
  NOT_YET_WAIT_MS,
  generationOfInit,
  initFileName,
  nextSegmentNumber,
  playlistInfoFromText,
  parseByteRange,
  previousGenerationFiles,
  readPlaylistInfo,
  readWhenReady,
  rewritePlaylist,
  withDiscontinuitySequence,
  sendBare,
  sendBuffer,
  sendFile,
  type FileObservation,
} from './files.js';
import { SerialLock } from './lock.js';
import { RingLog, createSpawnLauncher, findOrphanPids, killProcessTree } from './process.js';
import { pickVodAudio } from './vod/audio.js';
import { assertPlayable, readVodIndex, VodIndexCache } from './vod/index.js';
import { VOD_DIR_PREFIX, VodProducer, sweepVodDirs } from './vod/producer.js';
import { createHttpRangeReader } from './vod/reader.js';
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

/** Ficheros que genera ffmpeg y que sirve /api/v1/video (nunca un log); `init_<n>.mp4` tras un reinicio continuo. */
const VIDEO_FILE_RE = /^(?:index\.m3u8|init(?:_\d{1,6})?\.mp4|index\d{1,9}\.m4s)$/;

/** Vigilante de salida de la IPTV (B3): cada cuánto se mira la lista. */
export const IPTV_STALL_CHECK_MS = 2_000;
/** Atasco de la IPTV: la lista sin cambiar en `max(IPTV_STALL_MIN_MS, IPTV_STALL_TD_FACTOR × TD)`. */
export const IPTV_STALL_MIN_MS = 10_000;
export const IPTV_STALL_TD_FACTOR = 3;
/**
 * `ensure()` sobre una IPTV avisada de atasco hace más de esto sin que la lista se haya movido: el aviso
 * no ha servido (nadie lo atiende, o el reinicio no llegó a nada) y se relanza ffmpeg como antes.
 */
export const IPTV_ENSURE_RELAUNCH_MS = 40_000;
/** Lo que se espera a que el ffmpeg matado termine antes de lanzar el siguiente (el relé da 409 mientras). */
export const REPLACE_EXIT_WAIT_MS = 1_000;
/** Gracia antes de borrar lo de la generación anterior: su TD, entre estos límites. */
const STALE_GRACE_MIN_MS = 2_000;
const STALE_GRACE_MAX_MS = 10_000;

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
  /** `#EXT-X-TARGETDURATION` de la última lista vista, en ms (umbral del vigilante de la IPTV). */
  targetMs: number;
  /** Ya se avisó `onStalled` de este atasco (se rearma cuando la lista cambia). */
  stallNotified: boolean;
  /** Cuándo se avisó (para relanzar en `ensure()` si el aviso no sirve). */
  stallNotifiedAt: number;
  /** Generación en la carpeta: 1 el primer ffmpeg, +1 en cada reinicio continuo (B2). */
  readonly generation: number;
  /** Primer segmento de esta generación (0 en la primera). */
  readonly startNumber: number;
  /** Init de esta generación (`init.mp4` o `init_<n>.mp4`). */
  readonly initName: string;
  /** Quedan ficheros de generaciones anteriores por borrar (cuando esta esté lista). */
  stalePending: boolean;
  /** Gracia antes de borrarlos (el TD de la generación anterior). */
  readonly staleGraceMs: number;
  staleTimer: TimerHandle | null;
  /**
   * DISCONTINUITY-SEQUENCE de cada generación de la carpeta (compartido entre ellas): las costuras que ha
   * cruzado un cliente que llega a esa generación. Una generación que nunca se sirvió no cuenta.
   */
  readonly dsnBases: Map<number, number>;
  /** Alguna lista de esta generación ha salido hacia un cliente (la primera cuenta como servida). */
  served: boolean;
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
}

interface Carry {
  readonly viewers: string[];
  readonly legacyClients: [string, LegacyClient][];
  readonly lingering: string[];
}

/** Generación siguiente en la misma carpeta (reinicio continuo, B2). */
interface Continuation {
  readonly generation: number;
  readonly startNumber: number;
  readonly dsnBases: Map<number, number>;
  readonly staleGraceMs: number;
}

export interface RemuxEntryInfo {
  readonly sessionId: string;
  readonly hash: string;
  readonly pid: number | undefined;
  readonly exited: boolean;
  readonly ready: boolean;
  readonly viewers: readonly string[];
  readonly log: string;
}

export interface RemuxRuntime {
  readonly service: RemuxService;
  /** Estado interno para los tests y la salud. */
  entries(): RemuxEntryInfo[];
  /** Una vuelta del recolector (la que hace el temporizador cada 15 s). */
  reap(): Promise<void>;
  /** Una vuelta del vigilante de salida de la IPTV (la que hace el temporizador cada 2 s). */
  watchStalls(): Promise<void>;
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

/** Los visores de una entrada, para pasarlos al ffmpeg que la sustituye. */
function carryOf(entry: Entry): Carry {
  return {
    viewers: [...entry.viewers],
    legacyClients: [...entry.legacyClients],
    lingering: [...entry.lingering],
  };
}

export function createRemuxRuntime(deps: RemuxDeps): RemuxRuntime {
  const { config, clock, bus } = deps;
  const logger = deps.logger.child({ module: 'remux' });
  const launcher = deps.launcher ?? createSpawnLauncher();
  const procRoot =
    deps.procRoot === undefined ? (process.platform === 'linux' ? '/proc' : null) : deps.procRoot;
  const killPid = deps.killPid ?? ((pid: number) => killProcessTree(pid));
  const watchFiles = deps.watchFiles !== false;
  const notYetWaitMs = deps.notYetWaitMs ?? NOT_YET_WAIT_MS;
  const remuxDir = config.paths.remuxDir;
  const engineBase = `http://${hostForUrl(config.engine.host)}:${config.engine.port}`;

  const redact = deps.redact ?? redactText;
  const inputKeyOf = (source: RemuxSource): string => source.inputUrl ?? source.playbackUrl;
  const byHash = new Map<string, Entry>();
  const listeners = new Set<RemuxListener>();
  const registry = new SerialLock();
  /* Sesiones a mitad de un restart/retarget: si entre medias no hay entrada, «aún no está» y no 410. */
  const replacing = new Map<string, number>();
  /** Productores VOD por sesión (docs/vod.md §9.7) y dónde empieza su lista. */
  const vods = new Map<string, { readonly producer: VodProducer; startS: number }>();
  const vodIndexes = new VodIndexCache();
  const vodLauncher =
    deps.vodLauncher ??
    createSpawnLauncher({
      stdout: 'pipe',
      /* En Windows (solo desarrollo), «nice 10» se queda sin turno con la CPU llena. */
      ...(process.platform === 'win32' ? { niceness: 0 } : {}),
    });
  let ffmpegMissing = false;
  let reaper: TimerHandle | null = null;
  let stallTimer: TimerHandle | null = null;
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

  function emitStalled(entry: Entry): void {
    if (entry.stallNotified) return;
    entry.stallNotified = true;
    entry.stallNotifiedAt = clock.now();
    logger.warn(
      { sessionId: entry.sessionId, stalledMs: clock.now() - entry.lastChangeAt },
      'remux IPTV: la lista no avanza',
    );
    for (const listener of [...listeners]) {
      try {
        listener.onStalled?.(entry.sessionId);
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

  /** Apunta lo visto de la lista; true si ha cambiado (un cambio rearma el aviso de atasco). */
  function noteObservation(entry: Entry, seen: FileObservation): boolean {
    const key = `${seen.size}:${seen.mtimeMs}`;
    if (key === entry.observed) return false;
    entry.observed = key;
    entry.lastChangeAt = clock.now();
    entry.stallNotified = false;
    return true;
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

  /** Umbral del vigilante de la IPTV: `max(10 s, 3×TD)`, para no saltar con los GOP largos. */
  function iptvStallMs(entry: Entry): number {
    return Math.max(IPTV_STALL_MIN_MS, IPTV_STALL_TD_FACTOR * entry.targetMs);
  }

  /**
   * IPTV lista y viva cuya lista no cambia en `max(10 s, 3×TD)` (B3). El TD se relee JUSTO antes de
   * comparar, y no cuando se ve cambiar la lista: los cambios los ve casi siempre antes `serveFile` (hls.js
   * pide la lista cada TD), y un TD congelado en el del arranque (alto por el primer segmento sin clave, P5,
   * o bajo en un canal que luego alarga el GOP) daría un umbral equivocado.
   */
  async function isIptvStalled(entry: Entry): Promise<boolean> {
    if (entry.origin !== 'iptv' || entry.closed || entry.exited || !entry.ready) return false;
    if (!(await observe(entry))) return false;
    if (clock.now() - entry.lastChangeAt <= IPTV_STALL_MIN_MS) return false;
    const info = await readPlaylistInfo(path.join(entry.dir, 'index.m3u8'));
    if (info?.targetDuration) entry.targetMs = info.targetDuration * 1000;
    return clock.now() - entry.lastChangeAt > iptvStallMs(entry);
  }

  /**
   * Vigilante de salida (B3): solo IPTV con clientes (un visor 0.6.x soltado con `keepAlive` no cuenta:
   * nadie la está viendo); AceStream lo vigila el motor.
   */
  async function watchStalls(): Promise<void> {
    for (const entry of [...byHash.values()]) {
      if (entry.origin !== 'iptv' || !clientsCount(entry)) continue;
      if (await isIptvStalled(entry)) emitStalled(entry);
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
    clock.clearTimeout(entry.staleTimer);
    entry.staleTimer = null;
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
   * Lanza ffmpeg para una sesión. Con la cola del registro tomada. Con `next` (reinicio continuo, B2) la
   * carpeta NO se vacía: la generación anterior se sigue sirviendo hasta que esté la lista nueva.
   */
  async function startLocked(
    source: RemuxSource,
    hash: string,
    carry: Carry | null,
    next: Continuation | null = null,
  ): Promise<Entry> {
    const dir = path.join(remuxDir, hash);
    if (!next) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
        () => undefined,
      );
    }
    await mkdir(dir, { recursive: true });
    const generation = next?.generation ?? 1;
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
      targetMs: 0,
      stallNotified: false,
      stallNotifiedAt: 0,
      generation,
      startNumber: next?.startNumber ?? 0,
      initName: initFileName(generation),
      stalePending: next !== null,
      staleGraceMs: next?.staleGraceMs ?? 0,
      staleTimer: null,
      dsnBases: next?.dsnBases ?? new Map([[1, 0]]),
      served: next === null,
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
    };
    const args = buildRemuxArgs({
      url: source.inputUrl ?? `${engineBase}${source.playbackUrl}`,
      dir,
      sessionId: source.sessionId,
      origin,
      ...(source.isHls ? { isHls: true } : {}),
      ...(next ? { generation, startNumber: next.startNumber } : {}),
    });
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
    proc.onStderr((chunk) => entry.log.push(chunk));
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
        ...(next ? { generation, startNumber: next.startNumber } : {}),
      },
      'remux lanzado',
    );
    return entry;
  }

  /**
   * Reinicio continuo de la IPTV (B2). Con la cola del registro tomada. Mata el ffmpeg de ahora SIN tocar
   * la carpeta ni sacarlo del registro (la entrada nueva lo sustituye en el mismo paso: no hay hueco en el
   * que `serveFile` dé 410) y lanza la generación siguiente a partir del mayor segmento que hay en disco.
   */
  async function replaceLocked(current: Entry, carry: Carry): Promise<Entry> {
    const startNumber = await nextSegmentNumber(current.dir);
    current.closed = true;
    clock.clearTimeout(current.staleTimer);
    current.staleTimer = null;
    kill(current);
    current.watcher?.close();
    current.watcher = null;
    wake(current);
    /* El relé contesta 409 mientras no ha soltado la conexión del ffmpeg anterior: se espera (un poco) a que
       termine, para que el nuevo no se encuentre la puerta cerrada y muera nada más nacer. */
    const until = clock.now() + REPLACE_EXIT_WAIT_MS;
    while (!current.exited && clock.now() < until) {
      await waitChange(current, until - clock.now());
    }
    /* Costuras: una más que la generación que se deja, si algún cliente llegó a verla; si no, las mismas
       (el cliente pasa de la anterior a esta cruzando un solo #EXT-X-DISCONTINUITY). */
    const base = current.dsnBases.get(current.generation) ?? current.generation - 1;
    current.dsnBases.set(current.generation + 1, current.served ? base + 1 : base);
    try {
      return await startLocked(current.source, current.hash, carry, {
        generation: current.generation + 1,
        startNumber,
        dsnBases: current.dsnBases,
        staleGraceMs: Math.min(STALE_GRACE_MAX_MS, Math.max(STALE_GRACE_MIN_MS, current.targetMs)),
      });
    } catch (error) {
      if (byHash.get(current.hash) === current) byHash.delete(current.hash);
      throw error;
    }
  }

  /**
   * Borra los ficheros de las generaciones anteriores (B2) un TD después de que la lista nueva esté: lo que
   * hls.js estuviera bajando de la vieja en ese momento aún llega, y no un 404.
   */
  function scheduleStaleDrop(entry: Entry): void {
    if (!entry.stalePending || entry.staleTimer) return;
    entry.staleTimer = clock.setTimeout(
      () => {
        entry.staleTimer = null;
        dropPreviousGenerations(entry).catch((error: unknown) =>
          logger.error({ err: error }, 'borrado de la generación anterior del remux'),
        );
      },
      entry.staleGraceMs,
      { unref: true },
    );
  }

  async function dropPreviousGenerations(entry: Entry): Promise<void> {
    if (!entry.stalePending) return;
    await registry.run(async () => {
      if (!entry.stalePending || entry.closed || byHash.get(entry.hash) !== entry) return;
      entry.stalePending = false;
      const stale = await previousGenerationFiles(entry.dir, entry.startNumber, entry.initName);
      for (const name of stale) await unlink(path.join(entry.dir, name)).catch(() => undefined);
    });
  }

  /** Marca la sesión como «a mitad de un reinicio» mientras dura `run`. */
  async function withReplacing<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    replacing.set(sessionId, (replacing.get(sessionId) ?? 0) + 1);
    try {
      return await run();
    } finally {
      const left = (replacing.get(sessionId) ?? 1) - 1;
      if (left > 0) replacing.set(sessionId, left);
      else replacing.delete(sessionId);
    }
  }

  /** Tope de 3 sesiones: desaloja solo las que no tienen espectadores (server.js:247-255). */
  async function makeRoomLocked(): Promise<void> {
    while (byHash.size + vods.size >= MAX_REMUX_SESSIONS) {
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
   * Espera del arranque (server.js:4914-4924; B-105): 2 segmentos y 6 s, o 1 y 20 s, 45 s como máximo.
   * Con `progressMs` (reinicio por salida atascada, B3), además `iptv_dropped` si en ese plazo la generación
   * nueva no ha escrito ni un segmento: se mide que avance, no que esté lista (con un GOP de 6 s, dos
   * segmentos tras reconectar pasan de 10 s aunque el relé se haya recuperado al momento).
   */
  async function waitReady(entry: Entry, signal?: AbortSignal, progressMs?: number): Promise<void> {
    if (entry.ready) {
      throwIfGone(entry);
      return;
    }
    const t0 = clock.now();
    for (;;) {
      throwIfGone(entry);
      const info = await readPlaylistInfo(path.join(entry.dir, 'index.m3u8'));
      throwIfGone(entry);
      /* Tras un reinicio continuo, la lista que hay puede ser aún la de la generación anterior (congelada):
         solo cuenta la que nombra el init de esta. */
      const ready = info && (entry.generation <= 1 || info.init === entry.initName) ? info : null;
      const waited = clock.now() - t0;
      /* IPTV (docs/iptv.md §6.3): 2 segmentos o 20 s como mucho; pasado eso, iptv_timeout. */
      if (entry.origin === 'iptv') {
        if (ready && ready.segments >= REMUX_TIMINGS.readySegments) {
          if (ready.targetDuration) entry.targetMs = ready.targetDuration * 1000;
          break;
        }
        if (progressMs !== undefined && waited > progressMs && !(ready && ready.segments >= 1)) {
          throw new AppError('iptv_dropped', { detail: 'la salida no avanza tras reconectar' });
        }
        if (waited > IPTV_REMUX_READY_MS) throw new AppError('iptv_timeout');
        await waitChange(entry, READY_POLL_MS, signal);
        continue;
      }
      if (
        ready &&
        ready.segments >= REMUX_TIMINGS.readySegments &&
        ready.seconds >= REMUX_TIMINGS.readySeconds
      )
        break;
      if (ready && ready.segments >= 1 && waited > REMUX_TIMINGS.readyFallbackAfterMs) break;
      if (waited > TIMEOUTS.remuxStartServerMs) throw new AppError('remux_timeout');
      await waitChange(entry, READY_POLL_MS, signal);
    }
    entry.ready = true;
    /* Primera observación de la lista: desde aquí cuenta el atasco. */
    await observe(entry);
    scheduleStaleDrop(entry);
  }

  function handleOf(entry: Entry, token: string): RemuxHandle {
    return {
      sessionId: entry.sessionId,
      hash: entry.hash,
      dir: entry.dir,
      startedAt: entry.startedAt,
      ready: entry.ready,
      ...(token ? { legacyToken: token } : {}),
    };
  }

  /** Un fichero de una sesión VOD (docs/vod.md §9.7): la lista del índice o lo que tiene el productor. */
  async function serveVodFile(
    reply: FastifyReply,
    sessionId: string,
    vod: { readonly producer: VodProducer; readonly startS: number },
    file: string,
    options: {
      readonly rangeHeader?: string;
      readonly head?: boolean;
      readonly videoToken?: string;
      readonly deviceId?: string | null;
    },
  ): Promise<void> {
    if (!VIDEO_FILE_RE.test(file)) throw new AppError('not_found');
    /* Pedir ficheros cuenta como actividad del visor (latido). */
    for (const listener of [...listeners]) {
      try {
        listener.onAccess?.(sessionId, options.deviceId ?? null);
      } catch (error) {
        logger.error({ err: error }, 'un suscriptor del remux ha fallado');
      }
    }
    const dir = path.join(remuxDir, `${VOD_DIR_PREFIX}${sessionId}`);
    const send = { rangeHeader: options.rangeHeader, head: options.head };
    if (file === 'index.m3u8') {
      const text = vod.producer.playlist(vod.startS > 0 ? vod.startS : undefined);
      const body = options.videoToken ? rewritePlaylist(text, options.videoToken) : text;
      await sendBuffer(reply, path.join(dir, file), Buffer.from(body), send);
      return;
    }
    const controller = new AbortController();
    const onClose = (): void => controller.abort();
    reply.raw.once('close', onClose);
    let result: Awaited<ReturnType<VodProducer['file']>>;
    try {
      result = await vod.producer.file(file, controller.signal);
    } finally {
      reply.raw.off('close', onClose);
    }
    if (reply.raw.destroyed) return;
    if (result.kind === 'file') {
      await sendFile(reply, result.path, send);
      return;
    }
    if (result.kind === 'not_yet') {
      /* Aún no está: hls.js reintenta (la app nativa, el 404 de siempre con Retry-After). */
      await sendBare(reply, options.videoToken ? 404 : 503, { ...NOT_YET_HEADERS });
      return;
    }
    await sendBare(reply, 404, { 'cache-control': 'no-store' });
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
      /* Carpetas VOD de un proceso anterior que murió sin limpiar (docs/vod.md §9.7). */
      const swept = await sweepVodDirs(remuxDir, new Set(vods.keys())).catch(() => []);
      if (swept.length) logger.info({ count: swept.length }, 'VOD: carpetas huérfanas borradas');
      reaper = clock.setInterval(
        () => {
          reap().catch((error: unknown) => logger.error({ err: error }, 'recolector del remux'));
        },
        REMUX_TIMINGS.reaperIntervalMs,
        { unref: true },
      );
      stallTimer = clock.setInterval(
        () => {
          watchStalls().catch((error: unknown) =>
            logger.error({ err: error }, 'vigilante de salida del remux'),
          );
        },
        IPTV_STALL_CHECK_MS,
        { unref: true },
      );
    },

    async stop() {
      stopped = true;
      clock.clearInterval(reaper);
      reaper = null;
      clock.clearInterval(stallTimer);
      stallTimer = null;
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
          const sameInput =
            sameSession && current.inputKey === inputKeyOf(source) && !current.exited;
          /* IPTV atascada (B3): no se relanza aquí (otro ffmpeg sobre un relé atascado tampoco avanza);
             se avisa a playback, que reconecta el relé con un reinicio continuo, y el visor se engancha ya.
             Red: si el aviso ya lleva `IPTV_ENSURE_RELAUNCH_MS` sin efecto (nadie lo atiende, o no hay sesión
             IPTV en playback), o nunca llegó a estar lista, se relanza como antes (`remuxStalled`). */
          let reusable = sameInput;
          if (sameInput && current.origin === 'iptv') {
            if (await isIptvStalled(current)) {
              if (
                current.stallNotified &&
                clock.now() - current.stallNotifiedAt > IPTV_ENSURE_RELAUNCH_MS
              ) {
                reusable = false;
              } else {
                emitStalled(current);
              }
            } else if (!current.ready && (await isStalled(current))) {
              reusable = false;
            }
          } else if (sameInput) {
            reusable = !(await isStalled(current));
          }
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
          current = await startLocked(source, hash, carry);
        }
        const attached = attach(current, viewerId, options.legacy);
        current.lastAccess = clock.now();
        return { entry: current, token: attached };
      });
      await waitReady(entry, signal);
      return handleOf(entry, token);
    },

    async retarget(source, signal) {
      if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
      return withReplacing(source.sessionId, async () => {
        const entry = await registry.run(async () => {
          const current = findBySession(source.sessionId);
          if (!current) return null;
          if (current.inputKey === inputKeyOf(source) && !current.exited) return current;
          const carry = carryOf(current);
          clearViewers(current);
          await closeLocked(current, 'stopped', false);
          return startLocked(source, current.hash, carry);
        });
        if (!entry) return null;
        await waitReady(entry, signal);
        return handleOf(entry, '');
      });
    },

    async restart(sessionId, signal, options = {}) {
      if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
      return withReplacing(sessionId, async () => {
        let progressMs: number | undefined;
        const entry = await registry.run(async () => {
          const current = findBySession(sessionId);
          if (!current) return null;
          const carry = carryOf(current);
          clearViewers(current);
          /* IPTV: reinicio continuo en la misma carpeta (B2). El resto, como siempre. */
          if (current.origin === 'iptv') {
            /* Por atasco (B3): el plazo para ver avanzar la generación nueva escala con el TD, como el umbral. */
            if (options.stalled) progressMs = iptvStallMs(current);
            return replaceLocked(current, carry);
          }
          await closeLocked(current, 'stopped', false);
          return startLocked(current.source, current.hash, carry);
        });
        if (!entry) return null;
        await waitReady(entry, signal, progressMs);
        const handle = handleOf(entry, '');
        return entry.generation > 1 ? { ...handle, seamless: true } : handle;
      });
    },

    restarting(sessionId) {
      return replacing.has(sessionId);
    },

    async openVod(request) {
      if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
      if (ffmpegMissing) throw new AppError('ffmpeg_missing');
      const index = await vodIndexes.get(request.titleId, () =>
        readVodIndex(
          createHttpRangeReader(request.inputUrl, {
            /* Un poco más que los reintentos del relé (3 × 8 s): ver iptv/relay-vod.ts. */
            timeoutMs: 30_000,
            ...(request.signal ? { signal: request.signal } : {}),
          }),
        ),
      );
      assertPlayable(index, request.hevc);
      const audio = pickVodAudio(index.audio, {
        requested: request.audio,
        preferredLang: request.preferredLang ?? null,
      });
      const last = Math.max(0, index.durationS - 1);
      const startS = Math.min(Math.max(0, request.startS), last);
      return registry.run(async () => {
        if (stopped) throw new AppError('remux_died', { detail: 'remux parado' });
        const previous = vods.get(request.sessionId);
        if (previous) {
          vods.delete(request.sessionId);
          await previous.producer.close();
        }
        await makeRoomLocked();
        const producer = await VodProducer.open(
          {
            clock,
            logger,
            launcher: vodLauncher,
            redact,
            onIdle: () => request.onIdle?.(),
            onDropped: (error) => request.onDropped?.(error),
          },
          {
            sessionId: request.sessionId,
            dir: path.join(remuxDir, `${VOD_DIR_PREFIX}${request.sessionId}`),
            inputUrl: request.inputUrl,
            index,
            audio,
            /* `-tag:v hvc1` solo si el VÍDEO es HEVC: `request.hevc` dice que el
               cliente lo decodifica (Chrome lo manda siempre) y, con H.264,
               ffmpeg no escribe la cabecera. */
            hevc: index.video.codec === 'hevc',
            startS,
          },
        );
        vods.set(request.sessionId, { producer, startS });
        logger.info(
          {
            sessionId: request.sessionId,
            container: index.container,
            video: index.video.codec,
            durationS: Math.round(index.durationS),
            segments: producer.plan.segments.length,
            startS: Math.round(startS),
          },
          'VOD: productor abierto',
        );
        return { sessionId: request.sessionId, index, audio, startS };
      });
    },

    async closeVod(sessionId) {
      await registry.run(async () => {
        const entry = vods.get(sessionId);
        if (!entry) return;
        vods.delete(sessionId);
        await entry.producer.close();
      });
    },

    setVodStart(sessionId, startS) {
      const entry = vods.get(sessionId);
      if (entry) entry.startS = Math.max(0, startS);
    },

    vodStats(sessionId) {
      return vods.get(sessionId)?.producer.stats() ?? null;
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
      const vod = vods.get(sessionId);
      if (vod) {
        await serveVodFile(reply, sessionId, vod, file, options);
        return;
      }
      const entry = findBySession(sessionId);
      if (!entry) {
        /* A mitad de un reinicio: «aún no está» (503 con Retry-After; la app nativa, el 404 de siempre
           con Retry-After), no un 410 que el reproductor toma por sesión perdida (P9). */
        if (replacing.has(sessionId) && VIDEO_FILE_RE.test(file)) {
          await sendBare(reply, options.videoToken ? 404 : 503, { ...NOT_YET_HEADERS });
          return;
        }
        throw new AppError('session_expired', { detail: 'la sesión no tiene remux' });
      }
      if (!VIDEO_FILE_RE.test(file)) throw new AppError('not_found');
      touch(entry, options.deviceId ?? null);
      const full = path.join(entry.dir, file);
      /* La lista de un remux que arranca o se reinicia puede no estar todavía: «aún no está» (503 con
         Retry-After), no un error (docs/iptv.md §18). */
      const playlist = file === 'index.m3u8';
      const send = {
        rangeHeader: options.rangeHeader,
        head: options.head,
        notYet: playlist,
        notYetWaitMs,
      };
      /* Tras un reinicio continuo (generación 2 en adelante) la lista lleva además el
         `#EXT-X-DISCONTINUITY-SEQUENCE` que ffmpeg no escribe (B2); la de la primera sale tal cual. */
      if (playlist && (options.videoToken || entry.generation > 1)) {
        const text = await readWhenReady(full, notYetWaitMs);
        if (text === null) {
          /* La app nativa (con ?t=) sigue recibiendo el 404 de siempre (su reproductor ya lo reintenta),
             ahora con Retry-After; la web, el 503 «aún no está». */
          await sendBare(reply, options.videoToken ? 404 : 503, { ...NOT_YET_HEADERS });
          return;
        }
        /* Lo que sale de la generación de ahora cuenta como servido (para las costuras de la siguiente). */
        const generation = generationOfInit(playlistInfoFromText(text).init);
        if (generation === entry.generation) entry.served = true;
        const body = withDiscontinuitySequence(text, (g) => entry.dsnBases.get(g));
        await sendBuffer(
          reply,
          full,
          Buffer.from(options.videoToken ? rewritePlaylist(body, options.videoToken) : body),
          send,
        );
        if (!options.videoToken) await observe(entry);
        return;
      }
      const seen = await sendFile(reply, full, send);
      if (seen && file === 'index.m3u8') noteObservation(entry, seen);
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
      /* Con la sesión viva, su lista que aún no está es «aún no está» (503), no 404 (docs/iptv.md §18). */
      const playlist = path.basename(file) === 'index.m3u8';
      const seen = await sendFile(reply, file, {
        ...options,
        notYet: playlist && !!entry,
        notYetWaitMs,
      });
      if (seen && entry && playlist) noteObservation(entry, seen);
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
        for (const [sessionId, entry] of [...vods]) {
          vods.delete(sessionId);
          await entry.producer.close();
        }
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
      })),
    reap,
    watchStalls,
    idle: () => registry.idle(),
  };
}
