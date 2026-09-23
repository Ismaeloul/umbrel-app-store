/* Módulo `remux`: ffmpeg a HLS fMP4 para iPhone (arquitectura §5.7;
   backend-modulos §3.16; B-217 a B-226).

   - Entrada: SIEMPRE la `playbackUrl` de una sesión que abrió el backend
     (progresiva o HLS), nunca un `getstream` abierto por ffmpeg por su cuenta
     (hoy nadie puede pararlo: P7, P8, backend-modulos §8.3.16).
   - Argumentos de hoy (server.js:259-318, T-125) desde una función pura, más
     `-nostdin`, `-threads 2`, `-loglevel warning` y
     `-metadata ace_session=<id>`; prioridad baja con `os.setPriority`.
   - Como mucho 3 sesiones; solo se desaloja una sin espectadores; si todas
     tienen, 503 `remux_busy`: nunca se expulsa a un espectador (T-112, B-223).
   - Huérfanos: grupo de procesos propio y reaper cada 15 s que mata también
     los ffmpeg con `ace_session=` que no estén en el registro.
   - Log de ffmpeg en un búfer circular de 64 KiB; al morir con error, su
     final va a diagnóstico (causa `codec` o `engine`).
   - Espera de arranque: 2 segmentos y 6 s, o 1 y 20 s, 45 s como máximo;
     cancelada si el cliente cuelga.
   - Servido con Range, 206/416 y `no-store` en `/remux/<hash>/<fichero>`
     (T-035) y `/api/v1/video/<sid>/<fichero>` (m3u8 reescrito con `?t=`).

   Tests a portar: T-003 (parseByteRange, B-221), T-035 (B-221, B-222),
   T-112 (B-223), T-125 (B-075, B-105 a B-109, B-222, B-224, B-225). */

import type { FastifyReply } from 'fastify';
import type { LegacyRemuxStopBodySchema, LegacyRemuxStopResponseSchema } from '@ace/shared';
import type { z } from 'zod';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { EngineService } from '../engine/types.js';

export interface RemuxDeps extends CoreDeps {
  readonly engine: EngineService;
  /** Quién lanza ffmpeg. Por defecto `spawn('ffmpeg')`; en los tests, un ffmpeg falso. */
  readonly launcher?: ProcessLauncher;
  /**
   * Raíz de /proc para buscar ffmpeg huérfanos con `ace_session=`. Por defecto
   * `/proc` en Linux y nada en otros sistemas; `null` lo desactiva.
   */
  readonly procRoot?: string | null;
  /** Cómo se mata un huérfano (tests). Por defecto, `kill(-pid)` y si no `kill(pid)`. */
  readonly killPid?: (pid: number) => void;
  /** Vigilar la carpeta con `fs.watch` para enterarse antes de los segmentos nuevos. Por defecto sí. */
  readonly watchFiles?: boolean;
}

/** Proceso ffmpeg lanzado (el real o el falso de los tests). */
export interface RemuxProcess {
  readonly pid: number | undefined;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  /** `ENOENT` = no hay ffmpeg (el remux se desactiva sin romper nada: `ffmpeg_missing`). */
  onError(listener: (error: Error & { code?: string }) => void): void;
  onStderr(listener: (chunk: Buffer) => void): void;
  /** Mata el proceso (y su grupo en POSIX). Nunca lanza. */
  kill(): void;
}

export interface ProcessLauncher {
  spawn(args: readonly string[]): RemuxProcess;
}

/** Por qué una sesión del remux deja sin vídeo a sus visores. */
export type RemuxCloseReason = 'idle' | 'stopped' | 'died' | 'evicted' | 'shutdown';

/**
 * Avisos del remux a quien lo usa (playback) sin bus ni dependencia al revés
 * (playback depende de remux, no al contrario).
 */
export interface RemuxListener {
  /** Se ha servido un fichero de la sesión: cuenta como latido (arquitectura §5.6). */
  onAccess?(sessionId: string, deviceId: string | null): void;
  /** Visores que se quedan sin remux: un `stop` antiguo, el recolector, ffmpeg muerto o un desalojo. */
  onDetached?(sessionId: string, viewerIds: readonly string[], reason: RemuxCloseReason): void;
}

export interface RemuxEnsureOptions {
  /**
   * Enganche de un cliente 0.6.x por `/api/remux`: cada petición estrena
   * ficha (`legacyToken`) y `device` (vacío si no llegó `dev`) queda como
   * cliente de la sesión, como en `ensureRemux` (server.js:237-245, B-222).
   */
  readonly legacy?: { readonly device: string };
}

