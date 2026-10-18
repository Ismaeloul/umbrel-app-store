/* «Ver juntos» (docs/ver-juntos.md, D36): salas para ver una película o un
   episodio a la vez, con chat. La sala vive en memoria del servidor; el vídeo
   es UNA sesión VOD compartida por todos (una sola plaza del proveedor).

   Credencial de cada persona: `<memberId>.<secreto>`, en `token` del cuerpo
   de las peticiones POST y en `?t=` de las GET (el SSE incluido: EventSource
   no pone cabeceras; `t` ya lo tapa el registro). El secreto solo lo conoce
   quien entró. */

import { z } from 'zod';
import { PARTY } from '../../constants/party.js';
import { HashSchema } from '../../primitives.js';
import { ChannelStreamQuerySchema, VideoParamsSchema } from './playback.js';
import { VodArtStampSchema } from './vod.js';

export const PartyCodeSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{${PARTY.codeLength}}$`), 'código de sala');

export const PartyMemberIdSchema = z.string().regex(/^m_[A-Za-z0-9_-]{8,32}$/, 'id de persona');

/** Nombre visible: sin saltos de línea ni caracteres de control. */
export const PartyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PARTY.nameMaxChars)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, 'nombre');

export const PartyParamsSchema = z.strictObject({ code: PartyCodeSchema });
export type PartyParams = z.infer<typeof PartyParamsSchema>;

export const PartyTitleSchema = z.strictObject({
  /** Película o episodio que se reproduce. */
  id: HashSchema,
  kind: z.enum(['movie', 'episode']),
  /** Película o serie, para el cartel (`vodArt`). */
  artId: HashSchema,
  poster: VodArtStampSchema.nullable(),
  title: z.string().max(200),
  /** «T1 · E3 · Nombre» en un episodio. */
  subtitle: z.string().max(200).nullable(),
  /** Se sabe cuando se abre el vídeo por primera vez. */
  durationS: z.number().positive().max(86_400).nullable(),
});
export type PartyTitle = z.infer<typeof PartyTitleSchema>;

export const PartyAudioSchema = z.strictObject({
  /** Pista elegida (`audio` de `vodStream`), o null: la de siempre. */
  index: z.number().int().min(0).max(15).nullable(),
  /** Pistas del fichero, cuando ya se ha abierto (para el menú «Idioma»). */
  tracks: z.array(z.strictObject({ index: z.number().int(), label: z.string().max(40) })).max(16),
});
export type PartyAudio = z.infer<typeof PartyAudioSchema>;

export const PartyMemberSchema = z.strictObject({
  id: PartyMemberIdSchema,
  name: z.string().max(PARTY.nameMaxChars),
  host: z.boolean(),
  /** Tiene el SSE de la sala abierto o mandó su estado hace poco. */
  online: z.boolean(),
  /** Está cargando: la sala le espera (hasta `holdMaxMs`). */
  buffering: z.boolean(),
});
export type PartyMember = z.infer<typeof PartyMemberSchema>;

/**
 * Dónde va la película para todos. La posición «ahora» es
 * `positionS + (playing && !held ? (ahoraServidor - at) / 1000 : 0)`.
 */
export const PartyPlaybackSchema = z.strictObject({
  playing: z.boolean(),
  positionS: z.number().min(0).max(86_400),
  /** Hora del servidor (ms) a la que se fijó `positionS`. */
  at: z.number().int().nonnegative(),
  /** Sube con cada cambio: un cliente descarta lo que traiga uno más viejo. */
  rev: z.number().int().nonnegative(),
  /** Personas a las que se está esperando (cargando). Con alguna, el reloj está parado. */
  waitingFor: z.array(PartyMemberIdSchema).max(PARTY.maxMembers),
});
export type PartyPlayback = z.infer<typeof PartyPlaybackSchema>;

/**
 * La sala se ha quedado sin vídeo: `taken`, alguien de casa ha puesto otra
 * cosa por la IPTV (la plaza es una); `failed`, el proveedor o el productor
 * fallaron. Nadie vuelve a abrir solo: hace falta «Reanudar».
 */
export const PartyInterruptedSchema = z.enum(['taken', 'failed']).nullable();
export type PartyInterrupted = z.infer<typeof PartyInterruptedSchema>;

export const PartyRoomSchema = z.strictObject({
  code: PartyCodeSchema,
  /** Enlace para invitar: el del proxy de la sala (`https://…/s/<código>`) o null (el de casa). */
  inviteUrl: z.string().url().max(200).nullable(),
  title: PartyTitleSchema,
  audio: PartyAudioSchema,
  interrupted: PartyInterruptedSchema,
  hostId: PartyMemberIdSchema,
  createdAt: z.number().int().nonnegative(),
  members: z.array(PartyMemberSchema).max(PARTY.maxMembers),
  playback: PartyPlaybackSchema,
});
export type PartyRoom = z.infer<typeof PartyRoomSchema>;

