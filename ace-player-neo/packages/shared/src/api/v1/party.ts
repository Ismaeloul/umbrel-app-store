/* «Ver juntos» (docs/ver-juntos.md, D36): salas para ver una película o un
   episodio a la vez, con chat. La sala vive en memoria del servidor; el vídeo
   es UNA sesión VOD compartida por todos (una sola plaza del proveedor).

   Credencial de cada persona: `<memberId>.<secreto>`, en `token` del cuerpo
   de las peticiones POST y en `?t=` de las GET (el SSE incluido: EventSource
   no pone cabeceras; `t` ya lo tapa el registro). El secreto solo lo conoce
   quien entró. */

import { z } from 'zod';
import { PARTY } from '../../constants/party.js';
import { HashSchema, ScanJobIdSchema } from '../../primitives.js';
import { ResolutionCandidateSchema, ScanJobSchema } from '../common.js';
import { ChannelStreamQuerySchema, StreamGrantSchema } from './playback.js';
import { VodArtStampSchema, VodGrantSchema } from './vod.js';

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
  /** Película o episodio que se reproduce; en directo (§14), el canal que suena. */
  id: HashSchema,
  kind: z.enum(['movie', 'episode', 'live']),
  /** Película o serie, para el cartel (`vodArt`); en directo, el canal. */
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

/**
 * Sala de un partido o un canal en directo (§14): el NAS abre UNA conexión (la
 * plaza de la IPTV o un AceStream) y la reparte a todos por la ruta de la sala.
 * Todos van en directo a la vez: sin pausa ni saltos.
 */
export const PartyLiveSchema = z.strictObject({
  /** El canal que suena (el mismo id que `channelStream`). */
  hash: HashSchema,
  /** Cómo se llama: «DAZN 1 · 1080p». */
  channel: z.string().max(120),
  source: z.enum(['engine', 'iptv']),
  /** El partido de la Agenda, o null con un canal suelto. */
  matchId: z.string().max(120).nullable(),
  /** «Real Madrid – Barcelona», o null. */
  match: z.string().max(200).nullable(),
  /** «Cambio automático si se cae»: quien controla salta solo a la siguiente fuente buena. */
  auto: z.boolean(),
});
export type PartyLive = z.infer<typeof PartyLiveSchema>;

/** Lo que se elige al crear una sala en directo o al cambiar de canal (`live` de `partyControl`). */
export const PartyLiveChoiceSchema = z.strictObject({
  hash: HashSchema,
  channel: z.string().trim().min(1).max(120),
  source: z.enum(['engine', 'iptv']),
  matchId: z.string().max(120).nullable().default(null),
  match: z.string().trim().max(200).nullable().default(null),
});
export type PartyLiveChoice = z.infer<typeof PartyLiveChoiceSchema>;

/**
 * Papel en la sala (§13): `leader` (la corona), `coleader` (el escudo: controla
 * como el líder, pero no echa ni pasa la corona) o `guest` (ve, chatea y
 * propone y vota lo siguiente).
 */
export const PartyRoleSchema = z.enum(['leader', 'coleader', 'guest']);
export type PartyRole = z.infer<typeof PartyRoleSchema>;

export const PartyMemberSchema = z.strictObject({
  id: PartyMemberIdSchema,
  name: z.string().max(PARTY.nameMaxChars),
  /** Quien creó la sala: solo él la cierra. */
  host: z.boolean(),
  /**
   * El líder (§11): manda en la sala. Al principio, quien la creó. Se queda
   * por las apps de iPhone y Android, que aún no leen `role`.
   */
  leader: z.boolean(),
  /** Su papel (§13); con un servidor viejo, `guest` (y `leader` dice quién manda). */
  role: PartyRoleSchema.default('guest'),
  /**
   * «Esperando a todos» (§13): tiene vídeo de sobra para empezar. Lo dice su
   * reproductor; si no lo dice (una app vieja), cuenta como listo en cuanto
   * ha abierto el vídeo y no carga.
   */
  ready: z.boolean().default(false),
  /** Cuánto lleva cargado para empezar (0-100), o null si no lo dice. */
  progress: z.number().int().min(0).max(100).nullable().default(null),
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
  /**
   * «Esperando a todos» (§13): aún no ha empezado. Arranca sola cuando todos
   * los conectados han tocado «Estoy listo» y tienen el vídeo cargado (con dos
   * o más), o cuando quien controla da a reproducir («Empezar ya»). Mientras,
   * `playing` es false.
   */
  lobby: z.boolean().default(false),
});
export type PartyPlayback = z.infer<typeof PartyPlaybackSchema>;

