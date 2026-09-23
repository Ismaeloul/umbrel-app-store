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
}

export interface RemuxStats {
  readonly sessions: number;
  readonly max: number;
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
  ensure(source: RemuxSource, viewerId: string, signal?: AbortSignal): Promise<RemuxHandle>;
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
    },
  ): Promise<void>;
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