export const PartyChatMessageSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
  kind: z.enum(['chat', 'system']),
  /** null en los avisos de la sala («Ana se ha unido»). */
  memberId: PartyMemberIdSchema.nullable(),
  name: z.string().max(PARTY.nameMaxChars),
  text: z.string().max(PARTY.chatMaxChars + 80),
});
export type PartyChatMessage = z.infer<typeof PartyChatMessageSchema>;

/** `<memberId>.<secreto>`: la credencial de una persona en su sala. */
export const PartyTokenSchema = z
  .string()
  .regex(/^m_[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{20,64}$/, 'credencial de la sala');

/** Credencial que recibe quien entra. */
export const PartyCredentialSchema = z.strictObject({
  id: PartyMemberIdSchema,
  token: PartyTokenSchema,
});
export type PartyCredential = z.infer<typeof PartyCredentialSchema>;

// --- Peticiones ---

/** POST /api/v1/party: crear una sala con un título. */
export const PartyCreateBodySchema = z.strictObject({
  /** Película o episodio. */
  titleId: HashSchema,
  kind: z.enum(['movie', 'episode']),
  artId: HashSchema,
  poster: VodArtStampSchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).nullable().default(null),
  audio: z.number().int().min(0).max(15).nullable().default(null),
  name: PartyNameSchema,
});
export type PartyCreateBody = z.infer<typeof PartyCreateBodySchema>;

/** POST /api/v1/party/:code/join. */
export const PartyJoinBodySchema = z.strictObject({ name: PartyNameSchema });
export type PartyJoinBody = z.infer<typeof PartyJoinBodySchema>;

/** Respuesta de crear y de entrar. */
export const PartyJoinResponseSchema = z.strictObject({
  room: PartyRoomSchema,
  member: PartyCredentialSchema,
  chat: z.array(PartyChatMessageSchema).max(PARTY.chatHistory),
  serverNow: z.number().int().nonnegative(),
});
export type PartyJoinResponse = z.infer<typeof PartyJoinResponseSchema>;

/** GET /api/v1/party/:code: lo que se ve antes de entrar (sin credencial). */
export const PartyPreviewSchema = z.strictObject({
  code: PartyCodeSchema,
  title: PartyTitleSchema,
  members: z.array(z.string().max(PARTY.nameMaxChars)).max(PARTY.maxMembers),
  full: z.boolean(),
});
export type PartyPreview = z.infer<typeof PartyPreviewSchema>;

/** POST /api/v1/party/:code/control: reproducir, pausar o saltar (para todos). */
export const PartyControlBodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    token: PartyTokenSchema,
    action: z.enum(['play', 'pause', 'seek']),
    positionS: z.number().min(0).max(86_400),
  }),
  z.strictObject({
    token: PartyTokenSchema,
    action: z.literal('audio'),
    positionS: z.number().min(0).max(86_400),
    audio: z.number().int().min(0).max(15),
  }),
]);
export type PartyControlBody = z.infer<typeof PartyControlBodySchema>;

/** POST /api/v1/party/:code/status: el latido de cada uno (cada `statusIntervalMs`). */
export const PartyStatusBodySchema = z.strictObject({
  token: PartyTokenSchema,
  positionS: z.number().min(0).max(86_400),
  buffering: z.boolean(),
});
export type PartyStatusBody = z.infer<typeof PartyStatusBodySchema>;

