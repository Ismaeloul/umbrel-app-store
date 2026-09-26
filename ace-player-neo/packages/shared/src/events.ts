/* Eventos del tiempo real por SSE (arquitectura §5.13). Sustituyen al
   sondeo de /api/playback cada 5 s y avisan al momento del traspaso (hoy
   tarda hasta 5 s y suenan los dos dispositivos, reproductor §6.2).

   Formato en el cable: `id: <n>`, `event: <type>` y `data: <JSON de data>`.
   El `data` se valida con estos esquemas antes de enviarlo. */

import { z } from 'zod';
import {
  ClientKindSchema,
  HashSchema,
  IsoDateTimeSchema,
  ScanJobIdSchema,
  SessionIdSchema,
  ViewerIdSchema,
} from './primitives.js';
import { NowPlayingSchema } from './state/v1.js';
import {
  PlayableOnSchema,
  ScanJobKindSchema,
  ScanJobStatusSchema,
  VerdictStateSchema,
} from './api/common.js';
import { EngineStatusSchema } from './api/v1/engine.js';
import { DiagnosticEntrySchema } from './api/v1/diagnostics.js';
import { IptvStatusSchema } from './api/v1/iptv.js';
import {
  DEVICE_NAME_MAX,
  MatchRefSchema,
  SessionSummarySchema,
  StreamProtocolSchema,
} from './api/v1/playback.js';

// --- Reproducción ---

export const PlaybackNowPlayingEventSchema = z.strictObject({
  type: z.literal('playback.nowPlaying'),
  data: z.strictObject({
    nowPlaying: NowPlayingSchema.nullable(),
    learningCount: z.number().int().nonnegative(),
  }),
});

/** El visor tiene que pararse: otro dispositivo se ha quedado el mando. */
export const PlaybackHandoffEventSchema = z.strictObject({
  type: z.literal('playback.handoff'),
  data: z.strictObject({
    /** La sesión que pierde este visor. */
    sessionId: SessionIdSchema.nullable(),
    /** Visores afectados (el cliente se queda con los suyos). */
    viewerIds: z.array(ViewerIdSchema),
    /** Quién se lo ha quedado. */
    byDeviceId: z.string().nullable(),
    byClient: ClientKindSchema,
    hash: HashSchema,
    title: z.string(),
    /** `other_channel`: canales distintos, siempre traspaso. `same_channel`: política `handoff`. */
    reason: z.enum(['other_channel', 'same_channel']),
    /*
     * Varios dispositivos (docs/multidispositivo.md §2.2). Opcionales: un
     * cliente que no los conoce se para como hasta la 0.8.1.
     */
    /** Nombre legible del que se lo ha quedado («Chrome · Windows», «iPhone de Isma», «App antigua (0.6)»). */
    byDeviceName: z.string().max(DEVICE_NAME_MAX).optional(),
    /** true: el que cambia ha elegido «Cambiar en los dos»; el visor debe pasar solo a `hash` (con `join=1`). */
    follow: z.boolean().optional(),
    /** Partido del canal nuevo, si se pidió desde un partido. */
    matchId: MatchRefSchema.optional(),
  }),
});

/**
 * «Dónde se está reproduciendo»: la lista entera de sesiones (la misma forma
 * que `sessions` de GET /api/v1/playback) cada vez que cambia: se abre o se
 * cierra una sesión, entra o sale un visor o cambia su `playing`. No se
 * emite por cada latido (`lastBeatAt` va al día solo en el GET). Va a todas
 * las conexiones, web e iOS.
 */
export const PlaybackSessionsEventSchema = z.strictObject({
  type: z.literal('playback.sessions'),
  data: z.strictObject({
    sessions: z.array(SessionSummarySchema),
  }),
});

const StreamTargetShape = {
  sessionId: SessionIdSchema,
  /** Visores de esa sesión a los que va dirigido (el cliente filtra los suyos). */
  viewerIds: z.array(ViewerIdSchema),
};

/** La sesión está lista para reproducir (por ejemplo, el remux ya tiene colchón). */
export const StreamReadyEventSchema = z.strictObject({
  type: z.literal('stream.ready'),
  data: z.strictObject({
    ...StreamTargetShape,
    url: z.string().startsWith('/'),
    protocol: StreamProtocolSchema,
  }),
});

