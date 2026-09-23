/* Piezas comunes a todos los módulos del backend (arquitectura §5.1).

   Regla: ningún módulo guarda estado global ni lee `process.env`. Cada
   fábrica `create<Módulo>Service(deps)` recibe TODO lo que usa: el núcleo
   (`CoreDeps`) y los servicios de los que depende según el mapa de
   arquitectura §5.2. Así los tests montan un módulo con fakes y en cualquier
   orden (comportamientos-tests §1.9: en la 0.6.59 los tests dependían del
   orden por los globales de server.js). */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DeviceRecord, Origin } from '@ace/shared';
import type { AppConfig } from '../config/index.js';
import type { DomainBus } from './bus.js';
import type { Clock } from './clock.js';
import type { Logger } from './logger.js';

/** Lo que reciben todos los módulos. */
export interface CoreDeps {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly bus: DomainBus;
}

/**
 * Trabajos de fondo de un módulo (vigilantes, temporizadores, suscripciones
 * al bus). `start` se llama en el arranque (arquitectura §5.16, paso 4) y
 * `stop` en el apagado; los dos son idempotentes.
 */
export interface Lifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Dispositivo emparejado que hace la petición (solo origen native). */
export interface AuthenticatedDevice {
  readonly deviceId: string;
  readonly device: DeviceRecord;
  /** Cómo se identificó: token Bearer o URL de vídeo firmada. */
  readonly via: 'bearer' | 'video-token';
}

/** Contexto de una petición, igual para rutas antiguas y v1. */
export interface RequestContext {
  /** `X-Request-Id` (el de nginx si llega, arquitectura §5.15). */
  readonly requestId: string;
  readonly origin: Origin;
  /** El dispositivo si el origen es native y ya se comprobó su credencial. */
  readonly device: AuthenticatedDevice | null;
  /**
   * Se aborta si el cliente cuelga: las esperas largas (arranque del remux,
   * meta de la sesión) se cancelan con ella (api.md §6.16).
   */
  readonly signal: AbortSignal;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
}
