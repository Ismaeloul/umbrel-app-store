/* API pública del reproductor, la que usan el centro de partido y el resto
   de vistas. Es DIMINUTA a propósito: la importan vistas del JS inicial
   (agenda, biblioteca) y no puede arrastrar el reproductor, hls.js ni
   mpegts.js. El reproductor de verdad (index.tsx, runtime.ts y los motores)
   se carga aparte cuando el armazón monta el PlayerDock.

     import { play, stop, usePlayer, onSourceFailed } from '../../player/api.ts';

     play({ hash, title: 'M+ Liga de Campeones', subtitle: 'Fuente 1, Elcano',
            source: 'Elcano', lead: 'Fuente 1 verificada.' },
          { origin: 'auto', route });
     const { phase, channel, live } = usePlayer();
     useEffect(() => onSourceFailed((fallo) => {
       const siguiente = siguienteVerificada();
       if (!siguiente) return { message: `Esta señal no responde. Tienes ${n} fuentes…` };
       play(siguiente, { origin: 'auto', route });
       return { next: true };
     }), []);

   Todo lo documentado está en src/player/README.md. */

import { useEffect } from 'react';
import {
  DEFAULT_PLAYBACK_MODE,
  normalizeHash,
  PLAYBACK_MODES,
  PLAYBACK_PROFILES,
  type PlaybackMode,
  type StreamProtocol,
} from '@ace/shared';
import { api } from '../api/client.ts';
import { setPlayerPresence } from '../app/player-presence.ts';
import type { Route } from '../app/routes.ts';
import { readItem, STORAGE_KEYS, writeItem } from '../lib/storage.ts';
import { createStore, shallowEqual, useStore } from '../lib/store.ts';
import { toast } from '../notices/toasts.ts';
import type { EngineKind } from './engines/types.ts';
import type { ConnState, PlayerPhase } from './machine.ts';

export type { PlayerPhase } from './machine.ts';

/**
 * - `user`: la persona eligió esta fuente o canal (todo manual desde aquí, regla 19).
 * - `auto`: arranque automático por fuentes verificadas: 1 reconexión antes
 *   de dar la fuente por fallida si aún no había arrancado (index.html:5217).
 * - `zapping`: canal anterior o siguiente (← →).
 * - `library`: desde la biblioteca o un hash pegado.
 */
export type PlayOrigin = 'user' | 'auto' | 'zapping' | 'library';

export interface PlayChannel {
  /** Content ID o infohash de 40 hex (también acepta `acestream://…` o una URL con `?id=`). */
  hash: string;
  /** Nombre del canal: se enseña, va al mando, al historial y a la pantalla de bloqueo. */
  title: string;
  /** `infohash` si viene del buscador del motor; `auto` (por defecto) deja decidir al backend (P6). */
  kind?: 'id' | 'infohash' | 'auto';
  /** Segunda línea: «Fuente 1, Elcano» o «Atlético – Tottenham». NUNCA el marcador (regla 29). */
  subtitle?: string;
  /** Frase de la fuente para la línea de estado: «Fuente 1 verificada.» */
  lead?: string;
  /** Proveedor de la fuente (`source` del resultado que se manda al backend). */
  source?: string;
  /** Lista de la fuente (`listaId` del resultado). */
  listaId?: string;
  /** Colores de los dos equipos: la luz ambiental alrededor del vídeo (opcional). */
  colors?: readonly [string, string];
  /**
   * La fuente es de la IPTV (docs/iptv.md §8.3): «Conectando con tu IPTV…»
   * antes de la concesión, y sus fallos (`iptv_*`, `remux_*`, `ffmpeg_missing`)
   * agotan la fuente al momento, sin las 3 reconexiones: el servidor ya
   * reintentó y el puente pasa a AceStream. Tras la concesión manda
   * `grant.source` (`PlayerState.streamSource`).
   */
  iptv?: boolean;
}

