/* «Ver juntos» (docs/ver-juntos.md §6): lo que este aparato sabe de su sala.

   - La credencial de cada sala se guarda en este navegador (localStorage),
     así que recargar o volver a la sala no pide el nombre otra vez.
   - `PartyClient` abre el SSE de la sala, junta lo que llega (foto,
     reproducción, personas, chat, «está escribiendo»), manda el latido de
     estado cada 5 s y las órdenes, y estima el desfase de reloj con cada
     respuesta (con las cuatro marcas si el servidor manda `receivedAt`, una
     ráfaga de cuatro al entrar, al reabrir el SSE y al volver a la página).
     En «Esperando a todos» (§13) el latido lleva además si este aparato ya
     puede empezar y cuánto lleva cargado.
   - El SSE se recupera solo: pide el latido con nombre (`ping=1`), lo da por
     muerto tras `SSE_SILENT_MS` sin tramas y, si el navegador lo da por
     perdido, lo reabre con esperas de 3, 6, 12… 30 s mirando antes si la
     sala sigue (`diagnose`).
   - Contra duplicados: la misma orden en `DUPLICATE_ORDER_MS` no sale dos veces.
     Lo leen los componentes con `useSyncExternalStore`.
   - La última sala en la que se entró desde este navegador: la ficha de una
     película ofrece «Añadir a la sala» (docs/ver-juntos.md §11). */