/**
 * La sala se ha quedado sin vídeo: `taken`, alguien de casa ha puesto otra
 * cosa por la IPTV (la plaza es una); `failed`, el proveedor o el productor
 * fallaron. Nadie vuelve a abrir solo: hace falta «Reanudar».
 */
export const PartyInterruptedSchema = z.enum(['taken', 'failed']).nullable();
export type PartyInterrupted = z.infer<typeof PartyInterruptedSchema>;

/**
 * Quién controla el vídeo (§11 y §13): `leader`, el líder (y los co-líderes si
 * `settings.coleaders`), o `everyone`, todos. «Solo yo» es `leader` sin
 * co-líderes; «Yo y co-líderes», `leader` con ellos. Así una app vieja, que solo
 * conoce estos dos valores, sigue entendiendo la sala.
 */
export const PartyControlModeSchema = z.enum(['leader', 'everyone']);
export type PartyControlMode = z.infer<typeof PartyControlModeSchema>;

/**
 * Qué pasa al acabar (§11), como los modos de Rave: `autoplay`, lo primero de
 * la lista (o el siguiente episodio); `vote`, lo más votado; `leader`, nada:
 * elige el líder; `once`, se para.
 */
export const PartyQueueModeSchema = z.enum(['autoplay', 'vote', 'leader', 'once']);
export type PartyQueueMode = z.infer<typeof PartyQueueModeSchema>;

export const PartySettingsSchema = z.strictObject({
  control: PartyControlModeSchema,
  /** Con `control: leader`, los co-líderes también controlan (§13). */
  coleaders: z.boolean().default(true),
  queueMode: PartyQueueModeSchema,
});
export type PartySettings = z.infer<typeof PartySettingsSchema>;

/** Un título de la lista (lo mismo que `PartyTitle`, sin la duración). */
export const PartyQueueTitleSchema = PartyTitleSchema.omit({ durationS: true });
export type PartyQueueTitle = z.infer<typeof PartyQueueTitleSchema>;

export const PartyQueueItemIdSchema = z.string().regex(/^q_[A-Za-z0-9_-]{8}$/, 'id de la lista');

export const PartyQueueItemSchema = z.strictObject({
  id: PartyQueueItemIdSchema,
  title: PartyQueueTitleSchema,
  /** Quien lo añadió (puede quitarlo), o null si ya no está en la sala. */
  addedBy: PartyMemberIdSchema.nullable(),
  addedByName: z.string().max(PARTY.nameMaxChars),
  votes: z.array(PartyMemberIdSchema).max(PARTY.maxMembers),
});
export type PartyQueueItem = z.infer<typeof PartyQueueItemSchema>;

/** Lo que empieza al acabar la cuenta atrás (`PARTY.upNextMs`). */
export const PartyUpNextSchema = z.strictObject({
  title: PartyQueueTitleSchema,
  /** De la lista, o null si es el siguiente episodio. */
  itemId: PartyQueueItemIdSchema.nullable(),
  /** Hora del servidor (ms) a la que empieza. */
  startsAt: z.number().int().nonnegative(),
});
export type PartyUpNext = z.infer<typeof PartyUpNextSchema>;

