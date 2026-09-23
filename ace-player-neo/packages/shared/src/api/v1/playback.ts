/* Reproducción en /api/v1: el backend es el dueño de las sesiones del motor
   (D5, arquitectura §5.6 y §6.3). Ningún cliente vuelve a pedir
   `getstream` ni `manifest.m3u8` al motor: pide aquí la URL, manda un
   latido cada 15 s y la suelta al terminar. */

import { z } from 'zod';
import {
  ClientKindSchema,
  DeviceIdSchema,
  EpochMsSchema,
  HashSchema,
  IsoDateTimeSchema,
  SessionIdSchema,
  ViewerIdSchema,
} from '../../primitives.js';
import { NowPlayingSchema } from '../../state/v1.js';
import { EngineSessionModeSchema } from '../../state/v2.js';
import { PLAYBACK_MODES } from '../../constants/playback.js';

export const PlaybackModeSchema = z.enum(PLAYBACK_MODES);

/**
 * - `mpegts`: progresivo del motor (`/ace/r/…`), web con mpegts.js. Un solo consumidor.
 * - `hls`: HLS del motor (`/ace/m/…`), web con hls.js. Compartible.
 * - `hls-fmp4`: remux del backend para AVPlayer (`/native/api/v1/video/…`).
 */
export const StreamProtocolSchema = z.enum(['mpegts', 'hls', 'hls-fmp4']);
export type StreamProtocol = z.infer<typeof StreamProtocolSchema>;

export const ChannelStreamParamsSchema = z.strictObject({ id: HashSchema });

export const ChannelStreamQuerySchema = z.strictObject({
  client: z.enum(['web', 'ios']),
  /**
   * `auto` (por defecto): el servidor prueba `id` y, si el motor no abre,
   * una vez `infohash` (arregla P6). Un resultado del buscador es `infohash`.
   */
  kind: z.enum(['id', 'infohash', 'auto']).default('auto'),
  mode: PlaybackModeSchema.default('balanced'),
  viewer: ViewerIdSchema,
  /** Id persistente de la web (localStorage). En iOS sale del token y se ignora. */
  device: DeviceIdSchema.optional(),
  /** Título para el mando y el historial de la sesión. */
  title: z.string().max(200).optional(),
});
export type ChannelStreamQuery = z.infer<typeof ChannelStreamQuerySchema>;

export const StreamSessionInfoSchema = z.strictObject({
  id: SessionIdSchema,
  /** Cada cuánto hay que mandar el latido (15 s). */
  heartbeatMs: z.number().int().positive(),
  /** Sin latido en este tiempo, el visor se da por ido (45 s). */
  expiresAfterMs: z.number().int().positive(),
});

export const StreamCodecSchema = z.strictObject({
  /** "h264", "hevc"… o "unknown". */
  video: z.string(),
  audio: z.string(),
  /** De dónde sale: veredicto del comprobador, del reproductor, ffprobe sobre el init.mp4 del remux, o nada. */
  source: z.enum(['scanner', 'player', 'ffprobe', 'unknown']),
});

export const StreamLatencySchema = z.strictObject({
  mode: PlaybackModeSchema,
  initialBufferS: z.number().nonnegative(),
  rebuildS: z.number().nonnegative(),
  /** Seguimiento del directo acelerando (mpegts/hls). `null` en Estable (liveSync: false). */
  liveSync: z
    .strictObject({
      targetS: z.number().nonnegative(),
      maxS: z.number().nonnegative(),
      rate: z.number().positive(),
    })
    .nullable(),
  /** Solo con `hls-fmp4` (arquitectura §6.3, P11). */
  ios: z
    .strictObject({
      preferredForwardBufferDuration: z.number().nonnegative(),
      liveEdgeOffsetS: z.number().nonnegative(),
    })
    .optional(),
});
export type StreamLatency = z.infer<typeof StreamLatencySchema>;

