/* «Ver juntos» (docs/ver-juntos.md, D36): las salas.

   Reloj de la sala: `playback` guarda una posición y la hora del servidor a
   la que se fijó. Mientras reproduce y nadie carga, la posición «ahora» es
   `positionS + (ahora - at) / 1000`. Cada orden fija una posición nueva y
   sube `rev`; los clientes descartan lo que traiga un `rev` más viejo.

   Esperar al que carga: un cliente avisa en cuanto su vídeo se queda sin
   datos (`status` con `buffering`). Si dura más de `bufferingGraceMs` con la
   sala reproduciendo, el reloj se para (`waitingFor`) hasta que todos los
   que se esperan vuelven a tener datos, o hasta `holdMaxMs`: entonces la
   sala sigue sin esa persona (y no vuelve a esperarla en `HOLD_COOLDOWN_MS`).

   Credenciales: `<memberId>.<secreto>`; se guarda el SHA-256 del secreto y
   se compara en tiempo constante. El vídeo va con otra clave de cada persona
   en la ruta (`partyVideo`), y el latido de su sesión de playback lo da
   `status`: así los invitados de fuera (docs/ver-juntos.md §9) no necesitan
   ninguna ruta de playback ni de vídeo de la casa.

   Líder y lista (§11, como en Rave): el líder (al principio, quien crea la
   sala) manda en el vídeo si `settings.control` es `leader`, cambia los
   ajustes y puede echar a alguien. Si se va o se desconecta, pasa a ser líder
   quien lleva más tiempo en la sala. Al acabar un título, según
   `settings.queueMode`, empieza tras una cuenta atrás lo primero de la lista,
   lo más votado o el siguiente episodio.

   Co-líderes, «Esperando a todos» y «está escribiendo» (§13): el líder hace
   co-líder a quien quiera; con `settings.coleaders` controla como él, pero no
   echa ni pasa la corona. Cada título empieza en `lobby` (el reloj parado en
   el principio) y arranca solo cuando todos los conectados están listos (al
   crear la sala, con dos o más: si no, empezaría antes de que entre nadie), o
   cuando quien controla da a reproducir. «Está escribiendo» no se guarda: se
   reenvía, como mucho uno cada `typingIntervalMs` por persona. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PARTY,
  PartyEventSchema,
  SSE_MAX_BUFFERED_BYTES,
  SSE_TIMINGS,
  type PartyAction,
  type PartyAudio,
  type PartyChatMessage,
  type PartyCloseReason,
  type PartyCreateBody,
  type PartyEvent,
  type PartyInterrupted,
  type PartyJoinResponse,
  type PartyLive,
  type PartyLiveChoice,
  type PartyMember,
  type PartyPlayback,
  type PartyQueueBody,
  type PartyStreamQuery,
  type StreamGrant,
  type PartyQueueItem,
  type PartyQueueTitle,
  type PartyRoom,
  type PartySettings,
  type PartyTitle,
  type PartyUpNext,
} from '@ace/shared';
import type { FastifyReply } from 'fastify';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { Unsubscribe } from '../../core/bus.js';
import type { ViewerIdentity } from '../playback/types.js';
import type { PartyDeps, PartyService, PartySink } from './types.js';

/** Tras dejar de esperar a alguien, no se le vuelve a esperar durante esto. */
const HOLD_COOLDOWN_MS = 30_000;
/** Tras cambiar el idioma, el traspaso de la sesión vieja es de la propia sala. */
const AUDIO_SWITCH_WINDOW_MS = 45_000;
/** Cada cuánto se revisan esperas, ausencias y caducidades. */
const SWEEP_MS = 1_000;

const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-accel-buffering': 'no',
};

interface Member {
  readonly id: string;
  readonly secretHash: Buffer;
  readonly name: string;
  readonly host: boolean;
  lastSeen: number;
  connections: number;
  buffering: boolean;
  bufferingSince: number | null;
  /** No se le espera hasta esta hora (ya se le esperó `holdMaxMs`). */
  holdSkipUntil: number;
  readonly chatTimes: number[];
  /** «Esperando a todos» (§13): lo que dice su reproductor; null si no lo dice (una app vieja). */
  readyReported: boolean | null;
  progress: number | null;
  /** El último «está escribiendo» que se reenvió. */
  typingAt: number;
  /** Clave de vídeo (`partyVideo`): va en la ruta de la lista y de los segmentos. */
  readonly videoKey: string;
  /** Su visor de playback: el latido de la sesión lo da `status` (docs/ver-juntos.md §9). */
  viewer: { readonly identity: ViewerIdentity; readonly sessionId: string } | null;
}

interface Connection {
  readonly memberId: string;
  readonly sink: PartySink;
  closed: boolean;
  done: () => void;
  detach: () => void;
}

interface Room {
  readonly code: string;
  title: PartyTitle;
  audio: PartyAudio;
  interrupted: PartyInterrupted;
  readonly hostId: string;
  /** El líder (§11); al principio, `hostId`. */
  leaderId: string;
  /** Los co-líderes (§13); el líder nunca está aquí. */
  readonly coleaders: Set<string>;
  settings: PartySettings;
  /**
   * «Esperando a todos» (§13): `create`, la sala recién creada (arranca sola
   * con dos o más listos); `title`, otro título (con uno basta); null, ya empezó.
   */
  lobby: 'create' | 'title' | null;
  readonly queue: QueueItem[];
  upNext: PartyUpNext | null;
  /** El siguiente episodio del título que suena (lo trae la concesión del vídeo). */
  nextEpisode: PartyQueueTitle | null;
  readonly createdAt: number;
  /** En orden de llegada: el primero que sigue aquí hereda el liderazgo. */
  readonly members: Map<string, Member>;
  playback: { playing: boolean; positionS: number; at: number; rev: number };
  /** Persona → desde cuándo se la espera. */
  readonly waiting: Map<string, number>;
  readonly chat: PartyChatMessage[];
  nextMessageId: number;
  readonly connections: Set<Connection>;
  /** Desde cuándo no hay nadie conectado. */
  emptySince: number | null;
  /** Visores de playback de la sala (para saber si un traspaso o un cierre es suyo). */
  readonly viewers: Set<string>;
  /** Hasta cuándo un traspaso del mismo título es el cambio de idioma de la sala. */
  audioSwitchUntil: number;
  /** Sala en directo (§14): el canal que suena para todos; null en pelis y series. */
  live: PartyLive | null;
  closed: boolean;
}