export const PartyRoomSchema = z.strictObject({
  code: PartyCodeSchema,
  /** Enlace para invitar: el del proxy de la sala (`https://…/s/<código>`) o null (el de casa). */
  inviteUrl: z.string().url().max(200).nullable(),
  title: PartyTitleSchema,
  audio: PartyAudioSchema,
  interrupted: PartyInterruptedSchema,
  hostId: PartyMemberIdSchema,
  leaderId: PartyMemberIdSchema,
  createdAt: z.number().int().nonnegative(),
  members: z.array(PartyMemberSchema).max(PARTY.maxMembers),
  playback: PartyPlaybackSchema,
  settings: PartySettingsSchema,
  queue: z.array(PartyQueueItemSchema).max(PARTY.queueMax),
  upNext: PartyUpNextSchema.nullable(),
  /** Sala en directo (§14), o null: película o episodio. */
  live: PartyLiveSchema.nullable().default(null),
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

/** POST /api/v1/party con una película o un episodio. */
export const PartyCreateVodBodySchema = z.strictObject({
  /** Película o episodio. */
  titleId: HashSchema,
  kind: z.enum(['movie', 'episode']),
  artId: HashSchema,
  poster: VodArtStampSchema.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).nullable().default(null),
  audio: z.number().int().min(0).max(15).nullable().default(null),
  name: PartyNameSchema,
  /** «Quién controla» y «Votar lo siguiente» al crearla (§13); sin ellos, lo de siempre. */
  control: PartyControlModeSchema.default('leader'),
  coleaders: z.boolean().default(true),
  queueMode: PartyQueueModeSchema.default('autoplay'),
});
export type PartyCreateVodBody = z.infer<typeof PartyCreateVodBodySchema>;

/** POST /api/v1/party con un partido o un canal en directo (§14). */
export const PartyCreateLiveBodySchema = z.strictObject({
  live: PartyLiveChoiceSchema,
  name: PartyNameSchema,
  control: PartyControlModeSchema.default('leader'),
  coleaders: z.boolean().default(true),
});
export type PartyCreateLiveBody = z.infer<typeof PartyCreateLiveBodySchema>;

/** POST /api/v1/party: crear una sala con un título o en directo. */
export const PartyCreateBodySchema = z.union([PartyCreateLiveBodySchema, PartyCreateVodBodySchema]);
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

/**
 * GET /api/v1/party (solo la web de casa): las salas abiertas, para volver a
 * entrar o cerrarlas aunque se haya perdido la credencial (se salió sin querer,
 * o se creó en otro aparato).
 */
export const PartyListItemSchema = z.strictObject({
  code: PartyCodeSchema,
  title: PartyTitleSchema,
  /** Quien la creó. */
  host: z.string().max(PARTY.nameMaxChars),
  members: z.number().int().nonnegative().max(PARTY.maxMembers),
  online: z.number().int().nonnegative().max(PARTY.maxMembers),
  createdAt: z.number().int().nonnegative(),
});
export type PartyListItem = z.infer<typeof PartyListItemSchema>;

export const PartyListSchema = z.strictObject({
  rooms: z.array(PartyListItemSchema).max(PARTY.maxRooms),
});
export type PartyList = z.infer<typeof PartyListSchema>;

/** GET /api/v1/party/:code: lo que se ve antes de entrar (sin credencial). */
export const PartyPreviewSchema = z.strictObject({
  code: PartyCodeSchema,
  title: PartyTitleSchema,
  members: z.array(z.string().max(PARTY.nameMaxChars)).max(PARTY.maxMembers),
  full: z.boolean(),
  /** Quien la creó («Isma te invita a ver»). Opcional: un servidor anterior no lo manda. */
  host: z.string().max(PARTY.nameMaxChars).optional(),
});
export type PartyPreview = z.infer<typeof PartyPreviewSchema>;

/**
 * Qué tocó la persona para mandar una orden: el botón central (`button`), los saltos de ±10 s
 * (`nudge`), la barra (`bar`), el teclado (`key`), un toque o clic sobre el vídeo (`surface`),
 * «Empezar ya» en la espera (`lobby`) o las teclas multimedia, la pantalla de bloqueo o el Centro de
 * control (`mediaSession`). Solo va al registro: el servidor no decide nada con él.
 */
export const PartyControlSourceSchema = z.enum([
  'button',
  'nudge',
  'bar',
  'key',
  'surface',
  'lobby',
  'mediaSession',
]);
export type PartyControlSource = z.infer<typeof PartyControlSourceSchema>;

/** POST /api/v1/party/:code/control: reproducir, pausar o saltar (para todos). */
export const PartyControlBodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    token: PartyTokenSchema,
    action: z.enum(['play', 'pause', 'seek']),
    positionS: z.number().min(0).max(86_400),
    /** De dónde sale la orden (solo para el registro del servidor; las apps viejas no lo mandan). */
    source: PartyControlSourceSchema.optional(),
  }),
  z.strictObject({
    token: PartyTokenSchema,
    action: z.literal('audio'),
    positionS: z.number().min(0).max(86_400),
    audio: z.number().int().min(0).max(15),
  }),
  /** En directo (§14): otro canal o fuente para todos. */
  z.strictObject({
    token: PartyTokenSchema,
    action: z.literal('live'),
    live: PartyLiveChoiceSchema,
    /**
     * El hash que suena según quien cambia (directo §14): si la sala ya va por otro, el cambio se
     * ignora. Así, con dos que controlan, gana el primero y no hay dos saltos seguidos.
     */
    from: HashSchema.optional(),
  }),
]);
export type PartyControlBody = z.infer<typeof PartyControlBodySchema>;