/** Respuesta de GET /api/v1/channels/:id/stream (arquitectura §6.3). */
export const StreamGrantSchema = z.strictObject({
  session: StreamSessionInfoSchema,
  /** Relativa: `/ace/r/…`, `/ace/m/…` o, en iOS, `/native/api/v1/video/<sid>/index.m3u8?t=…`. */
  url: z.string().startsWith('/'),
  protocol: StreamProtocolSchema,
  remux: z.boolean(),
  codec: StreamCodecSchema,
  latency: StreamLatencySchema,
  /** Las estadísticas (pares, velocidades) llegan por SSE (`stream.stats`); ningún cliente sondea al motor. */
  stats: z.strictObject({ via: z.literal('sse') }),
  /** Si al entrar se ha traspasado el canal de otro dispositivo (política `handoff` o canal distinto). */
  handoff: z.boolean(),
});
export type StreamGrant = z.infer<typeof StreamGrantSchema>;

export const SessionParamsSchema = z.strictObject({ sid: SessionIdSchema });

export const HeartbeatBodySchema = z.strictObject({
  viewer: ViewerIdSchema,
  /** Opcional: si está reproduciendo o en pausa (ayuda a decidir el reinicio automático del motor). */
  playing: z.boolean().optional(),
});
export type HeartbeatBody = z.infer<typeof HeartbeatBodySchema>;

/**
 * Latido aceptado. Lleva la URL y el protocolo ACTUALES: un cliente que se
 * haya perdido un `stream.modeChanged` por SSE se entera aquí. Si la sesión
 * ya no existe, 410 `session_expired`.
 */
export const HeartbeatResponseSchema = z.strictObject({
  session: StreamSessionInfoSchema,
  url: z.string().startsWith('/'),
  protocol: StreamProtocolSchema,
  viewers: z.number().int().nonnegative(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const ReleaseReasonSchema = z.enum([
  'user',
  'channel_change',
  'pagehide',
  'error',
  'handoff',
]);

/** También llega por `sendBeacon` al cerrar la página (text/plain): el servidor lo acepta igual. */
export const ReleaseBodySchema = z.strictObject({
  viewer: ViewerIdSchema,
  reason: ReleaseReasonSchema.default('user'),
});
export type ReleaseBody = z.infer<typeof ReleaseBodySchema>;

export const ReleaseResponseSchema = z.strictObject({
  released: z.boolean(),
  /** Si al irse este visor la sesión se ha quedado sin nadie y se ha parado en el motor. */
  sessionClosed: z.boolean(),
});
export type ReleaseResponse = z.infer<typeof ReleaseResponseSchema>;

/** Resumen de una sesión abierta en el motor, para la web y la salud. */
export const SessionSummarySchema = z.strictObject({
  id: SessionIdSchema,
  hash: HashSchema,
  mode: EngineSessionModeSchema,
  openedAt: IsoDateTimeSchema,
  viewers: z.array(
    z.strictObject({
      client: ClientKindSchema,
      deviceId: z.string().nullable(),
      lastBeatAt: IsoDateTimeSchema,
    }),
  ),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** GET /api/v1/playback: el mando de siempre (T-115) más las sesiones abiertas. Respaldo si falla el SSE. */
export const PlaybackStatusSchema = z.strictObject({
  nowPlaying: NowPlayingSchema.nullable(),
  learningCount: z.number().int().nonnegative(),
  serverTime: EpochMsSchema,
  sessions: z.array(SessionSummarySchema),
});
export type PlaybackStatus = z.infer<typeof PlaybackStatusSchema>;

/**
 * GET /api/v1/video/:sid/:file?t=…: lista y segmentos del remux para
 * AVPlayer. Solo los ficheros que genera ffmpeg (nunca `ffmpeg.log`, que hoy
 * se puede descargar por /remux/, api.md §6.22).
 */
export const VideoParamsSchema = z.strictObject({
  sid: SessionIdSchema,
  file: z.string().regex(/^(?:index\.m3u8|init\.mp4|index\d{1,9}\.m4s)$/, 'fichero del remux'),
});
export const VideoQuerySchema = z.strictObject({
  /** `base64url(payload).HMAC`, payload `{ sid, dev, exp }` (arquitectura §5.12). */
  t: z.string().min(10).max(2048),
});