import {
  PARTY,
  PartyEventSchema,
  type PartyChatMessage,
  type PartyCloseReason,
  type PartyControlBody,
  type PartyControlSource,
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
import {
  addSample,
  bestOffset,
  bestSample,
  freshSamples,
  monotonicNow,
  offsetJumps,
  offsetSample,
  slewOffset,
  type OffsetSample,
} from './sync.ts';

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
  /**
   * Hora del servidor ≈ hora de este aparato (`monotonicNow`) + `offsetMs`: el desfase que se usaba
   * con la última muestra; `serverNow()` lo va acercando al nuevo (`slewOffset`).
   */
  readonly offsetMs: number;
  /** Lo que dijo el último latido de la sesión de vídeo (`partyStatus`). */
  readonly stream: 'ok' | 'lost' | 'none';
  /** Quién está escribiendo (§13); cada uno hasta `until` (hora de este aparato). */
  readonly typing: readonly Typing[];
  /**
   * «Estoy listo» (§13, pelis y series): quién no lo ha tocado aún, como lo dice el último
   * `party.votes`. Vacío hasta que llega (o con un servidor viejo): todos cuentan como que sí.
   */
  readonly unvoted: readonly string[];
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
  unvoted: [],
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

/* directo §14 */
/**
 * ¿Puede esta persona cambiar la fuente o el partido? Como `canSwitchLive` del servidor: el
 * líder, cualquier co-líder (aunque los co-líderes no controlen el vídeo), el anfitrión y, con
 * «Controlan todos», todos. Vive aquí (y no en liveSources.ts, que tira de Fuentes de la ficha)
 * para que la sala no baje Fuentes ni la agenda sin abrirlas.
 */
export function canSwitchLive(room: PartyRoom | null, selfId: string): boolean {
  if (!room?.live) return false;
  if (room.settings.control === 'everyone') return true;
  if (room.leaderId === selfId || room.hostId === selfId) return true;
  return room.members.some((member) => member.id === selfId && member.role === 'coleader');
}

/** Quién puede cambiar la fuente (los nombres, el líder primero), o null con «Controlan todos». */
export function liveSwitchers(room: PartyRoom): string[] | null {
  if (room.settings.control === 'everyone') return null;
  return room.members
    .filter(
      (member) =>
        member.id === room.leaderId || member.id === room.hostId || member.role === 'coleader',
    )
    .sort((a, b) => Number(b.id === room.leaderId) - Number(a.id === room.leaderId))
    .map((member) => member.name);
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
  /**
   * La hora del sistema (`Date.now()`), solo para ver si el aparato ha dormido: en WebKit, y en
   * Chrome del Mac, `performance.now()` (`now`) no avanza mientras duerme. Opcional (los tests
   * viejos no la dan): sin ella no se mira.
   */
  wallNow?(): number;
  eventSource(url: string): EventSource;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /**
   * Opcionales (los tests viejos no los dan): sin `setTimeout` no hay ráfaga de `status` ni
   * reapertura con espera del SSE; sin `listen`, no se escucha si la página vuelve a verse.
   */
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
  /** Escucha un evento de `document` o `window`; devuelve cómo dejar de escuchar. */
  listen?(target: 'document' | 'window', type: string, fn: (event: Event) => void): () => void;
  /** ¿Se ve la página? (sin `document`, sí). */
  visible?(): boolean;
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
/** La ráfaga de `status` (al entrar, al reabrir el SSE, al volver a verse): cuántos y cada cuánto. */
export const STATUS_BURST = 4;
export const STATUS_BURST_GAP_MS = 250;
/**
 * Si la hora del sistema avanza esto más que la monótona desde la última vez que se miró, el
 * aparato ha dormido (iPhone bloqueado, Mac en reposo): la hora monótona se paró.
 */
export const CLOCK_SLEEP_MS = 1_500;
/** Sin ninguna trama del SSE en esto (el latido es cada `PARTY.heartbeatMs`), se da por muerto. */
export const SSE_SILENT_MS = 25_000;
/** La espera para reabrir el SSE que el navegador dio por perdido: 3, 6, 12… hasta 30 s. */
export const SSE_REOPEN_BASE_MS = 3_000;
export const SSE_REOPEN_MAX_MS = 30_000;
/** La misma orden (o un salto al mismo sitio, ±`DUPLICATE_SEEK_S`) en esto no se manda otra vez. */
export const DUPLICATE_ORDER_MS = 500;
export const DUPLICATE_SEEK_S = 0.5;
/** Las últimas órdenes que se guardan para depurar (`?debug=juntos`). */
const ORDER_LOG_SIZE = 50;

/** Una orden de este aparato (para depurar): qué, a dónde, desde dónde y si salió. */
export interface OrderRecord {
  readonly at: number;
  readonly action: PartyControlBody['action'];
  readonly positionS: number | null;
  readonly source: PartyControlSource | null;
  /** `sent`, o `duplicate` si no se mandó por repetida. */
  readonly result: 'sent' | 'duplicate';
}

const BROWSER: PartyEnv = {
  now: monotonicNow,
  wallNow: () => Date.now(),
  eventSource: (url) => new EventSource(url),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  listen: (target, type, fn) => {
    const node: EventTarget | undefined =
      target === 'document' ? globalThis.document : globalThis.window;
    if (!node) return () => undefined;
    node.addEventListener(type, fn);
    return () => node.removeEventListener(type, fn);
  },
  visible: () => globalThis.document?.visibilityState !== 'hidden',
};

const EVENT_TYPES: readonly PartyEvent['type'][] = [
  'party.snapshot',
  'party.playback',
  'party.room',
  'party.chat',
  'party.typing',
  'party.votes',
  'party.ping',
  'party.closed',
];

/** El desfase que se usa: se acerca de `from` a `to` desde `at` (`slewOffset`). */
interface OffsetTrack {
  readonly from: number;
  readonly to: number;
  readonly at: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Una orden sin la credencial (y sin `source`: va como segundo argumento de `control`). */
export type PartyOrder = DistributiveOmit<PartyControlBody, 'token' | 'source'>;

export class PartyClient {
  private state: PartyState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private statusTimer: unknown = null;
  private samples: OffsetSample[] = [];
  /** El desfase que se usa y hacia dónde va; null hasta la primera muestra. */
  private offset: OffsetTrack | null = null;
  /** El desfase salió de la foto del SSE (una sola dirección): la primera ida y vuelta lo pisa. */
  private offsetRough = false;
  /** Las dos horas (monótona y del sistema) la última vez que se miró si el aparato durmió. */
  private clockRef: { mono: number; wall: number } | null = null;
  /**
   * El aparato acaba de dormir: hasta la siguiente ida y vuelta, `serverNow()` es una estimación
   * (`clockStale`) y el reproductor no salta ni corrige con ella.
   */
  private stale = false;
  /** Cuándo empezó la última sesión de vídeo (`resetStream`). */
  private streamResetAt = Number.NEGATIVE_INFINITY;
  private stopped = false;
  /** Lo que el reproductor dice de sí mismo para el latido. */
  private local: {
    positionS: number;
    buffering: boolean;
    lobby: LobbyReport | null;
    voted: boolean;
  } = {
    positionS: 0,
    buffering: false,
    lobby: null,
    /* «Estoy listo» (§13): esta página aún no ha tocado nada (al recargar, otra vez). */
    voted: false,
  };
  /** Lo último que se mandó de la espera (para no repetirlo) y cuándo. */
  private sentLobby: LobbyReport | null = null;
  private sentLobbyAt = Number.NEGATIVE_INFINITY;
  /** El último «está escribiendo» mandado. */
  private typingSentAt = Number.NEGATIVE_INFINITY;
  /** La última trama del SSE (cualquier evento, `party.ping` incluido, o la apertura). */
  private lastFrameAt = 0;
  /** ¿Se ha abierto ya algún SSE? (una apertura después de la primera es una reapertura). */
  private openedOnce = false;
  private reopenTimer: unknown = null;
  private reopenDelayMs = SSE_REOPEN_BASE_MS;
  private burstTimers: unknown[] = [];
  private unlisten: (() => void)[] = [];
  /** La última orden de reproducción mandada (contra los duplicados). */
  private lastOrder: { action: string; positionS: number; at: number } | null = null;
  private readonly orderLog: OrderRecord[] = [];

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

  /** Las últimas órdenes de este aparato, de la más vieja a la más nueva (`?debug=juntos`). */
  getOrders = (): readonly OrderRecord[] => this.orderLog;

  private set(patch: Partial<PartyState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    this.stopped = false;
    this.clockRef = null;
    this.checkSleep();
    this.open();
    this.statusTimer = this.env.setInterval(() => this.beat(), PARTY.statusIntervalMs);
    const listen = this.env.listen;
    if (listen) {
      this.unlisten = [
        listen('document', 'visibilitychange', () => {
          if (this.env.visible?.() !== false) this.wake();
        }),
        listen('window', 'online', () => this.wake()),
        listen('window', 'pageshow', (event) => {
          if ((event as PageTransitionEvent).persisted) this.wake();
        }),
      ];
    }
    this.burst();
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    if (this.statusTimer !== null) this.env.clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.clearReopen();
    for (const timer of this.burstTimers) this.env.clearTimeout?.(timer);
    this.burstTimers = [];
    for (const off of this.unlisten) off();
    this.unlisten = [];
  }

  /** El latido de cada `PARTY.statusIntervalMs`: el `status` y el vigilante del SSE. */
  private beat(): void {
    if (this.stopped) return;
    /* Si el aparato durmió, `checkSleep` ya reabre el SSE (con su ráfaga). */
    this.checkSleep();
    /* Abierto y sin ninguna trama en `SSE_SILENT_MS` (un proxy que corta sin cerrar, el
       iPhone que vuelve del bolsillo): se cierra y se abre otro. */
    const source = this.source;
    if (source && source.readyState !== 2 && this.silent()) this.reopen();
    void this.sendStatus().catch(() => undefined);
  }

  /** ¿Lleva el SSE más de `SSE_SILENT_MS` sin ninguna trama? */
  private silent(): boolean {
    return this.lastFrameAt > 0 && this.env.now() - this.lastFrameAt > SSE_SILENT_MS;
  }

  /** La página vuelve a verse, vuelve la red o vuelve de la caché de atrás: SSE vivo y reloj nuevo. */
  private wake(): void {
    if (this.stopped || this.state.closed) return;
    if (this.checkSleep()) return;
    const source = this.source;
    /* Al abrir, la propia apertura trae la ráfaga. */
    if (!source || source.readyState === 2 || this.silent()) this.reopen();
    else this.burst();
  }

  /**
   * ¿Ha dormido el aparato desde la última vez que se miró? La hora monótona (`now`) no avanza
   * mientras duerme en WebKit ni en Chrome del Mac: tras 10 minutos con el iPhone bloqueado,
   * `serverNow()` iba 10 minutos atrás y el primer tic saltaba ahí, y el SSE medio muerto que deja
   * iOS no parecía callado (`silent`). Si la del sistema ha avanzado `CLOCK_SLEEP_MS` más, se suma
   * lo dormido al desfase (una estimación: `clockStale` hasta la siguiente ida y vuelta, que lo
   * pisa), las muestras de antes ya no valen y el SSE se reabre (con su ráfaga de `status`).
   */
  private checkSleep(): boolean {
    const wallNow = this.env.wallNow;
    if (!wallNow) return false;
    const mono = this.env.now();
    const wall = wallNow();
    const ref = this.clockRef;
    this.clockRef = { mono, wall };
    if (!ref) return false;
    const sleptMs = wall - ref.wall - (mono - ref.mono);
    if (sleptMs < CLOCK_SLEEP_MS) return false;
    if (this.offset) {
      this.offset = {
        from: this.offset.from + sleptMs,
        to: this.offset.to + sleptMs,
        at: this.offset.at,
      };
    }
    this.samples = [];
    this.offsetRough = true;
    this.stale = true;
    if (this.lastFrameAt > 0) this.lastFrameAt -= sleptMs;
    if (!this.stopped && !this.state.closed) this.reopen();
    return true;
  }

  /**
   * ¿El aparato acaba de dormir y aún no hay una ida y vuelta nueva? Entonces la hora de la sala
   * (`serverNow`) es una estimación: no vale para saltar.
   */
  clockStale(): boolean {
    this.checkSleep();
    return this.stale;
  }

  /**
   * Ráfaga de `STATUS_BURST` `status` separados `STATUS_BURST_GAP_MS`: con cuatro idas y vueltas
   * seguidas la mejor muestra es buena enseguida. Las muestras de antes (otra red, el aparato
   * dormido) ya no valen.
   */
  private burst(): void {
    const setTimeout = this.env.setTimeout;
    if (!setTimeout || this.stopped) return;
    for (const timer of this.burstTimers) this.env.clearTimeout?.(timer);
    this.samples = [];
    this.burstTimers = Array.from({ length: STATUS_BURST }, (_, index) =>
      setTimeout(() => {
        if (!this.stopped) void this.sendStatus().catch(() => undefined);
      }, index * STATUS_BURST_GAP_MS),
    );
  }

  private open(): void {
    const url = routeUrl(
      'partyEvents',
      { code: this.code },
      { t: this.credential.token, ping: '1' },
    );
    const source = this.env.eventSource(url);
    this.source = source;
    /* Una conexión vieja (ya cambiada por otra) no toca nada: nunca dos SSE a la vez. */
    const current = () => source === this.source && !this.stopped;
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        if (!current()) return;
        this.lastFrameAt = this.env.now();
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
    source.addEventListener('open', () => {
      if (!current()) return;
      this.lastFrameAt = this.env.now();
      this.reopenDelayMs = SSE_REOPEN_BASE_MS;
      this.clearReopen();
      const reopened = this.openedOnce;
      this.openedOnce = true;
      this.set({ connection: 'open' });
      if (reopened) this.burst();
    });
    source.addEventListener('error', () => {
      if (!current() || this.state.closed) return;
      this.set({ connection: 'reconnecting' });
      /* EventSource reintenta solo; si lo ha dado por perdido (un 403, un 404, un 5xx), se mira
         por qué con esperas crecientes. */
      if (source.readyState === 2) this.scheduleReopen();
    });
  }

  /** Cierra el SSE que haya y abre otro (al momento). */
  private reopen(): void {
    if (this.stopped || this.state.closed) return;
    this.clearReopen();
    this.source?.close();
    this.source = null;
    this.open();
  }

  private clearReopen(): void {
    if (this.reopenTimer !== null) this.env.clearTimeout?.(this.reopenTimer);
    this.reopenTimer = null;
  }

  /** El SSE no vuelve solo: dentro de `reopenDelayMs` (3, 6, 12… 30 s), se mira por qué. */
  private scheduleReopen(): void {
    if (this.stopped || this.state.closed || this.reopenTimer !== null) return;
    const setTimeout = this.env.setTimeout;
    if (!setTimeout) {
      void this.diagnose();
      return;
    }
    const delay = this.reopenDelayMs;
    this.reopenDelayMs = Math.min(SSE_REOPEN_MAX_MS, this.reopenDelayMs * 2);
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      void this.diagnose();
    }, delay);
  }

  /**
   * ¿La sala ya no existe o ya no estás? (`sendStatus` lo apunta y se cierra). Si responde, se
   * reabre (lo hace `sendStatus` al ver el SSE perdido); con la red caída o un 5xx, se vuelve a
   * esperar, más.
   */
  private async diagnose(): Promise<void> {
    if (this.stopped || this.state.closed) return;
    try {
      await this.sendStatus(true);
    } catch {
      if (!this.stopped && !this.state.closed) this.scheduleReopen();
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
      case 'party.votes':
        this.set({ unvoted: event.data.unvoted });
        break;
      case 'party.ping':
        /* Solo dice que el SSE sigue vivo (`lastFrameAt`, arriba): nada que pintar. */
        break;
      case 'party.closed':
        forgetRoom(this.code);
        this.set({ closed: event.data.reason });
        this.stop();
        break;
    }
  }

  /** Muestra de una sola dirección (el SSE): solo mientras no haya ninguna mejor. */
  private noteServerTime(serverNow: number): void {
    if (this.offset && !this.offsetRough) return;
    const offsetMs = serverNow - this.env.now();
    this.offset = { from: offsetMs, to: offsetMs, at: this.env.now() };
    this.offsetRough = true;
    this.set({ offsetMs });
  }

  /**
   * Una ida y vuelta (`status`, `control`): con `serverReceivedAt` (`receivedAt` de la respuesta),
   * las cuatro marcas. Gana la muestra de menos retardo de las del último minuto; si se aparta
   * menos de `OFFSET_JUMP_MS` del desfase que se usa, se acerca poco a poco (`slewOffset`); si
   * no (o es la primera de verdad), de golpe.
   */
  private noteRoundTrip(
    sentAt: number,
    serverNow: number,
    serverReceivedAt: number | undefined,
    patch: Partial<PartyState> = {},
  ): void {
    const now = this.env.now();
    this.samples = addSample(
      this.samples,
      offsetSample(sentAt, now, serverNow, serverReceivedAt),
      now,
    );
    const best = bestOffset(freshSamples(this.samples, now));
    const current = this.offset ? this.offsetAt(this.offset, now) : null;
    if (current === null || this.offsetRough || offsetJumps(current, best)) {
      this.offset = { from: best, to: best, at: now };
    } else {
      this.offset = { from: current, to: best, at: now };
    }
    this.offsetRough = false;
    this.stale = false;
    this.set({ ...patch, offsetMs: this.offset.from });
  }

  private offsetAt(track: OffsetTrack, now: number): number {
    return slewOffset(track.from, track.to, now - track.at);
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
   * `voted` («Estoy listo», §13; null: lo de antes) sale siempre y, si cambia, al momento.
   */
  report(
    positionS: number,
    buffering: boolean,
    lobby: LobbyReport | null = null,
    voted: boolean | null = null,
  ): void {
    const vote = voted ?? this.local.voted;
    let urgent = buffering !== this.local.buffering || vote !== this.local.voted;
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
    this.local = { positionS, buffering, lobby, voted: vote };
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
          voted: this.local.voted,
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
      this.noteRoundTrip(sentAt, response.serverNow, response.receivedAt, stream);
      /* Responde y el SSE estaba perdido: se reabre ya, sin esperar a la espera que tocara. */
      if (!this.stopped && !this.state.closed && this.source?.readyState === 2) this.reopen();
    } catch (error) {
      this.handleFailure(error);
      if (rethrow) throw error;
    }
  }

  /**
   * Una orden para la sala. `source` (de dónde sale: el botón, la barra, Media Session…) solo va
   * con reproducir, pausar y saltar, y solo para el registro del servidor. La misma orden en
   * `DUPLICATE_ORDER_MS` (un salto, al mismo sitio ±`DUPLICATE_SEEK_S`) no sale otra vez: un
   * doble toque o dos eventos del mismo gesto eran dos avisos en el chat.
   */
  async control(order: PartyOrder, source?: PartyControlSource): Promise<void> {
    const sentAt = this.env.now();
    const playback = order.action === 'play' || order.action === 'pause' || order.action === 'seek';
    const positionS = 'positionS' in order ? order.positionS : null;
    if (playback && positionS !== null) {
      const last = this.lastOrder;
      const duplicate =
        last !== null &&
        last.action === order.action &&
        sentAt - last.at < DUPLICATE_ORDER_MS &&
        (order.action !== 'seek' || Math.abs(last.positionS - positionS) <= DUPLICATE_SEEK_S);
      this.logOrder({
        at: sentAt,
        action: order.action,
        positionS,
        source: source ?? null,
        result: duplicate ? 'duplicate' : 'sent',
      });
      if (duplicate) return;
      this.lastOrder = { action: order.action, positionS, at: sentAt };
    } else {
      this.logOrder({
        at: sentAt,
        action: order.action,
        positionS,
        source: null,
        result: 'sent',
      });
    }
    const body = {
      ...order,
      ...(playback && source ? { source } : {}),
      token: this.credential.token,
    } as PartyControlBody;
    try {
      const response = await api('partyControl', { params: { code: this.code }, body });
      this.noteRoundTrip(sentAt, response.serverNow, response.receivedAt);
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

  private logOrder(record: OrderRecord): void {
    this.orderLog.push(record);
    if (this.orderLog.length > ORDER_LOG_SIZE) this.orderLog.shift();
  }

  /** El reloj (para depurar): el desfase que se usa ahora y el retardo de la mejor muestra. */
  clockInfo(): { offsetMs: number; rttMs: number | null } {
    const now = this.env.now();
    const best = bestSample(freshSamples(this.samples, now));
    return {
      offsetMs: this.offset ? this.offsetAt(this.offset, now) : this.state.offsetMs,
      rttMs: best?.rttMs ?? null,
    };
  }

  /** Hora del servidor ahora mismo según este aparato (con el desfase que se va acercando). */
  serverNow(): number {
    const now = this.env.now();
    return now + (this.offset ? this.offsetAt(this.offset, now) : this.state.offsetMs);
  }
}

/** La reproducción de la sala, o null si aún no ha llegado la foto. */
export function playbackOf(state: PartyState): PartyPlayback | null {
  return state.room?.playback ?? null;
}