/** POST /api/v1/party/:code/status: el latido de cada uno (cada `statusIntervalMs`). */
export const PartyStatusBodySchema = z.strictObject({
  token: PartyTokenSchema,
  positionS: z.number().min(0).max(86_400),
  buffering: z.boolean(),
  /** «Esperando a todos» (§13): si ya puede empezar y cuánto lleva cargado (las apps viejas no lo mandan). */
  ready: z.boolean().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  /**
   * Pelis y series (§13): ha tocado «Estoy listo» (o algo que deja sonar el vídeo) desde que abrió
   * esta página. La web lo manda siempre; al recargar vuelve a false (el navegador vuelve a pedir
   * un toque). Las apps viejas no lo mandan y cuentan como que sí.
   */
  voted: z.boolean().optional(),
});
export type PartyStatusBody = z.infer<typeof PartyStatusBodySchema>;

/** La hora del servidor sirve para estimar el desfase de reloj con la ida y vuelta. */
export const PartyStatusResponseSchema = z.strictObject({
  /**
   * Hora del servidor (ms) al responder. Con `receivedAt`, el cliente tiene las cuatro marcas de
   * NTP (su envío, la llegada, la respuesta y su recepción) y descuenta lo que tarda el servidor.
   */
  serverNow: z.number().int().nonnegative(),
  /** Hora del servidor (ms) al llegar la petición; los servidores viejos no la mandan. */
  receivedAt: z.number().int().nonnegative().optional(),
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

/**
 * POST /api/v1/party/:code/settings: lo que no se manda no cambia. Quién
 * controla (`control`, `coleaders`), solo el líder; la regla de lo
 * siguiente (`queueMode`), también los co-líderes (§13).
 */
export const PartySettingsBodySchema = z.strictObject({
  token: PartyTokenSchema,
  control: PartyControlModeSchema.optional(),
  coleaders: z.boolean().optional(),
  queueMode: PartyQueueModeSchema.optional(),
  /** En directo (§14): «Cambio automático si se cae» (quien controla). */
  auto: z.boolean().optional(),
});
export type PartySettingsBody = z.infer<typeof PartySettingsBodySchema>;

/**
 * POST /api/v1/party/:code/member (solo el líder): echar a alguien, darle la
 * corona, hacerle co-líder (`coleader`) o quitárselo (`guest`).
 */
export const PartyMemberBodySchema = z.strictObject({
  token: PartyTokenSchema,
  memberId: PartyMemberIdSchema,
  action: z.enum(['kick', 'lead', 'coleader', 'guest']),
});
export type PartyMemberBody = z.infer<typeof PartyMemberBodySchema>;

/** POST /api/v1/party/:code/queue: la lista de la sala (§11). */
export const PartyQueueBodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    token: PartyTokenSchema,
    action: z.literal('add'),
    titleId: HashSchema,
    kind: z.enum(['movie', 'episode']),
    artId: HashSchema,
    poster: VodArtStampSchema.nullable().default(null),
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(200).nullable().default(null),
    /**
     * «Poner en la sala ahora» desde Pelis y series (§11): se añade y se pone para todos en la
     * misma llamada. Solo quien controla; sin él, se propone como siempre.
     */
    play: z.boolean().optional(),
  }),
  z.strictObject({
    token: PartyTokenSchema,
    action: z.enum(['remove', 'vote', 'play']),
    itemId: PartyQueueItemIdSchema,
  }),
  /** `next`: lo siguiente ya, sin esperar; `cancel`: quita la cuenta atrás. */
  z.strictObject({ token: PartyTokenSchema, action: z.enum(['next', 'cancel']) }),
]);
export type PartyQueueBody = z.infer<typeof PartyQueueBodySchema>;