interface QueueItem {
  readonly id: string;
  readonly title: PartyQueueTitle;
  addedBy: string | null;
  readonly addedByName: string;
  /** Quién lo ha votado (el empate lo gana lo que se añadió antes). */
  readonly votes: Set<string>;
}

/** «Solo yo», «Yo y co-líderes» o «Todos» (§13), para el aviso del chat. */
type ControlRule = 'solo' | 'leaders' | 'everyone';

function controlRule(settings: PartySettings): ControlRule {
  if (settings.control === 'everyone') return 'everyone';
  return settings.coleaders ? 'leaders' : 'solo';
}

const CONTROL_TEXT: Record<ControlRule, (name: string) => string> = {
  solo: (name) => `${name} se ha quedado solo con el control.`,
  leaders: (name) => `${name} comparte el control con los co-líderes.`,
  everyone: (name) => `${name} ha dado el control a todos.`,
};

const QUEUE_MODE_TEXT: Record<PartySettings['queueMode'], string> = {
  autoplay: 'al acabar sigue lo primero de la lista',
  vote: 'al acabar sigue lo más votado',
  leader: 'al acabar elige el líder',
  once: 'al acabar se para',
};

/** «Dune» o «The Office (T2 · E3 · …)». */
export function titleLabel(title: Pick<PartyQueueTitle, 'title' | 'subtitle'>): string {
  return title.subtitle ? `${title.title} (${title.subtitle})` : title.title;
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** «43:12» o «1:05:09». */
export function formatPosition(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function createPartyRuntime(deps: PartyDeps): PartyService {
  const { clock, logger, bus, playback, config } = deps;
  const publicUrl = config.party.publicUrl;
  const rooms = new Map<string, Room>();
  let sweepTimer: TimerHandle | null = null;
  let heartbeat: TimerHandle | null = null;
  let subscriptions: Unsubscribe[] = [];

  // --- Reloj de la sala ---

  function positionNow(room: Room, now = clock.now()): number {
    const { playing, positionS, at } = room.playback;
    let position = positionS;
    if (playing && room.waiting.size === 0) position += Math.max(0, now - at) / 1000;
    const duration = room.title.durationS;
    return Math.max(0, duration !== null ? Math.min(position, duration) : position);
  }

  function playbackView(room: Room): PartyPlayback {
    return {
      playing: room.playback.playing,
      positionS: Math.round(room.playback.positionS * 1000) / 1000,
      at: room.playback.at,
      rev: room.playback.rev,
      waitingFor: [...room.waiting.keys()],
      lobby: room.lobby !== null,
    };
  }

  /** Fija la posición y sube `rev` (antes de tocar `playing` o `waiting`). */
  function fix(room: Room, positionS: number, now = clock.now()): void {
    const duration = room.title.durationS;
    room.playback.positionS = Math.max(
      0,
      duration !== null ? Math.min(positionS, duration) : positionS,
    );
    room.playback.at = now;
    room.playback.rev += 1;
  }

  // --- Vistas ---

  function online(member: Member, now: number): boolean {
    return member.connections > 0 || now - member.lastSeen < PARTY.memberTimeoutMs;
  }

  /** Listo para empezar: lo que diga su reproductor o, si no dice nada, con vídeo y sin cargar. */
  function isReady(member: Member): boolean {
    return member.readyReported ?? (member.viewer !== null && !member.buffering);
  }

  function roleOf(room: Room, memberId: string): PartyMember['role'] {
    if (memberId === room.leaderId) return 'leader';
    return room.coleaders.has(memberId) ? 'coleader' : 'guest';
  }

  function membersView(room: Room, now = clock.now()): PartyMember[] {
    return [...room.members.values()].map((member) => ({
      id: member.id,
      name: member.name,
      host: member.host,
      leader: member.id === room.leaderId,
      role: roleOf(room, member.id),
      ready: isReady(member),
      progress: member.progress,
      online: online(member, now),
      buffering: member.buffering,
    }));
  }

  function queueView(room: Room): PartyQueueItem[] {
    return room.queue.map((item) => ({
      id: item.id,
      title: item.title,
      addedBy: item.addedBy,
      addedByName: item.addedByName,
      votes: [...item.votes],
    }));
  }

  function roomView(room: Room): PartyRoom {
    return {
      code: room.code,
      inviteUrl: publicUrl ? `${publicUrl}/s/${room.code}` : null,
      title: room.title,
      audio: room.audio,
      interrupted: room.interrupted,
      hostId: room.hostId,
      leaderId: room.leaderId,
      createdAt: room.createdAt,
      members: membersView(room),
      playback: playbackView(room),
      settings: room.settings,
      queue: queueView(room),
      upNext: room.upNext,
      live: room.live,
    };
  }

  // --- SSE ---

  function closeConnection(room: Room, connection: Connection): void {
    if (connection.closed) return;
    connection.closed = true;
    room.connections.delete(connection);
    connection.detach();
    const { sink } = connection;
    if (!sink.destroyed && !sink.writableEnded) sink.end();
    const member = room.members.get(connection.memberId);
    if (member) {
      member.connections = Math.max(0, member.connections - 1);
      member.lastSeen = clock.now();
    }
    if (connections() === 0) stopHeartbeat();
    connection.done();
  }

  function write(room: Room, connection: Connection, frame: string): void {
    if (connection.closed) return;
    try {
      connection.sink.write(frame);
    } catch {
      closeConnection(room, connection);
      return;
    }
    if (connection.sink.writableLength > SSE_MAX_BUFFERED_BYTES) {
      logger.warn({ room: room.code }, 'Ver juntos: cliente demasiado lento, se cierra su SSE');
      closeConnection(room, connection);
    }
  }

  function frameOf(event: PartyEvent): string | null {
    const parsed = PartyEventSchema.safeParse(event);
    if (!parsed.success) {
      logger.error(
        { event: event.type, issues: parsed.error.issues.slice(0, 5) },
        'Ver juntos: evento que no cumple su esquema, no se envía',
      );
      return null;
    }
    return `event: ${parsed.data.type}\ndata: ${JSON.stringify(parsed.data.data)}\n\n`;
  }

  function broadcast(room: Room, event: PartyEvent): void {
    const frame = frameOf(event);
    if (!frame) return;
    for (const connection of [...room.connections]) write(room, connection, frame);
  }

  function sendPlayback(room: Room, action: PartyAction, by: string | null): void {
    broadcast(room, {
      type: 'party.playback',
      data: { playback: playbackView(room), action, by, serverNow: clock.now() },
    });
  }

  function sendRoom(room: Room): void {
    broadcast(room, {
      type: 'party.room',
      data: {
        title: room.title,
        audio: room.audio,
        interrupted: room.interrupted,
        members: membersView(room),
        leaderId: room.leaderId,
        settings: room.settings,
        queue: queueView(room),
        upNext: room.upNext,
        live: room.live,
      },
    });
  }

  function connections(): number {
    let total = 0;
    for (const room of rooms.values()) total += room.connections.size;
    return total;
  }

  function stopHeartbeat(): void {
    clock.clearInterval(heartbeat);
    heartbeat = null;
  }

  function ensureHeartbeat(): void {
    if (heartbeat) return;
    heartbeat = clock.setInterval(
      () => {
        for (const room of rooms.values()) {
          for (const connection of [...room.connections]) write(room, connection, ': ping\n\n');
        }
      },
      PARTY.heartbeatMs,
      { unref: true },
    );
  }

  // --- Chat ---

  function say(room: Room, text: string, member: Member | null): void {
    const message: PartyChatMessage = {
      id: room.nextMessageId++,
      at: clock.now(),
      kind: member ? 'chat' : 'system',
      memberId: member?.id ?? null,
      name: member?.name ?? 'Sala',
      text,
    };
    room.chat.push(message);
    if (room.chat.length > PARTY.chatHistory) room.chat.shift();
    broadcast(room, { type: 'party.chat', data: { message } });
  }

  // --- Salas y personas ---

  function find(code: string): Room {
    const room = rooms.get(code);
    if (!room || room.closed) throw new AppError('party_not_found');
    return room;
  }

  /** La persona de la credencial, o `party_forbidden`. */
  function authenticate(room: Room, token: string): Member {
    const dot = token.indexOf('.');
    const member = dot > 0 ? room.members.get(token.slice(0, dot)) : undefined;
    const given = sha256(dot > 0 ? token.slice(dot + 1) : '');
    if (!member || !timingSafeEqual(given, member.secretHash)) {
      throw new AppError('party_forbidden');
    }
    member.lastSeen = clock.now();
    return member;
  }

  /** El líder, o un co-líder si la sala deja controlar a los co-líderes (§13). */
  function manages(room: Room, member: Member): boolean {
    if (member.id === room.leaderId) return true;
    return room.settings.coleaders && room.coleaders.has(member.id);
  }

  /** El vídeo y poner otro título: el líder (y los co-líderes), o todos si así lo ha dejado. */
  function requireControl(room: Room, member: Member): void {
    if (room.settings.control === 'everyone' || manages(room, member)) return;
    throw new AppError('party_leader_only');
  }

  /** La regla de lo siguiente y quitar lo que añadió otro: el líder y los co-líderes. */
  function requireManager(room: Room, member: Member): void {
    if (!manages(room, member)) throw new AppError('party_leader_only');
  }

  function requireLeader(room: Room, member: Member): void {
    if (member.id !== room.leaderId) throw new AppError('party_leader_only');
  }

  /** Quita de `times` lo que se sale de la ventana y anota esta vez; `rate_limited` si se pasa. */
  function throttle(times: number[], windowMs: number, max: number, now: number): void {
    while (times.length && now - (times[0] ?? 0) >= windowMs) times.shift();
    if (times.length >= max) throw new AppError('rate_limited');
    times.push(now);
  }

  function setLeader(room: Room, member: Member, text: string): void {
    room.coleaders.delete(member.id);
    room.leaderId = member.id;
    say(room, text, null);
    sendRoom(room);
  }

  /** Si el líder se ha ido, lo es quien lleva más tiempo en la sala y sigue conectado. */
  function handOver(room: Room, now: number): void {
    const leader = room.members.get(room.leaderId);
    if (leader && online(leader, now)) return;
    for (const member of room.members.values()) {
      if (member.id === room.leaderId || !online(member, now)) continue;
      setLeader(room, member, `${member.name} es ahora el líder.`);
      return;
    }
  }

  function uniqueName(room: Room, name: string): string {
    const taken = new Set([...room.members.values()].map((m) => m.name.toLocaleLowerCase('es')));
    if (!taken.has(name.toLocaleLowerCase('es'))) return name;
    for (let n = 2; n < 100; n += 1) {
      const suffix = ` ${n}`;
      const candidate = `${name.slice(0, PARTY.nameMaxChars - suffix.length)}${suffix}`;
      if (!taken.has(candidate.toLocaleLowerCase('es'))) return candidate;
    }
    return name;
  }

  function addMember(
    room: Room,
    name: string,
    host: boolean,
    id = `m_${randomId(9)}`,
  ): { member: Member; token: string } {
    const secret = randomId(24);
    const member: Member = {
      id,
      secretHash: sha256(secret),
      name: uniqueName(room, name),
      host,
      lastSeen: clock.now(),
      connections: 0,
      buffering: false,
      bufferingSince: null,
      holdSkipUntil: 0,
      chatTimes: [],
      readyReported: null,
      progress: null,
      typingAt: Number.NEGATIVE_INFINITY,
      videoKey: randomId(24),
      viewer: null,
    };
    room.members.set(id, member);
    return { member, token: `${id}.${secret}` };
  }

  function joined(room: Room, credential: { member: Member; token: string }): PartyJoinResponse {
    return {
      room: roomView(room),
      member: { id: credential.member.id, token: credential.token },
      chat: [...room.chat],
      serverNow: clock.now(),
    };
  }

  /** Suelta el visor de playback de una persona (sale, la echan o se cierra la sala). */
  function releaseViewer(member: Member): void {
    const viewer = member.viewer;
    member.viewer = null;
    if (!viewer) return;
    void playback
      .release(
        viewer.sessionId,
        { viewer: viewer.identity.viewerId, reason: 'user' },
        viewer.identity,
      )
      .catch(() => undefined);
  }

  function closeRoom(room: Room, reason: PartyCloseReason): void {
    if (room.closed) return;
    broadcast(room, { type: 'party.closed', data: { reason } });
    room.closed = true;
    rooms.delete(room.code);
    for (const member of room.members.values()) releaseViewer(member);
    for (const connection of [...room.connections]) closeConnection(room, connection);
    logger.info({ room: room.code, reason }, 'Ver juntos: sala cerrada');
    if (rooms.size === 0) stopSweep();
  }

  /** Quita a alguien de la espera; si ya no queda nadie, el reloj sigue. */
  function stopWaiting(room: Room, memberId: string, now: number): void {
    if (!room.waiting.delete(memberId)) return;
    if (room.waiting.size > 0) return;
    if (room.playback.playing) {
      fix(room, room.playback.positionS, now);
      sendPlayback(room, 'resume', null);
    }
  }

  function removeMember(room: Room, member: Member, text: string): void {
    room.members.delete(member.id);
    room.coleaders.delete(member.id);
    releaseViewer(member);
    for (const connection of [...room.connections]) {
      if (connection.memberId === member.id) closeConnection(room, connection);
    }
    for (const item of room.queue) {
      item.votes.delete(member.id);
      if (item.addedBy === member.id) item.addedBy = null;
    }
    stopWaiting(room, member.id, clock.now());
    say(room, text, null);
    handOver(room, clock.now());
    sendRoom(room);
  }

  // --- Lista y siguiente título (§11) ---

  /** Lo siguiente: lo más votado (en `vote`) o lo primero de la lista; si no hay, el siguiente episodio. */
  function pickNext(room: Room): Omit<PartyUpNext, 'startsAt'> | null {
    let best: QueueItem | undefined = room.queue[0];
    if (room.settings.queueMode === 'vote') {
      for (const item of room.queue) if (best && item.votes.size > best.votes.size) best = item;
    }
    if (best) return { title: best.title, itemId: best.id };
    return room.nextEpisode ? { title: room.nextEpisode, itemId: null } : null;
  }

  /** Se ha acabado el título: pausa al final y, según el modo, cuenta atrás para lo siguiente. */
  function onEnded(room: Room, now: number): void {
    fix(room, room.title.durationS ?? positionNow(room, now), now);
    room.playback.playing = false;
    room.waiting.clear();
    sendPlayback(room, 'ended', null);
    const mode = room.settings.queueMode;
    const next = mode === 'autoplay' || mode === 'vote' ? pickNext(room) : null;
    if (next) {
      room.upNext = { ...next, startsAt: now + PARTY.upNextMs };
      say(room, `Se ha terminado. Ahora viene ${titleLabel(next.title)}.`, null);
    } else {
      say(
        room,
        mode === 'leader' ? 'Se ha terminado. El líder elige qué ver.' : 'Se ha terminado.',
        null,
      );
    }
    sendRoom(room);
  }

  /** El título de una sala en directo (§14): el partido, o el canal suelto. */
  function liveTitle(choice: PartyLiveChoice): PartyTitle {
    return {
      id: choice.hash,
      kind: 'live',
      artId: choice.hash,
      poster: null,
      title: choice.match ?? choice.channel,
      subtitle: choice.match ? choice.channel : null,
      durationS: null,
    };
  }

  /**
   * En directo (§14), otro canal o fuente para todos: se sueltan las sesiones
   * de todos (sus traspasos ya no son de la sala) y cada uno vuelve a abrir
   * (acción `title`). Sin espera: el directo no espera a nadie.
   */
  function switchLive(room: Room, choice: PartyLiveChoice, by: Member | null): void {
    const live = room.live;
    if (!live) return;
    const otherMatch = choice.matchId !== live.matchId;
    room.live = { ...choice, auto: live.auto };
    room.title = liveTitle(choice);
    room.interrupted = null;
    room.waiting.clear();
    room.viewers.clear();
    for (const member of room.members.values()) {
      releaseViewer(member);
      member.buffering = false;
      member.bufferingSince = null;
    }
    fix(room, 0);
    room.playback.playing = true;
    sendRoom(room);
    sendPlayback(room, 'title', by?.id ?? null);
    const what =
      otherMatch && choice.match ? `${choice.match} (${choice.channel})` : choice.channel;
    say(
      room,
      by ? `${by.name} ha cambiado a ${what}.` : `Se ha caído la fuente: ahora, ${what}.`,
      null,
    );
    logger.info({ room: room.code, hash: choice.hash }, 'Ver juntos: otro canal en directo');
  }

  /** Empieza otro título para todos: cada uno vuelve a abrir el vídeo (acción `title`). */
  function switchTo(
    room: Room,
    title: PartyQueueTitle,
    itemId: string | null,
    by: Member | null,
  ): void {
    const now = clock.now();
    if (itemId) {
      const index = room.queue.findIndex((item) => item.id === itemId);
      if (index >= 0) room.queue.splice(index, 1);
    }
    /* Otro episodio de la misma serie: el mismo idioma. */
    const keepAudio = title.artId === room.title.artId ? room.audio.index : null;
    room.title = { ...title, durationS: null };
    room.audio = { index: keepAudio, tracks: [] };
    room.nextEpisode = null;
    room.upNext = null;
    room.interrupted = null;
    room.waiting.clear();
    /* Las sesiones viejas se sueltan; sus traspasos ya no son de la sala. */
    room.viewers.clear();
    for (const member of room.members.values()) {
      releaseViewer(member);
      member.buffering = false;
      member.bufferingSince = null;
      member.readyReported = null;
      member.progress = null;
    }
    fix(room, 0, now);
    /* Nadie se pierde el principio: espera a que todos lo tengan cargado (§13). */
    room.playback.playing = false;
    room.lobby = 'title';
    sendRoom(room);
    sendPlayback(room, 'title', by?.id ?? null);
    say(
      room,
      by ? `${by.name} ha puesto ${titleLabel(title)}.` : `Ahora: ${titleLabel(title)}.`,
      null,
    );
    logger.info({ room: room.code, title: title.id }, 'Ver juntos: otro título');
  }

  function queueAction(room: Room, member: Member, body: PartyQueueBody): void {
    switch (body.action) {
      case 'add': {
        /* Proponer, cualquiera, también en «Elijo yo»: el líder elige entre lo propuesto (§13). */
        if (room.queue.length >= PARTY.queueMax) throw new AppError('party_queue_full');
        const title: PartyQueueTitle = {
          id: body.titleId,
          kind: body.kind,
          artId: body.artId,
          poster: body.poster,
          title: body.title,
          subtitle: body.subtitle,
        };
        room.queue.push({
          id: `q_${randomId(6)}`,
          title,
          addedBy: member.id,
          addedByName: member.name,
          votes: new Set(),
        });
        say(room, `${member.name} ha añadido ${titleLabel(title)} a la lista.`, null);
        break;
      }
      case 'remove':
      case 'vote':
      case 'play': {
        const item = room.queue.find((entry) => entry.id === body.itemId);
        if (!item) throw new AppError('party_gone');
        if (body.action === 'play') {
          requireControl(room, member);
          switchTo(room, item.title, item.id, member);
          return;
        }
        if (body.action === 'vote') {
          if (!item.votes.delete(member.id)) item.votes.add(member.id);
          break;
        }
        if (item.addedBy !== member.id) requireManager(room, member);
        room.queue.splice(room.queue.indexOf(item), 1);
        if (room.upNext?.itemId === item.id) room.upNext = null;
        break;
      }
      case 'next': {
        requireControl(room, member);
        const next = room.upNext ?? pickNext(room);
        if (!next) throw new AppError('party_gone');
        switchTo(room, next.title, next.itemId, member);
        return;
      }
      case 'cancel':
        requireControl(room, member);
        if (!room.upNext) return;
        room.upNext = null;
        say(room, `${member.name} ha cancelado lo siguiente.`, null);
        break;
    }
    sendRoom(room);
  }

  /** Esperas, ausencias y caducidades (cada `SWEEP_MS` mientras haya salas). */
  function sweep(): void {
    const now = clock.now();
    for (const room of [...rooms.values()]) {
      if (now - room.createdAt >= PARTY.maxRoomAgeMs) {
        closeRoom(room, 'expired');
        continue;
      }
      let membersChanged = false;
      for (const member of [...room.members.values()]) {
        if (member.connections > 0) member.lastSeen = now;
        const away = now - member.lastSeen;
        /* Quien lleva mucho sin aparecer deja su sitio (el anfitrión, no: su enlace sigue valiendo). */
        if (!member.host && away >= PARTY.emptyRoomTtlMs) {
          removeMember(room, member, `${member.name} se ha ido.`);
          continue;
        }
        if (away >= PARTY.memberTimeoutMs && member.buffering) {
          member.buffering = false;
          member.bufferingSince = null;
          membersChanged = true;
        }
      }
      /* Esperas que vencen y avisos de «cargando» que ya duran bastante. */
      for (const [memberId, since] of [...room.waiting]) {
        const member = room.members.get(memberId);
        if (member && member.buffering && now - since < PARTY.holdMaxMs) continue;
        if (member) member.holdSkipUntil = now + HOLD_COOLDOWN_MS;
        stopWaiting(room, memberId, now);
      }
      for (const member of room.members.values()) maybeWait(room, member, now);
      handOver(room, now);
      maybeStart(room, now);
      const duration = room.title.durationS;
      if (
        room.playback.playing &&
        room.waiting.size === 0 &&
        !room.interrupted &&
        duration !== null &&
        positionNow(room, now) >= duration - 0.5
      ) {
        onEnded(room, now);
      }
      if (room.upNext && now >= room.upNext.startsAt) {
        switchTo(room, room.upNext.title, room.upNext.itemId, null);
      }
      const anyone = [...room.members.values()].some((member) => online(member, now));
      if (anyone) room.emptySince = null;
      else room.emptySince ??= now;
      if (room.emptySince !== null && now - room.emptySince >= PARTY.emptyRoomTtlMs) {
        closeRoom(room, 'empty');
        continue;
      }
      if (membersChanged) sendRoom(room);
    }
  }

  /**
   * «Esperando a todos» (§13): si todos los conectados están listos, empieza
   * sola. («Empezar para todos» es un `play` de quien controla: `control`.)
   */
  function maybeStart(room: Room, now: number): void {
    if (room.lobby === null || room.interrupted) return;
    const present = [...room.members.values()].filter((member) => online(member, now));
    if (present.length < (room.lobby === 'create' ? 2 : 1)) return;
    if (!present.every(isReady)) return;
    room.lobby = null;
    fix(room, room.playback.positionS, now);
    room.playback.playing = true;
    room.waiting.clear();
    sendPlayback(room, 'play', null);
    say(room, 'Ya estáis todos listos: empieza.', null);
  }

  /** Si alguien lleva cargando más de la gracia con la sala reproduciendo, el reloj se para. */
  function maybeWait(room: Room, member: Member, now: number): void {
    /* En directo nadie espera a nadie (§14): el que carga se pone al día solo. */
    if (room.live || !room.playback.playing || room.interrupted) return;
    if (!member.buffering || member.bufferingSince === null) return;
    if (room.waiting.has(member.id) || now < member.holdSkipUntil) return;
    if (now - member.bufferingSince < PARTY.bufferingGraceMs) return;
    const first = room.waiting.size === 0;
    if (first) fix(room, positionNow(room, now), now);
    room.waiting.set(member.id, now);
    if (!first) room.playback.rev += 1;
    sendPlayback(room, 'wait', null);
  }

  function ensureSweep(): void {
    if (sweepTimer) return;
    sweepTimer = clock.setInterval(sweep, SWEEP_MS, { unref: true });
  }

  function stopSweep(): void {
    clock.clearInterval(sweepTimer);
    sweepTimer = null;
  }

  /** El vídeo de una sala en directo (§14): el canal de la sala, por el remux, para cada persona. */
  async function streamLive(
    room: Room,
    member: Member,
    query: PartyStreamQuery,
    viewer: ViewerIdentity,
    signal: AbortSignal,
  ): Promise<StreamGrant> {
    const live = room.live;
    if (!live) throw new AppError('party_not_found');
    const grant = await playback.acquire(
      live.hash,
      {
        client: query.client,
        viewer: query.viewer,
        device: query.device,
        kind: 'auto',
        title: live.channel,
        mode: 'balanced',
      },
      viewer,
      signal,
      { partyKey: room.code },
    );
    const url = `/api/v1/party/${room.code}/v/${member.videoKey}/index.m3u8`;
    /* Mientras se abría, alguien cambió de canal: este visor ya no es de la sala. */
    if (room.closed || !room.members.has(member.id) || room.live?.hash !== live.hash) {
      return { ...grant, url };
    }
    room.viewers.add(viewer.viewerId);
    if (member.viewer && member.viewer.identity.viewerId !== viewer.viewerId) releaseViewer(member);
    member.viewer = { identity: viewer, sessionId: grant.session.id };
    /* Quien eligió el canal pudo no saber de dónde sale: lo dice la concesión. */
    const source = grant.source === 'iptv' ? 'iptv' : 'engine';
    let changed = false;
    if (room.live && room.live.source !== source) {
      room.live = { ...room.live, source };
      changed = true;
    }
    if (room.interrupted) {
      room.interrupted = null;
      say(room, 'El vídeo vuelve a estar listo.', null);
      changed = true;
    }
    if (changed) sendRoom(room);
    return { ...grant, url };
  }

  // --- Lo que avisa playback ---

  function onLost(
    viewerIds: readonly string[],
    kind: 'taken' | 'failed',
    hash: string | null,
  ): void {
    const now = clock.now();
    for (const room of rooms.values()) {
      if (!viewerIds.some((id) => room.viewers.has(id))) continue;
      /* El cambio de idioma reabre la sesión: ese traspaso es de la sala. */
      if (kind === 'taken' && hash === room.title.id && now < room.audioSwitchUntil) continue;
      for (const id of viewerIds) room.viewers.delete(id);
      if (room.interrupted) continue;
      room.interrupted = kind;
      const wasPlaying = room.playback.playing;
      fix(room, positionNow(room, now), now);
      room.playback.playing = false;
      room.waiting.clear();
      sendPlayback(room, 'pause', null);
      sendRoom(room);
      say(
        room,
        kind === 'taken'
          ? 'Alguien ha puesto otra cosa en la IPTV de casa. La sala está en pausa.'
          : 'Se ha cortado el vídeo. La sala está en pausa.',
        null,
      );
      logger.info(
        { room: room.code, kind, wasPlaying },
        'Ver juntos: la sala se ha quedado sin vídeo',
      );
    }
  }

  function subscribe(): void {
    if (subscriptions.length > 0) return;
    subscriptions = [
      bus.on('playback.handoff', (event) => onLost(event.viewerIds, 'taken', event.hash)),
      bus.on('stream.closed', (event) => {
        if (event.reason === 'handoff') onLost(event.viewerIds, 'taken', null);
        else if (event.reason === 'remux_failed' || event.reason === 'engine_failed') {
          onLost(event.viewerIds, 'failed', null);
        }
      }),
    ];
  }

  function attach(
    code: string,
    token: string,
    sink: PartySink,
    signal: AbortSignal,
  ): Promise<void> {
    const room = find(code);
    const member = authenticate(room, token);
    sink.writeHead(200, { ...SSE_HEADERS });
    return new Promise<void>((resolve) => {
      const onAbort = (): void => closeConnection(room, connection);
      const connection: Connection = {
        memberId: member.id,
        sink,
        closed: false,
        done: resolve,
        detach: () => signal.removeEventListener('abort', onAbort),
      };
      room.connections.add(connection);
      member.connections += 1;
      room.emptySince = null;
      if (signal.aborted) {
        closeConnection(room, connection);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      sink.once('close', () => closeConnection(room, connection));
      write(room, connection, `retry: ${SSE_TIMINGS.retryMs}\n\n`);
      const frame = frameOf({
        type: 'party.snapshot',
        data: { room: roomView(room), chat: [...room.chat], serverNow: clock.now() },
      });
      if (frame) write(room, connection, frame);
      ensureHeartbeat();
      /* Los demás ven que ha vuelto. */
      if (member.connections === 1) sendRoom(room);
    });
  }

  return {
    async start() {
      subscribe();
    },

    async stop() {
      for (const off of subscriptions) off();
      subscriptions = [];
      for (const room of [...rooms.values()]) closeRoom(room, 'shutdown');
      stopSweep();
      stopHeartbeat();
    },

    create(body: PartyCreateBody) {
      if (rooms.size >= PARTY.maxRooms) throw new AppError('party_limit');
      subscribe();
      const now = clock.now();
      let code = randomId(12);
      while (rooms.has(code)) code = randomId(12);
      const hostId = `m_${randomId(9)}`;
      const live = 'live' in body ? body.live : null;
      const room: Room = {
        code,
        title:
          'live' in body
            ? liveTitle(body.live)
            : {
                id: body.titleId,
                kind: body.kind,
                artId: body.artId,
                poster: body.poster,
                title: body.title,
                subtitle: body.subtitle,
                durationS: null,
              },
        audio: { index: 'live' in body ? null : body.audio, tracks: [] },
        interrupted: null,
        hostId,
        leaderId: hostId,
        coleaders: new Set(),
        settings: {
          control: body.control,
          coleaders: body.coleaders,
          /* En directo no hay lista (§14): `once`, por si una app vieja lo mira. */
          queueMode: 'live' in body ? 'once' : body.queueMode,
        },
        /* El directo empieza ya: no hay principio que perderse. */
        lobby: live ? null : 'create',
        queue: [],
        upNext: null,
        nextEpisode: null,
        createdAt: now,
        members: new Map(),
        playback: { playing: live !== null, positionS: 0, at: now, rev: 1 },
        waiting: new Map(),
        chat: [],
        nextMessageId: 1,
        connections: new Set(),
        emptySince: null,
        viewers: new Set(),
        audioSwitchUntil: 0,
        live: live ? { ...live, auto: true } : null,
        closed: false,
      };
      rooms.set(code, room);
      /* El anfitrión lleva el id reservado arriba (`hostId` es fijo en la sala). */
      const host = addMember(room, body.name, true, hostId);
      ensureSweep();
      say(room, `${host.member.name} ha creado la sala.`, null);
      logger.info(
        { room: code, title: room.title.id, live: live !== null },
        'Ver juntos: sala creada',
      );
      return joined(room, host);
    },

    preview(code) {
      const room = find(code);
      return {
        code: room.code,
        title: room.title,
        members: [...room.members.values()].map((member) => member.name),
        full: room.members.size >= PARTY.maxMembers,
      };
    },

    join(code, name) {
      const room = find(code);
      if (room.members.size >= PARTY.maxMembers) throw new AppError('party_full');
      const credential = addMember(room, name, false);
      say(room, `${credential.member.name} se ha unido.`, null);
      sendRoom(room);
      return joined(room, credential);
    },

    connect(code, token, reply: FastifyReply, signal) {
      /* Se comprueba ANTES del hijack: un 404 o un 403 salen como JSON normal. */
      authenticate(find(code), token);
      reply.hijack();
      return attach(code, token, reply.raw as unknown as PartySink, signal);
    },

    attach,

    async stream(code, query, viewer, signal) {
      const room = find(code);
      const member = authenticate(room, query.t);
      if (room.live) return streamLive(room, member, query, viewer, signal);
      const grant = await playback.acquireVod(
        room.title.id,
        {
          client: query.client,
          viewer: query.viewer,
          device: query.device,
          hevc: query.hevc,
          start: Math.round(positionNow(room) * 10) / 10,
          audio: room.audio.index ?? undefined,
        },
        viewer,
        signal,
        { partyKey: room.code },
      );
      /* La lista y los segmentos, por la ruta de la sala con la clave de la persona. */
      const url = `/api/v1/party/${room.code}/v/${member.videoKey}/index.m3u8`;
      if (room.closed || !room.members.has(member.id)) return { ...grant, url };
      room.viewers.add(viewer.viewerId);
      /* Un visor por persona: el de antes (otra pestaña, otro audio) se suelta. */
      if (member.viewer && member.viewer.identity.viewerId !== viewer.viewerId)
        releaseViewer(member);
      member.viewer = { identity: viewer, sessionId: grant.session.id };
      const vod = grant.vod;
      const tracks = vod.audio.map((track) => ({ index: track.index, label: track.label }));
      const title: PartyTitle = {
        ...room.title,
        title: vod.title,
        subtitle: vod.subtitle,
        durationS: vod.durationS,
      };
      const audio: PartyAudio = {
        index: room.audio.index ?? (vod.audioIndex >= 0 ? vod.audioIndex : null),
        tracks,
      };
      /* En «Esperando a todos», quien abre el vídeo puede pasar a «listo» (una app vieja). */
      const changed =
        JSON.stringify(title) !== JSON.stringify(room.title) ||
        JSON.stringify(audio) !== JSON.stringify(room.audio) ||
        room.interrupted !== null ||
        room.lobby !== null;
      room.title = title;
      room.audio = audio;
      room.nextEpisode = vod.next
        ? {
            id: vod.next.id,
            kind: 'episode',
            artId: room.title.artId,
            poster: room.title.poster,
            title: vod.next.title,
            subtitle: vod.next.label,
          }
        : null;
      if (room.interrupted) {
        room.interrupted = null;
        say(room, 'El vídeo vuelve a estar listo.', null);
      }
      if (changed) sendRoom(room);
      return { ...grant, url };
    },

    videoSession(code, key) {
      const room = find(code);
      for (const member of room.members.values()) {
        if (
          member.videoKey.length === key.length &&
          timingSafeEqual(Buffer.from(member.videoKey), Buffer.from(key))
        ) {
          if (!member.viewer) throw new AppError('session_not_found');
          member.lastSeen = clock.now();
          return member.viewer.sessionId;
        }
      }
      throw new AppError('party_forbidden');
    },

    control(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      requireControl(room, member);
      const now = clock.now();
      /* En directo (§14) solo se cambia de canal: ni pausa, ni saltos, ni idioma. */
      if (room.live || body.action === 'live') {
        if (body.action !== 'live' || !room.live) {
          throw new AppError('validation_error', { detail: 'party_live' });
        }
        switchLive(room, body.live, member);
        return { serverNow: now, rev: room.playback.rev };
      }
      fix(room, body.positionS, now);
      let action: PartyAction = body.action;
      switch (body.action) {
        case 'play':
          /* «Empezar para todos» (§13): reproducir en la espera la acaba. */
          room.playback.playing = true;
          if (room.lobby !== null) {
            room.lobby = null;
            say(room, `${member.name} ha empezado para todos.`, null);
            break;
          }
          say(room, `${member.name} ha dado a reproducir.`, null);
          break;
        case 'pause':
          room.playback.playing = false;
          room.waiting.clear();
          say(room, `${member.name} ha pausado.`, null);
          break;
        case 'seek':
          say(room, `${member.name} ha saltado a ${formatPosition(body.positionS)}.`, null);
          break;
        case 'audio': {
          room.audio = { ...room.audio, index: body.audio };
          room.audioSwitchUntil = now + AUDIO_SWITCH_WINDOW_MS;
          const label = room.audio.tracks.find((track) => track.index === body.audio)?.label;
          say(room, `${member.name} ha cambiado el idioma${label ? ` a ${label}` : ''}.`, null);
          sendRoom(room);
          action = 'audio';
          break;
        }
      }
      sendPlayback(room, action, member.id);
      return { serverNow: now, rev: room.playback.rev };
    },

    async status(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      const now = clock.now();
      let changed = false;
      if (body.buffering !== member.buffering) {
        member.buffering = body.buffering;
        member.bufferingSince = body.buffering ? now : null;
        if (!body.buffering) stopWaiting(room, member.id, now);
        else maybeWait(room, member, now);
        changed = true;
      }
      const ready = body.ready ?? null;
      const progress = body.progress ?? null;
      if (ready !== member.readyReported || progress !== member.progress) {
        member.readyReported = ready;
        member.progress = progress;
        /* Fuera de la espera, el % no le importa a nadie: no se reparte. */
        if (room.lobby !== null) changed = true;
      }
      if (changed) sendRoom(room);
      maybeStart(room, now);
      /* El latido de su sesión de vídeo: los invitados no tienen las rutas de playback. */
      let stream: 'ok' | 'lost' | 'none' = 'none';
      const viewer = member.viewer;
      if (viewer) {
        try {
          await playback.heartbeat(
            viewer.sessionId,
            {
              viewer: viewer.identity.viewerId,
              playing: room.playback.playing && room.waiting.size === 0,
            },
            viewer.identity,
          );
          stream = 'ok';
        } catch {
          if (member.viewer === viewer) member.viewer = null;
          stream = 'lost';
        }
      }
      return { serverNow: clock.now(), rev: room.playback.rev, stream };
    },

    chat(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      throttle(member.chatTimes, 60_000, PARTY.chatPerMinute, clock.now());
      say(room, body.text, member);
    },

    typing(code, token) {
      const room = find(code);
      const member = authenticate(room, token);
      const now = clock.now();
      /* Sin error: los de más se descartan (el cliente ya los espacia). */
      if (now - member.typingAt < PARTY.typingIntervalMs) return;
      member.typingAt = now;
      broadcast(room, { type: 'party.typing', data: { memberId: member.id, name: member.name } });
    },

    settings(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      const { control, coleaders, queueMode, auto } = body;
      /* Quién controla, solo el líder; la regla de lo siguiente, también los co-líderes (§13). */
      if (control !== undefined || coleaders !== undefined) requireLeader(room, member);
      if (queueMode !== undefined) requireManager(room, member);
      if (auto !== undefined) {
        requireControl(room, member);
        if (room.live && room.live.auto !== auto) {
          room.live = { ...room.live, auto };
          say(
            room,
            auto
              ? `${member.name} ha activado el cambio automático si se cae.`
              : `${member.name} ha quitado el cambio automático.`,
            null,
          );
        }
      }
      const before = controlRule(room.settings);
      room.settings = {
        ...room.settings,
        ...(control !== undefined ? { control } : {}),
        ...(coleaders !== undefined ? { coleaders } : {}),
      };
      const after = controlRule(room.settings);
      if (after !== before) say(room, CONTROL_TEXT[after](member.name), null);
      if (queueMode && queueMode !== room.settings.queueMode) {
        room.settings = { ...room.settings, queueMode };
        say(room, `${member.name} ha cambiado la lista: ${QUEUE_MODE_TEXT[queueMode]}.`, null);
      }
      sendRoom(room);
    },

    member(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      const target = room.members.get(body.memberId);
      /* Quien creó la sala puede volver a ser líder cuando quiera: es su casa. */
      const reclaim = body.action === 'lead' && member.host && target === member;
      if (!reclaim) requireLeader(room, member);
      if (!target) throw new AppError('party_gone');
      if (body.action === 'coleader' || body.action === 'guest') {
        /* Al líder no se le cambia el papel: primero tendría que pasar la corona. */
        if (target.id === room.leaderId) return;
        const was = room.coleaders.has(target.id);
        if (body.action === 'coleader' && !was) {
          room.coleaders.add(target.id);
          say(room, `${member.name} ha hecho co-líder a ${target.name}.`, null);
        } else if (body.action === 'guest' && was) {
          room.coleaders.delete(target.id);
          say(room, `${target.name} ya no es co-líder.`, null);
        } else {
          return;
        }
        sendRoom(room);
        return;
      }
      if (body.action === 'lead') {
        /* A alguien desconectado no: el liderazgo volvería a pasar a otro en el siguiente barrido. */
        if (!online(target, clock.now())) throw new AppError('party_gone');
        /* Quien pasa la corona se queda de invitado: nadie ha decidido que
           siga controlando (si el nuevo líder quiere, lo hace co-líder). */
        if (target.id !== room.leaderId)
          setLeader(room, target, `${target.name} es ahora el líder.`);
        return;
      }
      /* A uno mismo y a quien creó la sala no se les puede echar. */
      if (target === member || target.host) throw new AppError('party_leader_only');
      const frame = frameOf({ type: 'party.closed', data: { reason: 'kicked' } });
      for (const connection of [...room.connections]) {
        if (connection.memberId === target.id && frame) write(room, connection, frame);
      }
      removeMember(room, target, `${member.name} ha echado a ${target.name}.`);
    },

    queue(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      /* Sin lista ni votos en directo (§14). */
      if (room.live) throw new AppError('validation_error', { detail: 'party_live' });
      queueAction(room, member, body);
    },

    leave(code, token) {
      const room = find(code);
      const member = authenticate(room, token);
      if (member.host) {
        /* El anfitrión no deja su sitio (su enlace sigue valiendo): solo se marca como ido. */
        for (const connection of [...room.connections]) {
          if (connection.memberId === member.id) closeConnection(room, connection);
        }
        /* Después de cerrar sus SSE (que lo dan por visto ahora): así el liderazgo pasa ya. */
        member.lastSeen = clock.now() - PARTY.memberTimeoutMs;
        stopWaiting(room, member.id, clock.now());
        releaseViewer(member);
        handOver(room, clock.now());
        sendRoom(room);
        return;
      }
      removeMember(room, member, `${member.name} se ha ido.`);
    },

    close(code, token) {
      const room = find(code);
      const member = authenticate(room, token);
      if (!member.host) throw new AppError('party_host_only');
      closeRoom(room, 'host');
    },

    list() {
      const now = clock.now();
      return {
        rooms: [...rooms.values()]
          .filter((room) => !room.closed)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((room) => {
            const members = [...room.members.values()];
            return {
              code: room.code,
              title: room.title,
              host: room.members.get(room.hostId)?.name ?? '',
              members: members.length,
              online: members.filter((member) => online(member, now)).length,
              createdAt: room.createdAt,
            };
          }),
      };
    },

    end(code) {
      const room = find(code);
      logger.info({ room: room.code }, 'Ver juntos: sala cerrada desde casa');
      closeRoom(room, 'host');
    },

    health() {
      let members = 0;
      for (const room of rooms.values()) members += room.members.size;
      return { rooms: rooms.size, members, connections: connections() };
    },
  };
}