/**
 * Tras un reinicio del motor, playback reabre la sesión y avisa con la URL
 * nueva (arquitectura §5.5). `remux_restart` también cuando el relé de la
 * IPTV reconecta y llega otra base de tiempos, o cambia de variante: mismo
 * `sid`, ffmpeg nuevo (docs/iptv.md §5.5 y §6.1).
 */
export const StreamReopenedEventSchema = z.strictObject({
  type: z.literal('stream.reopened'),
  data: z.strictObject({
    ...StreamTargetShape,
    url: z.string().startsWith('/'),
    protocol: StreamProtocolSchema,
    reason: z.enum(['engine_restart', 'engine_recovered', 'remux_restart']),
  }),
});

/**
 * D5: se une un segundo dispositivo al MISMO canal con la política `share` y
 * la sesión pasa de progresiva a HLS. El primer visor se reengancha con
 * hls.js a la URL nueva (un corte breve).
 */
export const StreamModeChangedEventSchema = z.strictObject({
  type: z.literal('stream.modeChanged'),
  data: z.strictObject({
    ...StreamTargetShape,
    from: StreamProtocolSchema,
    to: StreamProtocolSchema,
    url: z.string().startsWith('/'),
    reason: z.enum(['shared', 'alone']),
  }),
});

export const StreamClosedEventSchema = z.strictObject({
  type: z.literal('stream.closed'),
  data: z.strictObject({
    ...StreamTargetShape,
    reason: z.enum([
      'released',
      'expired',
      'handoff',
      'engine_failed',
      'remux_failed',
      'revoked',
      'shutdown',
    ]),
    /**
     * Código del catálogo de errores si se cerró por un fallo. Una sesión IPTV
     * se cierra siempre con `reason: 'remux_failed'` y un `iptv_*`
     * (`iptv_dropped`, `iptv_disabled`, `iptv_removed`, `iptv_busy`), sin
     * valores de enum nuevos (docs/iptv.md §5.5).
     */
    code: z.string().optional(),
  }),
});

/**
 * Cada 2 s mientras haya visores: lo que da `stat_url` del motor (velocidades
 * en KB/s). En una IPTV lo da el relé: `status: 'iptv'`, `peers: 0`,
 * `speedUp: 0`, `speedDown` = KB/s que entran y `downloaded` = bytes.
 */
export const StreamStatsEventSchema = z.strictObject({
  type: z.literal('stream.stats'),
  data: z.strictObject({
    ...StreamTargetShape,
    /** `status` del motor ("dl", "prebuf"…). */
    status: z.string(),
    peers: z.number().int().nonnegative(),
    speedDown: z.number().nonnegative(),
    speedUp: z.number().nonnegative(),
    downloaded: z.number().nonnegative().nullable(),
    at: IsoDateTimeSchema,
  }),
});

// --- Motor, comprobador, estado y administración ---

export const EngineStatusEventSchema = z.strictObject({
  type: z.literal('engine.status'),
  data: EngineStatusSchema,
});

export const ScanProgressEventSchema = z.strictObject({
  type: z.literal('scan.progress'),
  data: z.strictObject({
    jobId: ScanJobIdSchema,
    kind: ScanJobKindSchema,
    status: ScanJobStatusSchema,
    total: z.number().int().nonnegative(),
    checked: z.number().int().nonnegative(),
    playable: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    retryAt: IsoDateTimeSchema.nullable(),
    matchId: z.string().nullable(),
  }),
});

export const ScanVerdictEventSchema = z.strictObject({
  type: z.literal('scan.verdict'),
  data: z.strictObject({
    jobId: ScanJobIdSchema.nullable(),
    hash: HashSchema,
    state: VerdictStateSchema,
    reason: z.string(),
    /** El reproductor manda 3 min sobre cualquier sonda (server.js:107). */
    by: z.enum(['scanner', 'player']),
    checkedAt: IsoDateTimeSchema,
    /** D6: dónde se puede reproducir (añadido en el paso 1.3; el comprobador siempre lo pone). */
    playableOn: PlayableOnSchema.optional(),
  }),
});

export const STATE_SCOPES = [
  'library',
  'preferences',
  'directories',
  'bindings',
  'reports',
  'learning',
  'stats',
  'nowPlaying',
  'settings',
] as const;
export const StateScopeSchema = z.enum(STATE_SCOPES);
export type StateScope = z.infer<typeof StateScopeSchema>;

/** Algo guardado ha cambiado: la web invalida las consultas de TanStack Query de ese ámbito. */
export const StateChangedEventSchema = z.strictObject({
  type: z.literal('state.changed'),
  data: z.strictObject({
    scopes: z.array(StateScopeSchema).min(1),
    at: IsoDateTimeSchema,
  }),
});