export interface PlayOptions {
  origin?: PlayOrigin;
  /** A dónde vuelve el mini-reproductor. Por defecto, `partido/canal/<hash>`. */
  route?: Route;
  /**
   * Apuntarlo en Recientes (por defecto sí). Un hash pegado a mano no entra
   * (`recordHistory = false`, index.html:3962; B-187).
   */
  record?: boolean;
}

/**
 * `kind` de una señal según lo que declara su lista o el buscador (B-010):
 * `ih: true` → infohash, `ih: false` → Content ID (sin el doble intento) y
 * solo lo de tipo desconocido (`ih: null`, un hash pegado) va en `auto`, que
 * prueba `id` y, si el motor no abre, una vez `infohash` (B-009).
 */
export function kindFromIh(ih: boolean | null | undefined): 'id' | 'infohash' | 'auto' {
  if (ih === true) return 'infohash';
  if (ih === false) return 'id';
  return 'auto';
}

export interface PlayerStats {
  /** `status` del motor («dl», «prebuf»…). */
  status: string;
  peers: number;
  /** KB/s. */
  speedDown: number;
  speedUp: number;
  downloaded: number | null;
  at: string;
}

export interface LiveInfo {
  /** Hay ventana de directo medible (con imagen). */
  available: boolean;
  /** Se va en el borde (medido, no la intención: P2). */
  atLive: boolean;
  /** Segundos por detrás del borde útil (ya descontado el colchón de seguridad). */
  behindS: number;
  /** Lo que hay cargado por delante del cabezal hasta lo último que ha llegado. */
  delayS: number | null;
}

export type IdleReason = 'inicio' | 'detenido' | 'traspasado' | 'fallo' | 'sin-motor';

export interface PlayerState {
  /** La fase pública (machine.ts): idle, cargando, buffer, reproduciendo, pausado… */
  phase: PlayerPhase;
  /** Estado de la conexión (detalle para el panel técnico y los tests). */
  conn: ConnState;
  channel: (PlayChannel & { hash: string }) | null;
  origin: PlayOrigin | null;
  route: Route | null;
  /** Frase del panel del vídeo (conectando, error, detenido…) o null si hay imagen. */
  message: string | null;
  idleReason: IdleReason | null;
  /** Reconexión en curso: «(n/máx)». */
  attempt: { n: number; max: number } | null;
  /** Ya hubo un fotograma real con esta fuente. */
  started: boolean;
  desiredPlaying: boolean;
  /** La persona quiere ir en directo (intención). */
  following: boolean;
  live: LiveInfo;
  /** Segundos cargados por delante del cabezal. */
  bufferAheadS: number;
  /** Rellenando el colchón tras un parón: objetivo en segundos. */
  rebuffering: { targetS: number } | null;
  engine: EngineKind | null;
  protocol: StreamProtocol | null;
  /** De dónde sale el vídeo según la concesión (`grant.source`): el motor AceStream o la IPTV. */
  streamSource: 'engine' | 'iptv' | null;
  codec: { video: string; audio: string } | null;
  sessionId: string | null;
  stats: PlayerStats | null;
  muted: boolean;
  volume: number;
  demo: boolean;
  /** Tiempo hasta la primera imagen de esta fuente, en ms. */
  ttffMs: number | null;
  /** Lo que el centro de partido dice mientras espera una fuente («Comprobando 5 fuentes…»). */
  waiting: string | null;
  /**
   * `waiting` es la frase FINAL (ya no se busca nada: un id IPTV que no está en
   * ningún sitio, docs/iptv.md §14.5). El panel dice «Sin señal», no «Buscando señal».
   */
  waitingFinal: boolean;
  /** Panel «Datos técnicos» (tecla S) abierto. */
  nerdOpen: boolean;
}

export const IDLE_LIVE: LiveInfo = { available: false, atLive: true, behindS: 0, delayS: null };

