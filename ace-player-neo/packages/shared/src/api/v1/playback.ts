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
 * Una IPTV siempre pasa por el remux: la web la recibe como `hls`
 * (`/api/v1/video/…`, sin token) y el iPhone como `hls-fmp4` (docs/iptv.md §6.4).
 */
export const StreamProtocolSchema = z.enum(['mpegts', 'hls', 'hls-fmp4']);
export type StreamProtocol = z.infer<typeof StreamProtocolSchema>;

/**
 * De dónde sale el vídeo de una sesión (docs/iptv.md §5.1): el motor
 * AceStream o la IPTV (relé local + remux). Opcional en la concesión y en el
 * resumen de sesión: ausente es `engine`, como hasta la 0.8.1.
 */
export const StreamSourceSchema = z.enum(['engine', 'iptv']);
export type StreamSource = z.infer<typeof StreamSourceSchema>;

export const ChannelStreamParamsSchema = z.strictObject({ id: HashSchema });

/** Qué pasa con los visores de otros dispositivos al cambiar de canal (docs/multidispositivo.md §2). */
export const OthersActionSchema = z.enum(['move', 'stop']);
export type OthersAction = z.infer<typeof OthersActionSchema>;

/** Id de un partido de la agenda, tal cual lo da `footballSchedule`. */
export const MatchRefSchema = z.string().min(1).max(100);

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
  /*
   * Varios dispositivos (docs/multidispositivo.md §2.2). Solo los manda un
   * cliente que ha visto `features.multi` en el arranque: un servidor sin
   * ellos rechazaría la petición (el esquema es estricto).
   */
  /**
   * `move`: los visores de otros dispositivos que están en la sesión `from`
   * reciben `playback.handoff` con `follow: true` y pasan solos a este; los
   * de cualquier otra sesión se paran. `stop` (o ausente, como hasta la
   * 0.8.1): se paran todos. `move` sin `from`, o con la política `handoff`,
   * el servidor lo trata como `stop`.
   */
  others: OthersActionSchema.optional(),
  /** Sesión que el cliente vio al decidir (`playbackStatus`): solo sus visores se mueven con `move`. */
  from: SessionIdSchema.optional(),
  /**
   * '1': unirse a lo que ya se ve, nunca cambiar el canal de la casa. Si no
   * hay sesión viva de este `hash`, 410 `session_expired` sin cerrar nada.
   * Lo llevan seguir, la cápsula y «Ver … aquí». Con `join`, `others` y
   * `from` se ignoran.
   */
  join: z.literal('1').optional(),
  /** Partido desde el que se pide (su `id` de la agenda): para unirse y seguir desde otro dispositivo. */
  match: MatchRefSchema.optional(),
  /** '1': este visor sabe seguir un cambio (`playback.handoff` con `follow`). */
  follows: z.enum(['0', '1']).optional(),
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
  /** `iptv` si el vídeo sale de la IPTV (textos del reproductor); ausente = `engine`. */
  source: StreamSourceSchema.optional(),
  /**
   * Solo IPTV: lo que entrega el proveedor, TS continuo o una lista HLS (con
   * HLS el retraso lo marca el segmento del proveedor). «Datos técnicos»
   * (docs/multidispositivo.md §4.4). Ausente = no es IPTV o servidor anterior.
   */
  iptvInput: z.enum(['ts', 'hls']).optional(),
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

/** Nombre que se enseña para un dispositivo que no se reconoce (web sin User-Agent útil). */
export const UNKNOWN_BROWSER_NAME = 'Navegador';
/** Nombre de los visores de las apps 0.6.x (su `claim` o su `/api/remux`). */
export const LEGACY_DEVICE_NAME = 'App antigua (0.6)';
/** Tope del nombre legible de un visor (el de un dispositivo emparejado es de 60). */
export const DEVICE_NAME_MAX = 80;

/**
 * Un visor de una sesión («Dónde se está reproduciendo»). `client` y
 * `deviceId` son los de siempre; lo demás llegó en la 0.7.1.
 */
export const SessionViewerSchema = z.strictObject({
  client: ClientKindSchema,
  /** El de la web (localStorage) o el del dispositivo emparejado: la app lo compara con el suyo para marcar «Este dispositivo». */
  deviceId: z.string().nullable(),
  lastBeatAt: IsoDateTimeSchema,
  viewerId: z.string(),
  /**
   * Legible: el nombre del dispositivo emparejado (iOS), uno sacado del
   * User-Agent en la web ("Chrome · Windows", "Safari · iPhone"; "Navegador"
   * si no se sabe) o "App antigua (0.6)".
   */
  deviceName: z.string().max(DEVICE_NAME_MAX),
  /** Igual que `client`: `web`, `ios` o `legacy`. */
  platform: ClientKindSchema,
  /** Del último latido: reproduciendo, en pausa o `null` si aún no lo ha dicho. */
  playing: z.boolean().nullable(),
  /** El visor sabe seguir un cambio de canal (lo declaró al pedirlo). Ausente = no. */
  follows: z.literal(true).optional(),
  /**
   * Sin latido desde hace más de `MULTI_TIMINGS.viewerAwayMs` (20 s): no
   * cuenta para la pregunta ni la cápsula. Ausente = vivo.
   */
  away: z.literal(true).optional(),
});
export type SessionViewer = z.infer<typeof SessionViewerSchema>;

/** Resumen de una sesión abierta en el motor, para la web, la app y la salud. */
export const SessionSummarySchema = z.strictObject({
  id: SessionIdSchema,
  hash: HashSchema,
  mode: EngineSessionModeSchema,
  openedAt: IsoDateTimeSchema,
  viewers: z.array(SessionViewerSchema),
  /** Título del canal que se ve (el del mando y el historial); "" si no se sabe. */
  title: z.string().max(200),
  /** Cómo lo recibe: `hls-fmp4` si solo lo ven apps de iOS (remux); si no, el del motor. */
  protocol: StreamProtocolSchema,
  /** `iptv` si la sesión es de la IPTV («Dónde se está reproduciendo» suma « · IPTV»); ausente = `engine`. */
  source: StreamSourceSchema.optional(),
  /** Partido que se ve en esta sesión (el del último visor que lo dijo). Ausente = canal suelto o no se sabe. */
  matchId: MatchRefSchema.optional(),
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
 * GET /api/v1/video/:sid/:file?t=…: lista y segmentos del remux. Solo los
 * ficheros que genera ffmpeg (nunca `ffmpeg.log`, que hoy se puede descargar
 * por /remux/, api.md §6.22).
 *
 * Desde la IPTV (docs/iptv.md §5.4) la ruta es `access: 'any'`:
 * - origen `native` (AVPlayer): `t` es obligatorio y se comprueba, como
 *   siempre (sin él, 401 `video_token_invalid`);
 * - origen `web` (hls.js tras el login de Umbrel): `t` es opcional y se
 *   IGNORA; la lista sale sin `?t=` en sus URIs.
 */
export const VideoParamsSchema = z.strictObject({
  sid: SessionIdSchema,
  file: z.string().regex(/^(?:index\.m3u8|init\.mp4|index\d{1,9}\.m4s)$/, 'fichero del remux'),
});
export const VideoQuerySchema = z.strictObject({
  /**
   * `base64url(payload).HMAC`, payload `{ sid, dev, exp }` (arquitectura
   * §5.12). Obligatorio desde /native (lo exige app.ts antes de validar);
   * opcional e ignorado desde la web.
   */
  t: z.string().min(10).max(2048).optional(),
});