export const DiagnosticsNewEventSchema = z.strictObject({
  type: z.literal('diagnostics.new'),
  data: DiagnosticEntrySchema,
});

/**
 * A todos los orígenes desde la 0.8.1 (web e iPhone: lista de Dispositivos y
 * «¡emparejado!» en vivo); el revocado recibe su `revoked` antes de que se le
 * cierre el SSE.
 */
export const DevicesChangedEventSchema = z.strictObject({
  type: z.literal('devices.changed'),
  data: z.strictObject({
    reason: z.enum(['paired', 'revoked', 'renamed']),
    deviceId: z.string(),
  }),
});

/**
 * Estado de la IPTV (docs/iptv.md §5.5): al empezar y terminar una
 * sincronización, al cambiar la guía o la cuenta y al activar, pausar o
 * eliminar. SOLO web (`WEB_ONLY_EVENT_TYPES`): la web invalida `iptvGet` y
 * `bootstrap`. Tras eliminar llega `status: 'disabled'` con `channels: 0`.
 */
export const IptvStatusEventSchema = z.strictObject({
  type: z.literal('iptv.status'),
  data: IptvStatusSchema,
});

/** El cliente reconecta tarde y lo que le falta ya no está en el búfer: que recargue. */
export const ResyncEventSchema = z.strictObject({
  type: z.literal('resync'),
  data: z.strictObject({
    reason: z.enum(['buffer_miss', 'unknown_event_id', 'server_restart']),
  }),
});

export const SseEventSchema = z.discriminatedUnion('type', [
  PlaybackNowPlayingEventSchema,
  PlaybackHandoffEventSchema,
  PlaybackSessionsEventSchema,
  StreamReadyEventSchema,
  StreamReopenedEventSchema,
  StreamModeChangedEventSchema,
  StreamClosedEventSchema,
  StreamStatsEventSchema,
  EngineStatusEventSchema,
  ScanProgressEventSchema,
  ScanVerdictEventSchema,
  StateChangedEventSchema,
  DiagnosticsNewEventSchema,
  DevicesChangedEventSchema,
  IptvStatusEventSchema,
  ResyncEventSchema,
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
export type SseEventType = SseEvent['type'];
export type SseEventData<T extends SseEventType> = Extract<SseEvent, { type: T }>['data'];

export const SSE_EVENT_TYPES: readonly SseEventType[] = SseEventSchema.options.map(
  (option) => option.shape.type.value,
);

/**
 * Eventos que solo recibe el origen `web`, como lista (para tipar). Desde la
 * 0.8.1 `devices.changed` llega también a los iPhone; `iptv.status` no,
 * porque la IPTV solo se configura en la web (docs/iptv.md §5.5, D13).
 * Sus ejemplos van en `fixtures/web/events/`, que la app no recorre.
 */
export const WEB_ONLY_EVENT_TYPE_LIST = ['iptv.status'] as const satisfies readonly SseEventType[];
export type WebOnlyEventType = (typeof WEB_ONLY_EVENT_TYPE_LIST)[number];
/** Lo que reciben también los iPhone. */
export type SharedEventType = Exclude<SseEventType, WebOnlyEventType>;

/** Eventos que solo recibe el origen `web` (el filtro de events/). */
export const WEB_ONLY_EVENT_TYPES: ReadonlySet<SseEventType> = new Set<SseEventType>(
  WEB_ONLY_EVENT_TYPE_LIST,
);

/** Eventos dirigidos a visores concretos: cada conexión recibe solo los de su dispositivo. */
export const TARGETED_EVENT_TYPES: ReadonlySet<SseEventType> = new Set<SseEventType>([
  'playback.handoff',
  'stream.ready',
  'stream.reopened',
  'stream.modeChanged',
  'stream.closed',
  'stream.stats',
]);

/** Evento con el id creciente que lleva en el cable. */
export interface SseEnvelope<E extends SseEvent = SseEvent> {
  readonly id: number;
  readonly event: E;
}

/** Trama SSE estándar de un evento (sin validar: valida antes con `SseEventSchema`). */
export function encodeSseEvent(id: number, event: SseEvent): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** Comentario de latido (cada 15 s) para que ningún proxy corte la conexión. */
export const SSE_HEARTBEAT_FRAME = ': ping\n\n';