export const INITIAL_PLAYER_STATE: PlayerState = {
  phase: 'idle',
  conn: 'idle',
  channel: null,
  origin: null,
  route: null,
  message: null,
  idleReason: 'inicio',
  attempt: null,
  started: false,
  desiredPlaying: false,
  following: false,
  live: IDLE_LIVE,
  bufferAheadS: 0,
  rebuffering: null,
  engine: null,
  protocol: null,
  streamSource: null,
  codec: null,
  sessionId: null,
  stats: null,
  muted: false,
  volume: 1,
  demo: false,
  ttffMs: null,
  waiting: null,
  waitingFinal: false,
  nerdOpen: false,
};

export const playerStore = createStore<PlayerState>(INITIAL_PLAYER_STATE);

/** Lo que hay ahora mismo (sin suscribirse). */
export function getPlayer(): PlayerState {
  return playerStore.get();
}

/** El estado entero del reproductor (se repinta a lo sumo 2 veces por segundo mientras suena). */
export function usePlayer(): PlayerState {
  return useStore(playerStore);
}

/** Un trozo del estado: `usePlayerSelector((s) => s.phase)`. */
export function usePlayerSelector<S>(
  selector: (state: PlayerState) => S,
  isEqual: (a: S, b: S) => boolean = shallowEqual,
): S {
  return useStore(playerStore, selector, isEqual);
}

// ---- Órdenes ------------------------------------------------------------------

export type PlayerCommand =
  | { type: 'play'; channel: PlayChannel & { hash: string }; options: PlayOptions }
  | { type: 'stop' }
  | { type: 'mode'; mode: PlaybackMode };

export interface RuntimeHandle {
  handle(command: PlayerCommand): void;
}

let runtime: RuntimeHandle | null = null;
let pending: PlayerCommand | null = null;

/** Ruta por defecto del mini-reproductor: el propio canal. */
export function channelRoute(hash: string): Route {
  return { vista: 'partido', id: null, canal: hash };
}

/**
 * Reproduce un canal (o una fuente de un partido). Si ya está sonando o
 * conectando ese mismo hash, no hace nada (así el centro de partido y el
 * zapping pueden pedirlo sin miedo a reiniciar la sesión). Devuelve false si
 * el hash no es válido.
 */
export function play(channel: PlayChannel, options: PlayOptions = {}): boolean {
  const hash = normalizeHash(channel.hash);
  if (!hash) return false;
  const command: PlayerCommand = {
    type: 'play',
    channel: { ...channel, hash, title: channel.title.trim() || `Canal ${hash.slice(0, 8)}` },
    options,
  };
  // El armazón mantiene montado el reproductor mientras esto sea verdad (también en «mini»).
  setPlayerPresence({ active: true, route: options.route ?? channelRoute(hash) });
  if (runtime) {
    runtime.handle(command);
  } else {
    // El reproductor aún se está descargando: se guarda la orden y la interfaz ya lo dice.
    pending = command;
    playerStore.set((state) => ({
      ...state,
      phase: 'cargando',
      conn: 'pidiendo',
      channel: command.channel,
      origin: options.origin ?? 'user',
      route: options.route ?? channelRoute(hash),
      message: 'Preparando el reproductor…',
      idleReason: null,
    }));
  }
  return true;
}

/** ¿Lo que suena (o se conecta) sale de la IPTV? Antes de la concesión lo dice el canal; después, el backend. */
export function isIptvPlayback(state: Pick<PlayerState, 'streamSource' | 'channel'>): boolean {
  return state.streamSource ? state.streamSource === 'iptv' : state.channel?.iptv === true;
}

/** Detiene todo y suelta la sesión (inventario §8.13). */
export function stop(): void {
  if (runtime) {
    runtime.handle({ type: 'stop' });
    return;
  }
  pending = null;
  playerStore.set((state) => ({
    ...INITIAL_PLAYER_STATE,
    idleReason: 'detenido',
    muted: state.muted,
    volume: state.volume,
    waiting: state.waiting,
    waitingFinal: state.waitingFinal,
  }));
  setPlayerPresence({ active: false, immersive: false });
}

