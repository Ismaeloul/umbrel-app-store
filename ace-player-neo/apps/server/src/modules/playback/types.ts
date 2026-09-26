/* Módulo `playback`: dueño de las sesiones del motor principal, de los
   visores y del mando (arquitectura §5.6, D5; backend-modulos §3.15;
   reproductor.md §2 y §6).

   Hechos comprobados contra el motor real (motor-real §2-§7): otra sesión del
   mismo contenido mata la anterior (403); HLS admite varios lectores; el
   progresivo, uno solo.

   - `EngineSession`: una por contenido y, en la 0.7.0, una sola a la vez en
     el motor principal. Siempre abierta con `format=json` (tiene
     `command_url`); se guarda en v2/sessions.json para pararla aunque el
     proceso muera.
   - `Viewer`: una reproducción concreta (una pestaña o un reproductor), con
     latido cada 15 s; sin latido en 45 s se da por ido. Sin visores, `stop`.
   - Sin carreras: cola por visor, `release` de lo anterior ANTES de abrir lo
     nuevo y número de generación (lo que hoy hace `S.playToken`).
   - Mismo canal: `share` (se comparte y pasa a HLS; `stream.modeChanged`) o
     `handoff` (el último manda, como la 0.6.59, avisando al momento).
     Canales distintos: siempre traspaso.
   - Estadísticas: lee `stat_url` cada 2 s con visores y publica `stream.stats`.
   - Mando antiguo: `nowPlaying` sigue en state.json y /api/playback* responde
     igual (T-037, T-038, T-115; B-005 a B-008); un `claim` antiguo cuenta como
     visor `legacy` sin latido que caduca a los 45 s.

   Publica en el bus `playback.*` y `stream.*`, y `playback.activity` para el
   vigilante del motor y el comprobador.

   Tests a portar: T-037 (B-006), T-038 (B-007), T-115 (B-277) y los de
   sesiones de plan E1.5 con el motor falso. */

import type {
  ChannelStreamQuery,
  HeartbeatBody,
  HeartbeatResponse,
  LegacyClaimBodySchema,
  LegacyClaimResponseSchema,
  LegacyPlaybackResponseSchema,
  LegacyReleaseBodySchema,
  LegacyReleaseResponseSchema,
  LegacyRemuxResponseSchema,
  PlaybackStatus,
  ReleaseBody,
  ReleaseResponse,
  StreamGrant,
} from '@ace/shared';
import type { z } from 'zod';
import type { AuthenticatedDevice, CoreDeps, Lifecycle } from '../../core/module.js';
import type { EngineService } from '../engine/types.js';
import type { IptvService } from '../iptv/types.js';
import type { RemuxService } from '../remux/types.js';
import type { ScannerService } from '../scanner/types.js';
import type { StateService } from '../state/types.js';

export interface PlaybackDeps extends CoreDeps {
  readonly engine: EngineService;
  readonly remux: RemuxService;
  readonly state: StateService;
  /** Para el códec de la respuesta (veredicto del comprobador o del reproductor, §6.3). */
  readonly scanner: ScannerService;
  /**
   * La IPTV (docs/iptv.md §6.4): una sesión IPTV se coloca con el MISMO
   * cerrojo de la casa y solo cambia la apertura (relé + remux). Opcional.
   */
  readonly iptv?: IptvService;
}

/** Quién pide el canal. */
export interface ViewerIdentity {
  readonly viewerId: string;
  /** Persistente: localStorage en la web; el dispositivo emparejado en iOS. */
  readonly deviceId: string | null;
  readonly device: AuthenticatedDevice | null;
  /**
   * Nombre legible para «Dónde se está reproduciendo»: el del emparejado en
   * iOS o el sacado del User-Agent en la web (device-name.ts). Sin él, el del
   * emparejado o "Navegador".
   */
  readonly deviceName?: string | null;
}

export interface PlaybackService extends Lifecycle {
  /**
   * GET /api/v1/channels/:id/stream (arquitectura §6.3): abre o se une a la
   * sesión del canal, espera a que la URL sea reproducible y la devuelve.
   * Si la señal se aborta (el cliente cuelga), se cancela y suelta lo abierto.
   */
  acquire(
    hash: string,
    query: ChannelStreamQuery,
    viewer: ViewerIdentity,
    signal: AbortSignal,
  ): Promise<StreamGrant>;
  /** Latido de un visor; 410 `session_expired` si la sesión ya no existe. */
  heartbeat(
    sessionId: string,
    body: HeartbeatBody,
    viewer: ViewerIdentity,
  ): Promise<HeartbeatResponse>;
  /** Soltar (también por `sendBeacon`); si la sesión queda sin visores, `stop` y fuera de sessions.json. */
  release(sessionId: string, body: ReleaseBody, viewer: ViewerIdentity): Promise<ReleaseResponse>;
  /** GET /api/v1/playback. */
  status(): PlaybackStatus;
  /** Suelta todos los visores de un dispositivo (revocación, arquitectura §5.12). */
  releaseDevice(deviceId: string): Promise<void>;
  /** ¿Sigue vivo este visor en esta sesión? (URLs de vídeo firmadas que siguen valiendo tras `exp`). */
  isViewerAlive(sessionId: string, deviceId: string): boolean;

  // --- Rutas antiguas (misma forma que la 0.6.59) ---
  /** GET /api/playback: SOLO `nowPlaying`, `learningCount` y `serverTime` (T-115). */
  legacyStatus(): z.infer<typeof LegacyPlaybackResponseSchema>;
  /** `claimPlayback` (server.js:1177): marca monótona `max(ahora, anterior + 1)` y lápidas (T-037, T-038). */
  legacyClaim(
    body: z.infer<typeof LegacyClaimBodySchema>,
  ): Promise<z.infer<typeof LegacyClaimResponseSchema>>;
  /** `releasePlayback` (server.js:1200): deja una lápida de 60 s del token. */
  legacyRelease(
    body: z.infer<typeof LegacyReleaseBodySchema>,
  ): Promise<z.infer<typeof LegacyReleaseResponseSchema>>;
  /**
   * GET /api/remux de la 0.6.59 (api.md §4.21): abre la sesión del canal y el
   * remux y espera a que la lista esté lista. Los 502/504 los manda la ruta.
   */
  legacyRemux(
    query: URLSearchParams,
    signal: AbortSignal,
  ): Promise<z.infer<typeof LegacyRemuxResponseSchema>>;

  // --- Arranque y apagado (arquitectura §5.16) ---
  /** Para las sesiones que quedaron en v2/sessions.json de un proceso anterior. */
  recoverOrphans(): Promise<void>;
  /** Para todas las sesiones en paralelo con 4 s de tope. */
  stopAll(timeoutMs: number): Promise<void>;
}
