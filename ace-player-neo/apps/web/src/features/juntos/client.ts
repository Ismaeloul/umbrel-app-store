/* «Ver juntos» (docs/ver-juntos.md §6): lo que este aparato sabe de su sala.

   - La credencial de cada sala se guarda en este navegador (localStorage),
     así que recargar o volver a la sala no pide el nombre otra vez.
   - `PartyClient` abre el SSE de la sala, junta lo que llega (foto,
     reproducción, personas, chat), manda el latido de estado cada 5 s y las
     órdenes, y estima el desfase de reloj con cada respuesta. Lo leen los
     componentes con `useSyncExternalStore`. */

import {
  PARTY,
  PartyEventSchema,
  type PartyChatMessage,
  type PartyCloseReason,
  type PartyControlBody,
  type PartyCredential,
  type PartyEvent,
  type PartyPlayback,
  type PartyRoom,
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

export function savedName(): string {
  return readItem(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  writeItem(NAME_KEY, name.trim());
}

/** El enlace para invitar (en la fase 1, la misma dirección de la web de casa). */
export function inviteUrl(code: string, location: Location = globalThis.location): string {
  return `${location.origin}${location.pathname}?vista=juntos/${code}`;
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
}

const INITIAL: PartyState = {
  room: null,
  chat: [],
  connection: 'connecting',
  closed: null,
  offsetMs: 0,
};

/** Lo que el cliente necesita del navegador (los tests lo cambian). */
export interface PartyEnv {
  now(): number;
  eventSource(url: string): EventSource;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

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
  'party.closed',
];

export class PartyClient {
  private state: PartyState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private statusTimer: unknown = null;
  private samples: OffsetSample[] = [];
  private stopped = false;
  /** Lo que el reproductor dice de sí mismo para el latido. */
  private local: { positionS: number; buffering: boolean } = { positionS: 0, buffering: false };

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
      case 'party.chat':
        this.set({ chat: [...this.state.chat, event.data.message].slice(-PARTY.chatHistory) });
        break;
      case 'party.closed':
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

  private noteRoundTrip(sentAt: number, serverNow: number): void {
    this.samples = addSample(this.samples, offsetSample(sentAt, this.env.now(), serverNow));
    this.set({ offsetMs: bestOffset(this.samples) });
  }

  private handleFailure(error: unknown): void {
    if (!isApiError(error)) return;
    if (error.code === 'party_not_found') {
      this.set({ closed: 'gone' });
      this.stop();
    } else if (error.code === 'party_forbidden') {
      forgetCredential(this.code);
      this.set({ closed: 'forbidden' });
      this.stop();
    }
  }

  /** El reproductor cuenta dónde va y si está cargando; un cambio de «cargando» sale al momento. */
  report(positionS: number, buffering: boolean): void {
    const changed = buffering !== this.local.buffering;
    this.local = { positionS, buffering };
    if (changed) void this.sendStatus().catch(() => undefined);
  }

  private async sendStatus(rethrow = false): Promise<void> {
    if (this.state.closed) return;
    const sentAt = this.env.now();
    try {
      const response = await api('partyStatus', {
        params: { code: this.code },
        body: {
          token: this.credential.token,
          positionS: Math.max(0, Math.min(86_400, this.local.positionS)),
          buffering: this.local.buffering,
        },
      });
      this.noteRoundTrip(sentAt, response.serverNow);
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

  async leave(): Promise<void> {
    this.stop();
    await api('partyLeave', {
      params: { code: this.code },
      body: { token: this.credential.token },
      keepalive: true,
    }).catch(() => undefined);
  }

  async close(): Promise<void> {
    await api('partyClose', {
      params: { code: this.code },
      body: { token: this.credential.token },
    });
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