/** Solo para el reproductor (index.tsx): conecta el motor de órdenes. */
export function connectRuntime(handle: RuntimeHandle): () => void {
  runtime = handle;
  const queued = pending;
  pending = null;
  if (queued) handle.handle(queued);
  return () => {
    if (runtime === handle) runtime = null;
  };
}

// ---- Fuente fallida (failover) ------------------------------------------------------

export interface SourceFailure {
  channel: PlayChannel & { hash: string };
  origin: PlayOrigin;
  /** `cayo` si llegó a verse (con los segundos vistos), `fallo` si no arrancó. */
  outcome: 'fallo' | 'cayo';
  seconds: number;
  /** Lo último que pasó, en español («La imagen se ha quedado parada…»). */
  reason: string;
  /**
   * Código del catálogo si lo hubo (`iptv_busy`, `iptv_dropped`,
   * `engine_unavailable`…). Con `engine_unavailable` el reproductor solo
   * pregunta por si hay una IPTV a la que pasar (§7.2): si nadie salta, espera
   * al motor como siempre.
   */
  code?: string;
}

/**
 * Qué contesta quien escucha: `{ next: true }` si va a reproducir otra
 * fuente (el reproductor espera su play()), `{ message }` para el panel en
 * rojo, o nada para el mensaje por defecto. Con `{ next: true, message }`,
 * ese texto sustituye al genérico «Esta fuente no responde: probando la
 * siguiente…» en la línea de estado (el puente IPTV ↔ AceStream, §7.2).
 */
export type SourceFailedReply =
  { next: true; message?: string } | { message: string } | boolean | void;
export type SourceFailedHandler = (failure: SourceFailure) => SourceFailedReply;

const failureHandlers: SourceFailedHandler[] = [];

/**
 * La fuente ha agotado sus reconexiones (3, o 1 en arranque automático).
 * Lo escucha el centro de partido para pasar a la siguiente verificada
 * (B-079). Devuelve la función para dejar de escuchar.
 */
export function onSourceFailed(handler: SourceFailedHandler): () => void {
  failureHandlers.push(handler);
  return () => {
    const index = failureHandlers.lastIndexOf(handler);
    if (index >= 0) failureHandlers.splice(index, 1);
  };
}

/** Solo para el reproductor: pregunta, del último que escucha al primero. */
export function notifySourceFailed(failure: SourceFailure): {
  next: boolean;
  message: string | null;
} {
  let message: string | null = null;
  for (const handler of [...failureHandlers].reverse()) {
    let reply: SourceFailedReply;
    try {
      reply = handler(failure);
    } catch (error) {
      console.error('[reproductor] Un oyente de onSourceFailed ha fallado', error);
      continue;
    }
    if (reply === true) return { next: true, message: null };
    if (reply && typeof reply === 'object' && 'next' in reply && reply.next)
      return { next: true, message: reply.message ?? null };
    if (reply && typeof reply === 'object' && 'message' in reply && reply.message && !message)
      message = reply.message ?? null;
  }
  return { next: false, message };
}

// ---- Espera del centro de partido y panel técnico ----------------------------------

/**
 * Mientras el centro de partido espera una fuente verificada, lo que se
 * enseña en el vídeo («Comprobando 5 fuentes: arranca la primera que
 * funcione…»). null para quitarlo.
 */
/**
 * La frase del centro de partido mientras espera una fuente. Con `final`, ya
 * no espera nada: es lo que queda (el panel dice «Sin señal», sin pulso).
 */
export function setWaitingMessage(text: string | null, options: { final?: boolean } = {}): void {
  const waitingFinal = text !== null && options.final === true;
  playerStore.set((state) =>
    state.waiting === text && state.waitingFinal === waitingFinal
      ? state
      : { ...state, waiting: text, waitingFinal },
  );
}

