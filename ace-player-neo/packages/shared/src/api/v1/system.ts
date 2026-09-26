/* Rutas de sistema de /api/v1: ping, arranque de los clientes (bootstrap),
   salud y conexión SSE. */

import { z } from 'zod';
import {
  DeviceIdSchema,
  EpochMsSchema,
  IsoDateTimeSchema,
  OriginSchema,
} from '../../primitives.js';
import { PreferencesSchema } from '../../state/v1.js';
import { SettingsSchema } from '../../state/v2.js';
import { DeviceSchema } from './auth.js';
import { DiagnosticCountsSchema } from './diagnostics.js';
import { EngineStatusSchema } from './engine.js';
import { LibraryViewSchema } from './library.js';
import { PlaybackStatusSchema } from './playback.js';

/** GET /api/v1/ping: vivo y versión, sin datos. Sin token también desde /native. */
export const PingResponseSchema = z.strictObject({
  ok: z.literal(true),
  app: z.literal('ace-player-neo'),
  version: z.string(),
  apiVersion: z.literal(1),
  serverTime: EpochMsSchema,
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

/** GET /api/v1/health/live: healthcheck de Docker, sin red ni disco. */
export const HealthLiveResponseSchema = z.strictObject({ ok: z.literal(true) });
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;

/** GET /api/v1/bootstrap: todo lo que necesita un cliente para pintar la primera pantalla. */
export const BootstrapResponseSchema = z.strictObject({
  version: z.string(),
  serverTime: EpochMsSchema,
  origin: OriginSchema,
  /** El dispositivo emparejado que pregunta (solo origen `native`). */
  device: DeviceSchema.nullable(),
  preferences: PreferencesSchema,
  library: LibraryViewSchema,
  playback: PlaybackStatusSchema,
  engine: EngineStatusSchema,
  settings: SettingsSchema,
  features: z.strictObject({
    /** Hay segundo motor para comprobar fuentes. */
    scanner: z.boolean(),
    /** Hay Ollama configurado. */
    ai: z.boolean(),
    /** La agenda es la de muestra (`FOOTBALL_DEMO_ONLY`). */
    demoSchedule: z.boolean(),
    /**
     * Hay IPTV activa con catálogo cargado (docs/iptv.md §5.1). Es el dato
     * barato con el que la web y la app deciden si preguntan por la IPTV al
     * tocar un canal o al abrir un partido sin canales. Opcional: ausente es
     * «no». El ejemplo `fixtures/v1/bootstrap.json` no lo lleva, para no
     * cambiar la ida y vuelta de la app.
     */
    iptv: z.boolean().optional(),
    /**
     * El servidor entiende `others`, `from`, `join`, `match` y `follows` al
     * pedir un canal (docs/multidispositivo.md §2.2). Un cliente solo los
     * manda con `multi === true`. Opcional: ausente es «no».
     */
    multi: z.boolean().optional(),
  }),
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;

const ComponentStatus = z.enum(['ready', 'degraded', 'offline', 'disabled', 'warming']);

/**
 * GET /api/v1/health: panel de salud. Sale de las cachés del vigilante del
 * motor y del comprobador, sin hacer peticiones de red en cada llamada
 * (backend-modulos §8.7.37). La forma antigua sigue en /api/health.
 */
export const HealthResponseSchema = z.strictObject({
  version: z.string(),
  checkedAt: IsoDateTimeSchema,
  uptimeSeconds: z.number().int().nonnegative(),
  components: z.strictObject({
    backend: z.strictObject({ status: z.literal('ready') }),
    engine: EngineStatusSchema,
    scanner: z.strictObject({
      status: ComponentStatus,
      busy: z.boolean(),
      queue: z.number().int().nonnegative(),
      activeJobs: z.number().int().nonnegative(),
      cachedSources: z.number().int().nonnegative(),
      /** Sesiones que el comprobador no pudo parar en la última hora (arquitectura §5.8). */
      leakedSessionsLastHour: z.number().int().nonnegative(),
    }),
    ai: z.strictObject({
      status: z.enum(['disabled', 'ready', 'model_missing', 'offline']),
      model: z.string(),
    }),
    agenda: z.strictObject({
      status: z.enum(['ready', 'stale', 'warming']),
      generatedAt: IsoDateTimeSchema.nullable(),
      matches: z.number().int().nonnegative(),
      preheated: z.number().int().nonnegative(),
    }),
    directories: z.strictObject({
      status: z.enum(['ready', 'degraded', 'empty']),
      total: z.number().int().nonnegative(),
      channels: z.number().int().nonnegative(),
    }),
    state: z.strictObject({
      /** `recovered` si al arrancar se tuvo que tirar de una copia; `degraded` si se arrancó vacío con ficheros apartados. */
      status: z.enum(['ready', 'recovered', 'degraded']),
      recoveredFrom: z.string().nullable(),
    }),
    playback: z.strictObject({
      sessions: z.number().int().nonnegative(),
      viewers: z.number().int().nonnegative(),
      remuxSessions: z.number().int().nonnegative(),
    }),
    events: z.strictObject({ connections: z.number().int().nonnegative() }),
  }),
  reports: z.strictObject({
    total: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    learningCount: z.number().int().nonnegative(),
  }),
  diagnostics: z.strictObject({ counts24h: DiagnosticCountsSchema }),
  /** Avisos para enseñar tal cual (cupo de reinicios agotado, fugas del comprobador…). */
  warnings: z.array(z.strictObject({ code: z.string(), message: z.string() })),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * GET /api/v1/events (SSE). La web manda su id persistente en `device` para
 * recibir lo de sus visores; en iOS sale del token. Para reanudar se usa la
 * cabecera `Last-Event-ID` (EventSource la pone sola) o `lastEventId`.
 */
export const EventsQuerySchema = z.strictObject({
  device: DeviceIdSchema.optional(),
  lastEventId: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional(),
});
export type EventsQuery = z.infer<typeof EventsQuerySchema>;