/** Respuesta de `partyQueue`: con `add`, el id de lo añadido (para resaltarlo en Siguiente). */
export const PartyQueueResponseSchema = z.strictObject({
  ok: z.literal(true),
  itemId: PartyQueueItemIdSchema.optional(),
});
export type PartyQueueResponse = z.infer<typeof PartyQueueResponseSchema>;

/** Clave de vídeo de una persona (base64url de 24 bytes). */
export const PartyVideoKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'clave de vídeo');

/**
 * Ficheros de la ruta de la sala: los de `video` (`VideoParamsSchema.shape.file`) más la lista
 * maestra y la versión ligera de los invitados (docs/ver-juntos.md §17): `master.m3u8`, `lo.m3u8`,
 * `lo_init.mp4` y `lo_index<N>.m4s`. Nombres planos de 40 caracteres como mucho (el proxy de la sala).
 */
export const PartyVideoFileSchema = z
  .string()
  .regex(
    /^(?:index\.m3u8|init(?:_\d{1,6})?\.mp4|index\d{1,9}\.m4s|master\.m3u8|lo\.m3u8|lo_init\.mp4|lo_index\d{1,9}\.m4s)$/,
    'fichero de la sala',
  );

/** GET /api/v1/party/:code/v/:key/:file: los ficheros de `video` y los de la versión ligera (§17). */
export const PartyVideoParamsSchema = z.strictObject({
  code: PartyCodeSchema,
  key: PartyVideoKeySchema,
  file: PartyVideoFileSchema,
});
export type PartyVideoParams = z.infer<typeof PartyVideoParamsSchema>;

/** GET /api/v1/party/:code/events (SSE). */
export const PartyEventsQuerySchema = z.strictObject({
  t: PartyTokenSchema,
  /**
   * `1`: además del comentario `: ping`, en cada latido un `party.ping` con la hora del servidor,
   * que el JS sí ve (para saber que el SSE sigue vivo). Las apps viejas no lo piden.
   */
  ping: z.enum(['0', '1']).optional(),
});
export type PartyEventsQuery = z.infer<typeof PartyEventsQuerySchema>;

/**
 * GET /api/v1/party/:code/art/:artId: el cartel del título de la sala (o de lo que viene), por la
 * ruta de la sala: el invitado de fuera no tiene `vodArt` (§9). Solo un `artId` que tenga la sala.
 */
export const PartyArtParamsSchema = z.strictObject({ code: PartyCodeSchema, artId: HashSchema });
export type PartyArtParams = z.infer<typeof PartyArtParamsSchema>;

/** GET /api/v1/party/:code/stream: el vídeo de la sala (una `VodGrant`). */
export const PartyStreamQuerySchema = ChannelStreamQuerySchema.pick({
  client: true,
  viewer: true,
  device: true,
}).extend({
  t: PartyTokenSchema,
  hevc: z.enum(['0', '1']).default('0'),
  /**
   * `1`: el cliente sabe elegir entre dos calidades (docs/ver-juntos.md §17). Solo lo manda la web del
   * invitado; con él, y si entra de fuera por el proxy de la sala, puede recibir `master.m3u8` (o
   * `lo.m3u8`) y `variants`. Sin él (las apps y la web de casa), `index.m3u8` como siempre.
   */
  abr: z.enum(['0', '1']).default('0'),
});
export type PartyStreamQuery = z.infer<typeof PartyStreamQuerySchema>;

/** Lo que devuelve `partyStream`: una `VodGrant` o, en directo (§14), una `StreamGrant`. */
export const PartyStreamGrantSchema = z.union([VodGrantSchema, StreamGrantSchema]);
export type PartyStreamGrant = z.infer<typeof PartyStreamGrantSchema>;