export function setNerdOpen(open: boolean): void {
  playerStore.set((state) => (state.nerdOpen === open ? state : { ...state, nerdOpen: open }));
}

export function toggleNerd(): void {
  setNerdOpen(!playerStore.get().nerdOpen);
}

/* ¿Quién enseña «Datos técnicos»? En la maqueta van en el panel del centro
   de partido (lateral en escritorio, plegable al final en el móvil), no
   sobre el vídeo. La vista que los pinta con <PlayerNerdStats/> se apunta
   aquí y el reproductor deja de sacar su propio panel (salvo a pantalla
   completa o en horizontal, donde la vista no se ve). Es un contador: dos
   sitios a la vez (el lateral y el del móvil al cambiar de tamaño) no se
   pisan al desmontarse. */
const nerdHostStore = createStore<number>(0);

/**
 * La vista que pinta «Datos técnicos» por su cuenta (con `<PlayerNerdStats/>`
 * y `usePlayerSelector((s) => s.nerdOpen)` para abrirse con la tecla S) lo
 * llama mientras lo tiene montado. Devuelve la función para dejarlo.
 */
export function hostNerdPanel(): () => void {
  nerdHostStore.set((count) => count + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    nerdHostStore.set((count) => Math.max(0, count - 1));
  };
}

/** Lo mismo como hook: `useHostNerdPanel(visible)` en la vista que pinta los datos. */
export function useHostNerdPanel(active = true): void {
  useEffect(() => (active ? hostNerdPanel() : undefined), [active]);
}

/** Si alguna vista enseña ya «Datos técnicos» (el reproductor no saca el suyo). */
export function useNerdHosted(): boolean {
  return useStore(nerdHostStore) > 0;
}

// ---- Modo de reproducción (Estable / Equilibrado / Baja latencia) -------------------

function validMode(value: string | null): PlaybackMode | null {
  return value && (PLAYBACK_MODES as readonly string[]).includes(value)
    ? (value as PlaybackMode)
    : null;
}

const modeStore = createStore<PlaybackMode>(
  validMode(readItem(STORAGE_KEYS.playbackMode)) ?? DEFAULT_PLAYBACK_MODE,
);

/** El modo guardado en este navegador (`aceneo-pb`, como la 0.6.59). */
export function getPlaybackMode(): PlaybackMode {
  return modeStore.get();
}

export function usePlaybackMode(): PlaybackMode {
  return useStore(modeStore);
}

/**
 * Cambia el modo (lo llama Ajustes). Si algo suena, se reengancha con el
 * perfil nuevo; en iPhone no (P11: el remux no cambia y reconectar solo corta).
 */
export function setPlaybackMode(mode: PlaybackMode): void {
  if (!validMode(mode) || modeStore.get() === mode) return;
  modeStore.set(mode);
  writeItem(STORAGE_KEYS.playbackMode, mode);
  toast(`Modo «${PLAYBACK_PROFILES[mode].label}» activado`, { tone: 'ok' });
  runtime?.handle({ type: 'mode', mode });
}

// ---- «Es el canal correcto» ------------------------------------------------------

/**
 * Confirma que lo que suena es el canal que se buscaba (B-054): el backend
 * aprende el vínculo canal ↔ hash y levanta los reportes de canal equivocado.
 */
export async function confirmChannel(channelName?: string): Promise<boolean> {
  const current = playerStore.get().channel;
  if (!current) return false;
  try {
    await api('sourcesFeedback', {
      body: {
        id: current.hash,
        verdict: 'correct',
        channel: channelName ?? current.title,
        title: current.title,
        reason: 'not_starting',
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Solo para los tests. */
export function resetPlayerApi(): void {
  runtime = null;
  pending = null;
  failureHandlers.length = 0;
  nerdHostStore.set(0);
  playerStore.set(INITIAL_PLAYER_STATE);
}
