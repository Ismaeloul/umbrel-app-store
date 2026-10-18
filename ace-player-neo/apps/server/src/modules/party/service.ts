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
   se compara en tiempo constante. */

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
  type PartyMember,
  type PartyPlayback,
  type PartyRoom,
  type PartyTitle,
} from '@ace/shared';
import type { FastifyReply } from 'fastify';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { Unsubscribe } from '../../core/bus.js';
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
  readonly createdAt: number;
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
  closed: boolean;
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
  const { clock, logger, bus, playback } = deps;
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

  function membersView(room: Room, now = clock.now()): PartyMember[] {
    return [...room.members.values()].map((member) => ({
      id: member.id,
      name: member.name,
      host: member.host,
      online: online(member, now),
      buffering: member.buffering,
    }));
  }

  function roomView(room: Room): PartyRoom {
    return {
      code: room.code,
      title: room.title,
      audio: room.audio,
      interrupted: room.interrupted,
      hostId: room.hostId,
      createdAt: room.createdAt,
      members: membersView(room),
      playback: playbackView(room),
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

  function closeRoom(room: Room, reason: PartyCloseReason): void {
    if (room.closed) return;
    broadcast(room, { type: 'party.closed', data: { reason } });
    room.closed = true;
    rooms.delete(room.code);
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
    for (const connection of [...room.connections]) {
      if (connection.memberId === member.id) closeConnection(room, connection);
    }
    stopWaiting(room, member.id, clock.now());
    say(room, text, null);
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

  /** Si alguien lleva cargando más de la gracia con la sala reproduciendo, el reloj se para. */
  function maybeWait(room: Room, member: Member, now: number): void {
    if (!room.playback.playing || room.interrupted) return;
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
      const room: Room = {
        code,
        title: {
          id: body.titleId,
          kind: body.kind,
          artId: body.artId,
          poster: body.poster,
          title: body.title,
          subtitle: body.subtitle,
          durationS: null,
        },
        audio: { index: body.audio, tracks: [] },
        interrupted: null,
        hostId,
        createdAt: now,
        members: new Map(),
        playback: { playing: false, positionS: 0, at: now, rev: 1 },
        waiting: new Map(),
        chat: [],
        nextMessageId: 1,
        connections: new Set(),
        emptySince: null,
        viewers: new Set(),
        audioSwitchUntil: 0,
        closed: false,
      };
      rooms.set(code, room);
      /* El anfitrión lleva el id reservado arriba (`hostId` es fijo en la sala). */
      const host = addMember(room, body.name, true, hostId);
      ensureSweep();
      say(room, `${host.member.name} ha creado la sala.`, null);
      logger.info({ room: code, title: body.titleId }, 'Ver juntos: sala creada');
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
      authenticate(room, query.t);
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
      if (room.closed) return grant;
      room.viewers.add(viewer.viewerId);
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
      const changed =
        JSON.stringify(title) !== JSON.stringify(room.title) ||
        JSON.stringify(audio) !== JSON.stringify(room.audio) ||
        room.interrupted !== null;
      room.title = title;
      room.audio = audio;
      if (room.interrupted) {
        room.interrupted = null;
        say(room, 'El vídeo vuelve a estar listo.', null);
      }
      if (changed) sendRoom(room);
      return grant;
    },

    control(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      const now = clock.now();
      fix(room, body.positionS, now);
      let action: PartyAction = body.action;
      switch (body.action) {
        case 'play':
          room.playback.playing = true;
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

    status(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      const now = clock.now();
      if (body.buffering !== member.buffering) {
        member.buffering = body.buffering;
        member.bufferingSince = body.buffering ? now : null;
        if (!body.buffering) stopWaiting(room, member.id, now);
        else maybeWait(room, member, now);
        sendRoom(room);
      }
      return { serverNow: now, rev: room.playback.rev };
    },

    chat(code, body) {
      const room = find(code);
      const member = authenticate(room, body.token);
      const now = clock.now();
      while (member.chatTimes.length && now - (member.chatTimes[0] ?? 0) >= 60_000) {
        member.chatTimes.shift();
      }
      if (member.chatTimes.length >= PARTY.chatPerMinute) throw new AppError('rate_limited');
      member.chatTimes.push(now);
      say(room, body.text, member);
    },

    leave(code, token) {
      const room = find(code);
      const member = authenticate(room, token);
      if (member.host) {
        /* El anfitrión no deja su sitio (su enlace sigue valiendo): solo se marca como ido. */
        member.lastSeen = clock.now() - PARTY.memberTimeoutMs;
        for (const connection of [...room.connections]) {
          if (connection.memberId === member.id) closeConnection(room, connection);
        }
        stopWaiting(room, member.id, clock.now());
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

    health() {
      let members = 0;
      for (const room of rooms.values()) members += room.members.size;
      return { rooms: rooms.size, members, connections: connections() };
    },
  };
}
