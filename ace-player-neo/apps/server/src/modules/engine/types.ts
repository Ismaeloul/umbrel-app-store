/* Módulo `engine`: cliente del motor AceStream principal, reinicio vía
   engine_control y vigilante con histéresis (arquitectura §5.5;
   backend-modulos §3.5 y §6; B-001 a B-013).

   - Cliente: cada llamada con plazo (TIMEOUTS de @ace/shared) y tope de
     512 KiB (hoy `aceRequest` no tiene tope). Siempre `format=json`, así el
     backend tiene `command_url` para parar la sesión (sin zombis, P7-P8).
     Las URL que devuelve el motor se reducen a ruta relativa `/ace/…` o
     `/content/…` (regla de `scannerEnginePath`, T-072).
   - Vigilante (lo que hoy hace el navegador con `motorSinRespuesta`,
     index.html:4238-4245): `get_version` cada 10 s; `offline` tras 2 fallos
     seguidos con alguien viendo y 3 sin nadie; `online` con 2 aciertos;
     publica `engine.status` en el bus SOLO al cambiar. Sabe si hay alguien
     viendo por el evento `playback.activity` (no depende de playback).
   - Reinicio automático solo con un visor esperando y el motor 60 s
     `offline` o 3 aperturas fallidas seguidas; espera 1, 2 y 4 min; como
     mucho 3 por hora. El manual conserva sus 15 s de enfriamiento
     (`restart_cooldown`, 429) y no gasta el cupo.

   Tests a portar: T-118 (B-229, contra engine-control) y los del vigilante
   de plan E1.5 con el motor falso (test/fake-engine). */

import type {
  EngineSessionKind,
  EngineSessionMode,
  EngineStatus,
  LegacyEngineStatusResponseSchema,
} from '@ace/shared';
import type { z } from 'zod';
import type { CoreDeps, Lifecycle } from '../../core/module.js';

export type EngineDeps = CoreDeps;

/** Lo que devuelve el motor al abrir una sesión con `format=json` (motor-real §2). */
export interface EngineSessionMeta {
  /** Ruta relativa `/ace/r/…` (progresivo) o `/ace/m/…` (HLS). */
  readonly playbackUrl: string;
  /** Ruta relativa `/ace/stat/…`. */
  readonly statUrl: string;
  /** Ruta relativa `/ace/cmd/…`: con `method=stop` cierra la sesión. */
  readonly commandUrl: string;
  readonly infohash: string | null;
  readonly isLive: boolean | null;
}

/** Lo que da `stat_url` (velocidades en KB/s). */
export interface EngineStat {
  readonly status: string;
  readonly peers: number;
  readonly speedDown: number;
  readonly speedUp: number;
  readonly downloaded: number | null;
}

export interface OpenSessionRequest {
  readonly hash: string;
  readonly kind: EngineSessionKind;
  readonly mode: EngineSessionMode;
  readonly signal?: AbortSignal;
}

export interface EngineClient {
  /** `getstream?…&format=json` o `manifest.m3u8?…&format=json` (12 s). Lanza `engine_unavailable`, `engine_timeout`, `source_no_peers`. */
  openSession(request: OpenSessionRequest): Promise<EngineSessionMeta>;
  /** `stat_url` (3 s). */
  getStat(statUrl: string, signal?: AbortSignal): Promise<EngineStat>;
  /** `command_url&method=stop` (2,5 s). Nunca lanza: una sesión que no se deja parar se anota en diagnóstico. */
  stop(commandUrl: string): Promise<void>;
  /** `get_version` (3 s): la versión del motor ("3.2.3"). */
  version(signal?: AbortSignal): Promise<string>;
  /** Cuerpo crudo de `/search` (12 s); lo interpreta el módulo search. */
  searchRaw(query: string, signal?: AbortSignal): Promise<string>;
}

export interface EngineService extends Lifecycle {
  /** Cliente HTTP del motor principal (el comprobador tiene el suyo, con otro host). */
  client(): EngineClient;
  /** Estado con histéresis del vigilante (sin red: sale de la caché). */
  status(): EngineStatus;
  /**
   * `/api/engine/status` de la 0.6.59: `{ online, raw }` (raw = los 300
   * primeros caracteres de `get_version`). Sale de la caché del vigilante en
   * vez de preguntar al motor en cada petición.
   */
  legacyStatus(): z.infer<typeof LegacyEngineStatusResponseSchema>;
  /**
   * Reinicio pedido por alguien (`/api/restart-engine`, POST /api/v1/engine/restart):
   * enfriamiento de 15 s (`restart_cooldown`) y `restart_failed` si
   * engine_control no responde bien. No gasta el cupo automático.
   */
  restartManual(): Promise<{ readonly restarted: true }>;
  /** Espera a que el motor dé 2 respuestas buenas seguidas (90 s como máximo). */
  waitUntilReady(signal?: AbortSignal): Promise<void>;
  /** Playback avisa de una apertura fallida por culpa del motor (cuenta para el reinicio automático). */
  reportOpenFailure(): void;
  reportOpenSuccess(): void;
}