// --- Eventos del SSE de la sala ---

/** `kicked`: solo le llega a quien han echado. */
export const PartyCloseReasonSchema = z.enum(['host', 'expired', 'empty', 'shutdown', 'kicked']);
export type PartyCloseReason = z.infer<typeof PartyCloseReasonSchema>;

/** Por qué cambió `playback` (para la línea «Ana ha pausado»). */
export const PartyActionSchema = z.enum([
  'play',
  'pause',
  'seek',
  'audio',
  'wait',
  'resume',
  /** Se ha acabado el título. */
  'ended',
  /** Empieza otro título (`party.room` ya trae el nuevo): hay que abrir el vídeo otra vez. */
  'title',
]);
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
      leaderId: PartyMemberIdSchema,
      settings: PartySettingsSchema,
      queue: z.array(PartyQueueItemSchema).max(PARTY.queueMax),
      upNext: PartyUpNextSchema.nullable(),
      live: PartyLiveSchema.nullable().default(null),
    }),
  }),
  /**
   * «Estoy listo» (§13, pelis y series): quién aún no lo ha tocado en esta visita. Va aparte de
   * `members` (que es estricto) para que una página o app de antes, que no conoce el campo, no
   * descarte las salas: este evento lo ignora sin más. Sale tras `party.snapshot` y con cada
   * `party.room`. Sin él (un servidor viejo), todos cuentan como que sí.
   */
  z.strictObject({
    type: z.literal('party.votes'),
    data: z.strictObject({
      unvoted: z.array(PartyMemberIdSchema).max(PARTY.maxMembers),
    }),
  }),
  /** «Ana está escribiendo…» (§13): como mucho uno cada `typingIntervalMs` por persona. */
  z.strictObject({
    type: z.literal('party.typing'),
    data: z.strictObject({
      memberId: PartyMemberIdSchema,
      name: z.string().max(PARTY.nameMaxChars),
    }),
  }),
  z.strictObject({
    type: z.literal('party.chat'),
    data: z.strictObject({ message: PartyChatMessageSchema }),
  }),
  /**
   * El latido con nombre: solo a las conexiones con `ping=1`, cada `PARTY.heartbeatMs`. No cambia
   * nada de la sala; el cliente sabe así que el SSE sigue vivo.
   */
  z.strictObject({
    type: z.literal('party.ping'),
    data: z.strictObject({ serverNow: z.number().int().nonnegative() }),
  }),
  z.strictObject({
    type: z.literal('party.closed'),
    data: z.strictObject({ reason: PartyCloseReasonSchema }),
  }),
]);
export type PartyEvent = z.infer<typeof PartyEventSchema>;
export type PartyEventType = PartyEvent['type'];

// --- Fuentes de una sala en directo (directo §14) ---

/**
 * GET /api/v1/party/:code/sources: las fuentes del partido o canal que suena, con la misma
 * resolución que la ficha del partido y su trabajo del comprobador (uno por sala). Solo quien
 * puede cambiar de fuente (el líder, los co-líderes y el anfitrión), también por el enlace.
 */
export const PartyLiveSourcesQuerySchema = z.strictObject({
  t: PartyTokenSchema,
  /** Solo el estado de este trabajo del comprobador (el sondeo barato mientras comprueba). */
  job: ScanJobIdSchema.optional(),
  /** `1`: «Buscar más fuentes» (una pasada nueva, sin la caché de la sala). */
  research: z.enum(['0', '1']).optional(),
});
export type PartyLiveSourcesQuery = z.infer<typeof PartyLiveSourcesQuerySchema>;

export const PartyLiveSourcesResponseSchema = z.strictObject({
  /** En el orden del servidor (IPTV primero, la mejor arriba), como `footballResolve`. */
  candidates: z.array(ResolutionCandidateSchema),
  /** El trabajo del comprobador de la sala, o null si no hay (comprobador apagado o ya olvidado). */
  scan: ScanJobSchema.nullable(),
});
export type PartyLiveSourcesResponse = z.infer<typeof PartyLiveSourcesResponseSchema>;