/** La hora del servidor sirve para estimar el desfase de reloj con la ida y vuelta. */
export const PartyStatusResponseSchema = z.strictObject({
  serverNow: z.number().int().nonnegative(),
  rev: z.number().int().nonnegative(),
  /**
   * Solo en `partyStatus`: el latido de la sesión de vídeo de la persona. `ok`,
   * sigue; `lost`, la sesión ya no está (el reproductor vuelve a abrir si la
   * sala no está interrumpida); `none`, aún no ha abierto el vídeo.
   */
  stream: z.enum(['ok', 'lost', 'none']).optional(),
});
export type PartyStatusResponse = z.infer<typeof PartyStatusResponseSchema>;

/** POST /api/v1/party/:code/chat. */
export const PartyChatBodySchema = z.strictObject({
  token: PartyTokenSchema,
  text: z
    .string()
    .trim()
    .min(1)
    .max(PARTY.chatMaxChars)
    .regex(/^[^\p{Cc}]*$/u, 'texto'),
});
export type PartyChatBody = z.infer<typeof PartyChatBodySchema>;

/** POST /api/v1/party/:code/leave y DELETE /api/v1/party/:code (cerrar, solo el anfitrión). */
export const PartyTokenBodySchema = z.strictObject({ token: PartyTokenSchema });
export type PartyTokenBody = z.infer<typeof PartyTokenBodySchema>;

export const PartyOkSchema = z.strictObject({ ok: z.literal(true) });

/** Clave de vídeo de una persona (base64url de 24 bytes). */
export const PartyVideoKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'clave de vídeo');

/** GET /api/v1/party/:code/v/:key/:file: los mismos ficheros que `video`. */
export const PartyVideoParamsSchema = z.strictObject({
  code: PartyCodeSchema,
  key: PartyVideoKeySchema,
  file: VideoParamsSchema.shape.file,
});
export type PartyVideoParams = z.infer<typeof PartyVideoParamsSchema>;

/** GET /api/v1/party/:code/events (SSE). */
export const PartyEventsQuerySchema = z.strictObject({ t: PartyTokenSchema });
export type PartyEventsQuery = z.infer<typeof PartyEventsQuerySchema>;

/** GET /api/v1/party/:code/stream: el vídeo de la sala (una `VodGrant`). */
export const PartyStreamQuerySchema = ChannelStreamQuerySchema.pick({
  client: true,
  viewer: true,
  device: true,
}).extend({
  t: PartyTokenSchema,
  hevc: z.enum(['0', '1']).default('0'),
});
export type PartyStreamQuery = z.infer<typeof PartyStreamQuerySchema>;

// --- Eventos del SSE de la sala ---

export const PartyCloseReasonSchema = z.enum(['host', 'expired', 'empty', 'shutdown']);
export type PartyCloseReason = z.infer<typeof PartyCloseReasonSchema>;

/** Por qué cambió `playback` (para la línea «Ana ha pausado»). */
export const PartyActionSchema = z.enum(['play', 'pause', 'seek', 'audio', 'wait', 'resume']);
export type PartyAction = z.infer<typeof PartyActionSchema>;

export const PartyEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('party.snapshot'),
    data: z.strictObject({
      room: PartyRoomSchema,
      chat: z.array(PartyChatMessageSchema).max(PARTY.chatHistory),
      serverNow: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    type: z.literal('party.playback'),
    data: z.strictObject({
      playback: PartyPlaybackSchema,
      action: PartyActionSchema,
      /** Quien lo hizo; null si lo decidió la sala (esperar o seguir). */
      by: PartyMemberIdSchema.nullable(),
      serverNow: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    type: z.literal('party.room'),
    data: z.strictObject({
      title: PartyTitleSchema,
      audio: PartyAudioSchema,
      interrupted: PartyInterruptedSchema,
      members: z.array(PartyMemberSchema).max(PARTY.maxMembers),
    }),
  }),
  z.strictObject({
    type: z.literal('party.chat'),
    data: z.strictObject({ message: PartyChatMessageSchema }),
  }),
  z.strictObject({
    type: z.literal('party.closed'),
    data: z.strictObject({ reason: PartyCloseReasonSchema }),
  }),
]);
export type PartyEvent = z.infer<typeof PartyEventSchema>;
export type PartyEventType = PartyEvent['type'];