/** Lo que necesita el remux de la sesión del motor que le da playback. */
export interface RemuxSource {
  /** Id de la sesión del backend (`s_…`): va en `-metadata ace_session=`. */
  readonly sessionId: string;
  readonly hash: string;
  /** `playbackUrl` relativa de la sesión (`/ace/r/…` o `/ace/m/…`). */
  readonly playbackUrl: string;
  readonly mode: 'progressive' | 'hls';
}

export interface RemuxHandle {
  readonly sessionId: string;
  readonly hash: string;
  /** Carpeta con index.m3u8, init.mp4 e index<N>.m4s. */
  readonly dir: string;
  readonly startedAt: number;
  /** Lista lista para reproducir (arranque completado). */
  readonly ready: boolean;
  /** Ficha de 16 hex del enganche antiguo (solo con `options.legacy`). */
  readonly legacyToken?: string;
}

export interface RemuxStats {
  readonly sessions: number;
  readonly max: number;
  /** No hay ffmpeg: el remux está desactivado (`ffmpeg_missing`). */
  readonly ffmpegMissing?: boolean;
}

/** Rango HTTP ya interpretado (`parseByteRange`, server.js:346). */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface RemuxService extends Lifecycle {
  /**
   * Arranca (o reutiliza, P9) el ffmpeg de una sesión y espera a que la lista
   * tenga colchón. Lanza `remux_busy`, `remux_timeout`, `remux_died`,
   * `ffmpeg_missing`. Con la señal abortada, deja de esperar.
   */
  ensure(
    source: RemuxSource,
    viewerId: string,
    signal?: AbortSignal,
    options?: RemuxEnsureOptions,
  ): Promise<RemuxHandle>;
  /**
   * La sesión del motor ha cambiado de URL (pasa a HLS o se ha reabierto tras
   * un reinicio): relanza ffmpeg sobre la nueva con los mismos visores y
   * fichas, y espera a que haya colchón. `null` si la sesión no tenía remux.
   */
  retarget(source: RemuxSource, signal?: AbortSignal): Promise<RemuxHandle | null>;
  /** Un visor deja la sesión; sin visores, ffmpeg se para. */
  detach(sessionId: string, viewerId: string): Promise<void>;
  /** Sirve un fichero de la sesión con Range (206/416) y `no-store`; en m3u8, reescribe las URI con `?t=`. */
  serveFile(
    reply: FastifyReply,
    sessionId: string,
    file: string,
    options: {
      readonly rangeHeader?: string;
      readonly head?: boolean;
      readonly videoToken?: string;
      /** Dispositivo del token de vídeo: la petición cuenta como su latido. */
      readonly deviceId?: string | null;
    },
  ): Promise<void>;
  /** Suscribe a los avisos del remux (playback). Devuelve la baja. */
  subscribe(listener: RemuxListener): () => void;
  /** Visores con remux de una sesión (vacío si no tiene). */
  viewersOf(sessionId: string): readonly string[];
  /** Compatibilidad: `/remux/<hash>/<fichero>` de la 0.6.59 (T-035). 403 sin cuerpo si la ruta no vale. */
  serveLegacyFile(
    reply: FastifyReply,
    url: string,
    options: { readonly rangeHeader?: string; readonly head?: boolean },
  ): Promise<void>;
  /** POST /api/remux/stop de la 0.6.59 (`{id, dev, keepAlive, token}`, B-222). */
  legacyStop(
    body: z.infer<typeof LegacyRemuxStopBodySchema>,
  ): Promise<z.infer<typeof LegacyRemuxStopResponseSchema>>;
  stats(): RemuxStats;
  /** Mata todos los ffmpeg (apagado). */
  stopAll(): Promise<void>;
  /** Vacía `remux/` al arrancar (server.js:5134). */
  cleanWorkDir(): Promise<void>;

  // --- Funciones puras ---
  /** Argumentos de ffmpeg (T-125). */
  buildArgs(input: {
    readonly url: string;
    readonly dir: string;
    readonly sessionId: string;
  }): string[];
  /** `parseByteRange` (server.js:346): `{start,end}` o false si no se puede servir (T-003). */
  parseByteRange(header: string | undefined, size: number): ByteRange | false | null;
}
