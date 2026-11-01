/* «Ver juntos» (docs/ver-juntos.md §6): lo que este aparato sabe de su sala.

   - La credencial de cada sala se guarda en este navegador (localStorage),
     así que recargar o volver a la sala no pide el nombre otra vez.
   - `PartyClient` abre el SSE de la sala, junta lo que llega (foto,
     reproducción, personas, chat, «está escribiendo»), manda el latido de
     estado cada 5 s y las órdenes, y estima el desfase de reloj con cada
     respuesta. En «Esperando a todos» (§13) el latido lleva además si este
     aparato ya puede empezar y cuánto lleva cargado.
     Lo leen los componentes con `useSyncExternalStore`.
   - La última sala en la que se entró desde este navegador: la ficha de una
     película ofrece «Añadir a la sala» (docs/ver-juntos.md §11). */

import {
  PARTY,
  PartyEventSchema,
  type PartyChatMessage,
  type PartyCloseReason,
  type PartyControlBody,
  type PartyCredential,
  type PartyEvent,
  type PartyMemberBody,
  type PartyPlayback,
  type PartyQueueBody,
  type PartyRole,
  type PartyRoom,
  type PartySettingsBody,
} from '@ace/shared';
import { api, isApiError } from '../../api/index.ts';
import { routeUrl } from '../../api/routes.ts';
import { readItem, readJson, removeItem, writeItem, writeJson } from '../../lib/storage.ts';
import { addSample, bestOffset, offsetSample, type OffsetSample } from './sync.ts';

const NAME_KEY = 'aceneo-juntos-nombre';
const credentialKey = (code: string) => `aceneo-juntos-${code}`;

function isCredential(value: unknown): value is PartyCredential {
  const v = value as Partial<PartyCredential> | null;
  return typeof v?.id === 'string' && typeof v.token === 'string';
}

export function savedCredential(code: string): PartyCredential | null {
  return readJson(credentialKey(code), isCredential);
}

export function saveCredential(code: string, credential: PartyCredential): void {
  writeJson(credentialKey(code), credential);
}

export function forgetCredential(code: string): void {
  removeItem(credentialKey(code));
}

const LAST_ROOM_KEY = 'aceneo-juntos-ultima';

/** La última sala en la que se entró (con su credencial), o null. */
export function lastRoom(): { code: string; credential: PartyCredential } | null {
  const code = readItem(LAST_ROOM_KEY);
  const credential = code ? savedCredential(code) : null;
  return code && credential ? { code, credential } : null;
}

export function rememberRoom(code: string): void {
  writeItem(LAST_ROOM_KEY, code);
}

export function forgetLastRoom(): void {
  removeItem(LAST_ROOM_KEY);
}

/**
 * Una sala que ya no sirve (cerrada, caducada o de la que se ha salido): se
 * olvida su credencial y, si era la última, deja de ofrecerse «Volver a tu
 * sala» o «Añadir a la sala».
 */
export function forgetRoom(code: string): void {
  forgetCredential(code);
  if (readItem(LAST_ROOM_KEY) === code) forgetLastRoom();
}

export function savedName(): string {
  return readItem(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  writeItem(NAME_KEY, name.trim());
}

/**
 * El enlace para invitar: el del proxy de la sala si el servidor lo conoce
 * (`room.inviteUrl`, docs/ver-juntos.md §9); si no, la web de casa.
 */
export function inviteUrl(
  code: string,
  publicUrl: string | null = null,
  location: Location = globalThis.location,
): string {
  return publicUrl ?? `${location.origin}${location.pathname}?vista=juntos/${code}`;
}

export type Connection = 'connecting' | 'open' | 'reconnecting';

export interface PartyState {
  readonly room: PartyRoom | null;
  readonly chat: readonly PartyChatMessage[];
  readonly connection: Connection;
  /** Cerrada para todos (o ya no estás): la vista lo explica y deja de intentar. */
  readonly closed: PartyCloseReason | 'forbidden' | 'gone' | null;
  /** Hora del servidor ≈ `Date.now() + offsetMs`. */
  readonly offsetMs: number;
  /** Lo que dijo el último latido de la sesión de vídeo (`partyStatus`). */
  readonly stream: 'ok' | 'lost' | 'none';
  /** Quién está escribiendo (§13); cada uno hasta `until` (hora de este aparato). */
  readonly typing: readonly Typing[];
}

export interface Typing {
  readonly memberId: string;
  readonly name: string;
  readonly until: number;
}

const INITIAL: PartyState = {
  room: null,
  chat: [],
  connection: 'connecting',
  closed: null,
  offsetMs: 0,
  stream: 'none',
  typing: [],
};

/** El papel de alguien en la sala (§13): el líder por `leaderId`, aunque el servidor sea viejo. */
export function roleOf(room: PartyRoom | null, memberId: string): PartyRole {
  if (!room) return 'guest';
  if (room.leaderId === memberId) return 'leader';
  return room.members.find((member) => member.id === memberId)?.role === 'coleader'
    ? 'coleader'
    : 'guest';
}

/** El líder, o un co-líder si la sala deja controlar a los co-líderes. */
export function isManager(room: PartyRoom | null, selfId: string): boolean {
  const role = roleOf(room, selfId);
  return role === 'leader' || (role === 'coleader' && !!room?.settings.coleaders);
}

/** ¿Puede esta persona mandar en el vídeo? El líder (y los co-líderes), o todos si así lo ha dejado. */
export function canControl(room: PartyRoom | null, selfId: string): boolean {
  return !!room && (room.settings.control === 'everyone' || isManager(room, selfId));
}

/** Quiénes controlan, por su nombre («Ismael y Yassin»); null si controlan todos. */
export function controllers(room: PartyRoom): string[] | null {
  if (room.settings.control === 'everyone') return null;
  return room.members
    .filter((member) => isManager(room, member.id))
    .sort((a, b) => Number(b.id === room.leaderId) - Number(a.id === room.leaderId))
    .map((member) => member.name);
}

/** Lo que el cliente necesita del navegador (los tests lo cambian). */
export interface PartyEnv {
  now(): number;
  eventSource(url: string): EventSource;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** «Esperando a todos»: lo que el reproductor cuenta de su carga (o null fuera de la espera). */
export interface LobbyReport {
  readonly ready: boolean;
  readonly progress: number;
}

/** En la espera, un cambio del % sale al momento si es de al menos esto (y `ready` siempre). */
const PROGRESS_STEP = 10;
/** Y no más de uno por segundo. */
const LOBBY_STATUS_MS = 1_000;

const BROWSER: PartyEnv = {
  now: () => Date.now(),
  eventSource: (url) => new EventSource(url),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

const EVENT_TYPES: readonly PartyEvent['type'][] = [
  'party.snapshot',
  'party.playback',
  'party.room',
  'party.chat',
  'party.typing',
  'party.closed',
];

export class PartyClient {
  private state: PartyState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private statusTimer: unknown = null;
  private samples: OffsetSample[] = [];
  /** Cuándo empezó la última sesión de vídeo (`resetStream`). */
  private streamResetAt = Number.NEGATIVE_INFINITY;
  private stopped = false;
  /** Lo que el reproductor dice de sí mismo para el latido. */
  private local: { positionS: number; buffering: boolean; lobby: LobbyReport | null } = {
    positionS: 0,
    buffering: false,
    lobby: null,
  };
  /** Lo último que se mandó de la espera (para no repetirlo) y cuándo. */
  private sentLobby: LobbyReport | null = null;
  private sentLobbyAt = Number.NEGATIVE_INFINITY;
  /** El último «está escribiendo» mandado. */
  private typingSentAt = Number.NEGATIVE_INFINITY;

  constructor(
    readonly code: string,
    readonly credential: PartyCredential,
    private readonly env: PartyEnv = BROWSER,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PartyState => this.state;

  private set(patch: Partial<PartyState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    this.stopped = false;
    this.open();
    this.statusTimer = this.env.setInterval(() => void this.sendStatus(), PARTY.statusIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    if (this.statusTimer !== null) this.env.clearInterval(this.statusTimer);
    this.statusTimer = null;
  }

  private open(): void {
    const url = routeUrl('partyEvents', { code: this.code }, { t: this.credential.token });
    const source = this.env.eventSource(url);
    this.source = source;
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        let data: unknown;
        try {
          data = JSON.parse((message as MessageEvent<string>).data);
        } catch {
          return;
        }
        const parsed = PartyEventSchema.safeParse({ type, data });
        if (parsed.success) this.apply(parsed.data);
      });
    }
    source.addEventListener('open', () => this.set({ connection: 'open' }));
    source.addEventListener('error', () => {
      if (this.stopped || this.state.closed) return;
      this.set({ connection: 'reconnecting' });
      /* EventSource reintenta solo; si lo ha dado por perdido (un 403 o un 404), se mira por qué. */
      if (source.readyState === 2) void this.diagnose();
    });
  }

  /** El SSE no vuelve: ¿la sala ya no existe o ya no estás? Si no, se reabre. */
  private async diagnose(): Promise<void> {
    try {
      await this.sendStatus(true);
      if (!this.stopped && !this.state.closed) {
        this.source?.close();
        this.open();
      }
    } catch {
      /* `sendStatus` ya apuntó `closed` si era eso; si es la red, el siguiente latido lo dirá. */
    }
  }

  private apply(event: PartyEvent): void {
    switch (event.type) {
      case 'party.snapshot':
        this.noteServerTime(event.data.serverNow);
        this.set({ room: event.data.room, chat: event.data.chat, connection: 'open' });
        break;
      case 'party.playback': {
        const room = this.state.room;
        if (!room || event.data.playback.rev < room.playback.rev) return;
        this.set({ room: { ...room, playback: event.data.playback } });
        break;
      }
      case 'party.room': {
        const room = this.state.room;
        if (!room) return;
        this.set({ room: { ...room, ...event.data } });
        break;
      }
      case 'party.chat': {
        /* Quien manda su mensaje deja de estar «escribiendo». */
        const author = event.data.message.memberId;
        this.set({
          chat: [...this.state.chat, event.data.message].slice(-PARTY.chatHistory),
          typing: this.state.typing.filter((entry) => entry.memberId !== author),
        });
        break;
      }
      case 'party.typing': {
        if (event.data.memberId === this.credential.id) return;
        const until = this.env.now() + PARTY.typingShowMs;
        this.set({
          typing: [
            ...this.state.typing.filter((entry) => entry.memberId !== event.data.memberId),
            { memberId: event.data.memberId, name: event.data.name, until },
          ],
        });
        break;
      }
      case 'party.closed':
        forgetRoom(this.code);
        this.set({ closed: event.data.reason });
        this.stop();
        break;
    }
  }

  /** Muestra de una sola dirección (el SSE): solo mientras no haya ninguna mejor. */
  private noteServerTime(serverNow: number): void {
    if (this.samples.length > 0) return;
    this.set({ offsetMs: serverNow - this.env.now() });
  }

  private noteRoundTrip(sentAt: number, serverNow: number, patch: Partial<PartyState> = {}): void {
    this.samples = addSample(this.samples, offsetSample(sentAt, this.env.now(), serverNow));
    this.set({ ...patch, offsetMs: bestOffset(this.samples) });
  }

  /**
   * Una sesión de vídeo nueva (el reproductor acaba de recibir la concesión): el «lost» que
   * quedaba de la anterior ya no vale. Sin avisar a nadie; las respuestas de `status` que se
   * enviaron antes de esto tampoco cuentan para `stream`.
   */
  resetStream(): void {
    this.streamResetAt = this.env.now();
    if (this.state.stream !== 'none') this.state = { ...this.state, stream: 'none' };
  }

  private handleFailure(error: unknown): void {
    if (!isApiError(error)) return;
    if (error.code === 'party_not_found') {
      forgetRoom(this.code);
      this.set({ closed: 'gone' });
      this.stop();
    } else if (error.code === 'party_forbidden') {
      forgetCredential(this.code);
      this.set({ closed: 'forbidden' });
      this.stop();
    }
  }

  /**
   * El reproductor cuenta dónde va y si está cargando; un cambio de «cargando»
   * sale al momento. En «Esperando a todos», también si ya puede empezar y su
   * % (al momento si cambia `ready` o el % sube un tramo, uno por segundo).
   */
  report(positionS: number, buffering: boolean, lobby: LobbyReport | null = null): void {
    let urgent = buffering !== this.local.buffering;
    if (lobby) {
      const sent = this.sentLobby;
      /* «Listo» sale siempre al momento (la sala arranca con él); el % va espaciado. */
      if (!sent || sent.ready !== lobby.ready) urgent = true;
      else if (
        Math.abs(sent.progress - lobby.progress) >= PROGRESS_STEP &&
        this.env.now() - this.sentLobbyAt >= LOBBY_STATUS_MS
      ) {
        urgent = true;
      }
    }
    this.local = { positionS, buffering, lobby };
    if (urgent) void this.sendStatus().catch(() => undefined);
  }

  private async sendStatus(rethrow = false): Promise<void> {
    if (this.state.closed) return;
    const sentAt = this.env.now();
    const lobby = this.local.lobby;
    if (lobby) {
      this.sentLobby = lobby;
      this.sentLobbyAt = sentAt;
    }
    try {
      const response = await api('partyStatus', {
        params: { code: this.code },
        body: {
          token: this.credential.token,
          positionS: Math.max(0, Math.min(86_400, this.local.positionS)),
          buffering: this.local.buffering,
          ...(lobby
            ? {
                ready: lobby.ready,
                progress: Math.round(Math.max(0, Math.min(100, lobby.progress))),
              }
            : {}),
        },
      });
      /* La hora y la sesión en un solo cambio: nadie ve el «lost» viejo con la hora nueva. Una
         respuesta a un envío de antes de la sesión nueva no dice nada de ella. */
      const stream =
        response.stream && response.stream !== this.state.stream && sentAt >= this.streamResetAt
          ? { stream: response.stream }
          : {};
      this.noteRoundTrip(sentAt, response.serverNow, stream);
    } catch (error) {
      this.handleFailure(error);
      if (rethrow) throw error;
    }
  }

  async control(order: DistributiveOmit<PartyControlBody, 'token'>): Promise<void> {
    const sentAt = this.env.now();
    try {
      const response = await api('partyControl', {
        params: { code: this.code },
        body: { ...order, token: this.credential.token } as PartyControlBody,
      });
      this.noteRoundTrip(sentAt, response.serverNow);
    } catch (error) {
      this.handleFailure(error);
      throw error;
    }
  }

  async chat(text: string): Promise<void> {
    try {
      await api('partyChat', {
        params: { code: this.code },
        body: { token: this.credential.token, text },
      });
    } catch (error) {
      this.handleFailure(error);
      throw error;
    }
  }

  /** Se está escribiendo en el chat: avisa a la sala, como mucho uno cada `typingIntervalMs`. */
  typing(): void {
    const now = this.env.now();
    if (this.state.closed || now - this.typingSentAt < PARTY.typingIntervalMs) return;
    this.typingSentAt = now;
    void api('partyTyping', {
      params: { code: this.code },
      body: { token: this.credential.token },
    }).catch(() => undefined);
  }

  /** Quita los «está escribiendo» que ya han caducado (la vista lo llama con su reloj). */
  expireTyping(): void {
    const now = this.env.now();
    if (!this.state.typing.some((entry) => entry.until <= now)) return;
    this.set({ typing: this.state.typing.filter((entry) => entry.until > now) });
  }

  async settings(patch: Omit<PartySettingsBody, 'token'>): Promise<void> {
    const { code, credential } = this;
    await this.guard(() =>
      api('partySettings', { params: { code }, body: { ...patch, token: credential.token } }),
    );
  }

  async member(memberId: string, action: PartyMemberBody['action']): Promise<void> {
    const { code, credential } = this;
    await this.guard(() =>
      api('partyMember', {
        params: { code },
        body: { token: credential.token, memberId, action },
      }),
    );
  }

  async queue(order: DistributiveOmit<PartyQueueBody, 'token'>): Promise<void> {
    const { code, credential } = this;
    await this.guard(() =>
      api('partyQueue', {
        params: { code },
        body: { ...order, token: credential.token } as PartyQueueBody,
      }),
    );
  }

  /** Si la respuesta dice que ya no estás o que no está la sala, la vista se cierra. */
  private async guard(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.handleFailure(error);
      throw error;
    }
  }

  async leave(): Promise<void> {
    this.stop();
    await api('partyLeave', {
      params: { code: this.code },
      body: { token: this.credential.token },
      keepalive: true,
    }).catch(() => undefined);
    forgetRoom(this.code);
  }

  /**
   * Cierra la sala para todos (quien la creó). Si ya no existía, también vale:
   * el resultado es el mismo. Al acabar, este aparato deja de escuchar y la
   * olvida; la vista se encarga de llevar a otro sitio.
   */
  async close(): Promise<void> {
    try {
      await api('partyClose', {
        params: { code: this.code },
        body: { token: this.credential.token },
      });
    } catch (error) {
      if (!isApiError(error) || error.code !== 'party_not_found') {
        this.handleFailure(error);
        throw error;
      }
    }
    this.stop();
    forgetRoom(this.code);
  }

  /** Hora del servidor ahora mismo según este aparato. */
  serverNow(): number {
    return this.env.now() + this.state.offsetMs;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** La reproducción de la sala, o null si aún no ha llegado la foto. */
export function playbackOf(state: PartyState): PartyPlayback | null {
  return state.room?.playback ?? null;
}
