/* Fuentes del partido (o del canal) que se está viendo: el controlador.

   Vive fuera de React A PROPÓSITO. La vista del centro de partido se oculta
   (Activity) al ir a la agenda con el mini-reproductor sonando, y con ella se
   pararían sus efectos; pero la política de fuentes tiene que seguir viva
   mientras suena el partido: si la fuente se cae estando en «mini», se pasa
   a la siguiente verificada igual (inventario §7.3). La vista y el panel
   lateral solo LEEN este almacén y llaman a sus acciones.

   Qué hace (inventario §5.1, §7.3-7.9 y reglas 19-26):
   - Resuelve el partido (`/api/v1/football/resolve`), guarda las
     candidatas y, con comprobador, espera a la primera verificada y la
     arranca (arranque automático). Sin comprobador, la mejor colocada.
   - Sigue al comprobador por SSE (`scan.progress` / `scan.verdict`) y, si el
     SSE no está abierto (no conectó en 10 s, o demo), sondea
     `/api/v1/football/scans/:id` cada 1,5 s. Tres fallos seguidos: «El
     comprobador no responde; se muestran todas las fuentes».
   - POLÍTICA ÚNICA DE CAMBIO DE FUENTE (P16), documentada en README.md:
       · Mientras la persona no elige nada («automático»), si la fuente se
         cae (3 reconexiones; 1 antes de la primera imagen) se pasa a la
         siguiente verificada que no se haya probado. Es lo que pide la
         regla 19: la entrada al partido la lleva la app.
       · En cuanto elige una fuente (o pega un hash), todo es manual: nunca
         se salta sola; el reproductor le dice cuántas le quedan.
       · Salto de entrada: si se eligió una candidata en «Encontrar canal» y
         el comprobador la da por fallida antes de que se vea, se prueba una
         vez la primera viva (index.html:3645-3658).
   - Detener (o el traspaso a otro dispositivo) apaga todo el automatismo y
     el seguimiento del comprobador (regla 17); la lista se queda para poder
     elegir otra a mano.
   - Reproducir algo que no está en la lista (zapping, biblioteca) termina la
     sesión (index.html:4887-4896).
   - Palco (plan fase 2, W13): un toque háptico acompaña, nunca sustituye, al
     aviso: «aviso» en el cambio automático de fuente, «error» si falla la
     que elegiste, «éxito» al reportar o al pegar un Content ID.
   - IPTV (docs/iptv.md §7 y §8.4, regla P16.6 del README):
       · la IPTV arranca la primera, sin esperar a «Verificada»;
       · PUENTE: si cae la IPTV, se pasa sola a la mejor AceStream verificada
         (con un aviso en la línea de estado y «Volver a la IPTV» en un toast
         o, en inmersivo, en una cápsula sobre el vídeo, atado a esta sesión); si cae una AceStream y hay IPTV, a la IPTV.
         Vale en automático, en manual y en los canales sueltos. Como mucho
         2 saltos del puente cada 3 min; después, P16 entre AceStream;
       · al tocar un canal con IPTV activa (`bootstrap.features.iptv`), se
         pregunta antes al servidor (`footballResolve` con `scope=channel`,
         2,5 s) y, si trae IPTV, suena ella primero; si no, lo de siempre;
       · un partido sin canales en la agenda, con IPTV activa, pregunta por
         la guía (5 s); si no hay nada, «El canal todavía no está anunciado».
       · una IPTV se reproduce con `record: false`: no entra en Recientes.
   - Buscador (docs/iptv.md §14.4 y §14.6):
       · la primera pregunta lleva el canal IPTV tocado (`iptv`, o el hash
         tocado si no se sabe): si es de tu IPTV, sale primero;
       · con menos de 3 AceStream (o si lo tocado es un id IPTV y no vino
         nada) se pide de fondo la búsqueda inversa (`engine=1`, 20 s): lo
         nuevo se añade al final sin reordenar, conservando lo comprobado, y
         el trabajo del comprobador pasa al nuevo;
       · un id IPTV que no encuentra nada no abre el reproductor con un
         error: se queda en espera con su texto;
       · en un canal solo de la IPTV, el puente espera a la búsqueda inversa
         o dice que no está en AceStream;
       · en Recientes entra el canal TOCADO, una vez por sesión, al arrancar
         la primera fuente (sea la IPTV o una AceStream). */

import type {
  FootballMatch,
  Item,
  LibraryView,
  PreheatPublic,
  Resolution,
  ResolutionCandidate,
  ScanJob,
  ScanRef,
  SourceReportReason,
  WebSourceSummary,
} from '@ace/shared';
import {
  IPTV_CLIENT,
  IPTV_SEARCH,
  isIptvReason,
  normalizeHash,
  type VerdictState,
} from '@ace/shared';
import { api, getViewerId, isAbortError, isApiError, onSseEvent } from '../../api/index.ts';
import { iptvActive } from '../../api/boot.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import type { Route } from '../../app/routes.ts';
import { hueFromName, oklchCss } from '../../lib/color.ts';
import { haptic } from '../../lib/haptics.ts';
import { matches, MEDIA } from '../../lib/media.ts';
import { matchVersusPair } from '../../lib/teams.ts';
import { createStore, useStore } from '../../lib/store.ts';
import {
  dismissImmersiveAction,
  dismissToast,
  notify,
  showImmersiveAction,
  toast,
} from '../../notices/index.ts';
import { noticeFlags } from '../../notices/notify.ts';
import {
  getPlayer,
  kindFromIh,
  onSourceFailed,
  play,
  playerStore,
  setWaitingMessage,
  type PlayerState,
  type PlayOrigin,
  type SourceFailedReply,
  type SourceFailure,
} from '../../player/api.ts';
import { madridHour } from '../agenda/domain.ts';
import { setLibraryData } from '../library/data.ts';
import { registerChannelStarter, takeChannelTap, type TappedChannel } from '../library/play.ts';
import {
  applyScan,
  applyVerdict,
  bridgeAllowed,
  BRIDGE_WINDOW_MS,
  channelPartOf,
  clearScan,
  dedupeEntries,
  effectiveOf,
  entryFromCandidate,
  entryFromItem,
  failureVerdict,
  INVALID_HASH_TEXT,
  iptvQualityText,
  isIptv,
  isIptvAccountFailure,
  isReported,
  isShownWhileScanning,
  librarySiblings,
  LOCAL_QUARANTINE_MS,
  manualEntry,
  NOTHING_ON_SCREEN,
  onScreenOf,
  pickAutoSource,
  pickBridgeTarget,
  pickNextIptvVariant,
  pickInitialSwitch,
  presentationOf,
  reportFollowUp,
  scanFinished,
  startScan,
  type Effective,
  type OnScreen,
  type ScanView,
  type SourceEntry,
} from './model.ts';

/** Sondeo de respaldo del comprobador (index.html:3567). */
export const SCAN_POLL_MS = 1500;
/** Fallos seguidos del sondeo antes de rendirse (index.html:3713-3720). */
export const SCAN_MAX_FAILURES = 3;
/** Seguimiento de un reporte: 32 consultas (index.html:3990) y 31 min como mucho de espera. */
export const REPORT_MAX_POLLS = 32;
export const REPORT_MAX_WAIT_MS = 31 * 60_000;
/** Plazos de la resolución (index.html:4080): 20 s al entrar, 30 s al rebuscar. */
export const RESOLVE_TIMEOUT_MS = 20_000;
export const RESEARCH_TIMEOUT_MS = 30_000;

export interface MatchInfo {
  id: string;
  title: string;
  home: string;
  away: string;
  competition: string;
  date: string;
  time: string;
  channels: string[];
  /** Los dos colores de club para la luz ambiental del vídeo (los de la API o, sin ellos, del nombre). */
  colors?: readonly [string, string];
}

export type SessionPhase = 'idle' | 'resolving' | 'ready' | 'choices' | 'not_found' | 'no_channels';

export interface SessionScan extends ScanView {
  id: string;
}

export interface SessionState {
  /** `m:<idPartido>` o `c:<hash>`; null sin sesión. */
  key: string | null;
  kind: 'match' | 'channel' | null;
  match: MatchInfo | null;
  /** Nombre del canal (modo canal). */
  channelTitle: string;
  phase: SessionPhase;
  resolution: Resolution | null;
  entries: SourceEntry[];
  /** La fuente elegida (la que está o estaba en pantalla). */
  activeHash: string | null;
  scan: SessionScan | null;
  preheat: PreheatPublic | null;
  /** Arranque por verificadas activo (`autoPlayVerified`). */
  autoVerified: boolean;
  /** Salto de entrada armado (`sourceAutoSwitchArmed`). */
  switchArmed: boolean;
  /** La persona ya eligió una fuente: todo es manual (regla 19). */
  manualChosen: boolean;
  researching: boolean;
  /** Se detuvo (o pasó a otro dispositivo): nada se mueve solo. */
  stopped: boolean;
  /** Frase final cuando ninguna fuente da señal (la enseña la vista). */
  failureText: string | null;
  /** Hojas: «Encontrar canal», «Reportar fuente» (hash) y «Pegar hash». */
  resolverOpen: boolean;
  reportFor: string | null;
  pasteOpen: boolean;
  /**
   * Canal suelto que se abrió preguntando antes por la IPTV (§8.4): lo que se
   * tocó, para volver a él si la IPTV no está o se cae («el hash que se tocó»).
   */
  tapped: TappedChannel | null;
  /** Canal suelto con IPTV: hay arranque automático, comprobador y puente, como en un partido. */
  iptvBridge: boolean;
  /** Momentos de los saltos automáticos del puente IPTV ↔ AceStream (tope: 2 cada 3 min). */
  bridgeJumps: number[];
  /** Búsqueda inversa del canal en AceStream (`engine=1`, §14.4). */
  reverse: 'none' | 'running' | 'done';
  /** El canal tocado ya entró en Recientes en esta sesión (§14.6). */
  recorded: boolean;
  /**
   * Canal abierto con el enlace antes de que llegue la biblioteca: se espera
   * a saber si es un id IPTV (`iptvIds`) antes de arrancarlo, porque un id
   * IPTV nunca va directo al motor (docs/iptv.md §14.4).
   */
  waitingLibrary: boolean;
}

const EMPTY: SessionState = {
  key: null,
  kind: null,
  match: null,
  channelTitle: '',
  phase: 'idle',
  resolution: null,
  entries: [],
  activeHash: null,
  scan: null,
  preheat: null,
  autoVerified: false,
  switchArmed: false,
  manualChosen: false,
  researching: false,
  stopped: false,
  failureText: null,
  resolverOpen: false,
  reportFor: null,
  pasteOpen: false,
  tapped: null,
  iptvBridge: false,
  bridgeJumps: [],
  reverse: 'none',
  recorded: false,
  waitingLibrary: false,
};

export const sessionStore = createStore<SessionState>(EMPTY);

export function useSession<S>(
  selector: (state: SessionState) => S,
  isEqual?: (a: S, b: S) => boolean,
): S {
  return useStore(sessionStore, selector, isEqual);
}

export function getSession(): SessionState {
  return sessionStore.get();
}

function patch(next: Partial<SessionState>): void {
  sessionStore.set((state) => ({ ...state, ...next }));
}

// ---- Reloj (inyectable en los tests) -------------------------------------------------

let clock: () => number = () => Date.now();
export function setSessionClock(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}

// ---- Utilidades ------------------------------------------------------------------------

export function matchInfoOf(match: FootballMatch): MatchInfo {
  return {
    id: match.id,
    title: match.title,
    home: match.home,
    away: match.away,
    competition: match.competition,
    date: match.date,
    time: match.time,
    channels: (match.channels ?? []).map((channel) => channel?.name).filter(Boolean) as string[],
    colors: matchGlow(match),
  };
}

/**
 * Luz ambiental del vídeo (plan Palco, W5): el par de colores de club de la
 * tarjeta versus (los de la API; sin ellos, el tono del nombre), ya separados
 * si los dos equipos se parecen.
 */
export function matchGlow(match: FootballMatch): readonly [string, string] {
  const pair = matchVersusPair(match);
  return [pair.home, match.away ? pair.away : pair.home];
}

function webSources(): WebSourceSummary[] | undefined {
  return queryClient.getQueryData<{ webSources?: WebSourceSummary[] }>(routeKey('libraryGet'))
    ?.webSources;
}

export function screenNow(): OnScreen {
  return onScreenOf(getPlayer());
}

export function effectiveMap(
  entries: readonly SourceEntry[],
  screen: OnScreen,
  now: number,
): Map<string, Effective> {
  return new Map(entries.map((entry) => [entry.id, effectiveOf(entry, screen, now)]));
}

function numberOf(state: SessionState, hash: string): number {
  return state.entries.findIndex((entry) => entry.id === hash) + 1;
}

/** Canal del partido para los vínculos y el aprendizaje: con el que casó la fuente, si es de este partido. */
function matchChannelFor(state: SessionState, entry: SourceEntry | undefined): string {
  const channels = state.match?.channels ?? [];
  if (entry?.matchedChannel && channels.includes(entry.matchedChannel)) return entry.matchedChannel;
  return channels[0] ?? state.channelTitle ?? '';
}

function routeFor(state: SessionState): Route | undefined {
  if (state.kind === 'match' && state.match)
    return { vista: 'partido', id: state.match.id, canal: null };
  if (state.kind === 'channel' && state.key)
    return { vista: 'partido', id: null, canal: state.key.slice(2) };
  return undefined;
}

/** Luz de un equipo solo por su nombre (sesiones preparadas sin el partido entero). */
function glow(name: string): string {
  return oklchCss({ l: 0.66, c: 0.13, h: hueFromName(name || '?') });
}

/** ¿Esta sesión tiene arranque automático y puente? (un partido, o un canal suelto con IPTV). */
function drives(state: Pick<SessionState, 'kind' | 'iptvBridge'>): boolean {
  return state.kind === 'match' || state.iptvBridge;
}

function libraryNow(): Partial<LibraryView> | undefined {
  return queryClient.getQueryData<LibraryView>(routeKey('libraryGet'));
}

/** Frase de la fuente para la línea de estado: «Fuente 1 verificada.» */
function leadFor(
  number: number,
  effective: Effective | undefined,
  state: SessionState,
): string | undefined {
  if (state.kind !== 'match') return undefined;
  if (effective?.state === 'working' && !effective.reported) return `Fuente ${number} verificada.`;
  if (effective?.state === 'weak') return `Fuente ${number}, señal floja.`;
  return `Fuente ${number}.`;
}

// ---- Suscripciones mientras hay sesión --------------------------------------------------

let generation = 0;
let resolveAbort: AbortController | null = null;
/** La búsqueda inversa de fondo (§14.4): se corta con la sesión. */
let reverseAbort: AbortController | null = null;
let stopScanWatch: (() => void) | null = null;
let scanFailures = 0;
const reportWatches = new Map<string, () => void>();
let researchWatch: { before: Set<string>; ai: string } | null = null;
let offFailed: (() => void) | null = null;
let offPlayer: (() => void) | null = null;
let lastPlayer: PlayerState = getPlayer();
/** El toast «Volver a la IPTV» (atado a esta sesión: se quita al acabarla). */
let backToastId: number | null = null;
/** Su gemela en inmersivo: la cápsula tocable sobre el vídeo. */
let backPillId: number | null = null;

function dismissBackToast(): void {
  if (backToastId !== null) dismissToast(backToastId);
  if (backPillId !== null) dismissImmersiveAction(backPillId);
  backToastId = null;
  backPillId = null;
}

function attach(): void {
  if (!offFailed) offFailed = onSourceFailed(handleSourceFailed);
  if (!offPlayer) {
    lastPlayer = getPlayer();
    offPlayer = playerStore.subscribe(onPlayerChange);
  }
}

function detach(): void {
  offFailed?.();
  offFailed = null;
  offPlayer?.();
  offPlayer = null;
}

function stopWatchers(): void {
  stopScanWatch?.();
  stopScanWatch = null;
  for (const stop of reportWatches.values()) stop();
  reportWatches.clear();
  researchWatch = null;
  scanFailures = 0;
}

/** Termina la sesión (otro partido, otro canal o salir). */
export function endSession(): void {
  generation += 1;
  resolveAbort?.abort();
  resolveAbort = null;
  reverseAbort?.abort();
  reverseAbort = null;
  stopWatchers();
  detach();
  dismissBackToast();
  if (sessionStore.get().key) setWaitingMessage(null);
  sessionStore.set(EMPTY);
}

function begin(next: Partial<SessionState>): number {
  endSession();
  sessionStore.set({ ...EMPTY, ...next });
  attach();
  return generation;
}

/**
 * La vista deja de verse. Si de esta sesión no suena nada, se apaga el
 * automatismo: arrancar un vídeo mientras la persona está en otra pantalla
 * sería una sorpresa. Si suena (mini-reproductor), sigue vivo.
 */
export function leaveSession(): void {
  const state = sessionStore.get();
  if (!state.key) return;
  if (belongsOnScreen(state, screenNow())) return;
  resolveAbort?.abort();
  stopScanWatch?.();
  stopScanWatch = null;
  setWaitingMessage(null);
  patch({
    autoVerified: false,
    switchArmed: false,
    phase: state.phase === 'resolving' ? 'idle' : state.phase,
  });
}

function belongsOnScreen(state: SessionState, screen: OnScreen): boolean {
  return (
    screen.hash !== null &&
    (screen.playing || screen.connecting) &&
    state.entries.some((entry) => entry.id === screen.hash)
  );
}

// ---- Entrar a un partido --------------------------------------------------------------

/**
 * Entrada al centro de partido (`resolveFootballMatch`, index.html:4136-4157).
 * Idempotente: volver al mismo partido mientras suena (desde el
 * mini-reproductor) no vuelve a resolver nada.
 */
export function enterMatch(match: FootballMatch): void {
  const info = matchInfoOf(match);
  const key = `m:${info.id}`;
  const current = sessionStore.get();
  if (current.key === key) {
    const alive =
      current.phase === 'resolving' ||
      belongsOnScreen(current, screenNow()) ||
      (current.stopped && current.entries.length > 0) ||
      current.manualChosen;
    // Datos frescos del partido (canales de la agenda), sin tocar lo demás.
    if (alive) {
      patch({ match: info });
      return;
    }
  }
  begin({ key, kind: 'match', match: info });
  if (!info.channels.length) {
    // Con IPTV activa, la guía puede saber qué canal lo echa (§4.5 y §8.4).
    if (iptvActive()) {
      void resolveMatch({ withoutChannels: true });
      return;
    }
    noChannels();
    return;
  }
  void resolveMatch();
}

/** «El canal todavía no está anunciado», como siempre (sin abrir «Encontrar canal»). */
function noChannels(): void {
  setWaitingMessage(null);
  patch({ phase: 'no_channels' });
  toast('El canal todavía no está anunciado', { tone: 'warn', icon: 'tv' });
}

async function resolveMatch({
  withoutChannels = false,
}: { withoutChannels?: boolean } = {}): Promise<void> {
  const state = sessionStore.get();
  const match = state.match;
  if (!match) return;
  const gen = generation;
  resolveAbort?.abort();
  const controller = new AbortController();
  resolveAbort = controller;
  patch({ phase: 'resolving', failureText: null });
  if (!belongsOnScreen(state, screenNow()) && !screenNow().hash)
    setWaitingMessage('Buscando fuentes para el partido…');
  try {
    const data = await api('footballResolve', {
      query: { match: match.id, channel: match.channels, client: getViewerId() },
      timeoutMs: withoutChannels ? IPTV_CLIENT.matchResolveMs : RESOLVE_TIMEOUT_MS,
      signal: controller.signal,
    });
    if (gen !== generation) return;
    // Sin canales en la agenda solo vale lo que encuentre la guía: si no, como hoy.
    if (withoutChannels && (data.status !== 'found' || !data.candidate)) {
      noChannels();
      return;
    }
    applyEntryResolution(data);
  } catch (error) {
    if (gen !== generation || controller.signal.aborted) return;
    if (isAbortError(error)) return;
    if (withoutChannels) {
      noChannels();
      return;
    }
    // Error de red: el mismo modal, como «no encontrado» y sin buscador (index.html:4154-4155).
    setWaitingMessage(null);
    patch({
      phase: 'not_found',
      resolverOpen: true,
      resolution: {
        status: 'not_found',
        channels: match.channels,
        checked: ['saved', 'm3u', 'library', 'acestream'],
        candidates: [],
        engineAvailable: false,
        ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
        program: null,
        research: false,
        preheat: null,
        scan: null,
      },
    });
  } finally {
    if (resolveAbort === controller) resolveAbort = null;
  }
}

function applyEntryResolution(data: Resolution): void {
  const now = clock();
  if (data.status !== 'found' || !data.candidate) {
    setWaitingMessage(null);
    patch({
      phase: data.status === 'choices' ? 'choices' : 'not_found',
      resolution: data,
      resolverOpen: true,
      preheat: data.preheat,
    });
    return;
  }
  const list = data.candidates.length ? data.candidates : [data.candidate];
  const entries = dedupeEntries(list.map((candidate) => entryFromCandidate(candidate, now)));
  const screen = screenNow();
  const playingOne =
    screen.hash && entries.some((entry) => entry.id === screen.hash) ? screen.hash : null;
  patch({
    phase: 'ready',
    resolution: data,
    preheat: data.preheat,
    entries,
    activeHash: playingOne,
  });
  if (data.scan) configureScan(data.scan);
  if (playingOne) {
    // Ya suena una fuente de este partido (se recargó la vista): nada que arrancar.
    setWaitingMessage(null);
    return;
  }
  if (data.scan) {
    patch({ autoVerified: true });
    setWaitingMessage(`Comprobando ${entries.length} fuentes: arranca la primera que funcione…`);
    tryAutoStart();
    return;
  }
  // Sin comprobador: la mejor colocada, como antes (index.html:4150-4151).
  setWaitingMessage(null);
  const best = entries.find((entry) => entry.id === data.candidate?.id) ?? entries[0];
  if (best) playEntry(best, 'user');
}

// ---- Canal de la biblioteca -----------------------------------------------------------

export interface ChannelEntry {
  hash: string;
  title: string;
  siblings: readonly Item[];
  activeListId: string | null;
  /** La biblioteca ya respondió (o falló). Sin ella no se sabe si el canal es un id IPTV. */
  libraryReady?: boolean;
}

/**
 * Centro de partido de un canal suelto (`partido/canal/<hash>`): sus
 * hermanas del mismo canal (regla 23) y, si nada suena todavía (la página
 * se abrió con ese enlace), lo reproduce. Tras un «Detener» no lo relanza.
 */
export function enterChannel({
  hash,
  title,
  siblings,
  activeListId,
  libraryReady = true,
}: ChannelEntry): void {
  const key = `c:${hash}`;
  const entries =
    siblings.length > 1
      ? dedupeEntries(siblings.map((item) => entryFromItem(item, activeListId)))
      : [];
  const current = sessionStore.get();
  // Se tocó en Canales, el buscador, Favoritos o Recientes con IPTV activa (§8.4).
  const tap = takeChannelTap(hash);
  if (tap) {
    startChannel(tap);
    return;
  }
  if (current.key === key && current.tapped && !current.iptvBridge && current.phase !== 'ready') {
    // Se tocó con IPTV activa y aún se está preguntando (o la vista se ocultó
    // y cortó la pregunta): se sigue esperando o se vuelve a preguntar.
    patch({ channelTitle: title || current.channelTitle });
    if (current.phase !== 'resolving' && !current.stopped) void resolveChannel(current.tapped);
    return;
  }
  if (current.key === key && current.iptvBridge) {
    // Canal con IPTV: las fuentes son las de la resolución (con sus hermanas).
    patch({ channelTitle: title || current.channelTitle });
    return;
  }
  if (current.key === key && current.waitingLibrary) {
    // Abierto con el enlace esperando a la biblioteca: hasta que llegue, nada.
    if (!libraryReady) {
      patch({ channelTitle: title || current.channelTitle, entries });
      return;
    }
    // Ya llegó: se decide abajo, como si se acabara de abrir.
  } else if (current.key === key) {
    // La biblioteca llegó o cambió: se rehacen las hermanas conservando lo visto.
    const previous = new Map(current.entries.map((entry) => [entry.id, entry]));
    patch({
      channelTitle: title || current.channelTitle,
      entries: entries.map((entry) => {
        const old = previous.get(entry.id);
        return old ? { ...entry, playerVerdict: old.playerVerdict, reported: old.reported } : entry;
      }),
    });
    return;
  }
  // Un canal que ya es fuente de la sesión actual (volver del mini-reproductor
  // tras elegir una hermana) no abre otra sesión.
  if (
    !current.waitingLibrary &&
    current.kind === 'channel' &&
    current.entries.some((entry) => entry.id === hash)
  ) {
    patch({ channelTitle: title || current.channelTitle });
    return;
  }
  const player = getPlayer();
  const idle = player.phase === 'idle' || player.phase === 'error';
  const autoStarts =
    player.channel?.hash !== hash &&
    idle &&
    (player.idleReason === 'inicio' || player.idleReason === null);
  if (autoStarts && !libraryReady && !iptvActive()) {
    // Sin la biblioteca no se sabe si es un id IPTV (que nunca va al motor): se espera.
    begin({
      key,
      kind: 'channel',
      channelTitle: title,
      entries,
      activeHash: hash,
      phase: 'ready',
      waitingLibrary: true,
    });
    return;
  }
  // Abierto con el enlace y con IPTV activa: también suena primero la IPTV (§8.4).
  // Un id IPTV de tu biblioteca nunca va directo al motor, ni con la IPTV en pausa (§14.4).
  const knownIptv = Object.hasOwn(libraryNow()?.iptvIds ?? {}, hash);
  if (autoStarts && (iptvActive() || knownIptv)) {
    const item = siblings.find((sibling) => sibling.id === hash);
    const ih = knownIptv ? false : item ? (item.ih ?? false) : null;
    const known = libraryNow();
    const alias = knownIptv
      ? (
          known?.favorites?.find((entry) => entry.id === hash) ??
          known?.history?.find((entry) => entry.id === hash)
        )?.alias
      : undefined;
    startChannel({
      hash,
      title,
      kind: kindFromIh(ih),
      record: true,
      ih,
      iptv: knownIptv ? hash : null,
      ...(alias ? { alias } : {}),
    });
    return;
  }
  begin({ key, kind: 'channel', channelTitle: title, entries, activeHash: hash, phase: 'ready' });
  if (autoStarts) {
    play(
      { hash, title: title || `Canal ${hash.slice(0, 8)}` },
      { origin: 'library', route: { vista: 'partido', id: null, canal: hash } },
    );
  }
}

/**
 * Tocar un canal con IPTV activa (`playChannel`, §8.4): en vez de reproducir
 * ya el hash de AceStream, se abre la sesión del canal y se pregunta al
 * servidor si está en la IPTV. Lo llama `playChannel` antes de navegar.
 */
export function startChannel(tapped: TappedChannel): void {
  const title = tapped.title || `Canal ${tapped.hash.slice(0, 8)}`;
  const current = sessionStore.get();
  // Tocar otra vez el canal que ya suena (con su IPTV o una hermana) no reinicia nada.
  if (current.key === `c:${tapped.hash}` && belongsOnScreen(current, screenNow())) return;
  begin({
    key: `c:${tapped.hash}`,
    kind: 'channel',
    channelTitle: title,
    tapped: { ...tapped, title },
    phase: 'resolving',
  });
  void resolveChannel({ ...tapped, title });
}

registerChannelStarter(startChannel);

/** Las hermanas del canal que están en la biblioteca, como entradas (regla 23). */
function localSiblings(hash: string): SourceEntry[] {
  const library = libraryNow();
  const siblings = librarySiblings(library, hash);
  return siblings.map((item) => entryFromItem(item, library?.activeWebSourceId ?? null));
}

/** La entrada del canal tocado: la de la biblioteca si está; si no (buscador), una de AceStream. */
function tappedEntry(tapped: TappedChannel): SourceEntry {
  const known = localSiblings(tapped.hash).find((entry) => entry.id === tapped.hash);
  if (known) return known;
  return {
    ...manualEntry(tapped.hash, tapped.title, tapped.title),
    origin: 'acestream',
    ih: tapped.ih,
  };
}

/** Lo que se manda como `iptv` (§14.4): el canal IPTV tocado o, si no se sabe, el hash tocado. */
function iptvQueryOf(tapped: TappedChannel): { iptv?: string } {
  const id = (tapped.iptv ?? tapped.hash).toLowerCase();
  return /^[a-f0-9]{40}$/.test(id) ? { iptv: id } : {};
}

/** ¿Lo tocado es un canal de tu IPTV (id sintético, sin hash de AceStream)? */
function tappedIsIptv(tapped: TappedChannel | null): boolean {
  return Boolean(tapped && tapped.iptv && tapped.iptv === tapped.hash);
}

/**
 * El canal que se pide al servidor: el nombre en tu IPTV de un id IPTV
 * renombrado (`alias`, §14.6) o, si no, el título. Con la IPTV en pausa o con
 * un id que ya no vale, «Mi T5» no encontraría en AceStream lo que sí
 * encuentra «Telecinco».
 */
function channelAsked(tapped: TappedChannel): string {
  return tappedIsIptv(tapped) && tapped.alias ? tapped.alias : tapped.title;
}

/** Fuentes de AceStream de la sesión (las que no son IPTV). */
function aceCount(entries: readonly SourceEntry[]): number {
  return entries.filter((entry) => !isIptv(entry)).length;
}

async function resolveChannel(tapped: TappedChannel): Promise<void> {
  const gen = generation;
  resolveAbort?.abort();
  const controller = new AbortController();
  resolveAbort = controller;
  patch({ phase: 'resolving' });
  if (!screenNow().hash) setWaitingMessage('Buscando el canal en tu IPTV…');
  let data: Resolution | null;
  try {
    data = await api('footballResolve', {
      query: {
        channel: channelAsked(tapped),
        scope: 'channel',
        client: getViewerId(),
        ...iptvQueryOf(tapped),
      },
      timeoutMs: IPTV_CLIENT.channelResolveMs,
      signal: controller.signal,
    });
  } catch (error) {
    // Cortada por la sesión (otro canal, salir): nada más que hacer.
    if (gen !== generation || controller.signal.aborted) return;
    if (isAbortError(error) && !isApiError(error)) return;
    data = null;
  } finally {
    if (resolveAbort === controller) resolveAbort = null;
  }
  if (gen !== generation) return;
  const withIptv =
    data &&
    data.status === 'found' &&
    data.candidates.some((candidate) => candidate.source === 'iptv');
  if (!data || !withIptv) {
    // Un id IPTV no se abre en el motor (§14.4): se busca el canal en AceStream.
    if (tappedIsIptv(tapped)) {
      setWaitingMessage('Buscando este canal en AceStream…');
      void reverseChannel(tapped);
      return;
    }
    // Sin IPTV, con error o fuera de plazo: exactamente lo de siempre.
    playTappedAsToday(tapped);
    return;
  }
  applyChannelResolution(data, tapped);
  // Pocas AceStream detrás de la IPTV: se buscan más en el motor, de fondo (§14.4).
  if (aceCount(sessionStore.get().entries) < IPTV_SEARCH.reverseBelowAce) {
    void reverseChannel(tapped);
  }
}

/**
 * Búsqueda inversa de fondo (§14.4): `footballResolve` con `engine=1`. Si ya
 * hay fuentes, las nuevas AceStream se añaden al final sin reordenar (lo ya
 * comprobado se conserva) y el comprobador pasa al trabajo nuevo; si no había
 * nada (un id IPTV que no vino en la primera), la resolución entera. Sin
 * avisos: los carteles nuevos aparecen en el panel de fuentes.
 */
async function reverseChannel(tapped: TappedChannel): Promise<void> {
  const gen = generation;
  reverseAbort?.abort();
  const controller = new AbortController();
  reverseAbort = controller;
  patch({ reverse: 'running' });
  let data: Resolution | null;
  try {
    data = await api('footballResolve', {
      query: {
        channel: channelAsked(tapped),
        scope: 'channel',
        client: getViewerId(),
        engine: '1',
        ...iptvQueryOf(tapped),
      },
      timeoutMs: IPTV_CLIENT.channelEngineMs,
      signal: controller.signal,
    });
  } catch (error) {
    if (gen !== generation || controller.signal.aborted) return;
    if (isAbortError(error) && !isApiError(error)) return;
    data = null;
  } finally {
    if (reverseAbort === controller) reverseAbort = null;
  }
  if (gen !== generation) return;
  patch({ reverse: 'done' });
  const state = sessionStore.get();
  const found = data && data.status !== 'not_found' ? data.candidates : [];
  if (!state.entries.length) {
    if (!data || !found.length) {
      nothingForIptvId(tapped);
      return;
    }
    applyChannelResolution(data, tapped);
    return;
  }
  if (data && found.length) mergeReverse(data);
  afterReverse();
}

/** Añade lo que trajo la búsqueda inversa al final, sin tocar lo que ya había (§14.4). */
function mergeReverse(data: Resolution): void {
  const state = sessionStore.get();
  const now = clock();
  const known = new Set(state.entries.map((entry) => entry.id));
  const fresh = data.candidates
    .filter((candidate) => !known.has(candidate.id) && candidate.source !== 'iptv')
    .map((candidate) => entryFromCandidate(candidate, now));
  if (fresh.length) patch({ entries: [...state.entries, ...fresh] });
  if (data.scan) configureScan(data.scan, { keepProbes: true });
  else afterScanChange();
}

/**
 * Tras la búsqueda inversa: si la IPTV de un canal solo de la IPTV ya cayó y
 * no hay nada de AceStream, se dice (§14.4, el puente).
 */
function afterReverse(): void {
  const state = sessionStore.get();
  if (!tappedIsIptv(state.tapped) || aceCount(state.entries) > 0) return;
  const now = clock();
  const effective = effectiveMap(state.entries, NOTHING_ON_SCREEN, now);
  const iptvDown = state.entries
    .filter(isIptv)
    .every((entry) => effective.get(entry.id)?.state === 'failed');
  if (!state.entries.some(isIptv) || !iptvDown) return;
  patch({ autoVerified: false, failureText: IPTV_ONLY_DOWN_TEXT });
  setWaitingMessage(null);
  notify(IPTV_ONLY_DOWN_TEXT, { kind: 'signal', tone: 'err', signal: 'fail' });
}

/** Un id IPTV tocado que no está ni en tu IPTV ni en AceStream: se queda en espera con su texto (§14.5). */
function nothingForIptvId(tapped: TappedChannel): void {
  const state = libraryNow()?.iptvIds?.[tapped.hash];
  const text =
    state === 'iptv_disabled'
      ? 'Tu IPTV está en pausa y este canal no está en AceStream.'
      : state === 'iptv_removed'
        ? 'Has eliminado tu IPTV y este canal no está en AceStream.'
        : 'Este canal ya no está en tu IPTV y no lo encuentro en AceStream.';
  patch({ phase: 'ready', entries: [], activeHash: null });
  // Es lo que queda, no una espera: sin «Buscando señal» ni «Comprobando».
  setWaitingMessage(text, { final: true });
}

/** En Recientes entra el canal tocado, una vez por sesión y al arrancar la primera fuente (§14.6). */
function recordTapped(): void {
  const state = sessionStore.get();
  const tapped = state.tapped;
  if (!tapped || !tapped.record || state.recorded) return;
  patch({ recorded: true });
  void api('libraryMutate', {
    body: {
      action: 'history-upsert',
      item: { id: tapped.hash, title: tapped.title.slice(0, 500), ih: tapped.ih === true },
    },
  })
    .then((view) => setLibraryData(queryClient, view))
    .catch(() => {});
}

/** El camino de hoy: el hash tocado con sus hermanas, sin comprobador ni saltos. */
function playTappedAsToday(tapped: TappedChannel): void {
  setWaitingMessage(null);
  const siblings = localSiblings(tapped.hash);
  patch({
    phase: 'ready',
    entries: siblings.length > 1 ? dedupeEntries(siblings) : [],
    activeHash: tapped.hash,
  });
  play(
    { hash: tapped.hash, title: tapped.title, kind: tapped.kind },
    {
      origin: 'library',
      route: { vista: 'partido', id: null, canal: tapped.hash },
      ...(tapped.record ? {} : { record: false }),
    },
  );
}

/**
 * Canal suelto con IPTV (§8.2): primero las IPTV, luego el hash que se tocó,
 * luego las hermanas del servidor en su orden y al final las de la
 * biblioteca que el servidor no devolvió. Arranca la IPTV (tryAutoStart).
 */
function applyChannelResolution(data: Resolution, tapped: TappedChannel): void {
  const now = clock();
  const fromServer = data.candidates.map((candidate) => entryFromCandidate(candidate, now));
  // Un id IPTV no es una fuente de AceStream: ni el tocado ni sus «hermanas» (§14.4).
  const iptvTap = tappedIsIptv(tapped);
  const entries = dedupeEntries([
    ...fromServer.filter(isIptv),
    ...(iptvTap ? [] : [tappedEntry(tapped)]),
    ...fromServer.filter((entry) => !isIptv(entry)),
    ...(iptvTap ? [] : localSiblings(tapped.hash)),
  ]);
  patch({
    phase: 'ready',
    resolution: data,
    preheat: data.preheat,
    entries,
    activeHash: null,
    iptvBridge: true,
    autoVerified: true,
  });
  if (data.scan) configureScan(data.scan);
  if (tryAutoStart() || data.scan) return;
  // Sin comprobador y sin IPTV que arrancar (un id IPTV que ya no está): la mejor colocada.
  const best = entries.find((entry) => !isReported(entry, now));
  if (best) {
    setWaitingMessage(null);
    playEntry(best, 'user');
  }
}

// ---- Comprobador -------------------------------------------------------------------------

interface WatchOptions {
  onJob(job: ScanJob): void;
  onError(error: unknown): void;
  onVerdict?(data: {
    hash: string;
    state: 'working' | 'weak' | 'failed';
    reason: string;
    playableOn?: { web: boolean; ios: boolean };
  }): void;
}

/**
 * Sigue un trabajo del comprobador: con el SSE abierto, cada `scan.progress`
 * de ese trabajo pide el estado entero (y `scan.verdict` cambia la fuente al
 * momento); sin SSE (respaldo o demo), se consulta cada 1,5 s. Nunca las dos
 * cosas: con el SSE abierto no hay sondeo (§2.1).
 */
function watchJob(jobId: string, options: WatchOptions): () => void {
  let stopped = false;
  let busy = false;
  let again = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const fetchNow = async () => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const job = await api('footballScan', { params: { id: jobId } });
      if (!stopped) options.onJob(job);
    } catch (error) {
      if (!stopped && !isAbortError(error)) options.onError(error);
    } finally {
      busy = false;
      if (again && !stopped) {
        again = false;
        void fetchNow();
      }
    }
  };

  const polling = () => realtimeStore.get().status !== 'open';
  const syncTimer = () => {
    if (stopped) return;
    if (polling() && !timer) timer = setInterval(() => void fetchNow(), SCAN_POLL_MS);
    if (!polling() && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  let wasOpen = !polling();
  const offRealtime = realtimeStore.subscribe(() => {
    const open = !polling();
    // Al volver el SSE se pudo perder algún evento: se pide el estado una vez.
    if (open && !wasOpen) void fetchNow();
    wasOpen = open;
    syncTimer();
  });
  const offProgress = onSseEvent('scan.progress', (data) => {
    if (data.jobId === jobId) void fetchNow();
  });
  const offVerdict = onSseEvent('scan.verdict', (data) => {
    if (data.jobId !== jobId) return;
    options.onVerdict?.(data);
    void fetchNow();
  });

  void fetchNow();
  syncTimer();
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    offRealtime();
    offProgress();
    offVerdict();
  };
}

function configureScan(ref: ScanRef, options: { keepProbes?: boolean } = {}): void {
  stopScanWatch?.();
  scanFailures = 0;
  const state = sessionStore.get();
  const started = startScan(state.entries, ref.initialCount);
  // Trabajo nuevo de la búsqueda inversa (§14.4): lo ya comprobado se queda como estaba.
  const entries = options.keepProbes
    ? state.entries.map((entry, index) =>
        entry.probe ? entry : { ...(started[index] as SourceEntry), initial: false },
      )
    : started;
  patch({
    entries,
    scan: {
      id: ref.id,
      status: 'queued',
      total: Math.max(ref.total, entries.length),
      checked: 0,
      playable: 0,
      retryAt: null,
    },
  });
  const gen = generation;
  const jobId = ref.id;
  stopScanWatch = watchJob(jobId, {
    onJob: (job) => {
      if (gen === generation && sessionStore.get().scan?.id === jobId) onMainJob(job);
    },
    onError: () => {
      if (gen === generation && sessionStore.get().scan?.id === jobId) onMainScanError();
    },
    onVerdict: (data) => {
      if (gen !== generation) return;
      patch({ entries: releaseIptvRetries(applyVerdict(sessionStore.get().entries, data)) });
      afterScanChange();
    },
  });
}

function onMainJob(job: ScanJob): void {
  if (job.status === 'cancelled') {
    onMainScanError();
    return;
  }
  scanFailures = 0;
  const state = sessionStore.get();
  const entries = releaseIptvRetries(applyScan(state.entries, job));
  patch({
    entries,
    scan: {
      id: job.id,
      status: job.status,
      total: Math.max(job.total, entries.length),
      checked: job.checked,
      playable: job.playable,
      retryAt: job.retryAt,
    },
  });
  // Con IPTV y el SSE abierto se sigue escuchando: el servidor revalida las
  // mejores AceStream mientras suena la IPTV (§7.3, «mantener caliente»), y
  // cuando caiga, «la mejor verificada» lo será de verdad.
  const keepListening =
    entries.some(isIptv) && realtimeStore.get().status === 'open' && !state.stopped;
  if (job.status === 'complete' && !keepListening) {
    stopScanWatch?.();
    stopScanWatch = null;
  }
  if (job.status === 'complete' || job.status === 'waiting') announceResearch();
  afterScanChange();
}

/**
 * El arranque ya no vuelve solo a una IPTV probada, salvo que el servidor la
 * dé por buena DESPUÉS del fallo y hayan pasado 60 s (§7.2).
 */
function releaseIptvRetries(entries: SourceEntry[]): SourceEntry[] {
  const now = clock();
  let changed = false;
  const next = entries.map((entry) => {
    if (!isIptv(entry) || !entry.autoTried || entry.probe?.state !== 'working') return entry;
    const failedAt = entry.playerVerdict?.state === 'failed' ? entry.playerVerdict.at : null;
    if (failedAt === null || now - failedAt < IPTV_CLIENT.autoTriedResetMs) return entry;
    changed = true;
    return { ...entry, autoTried: false };
  });
  return changed ? next : entries;
}

function onMainScanError(): void {
  scanFailures += 1;
  if (scanFailures < SCAN_MAX_FAILURES) return;
  stopScanWatch?.();
  stopScanWatch = null;
  const state = sessionStore.get();
  patch({ entries: clearScan(state.entries), scan: null, autoVerified: false, switchArmed: false });
  toast('El comprobador no responde; se muestran todas las fuentes', {
    tone: 'warn',
    icon: 'aviso',
  });
  // Sin comprobador y sin nada en pantalla: la mejor colocada, como si no
  // hubiera comprobador desde el principio (la 0.6.59 se quedaba esperando).
  const after = sessionStore.get();
  if (
    drives(after) &&
    !after.manualChosen &&
    !after.stopped &&
    !belongsOnScreen(after, screenNow())
  ) {
    const best = after.entries.find((entry) => !isReported(entry, clock()));
    setWaitingMessage(null);
    if (best) playEntry(best, 'user');
  }
}

function afterScanChange(): void {
  if (tryAutoStart()) return;
  maybeInitialSwitch();
}

/**
 * Arranca la primera verificada (`arrancarPrimeraVerificada`). Devuelve true
 * si ha mandado reproducir algo.
 */
function tryAutoStart(): boolean {
  const state = sessionStore.get();
  if (!state.autoVerified || state.stopped || !drives(state)) return false;
  const screen = screenNow();
  if (belongsOnScreen(state, screen)) return false;
  const now = clock();
  const effective = effectiveMap(state.entries, screen, now);
  const finished = scanFinished(state.scan);
  const chosen = pickAutoSource(state.entries, effective, finished);
  const total = state.entries.length;
  if (chosen) {
    const number = numberOf(state, chosen.id);
    const verified = effective.get(chosen.id)?.state === 'working';
    if (isIptv(chosen))
      notify('Arrancando tu IPTV', { kind: 'signal', icon: 'tv', signal: 'checking' });
    else
      notify(
        verified
          ? `Fuente ${number} verificada: arrancando`
          : `Ninguna verificada del todo; probamos la fuente ${number}, que da señal floja`,
        { kind: 'signal', icon: 'tv', signal: verified ? 'ok' : 'weak' },
      );
    setWaitingMessage(null);
    markAutoTried(chosen.id);
    playEntry(chosen, 'auto');
    return true;
  }
  if (finished) {
    if (state.scan?.status === 'waiting' && total) {
      const hour = madridHour(state.scan.retryAt);
      setWaitingMessage(
        `Ninguna de las ${total} fuentes da señal todavía. ${
          hour ? `Las vuelvo a probar a las ${hour}` : 'Las vuelvo a probar en unos minutos'
        } y arranco la primera que responda.`,
      );
      return false;
    }
    // Canal solo de la IPTV: mientras busca en AceStream, se espera (§14.4).
    if (tappedIsIptv(state.tapped) && state.reverse === 'running') {
      setWaitingMessage('Buscando este canal en AceStream…');
      return false;
    }
    const text =
      tappedIsIptv(state.tapped) && !aceCount(state.entries)
        ? IPTV_ONLY_DOWN_TEXT
        : state.entries.some(isIptv)
          ? BOTH_DOWN_TEXT
          : total
            ? `Ninguna de las ${total} fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.`
            : 'Este partido no tiene fuentes ahora mismo.';
    patch({ autoVerified: false, failureText: text });
    setWaitingMessage(null);
    notify(text, { kind: 'signal', tone: 'err', signal: 'fail' });
    return false;
  }
  const checked = state.scan?.checked ?? 0;
  setWaitingMessage(
    checked > 0
      ? `Comprobando fuentes… ${checked}/${state.scan?.total ?? total}`
      : `Comprobando ${total} fuentes: arranca la primera que funcione…`,
  );
  return false;
}

function markAutoTried(hash: string): void {
  sessionStore.set((state) => ({
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === hash ? { ...entry, autoTried: true } : entry,
    ),
  }));
}

function maybeInitialSwitch(): void {
  const state = sessionStore.get();
  if (!state.switchArmed || state.stopped) return;
  const next = pickInitialSwitch(state.entries, state.activeHash, screenNow(), clock());
  if (!next) return;
  patch({ switchArmed: false });
  haptic('warning');
  notify(
    `La señal inicial no responde; probamos automáticamente la fuente ${numberOf(state, next.id)}`,
    {
      kind: 'signal',
      icon: 'tv',
    },
  );
  playEntry(next, 'auto');
}

function announceResearch(): void {
  const watch = researchWatch;
  if (!watch) return;
  researchWatch = null;
  const state = sessionStore.get();
  const now = clock();
  const screen = screenNow();
  const fresh = state.entries.filter((entry) => {
    const effective = effectiveOf(entry, screen, now);
    return (
      !watch.before.has(entry.id) &&
      effective.state !== 'failed' &&
      (!state.scan || isShownWhileScanning(entry, effective, state.activeHash))
    );
  }).length;
  toast(
    fresh
      ? `Rebúsqueda terminada · ${fresh} ${fresh === 1 ? 'fuente nueva que funciona' : 'fuentes nuevas que funcionan'}${watch.ai}`
      : `Rebúsqueda terminada · ninguna fuente nueva funciona${watch.ai}`,
    { tone: 'ok', icon: 'refresh' },
  );
}

// ---- Reproducir ----------------------------------------------------------------------------

/** El nombre del canal para el reproductor: el título sin el proveedor. */
export function channelTitleFor(state: SessionState, entry: SourceEntry): string {
  if (state.kind === 'channel')
    return isIptv(entry)
      ? channelPartOf(entry.title) || state.channelTitle || entry.title
      : entry.title;
  return (
    channelPartOf(entry.title) || entry.matchedChannel || state.match?.channels[0] || entry.title
  );
}

function playEntry(entry: SourceEntry, origin: PlayOrigin): void {
  const state = sessionStore.get();
  const number = numberOf(state, entry.id);
  const presentation = presentationOf(entry, webSources());
  const effective = effectiveOf(entry, screenNow(), clock());
  const match = state.match;
  const iptv = isIptv(entry);
  const subtitle =
    state.kind === 'match'
      ? `Fuente ${number}, ${presentation.short}`
      : state.entries.length > 1
        ? `Fuente ${number} de ${state.entries.length}`
        : undefined;
  // Canal tocado con IPTV (§14.6): en Recientes entra el canal tocado, una vez, no cada fuente.
  const tappedSession = state.kind === 'channel' && state.iptvBridge && state.tapped !== null;
  if (tappedSession) recordTapped();
  play(
    {
      hash: entry.id,
      title: channelTitleFor(state, entry),
      // El tipo que declara la lista o el buscador (B-010); el pegado, `auto` (B-009).
      kind: kindFromIh(entry.ih),
      ...(subtitle ? { subtitle } : {}),
      ...(leadFor(number, effective, state) ? { lead: leadFor(number, effective, state) } : {}),
      source: presentation.short.slice(0, 60),
      ...(entry.listaId ? { listaId: entry.listaId } : {}),
      ...(match
        ? { colors: match.colors ?? ([glow(match.home), glow(match.away || match.home)] as const) }
        : {}),
      // La IPTV: textos «tu IPTV» y fallos sin reintentos en el reproductor (§8.3).
      ...(iptv ? { iptv: true } : {}),
    },
    {
      origin,
      ...(routeFor(state) ? { route: routeFor(state) } : {}),
      // Un hash pegado a mano no entra en Recientes (B-187); una IPTV tampoco (§4.6).
      ...(entry.origin === 'manual' || iptv || tappedSession ? { record: false } : {}),
    },
  );
  patch({
    activeHash: entry.id,
    stopped: false,
    failureText: null,
  });
}

// ---- Lo que hace el reproductor ---------------------------------------------------------------

function onPlayerChange(): void {
  const player = getPlayer();
  const previous = lastPlayer;
  lastPlayer = player;
  const state = sessionStore.get();
  if (!state.key) return;
  const hash = player.channel?.hash ?? null;

  // Detener (o el traspaso): se apaga todo lo automático (regla 17).
  if (
    player.phase === 'idle' &&
    previous.phase !== 'idle' &&
    (player.idleReason === 'detenido' || player.idleReason === 'traspasado')
  ) {
    stopWatchers();
    setWaitingMessage(null);
    patch({ stopped: true, autoVerified: false, switchArmed: false });
    return;
  }

  // Suena otra cosa que no es de esta sesión (zapping, biblioteca): se acaba.
  if (
    hash &&
    hash !== previous.channel?.hash &&
    !state.entries.some((entry) => entry.id === hash)
  ) {
    if (state.kind === 'channel' && state.key === `c:${hash}`) return;
    endSession();
    return;
  }

  if (!hash) return;
  const index = state.entries.findIndex((entry) => entry.id === hash);
  if (index < 0) return;
  const next: Partial<SessionState> = {};
  if (state.activeHash !== hash) next.activeHash = hash;
  // Primera imagen: el reproductor la da por buena (manda 3 min) y el salto de entrada se apaga.
  if (player.started && !(previous.started && previous.channel?.hash === hash)) {
    next.entries = state.entries.map((entry, i) =>
      i === index
        ? { ...entry, playerVerdict: { state: 'working', reason: 'player_ok', at: clock() } }
        : entry,
    );
    next.switchArmed = false;
    next.failureText = null;
  }
  if (Object.keys(next).length) patch(next);
}

/**
 * La fuente agotó sus reconexiones (callback del reproductor). Política
 * única (P16): en automático, la siguiente verificada; en manual, nunca.
 */
function handleSourceFailed(failure: SourceFailure): SourceFailedReply {
  const state = sessionStore.get();
  const index = state.entries.findIndex((entry) => entry.id === failure.channel.hash);
  if (!state.key || index < 0) return undefined;
  const now = clock();
  const failed = state.entries[index] as SourceEntry;
  const verdict = playerVerdictFor(failed, failure);
  // Un fallo de CUENTA (ocupada, no entra, caducada) vale para toda la IPTV (§4.3).
  const accountDown = isIptv(failed) && isIptvAccountFailure(failure.code);
  // Con el motor caído la fuente no tiene la culpa: no se apunta nada en ella.
  const engineDown = failure.code === 'engine_unavailable';
  const entries = engineDown
    ? state.entries
    : state.entries.map((entry, i) =>
        i === index
          ? {
              ...entry,
              playerVerdict: { ...verdict, at: now },
              // El puente no vuelve a una IPTV recién caída (60 s, §7.2).
              ...(isIptv(entry) ? { failedAt: now } : {}),
            }
          : accountDown && isIptv(entry)
            ? // Ni el arranque ni el puente vuelven a ellas en los próximos 60 s.
              { ...entry, autoTried: true, failedAt: now }
            : entry,
      );
  if (!engineDown) patch({ entries });
  const effective = effectiveMap(entries, NOTHING_ON_SCREEN, now);
  const finished = scanFinished(state.scan);
  const hasIptv = entries.some(isIptv);

  // §17: si cae una variante IPTV (la 1080p), la siguiente variante IPTV antes
  // que AceStream (4K, 720p, SD…). No cuenta en el tope del puente: cada una se
  // prueba una vez. Un fallo de cuenta, o la IPTV en pausa, vale para todas.
  const iptvDown =
    accountDown || failure.code === 'iptv_disabled' || failure.code === 'iptv_removed';
  if (isIptv(failed) && !iptvDown && !state.stopped && drives(state)) {
    const next = pickNextIptvVariant(entries, effective, failed, now);
    if (next) {
      const number = entries.findIndex((entry) => entry.id === next.id) + 1;
      patch({ autoVerified: true, manualChosen: false, switchArmed: false });
      haptic('warning');
      markAutoTried(next.id);
      playEntry(next, 'auto');
      return { next: true, message: nextVariantText(failure.code, failed, next, number) };
    }
  }

  // P16.6, el puente: «si uno no va, va el otro» (también en manual y en canales sueltos).
  if (hasIptv && !state.stopped && drives(state) && bridgeAllowed(state.bridgeJumps, now)) {
    const reply = bridge(state, entries, effective, failed, failure, finished, now);
    if (reply) return reply;
  }
  // Motor caído y ninguna IPTV a la que pasar: otra AceStream tampoco abriría;
  // el reproductor espera al motor como siempre.
  if (engineDown) return undefined;

  if (state.autoVerified && !state.stopped && drives(state)) {
    // Entre AceStream (P16.2): el puente, o su tope, ya decidió sobre la IPTV.
    const next = pickAutoSource(entries, effective, finished, { iptv: !hasIptv });
    if (next) {
      // Cambio automático de fuente: un aviso háptico (HAPTIC_MAP), nunca la única señal.
      haptic('warning');
      markAutoTried(next.id);
      playEntry(next, 'auto');
      return { next: true };
    }
    if (!finished)
      return {
        message:
          'Esta fuente no responde. Sigo comprobando las demás y arranco la primera que funcione.',
      };
    const total = entries.length;
    const text = hasIptv
      ? BOTH_DOWN_TEXT
      : `Ninguna de las ${total} fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.`;
    patch({ autoVerified: false, failureText: text });
    return { message: text };
  }

  // Manual: se dice cuántas quedan y se deja elegir (regla 19).
  haptic('error');
  const others = entries.filter(
    (entry, i) =>
      i !== index &&
      !effective.get(entry.id)?.reported &&
      effective.get(entry.id)?.state !== 'failed',
  ).length;
  const what = state.kind === 'match' ? 'partido' : 'canal';
  if (!others && hasIptv) {
    patch({ failureText: BOTH_DOWN_TEXT });
    return { message: BOTH_DOWN_TEXT };
  }
  return {
    message: others
      ? `Esta señal no responde. Tienes ${others} ${others === 1 ? 'fuente más' : 'fuentes más'} para este ${what}: prueba otra en el selector.`
      : `Esta señal no responde y no quedan más fuentes para este ${what}. Prueba «Rebuscar» o pega un Content ID.`,
  };
}

// ---- El puente IPTV ↔ AceStream (P16.6, docs/iptv.md §7.2) -----------------------------------

/**
 * Lo que deja el reproductor en la fuente que cae. Una IPTV con su motivo
 * (`iptv_dropped`, `iptv_busy`…) lo enseña en el cartel («se cortó en el
 * proveedor», «conexión ocupada»); la conexión ocupada es «Floja», no «Sin
 * señal»: es dudosa, la plaza se libera sola (§7.3 y §8.3).
 */
function playerVerdictFor(
  entry: SourceEntry,
  failure: SourceFailure,
): { state: VerdictState; reason: string } {
  const verdict = failureVerdict(failure.outcome, failure.seconds);
  if (!isIptv(entry) || !isIptvReason(failure.code)) return verdict;
  return { state: failure.code === 'iptv_busy' ? 'weak' : verdict.state, reason: failure.code };
}

/** Cuando ya no queda nada que probar, ni la IPTV ni AceStream. */
export const BOTH_DOWN_TEXT =
  'Ni tu IPTV ni las fuentes de AceStream dan señal ahora mismo. Prueba «Rebuscar» en unos minutos.';

/** Canal solo de la IPTV (§14.4): la IPTV cae y se busca en AceStream. */
export const IPTV_ONLY_WAIT_TEXT =
  'Tu IPTV no responde. Busco este canal en AceStream y arranco la primera fuente que funcione.';
/** Canal solo de la IPTV: la IPTV cae y en AceStream no está. */
export const IPTV_ONLY_DOWN_TEXT =
  'Tu IPTV no responde y este canal no está en AceStream. Prueba otra vez en unos minutos.';

/** Lo que dice la línea de estado según por qué cayó la IPTV. */
function iptvDownLead(code: string | undefined): string {
  if (code === 'iptv_busy') return 'Tu IPTV tiene la conexión ocupada';
  if (code === 'iptv_disabled' || code === 'iptv_removed') return 'Tu IPTV está en pausa';
  return 'Tu IPTV no responde';
}

/**
 * Cae una variante IPTV y se pasa a la siguiente (§17): «Tu IPTV no responde
 * en 1080p: probamos en 4K (fuente 2)»; sin calidades, «Tu IPTV no responde:
 * probamos otra señal de tu IPTV (fuente 2)».
 */
export function nextVariantText(
  code: string | undefined,
  failed: Pick<SourceEntry, 'iptv'>,
  next: Pick<SourceEntry, 'iptv'>,
  number: number,
): string {
  const from = iptvQualityText(failed);
  const to = iptvQualityText(next);
  const lead = iptvDownLead(code);
  if (from && to && from !== to) return `${lead} en ${from}: probamos en ${to} (fuente ${number})`;
  return `${lead}: probamos otra señal de tu IPTV (fuente ${number})`;
}

/**
 * A pantalla completa no se pinta ningún toast (`data-immersive`), que es
 * justo como se ve el fútbol: ahí «Volver a la IPTV» es una cápsula tocable
 * sobre el vídeo (showBackToast). Con teclado, además, la línea dice la
 * tecla, corta para que quepa (§7.2).
 */
function withBackHint(text: string, entries: readonly SourceEntry[], iptvId: string): string {
  if (!noticeFlags.get().immersive || !matches(MEDIA.finePointer)) return text;
  const number = entries.findIndex((entry) => entry.id === iptvId) + 1;
  if (number <= 0 || number > 9) return text;
  return `${text}${text.endsWith('.') ? '' : '.'} Para volver, pulsa ${number}.`;
}

/**
 * «Seguimos por AceStream» · «Volver a la IPTV» (8 s), atado a ESTA sesión
 * de fuentes: si se va a otro partido o canal, se quita y su acción ya no
 * hace nada. Va dos veces con la misma acción: el toast (fuera de
 * inmersivo) y la cápsula sobre el vídeo (en inmersivo, donde no hay
 * toasts); cada una se ve solo en su modo, así girar el móvil no la pierde.
 */
function showBackToast(iptvId: string): void {
  dismissBackToast();
  const gen = generation;
  const key = sessionStore.get().key;
  const back = () => {
    const current = sessionStore.get();
    if (gen !== generation || current.key !== key) return;
    if (!current.entries.some((entry) => entry.id === iptvId)) return;
    selectSource(iptvId);
  };
  const onAction = () => {
    // La otra copia ya no hace falta.
    dismissBackToast();
    back();
  };
  backToastId = toast('Seguimos por AceStream', {
    tone: 'warn',
    icon: 'tv',
    ms: IPTV_CLIENT.backToastMs,
    action: { label: 'Volver a la IPTV', onAction },
  });
  backPillId = showImmersiveAction(
    { text: 'Seguimos por AceStream', label: 'Volver a la IPTV', onAction },
    IPTV_CLIENT.backToastMs,
  );
}

function recentJumps(state: Pick<SessionState, 'bridgeJumps'>, now: number): number[] {
  return [...state.bridgeJumps.filter((at) => now - at < BRIDGE_WINDOW_MS), now];
}

/**
 * Un salto del puente, o null si no hay a quién saltar (sigue P16). El salto
 * deja la sesión en automático: si la AceStream elegida también cae
 * enseguida, se sigue con la siguiente (el salto ya contó en el tope).
 */
function bridge(
  state: SessionState,
  entries: readonly SourceEntry[],
  effective: ReadonlyMap<string, Effective>,
  failed: SourceEntry,
  failure: SourceFailure,
  finished: boolean,
  now: number,
): SourceFailedReply | null {
  if (isIptv(failed)) {
    // «Volver a la IPTV» vuelve al primer cartel IPTV (la mejor variante, §17), no al último que cayó.
    const back = entries.find(isIptv)?.id ?? failed.id;
    const paused = failure.code === 'iptv_disabled' || failure.code === 'iptv_removed';
    let target = pickBridgeTarget(entries, effective, 'iptv', finished, now);
    let numbered = true;
    // Canal suelto sin ninguna verificada: el hash que se tocó (§7.2).
    if (!target && state.kind === 'channel' && state.tapped) {
      const tappedHash = state.tapped.hash;
      const tapped = entries.find(
        (entry) =>
          entry.id === tappedHash &&
          !entry.autoTried &&
          !effective.get(entry.id)?.reported &&
          effective.get(entry.id)?.state !== 'failed',
      );
      if (tapped) {
        target = tapped;
        numbered = false;
      }
    }
    const lead = iptvDownLead(failure.code);
    if (target) {
      const number = entries.findIndex((entry) => entry.id === target.id) + 1;
      patch({
        bridgeJumps: recentJumps(state, now),
        autoVerified: true,
        manualChosen: false,
        switchArmed: false,
      });
      haptic('warning');
      markAutoTried(target.id);
      playEntry(target, 'auto');
      if (!paused) showBackToast(back);
      const text = `${lead}: seguimos por AceStream${numbered ? ` (fuente ${number})` : ''}`;
      return { next: true, message: paused ? text : withBackHint(text, entries, back) };
    }
    const iptvOnly = state.kind === 'channel' && tappedIsIptv(state.tapped);
    const searching = iptvOnly && state.reverse === 'running';
    if (!finished || searching) {
      // Ninguna verificada todavía (o se está buscando en AceStream): se espera a la primera.
      patch({
        bridgeJumps: recentJumps(state, now),
        autoVerified: true,
        manualChosen: false,
        switchArmed: false,
      });
      haptic('warning');
      if (!paused) showBackToast(back);
      const text =
        iptvOnly && !paused
          ? IPTV_ONLY_WAIT_TEXT
          : `${lead}. Sigo comprobando las fuentes de AceStream y arranco la primera que funcione.`;
      return { message: paused ? text : withBackHint(text, entries, back) };
    }
    if (iptvOnly && !aceCount(entries)) {
      // La búsqueda inversa terminó sin ninguna AceStream (§14.4).
      patch({ autoVerified: false, failureText: IPTV_ONLY_DOWN_TEXT });
      haptic('error');
      if (!paused) showBackToast(back);
      return {
        message: paused ? IPTV_ONLY_DOWN_TEXT : withBackHint(IPTV_ONLY_DOWN_TEXT, entries, back),
      };
    }
    return null;
  }
  const target = pickBridgeTarget(entries, effective, 'acestream', finished, now);
  if (!target) return null;
  patch({
    bridgeJumps: recentJumps(state, now),
    autoVerified: true,
    manualChosen: false,
    switchArmed: false,
  });
  haptic('warning');
  dismissBackToast();
  playEntry(target, 'auto');
  return {
    next: true,
    message:
      failure.code === 'engine_unavailable'
        ? 'El motor AceStream no responde: pasamos a tu IPTV'
        : 'Esta fuente no responde: pasamos a tu IPTV',
  };
}

// ---- Acciones de la persona ----------------------------------------------------------------

/** Elegir una fuente a mano (`renderFuentes` → onclick, index.html:3821-3833). */
export function selectSource(hash: string): void {
  const state = sessionStore.get();
  const entry = state.entries.find((item) => item.id === hash);
  if (!entry) return;
  const screen = screenNow();
  // Pulsar la activa mientras suena no hace nada.
  if (screen.hash === hash && (screen.playing || screen.connecting)) return;
  patch({ autoVerified: false, switchArmed: false, manualChosen: true });
  setWaitingMessage(null);
  if (isIptv(entry)) dismissBackToast();
  const presentation = presentationOf(entry, webSources());
  // IPTV: «Fuente 1 · IPTV · Casa», sin trozo de hash (§7.5).
  notify(
    isIptv(entry)
      ? `Fuente ${numberOf(state, hash)} · ${presentation.label}`
      : `${presentation.label} · ${hash.slice(0, 10)}`,
    { kind: 'signal', icon: 'tv' },
  );
  playEntry(entry, 'user');
}

/** La siguiente (o anterior) de las que se ven: deslizar en el móvil y la tecla N. */
export function stepSource(direction: 1 | -1, visible: readonly string[]): void {
  const state = sessionStore.get();
  if (!visible.length) return;
  const current = state.activeHash ? visible.indexOf(state.activeHash) : -1;
  const index =
    current < 0
      ? direction > 0
        ? 0
        : visible.length - 1
      : (current + direction + visible.length) % visible.length;
  const hash = visible[index];
  if (hash && hash !== state.activeHash) selectSource(hash);
}

/**
 * «Pegar hash» dentro de un partido (`playExternalHash`, index.html:3944-3963):
 * si ya estaba, solo cambia a él; si no, se añade como fuente manual.
 */
export function addManualSource(raw: string): boolean {
  const hash = normalizeHash(raw);
  if (!hash) return false;
  const state = sessionStore.get();
  const title =
    state.match?.channels[0] ||
    getPlayer().channel?.title ||
    state.channelTitle ||
    `Stream ${hash.slice(0, 8)}`;
  const existed = state.entries.some((entry) => entry.id === hash);
  const entries = existed
    ? state.entries
    : [...state.entries, manualEntry(hash, title, state.match?.channels[0] ?? '')];
  patch({
    entries,
    autoVerified: false,
    switchArmed: false,
    manualChosen: true,
    pasteOpen: false,
    ...(state.scan
      ? { scan: { ...state.scan, total: Math.max(state.scan.total, entries.length) } }
      : {}),
  });
  setWaitingMessage(null);
  const entry = entries.find((item) => item.id === hash);
  if (entry) playEntry(entry, 'user');
  haptic('success');
  toast(existed ? 'Reproduciendo el hash seleccionado' : 'Hash externo añadido y reproduciendo', {
    tone: 'ok',
    icon: 'play',
  });
  return true;
}

/** «Rebuscar» (`researchFootballSources`, index.html:4085-4135). */
export async function research(): Promise<void> {
  const state = sessionStore.get();
  if (state.researching) return;
  const match = state.match;
  if (state.kind !== 'match' || !match || !match.channels.length) {
    toast('Este partido todavía no tiene canales anunciados', { tone: 'warn', icon: 'aviso' });
    return;
  }
  const screen = screenNow();
  const now = clock();
  const currentId = state.activeHash ?? screen.hash;
  const current = state.entries.find((entry) => entry.id === currentId);
  const previousIds = new Set(state.entries.map((entry) => entry.id));
  const effective = effectiveMap(state.entries, screen, now);
  const before = new Set(
    state.entries
      .filter(
        (entry) =>
          !state.scan ||
          isShownWhileScanning(entry, effective.get(entry.id) as Effective, state.activeHash),
      )
      .map((entry) => entry.id),
  );
  const gen = generation;
  researchWatch = null;
  patch({ researching: true });
  try {
    const data = await api('footballResolve', {
      query: {
        match: match.id,
        channel: match.channels,
        research: '1',
        client: getViewerId(),
        ...(currentId ? { current: currentId, currentIh: current?.ih === true ? '1' : '0' } : {}),
      },
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    if (gen !== generation) return;
    const fresh = data.candidates.length ? data.candidates : data.candidate ? [data.candidate] : [];
    if (!fresh.length) {
      toast('No han aparecido fuentes nuevas para este partido', { tone: 'warn', icon: 'buscar' });
      return;
    }
    const latest = sessionStore.get();
    const old = new Map(latest.entries.map((entry) => [entry.id, entry]));
    let combined = dedupeEntries(
      fresh.map((candidate: ResolutionCandidate) => {
        const entry = entryFromCandidate(candidate, clock());
        const seen = old.get(entry.id);
        // Lo que vio el reproductor sigue valiendo sus 3 minutos.
        return seen
          ? { ...entry, playerVerdict: seen.playerVerdict, autoTried: seen.autoTried }
          : entry;
      }),
    );
    if (current && !combined.some((entry) => entry.id === current.id))
      combined = [...combined, { ...current, probe: null, initial: false }];
    const newCount = fresh.filter((candidate) => !previousIds.has(candidate.id)).length;
    // Si nada suena y la persona no ha elegido nada, lo nuevo puede arrancar
    // solo: sigue siendo la entrada al partido (regla 19).
    const rearm = !latest.manualChosen && !latest.stopped && !belongsOnScreen(latest, screenNow());
    patch({
      entries: combined,
      preheat: null,
      switchArmed: false,
      autoVerified: rearm,
      failureText: null,
      scan: null,
    });
    stopScanWatch?.();
    stopScanWatch = null;
    if (data.scan) configureScan(data.scan);
    const ai = data.ai?.used ? ' · revisadas por la IA' : '';
    researchWatch = { before, ai };
    toast(
      `Rebúsqueda: ${combined.length} señales reunidas, ${newCount} sin probar antes · comprobándolas…${ai}`,
      { tone: 'info', icon: 'refresh' },
    );
    if (!data.scan) announceResearch();
    if (rearm) afterScanChange();
  } catch (error) {
    if (gen !== generation) return;
    toast(
      isApiError(error) && error.code === 'timeout'
        ? 'La rebúsqueda está tardando demasiado; vuelve a intentarlo'
        : 'No se pudo completar la rebúsqueda ahora mismo',
      { tone: 'err', icon: 'aviso' },
    );
  } finally {
    if (gen === generation) patch({ researching: false });
  }
}

/** «Reportar y comprobar» (`submitSourceReport`, index.html:4024-4041). */
export async function reportSource(hash: string, reason: SourceReportReason): Promise<boolean> {
  const state = sessionStore.get();
  const entry = state.entries.find((item) => item.id === hash);
  if (!entry) return false;
  const presentation = presentationOf(entry, webSources());
  const gen = generation;
  try {
    const result = await api('sourcesReport', {
      body: {
        id: entry.id,
        reason,
        title: entry.title.slice(0, 200),
        source: (presentation.short || presentation.type).slice(0, 60),
        ih: entry.ih === true,
        ...(matchChannelFor(state, entry)
          ? { channel: matchChannelFor(state, entry).slice(0, 200) }
          : {}),
        ...(state.match ? { matchId: state.match.id } : {}),
      },
    });
    if (gen !== generation) return true;
    const until = Date.parse(result.report.quarantineUntil ?? '');
    markReported(hash, {
      reason,
      until: Number.isFinite(until) && until > clock() ? until : clock() + LOCAL_QUARANTINE_MS,
    });
    patch({ reportFor: null });
    const latest = sessionStore.get();
    const alternative =
      latest.activeHash === hash
        ? latest.entries.find((item) => {
            if (item.id === hash) return false;
            const effective = effectiveOf(item, screenNow(), clock());
            return (
              !effective.reported && (effective.state === 'working' || effective.state === 'weak')
            );
          })
        : undefined;
    // Reportar no cambia de fuente sola (index.html:4034-4038); se ofrece hacerlo.
    haptic('success');
    // La IPTV no la comprueba el segundo motor, sino su carril del comprobador.
    toast(
      isIptv(entry)
        ? 'Fuente apartada; ya se está comprobando tu IPTV'
        : 'Fuente apartada; el segundo motor ya la está comprobando',
      {
        tone: 'info',
        icon: 'refresh',
        ...(alternative
          ? {
              action: {
                label: `Ver la ${numberOf(latest, alternative.id)}`,
                onAction: () => selectSource(alternative.id),
              },
            }
          : {}),
      },
    );
    if (result.scan) followReport(hash, reason, result.scan.id);
    return true;
  } catch (error) {
    if (isAbortError(error)) return false;
    toast('No se pudo enviar el reporte', { tone: 'err', icon: 'aviso' });
    return false;
  }
}

function markReported(
  hash: string,
  report: { reason: SourceReportReason; until: number } | null,
): void {
  sessionStore.set((state) => ({
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === hash ? { ...entry, reported: report } : entry,
    ),
  }));
}

/** Seguimiento del reporte (`pollReportedSource`, index.html:3987-4022). */
function followReport(hash: string, reason: SourceReportReason, jobId: string): void {
  reportWatches.get(hash)?.();
  const gen = generation;
  let polls = 0;
  let pause: ReturnType<typeof setTimeout> | null = null;
  let stop: (() => void) | null = null;
  const finish = () => {
    stop?.();
    stop = null;
    if (pause) clearTimeout(pause);
    pause = null;
    reportWatches.delete(hash);
  };
  const run = () => {
    stop = watchJob(jobId, {
      onJob: (job) => {
        if (gen !== generation) return finish();
        polls += 1;
        const result = job.candidates.find((candidate) => candidate.id === hash);
        if (result) {
          sessionStore.set((state) => ({
            ...state,
            entries: applyScan(state.entries, { candidates: [result] }),
          }));
        }
        if (job.status === 'waiting' && job.retryAt) {
          // Hasta la hora del reintento no hay nada nuevo: se deja de preguntar.
          const at = Date.parse(job.retryAt);
          const wait = Number.isFinite(at)
            ? Math.max(SCAN_POLL_MS, Math.min(REPORT_MAX_WAIT_MS, at - clock() + 750))
            : 60_000;
          stop?.();
          stop = null;
          pause = setTimeout(() => {
            pause = null;
            run();
          }, wait);
          return;
        }
        if (job.status === 'complete' || job.status === 'cancelled') {
          finish();
          if (job.status === 'cancelled') return;
          const outcome = reportFollowUp(reason, result?.state);
          const current = sessionStore.get().entries.find((entry) => entry.id === hash);
          if (!outcome.stillReported) markReported(hash, null);
          else if (current && !current.reported)
            markReported(hash, { reason, until: clock() + LOCAL_QUARANTINE_MS });
          toast(outcome.message, {
            tone: outcome.tone,
            icon: outcome.tone === 'ok' ? 'check' : 'aviso',
          });
          return;
        }
        if (polls >= REPORT_MAX_POLLS && realtimeStore.get().status !== 'open') finish();
      },
      onError: () => {
        polls += 1;
        if (polls >= REPORT_MAX_POLLS) finish();
      },
    });
  };
  run();
  reportWatches.set(hash, finish);
}

/** «Es el canal correcto» (`sendSourceFeedback`, index.html:3965-3976). */
export async function confirmSource(hash: string): Promise<boolean> {
  const state = sessionStore.get();
  const entry = state.entries.find((item) => item.id === hash);
  const channel = matchChannelFor(state, entry);
  if (!entry || !channel) return false;
  try {
    await api('sourcesFeedback', {
      body: {
        id: entry.id,
        title: entry.title.slice(0, 200),
        channel: channel.slice(0, 200),
        verdict: 'correct',
        reason: 'not_starting',
      },
    });
    sessionStore.set((current) => ({
      ...current,
      entries: current.entries.map((item) =>
        item.id === hash ? { ...item, learned: 'correct' } : item,
      ),
    }));
    toast('La asociación queda aprendida en el NAS', { tone: 'ok', icon: 'learn' });
    return true;
  } catch {
    toast('No se pudo guardar esta corrección', { tone: 'err', icon: 'aviso' });
    return false;
  }
}

// ---- «Encontrar canal» (§5.2) --------------------------------------------------------------------

export interface Choice {
  id: string;
  title: string;
  ih: boolean;
  source: ResolutionCandidate['source'];
}

/** El canal por el que se pregunta en «Encontrar canal». */
export function resolverChannel(state: SessionState): string {
  return state.resolution?.channels[0] || state.match?.channels[0] || 'Canal por confirmar';
}

/**
 * Elegir una señal en «Encontrar canal» (`playResolvedCandidate`,
 * index.html:4040-4060): se reproduce directamente, sin esperar al
 * comprobador. Con «Recordar mi elección», se vincula el canal.
 */
export async function chooseCandidate(choice: Choice, remember: boolean): Promise<void> {
  const state = sessionStore.get();
  const channel = resolverChannel(state);
  const gen = generation;
  let bindingFailed = false;
  if (remember) {
    try {
      await api('footballBind', {
        body: {
          channel: channel.slice(0, 200),
          id: choice.id,
          title: (choice.title || channel).slice(0, 200),
          ih: choice.ih,
        },
      });
    } catch {
      bindingFailed = true;
    }
  }
  if (gen !== generation) return;
  const resolution = sessionStore.get().resolution;
  const now = clock();
  const candidates = resolution?.candidates ?? [];
  let entries = dedupeEntries(candidates.map((candidate) => entryFromCandidate(candidate, now)));
  if (!entries.some((entry) => entry.id === choice.id)) {
    entries = [
      ...entries,
      {
        ...manualEntry(choice.id, choice.title || channel, channel),
        origin: choice.source,
        ih: choice.ih,
      },
    ];
  }
  patch({
    phase: 'ready',
    resolverOpen: false,
    entries,
    activeHash: choice.id,
    autoVerified: false,
    manualChosen: false,
    stopped: false,
  });
  if (resolution?.scan) {
    configureScan(resolution.scan);
    patch({ switchArmed: true });
  }
  const entry = sessionStore.get().entries.find((item) => item.id === choice.id);
  if (entry) playEntry(entry, 'user');
  if (bindingFailed)
    toast('El canal se reproduce, pero no pudimos recordar la asociación', {
      tone: 'warn',
      icon: 'aviso',
    });
}

/** «Vincular y reproducir» (`manualBindAndPlay`, index.html:4061-4065). Devuelve el error, o null. */
export async function bindManual(raw: string): Promise<string | null> {
  const hash = normalizeHash(raw);
  if (!hash) return INVALID_HASH_TEXT;
  const channel = resolverChannel(sessionStore.get());
  await chooseCandidate({ id: hash, title: channel, ih: false, source: 'saved' }, true);
  return null;
}

// ---- Hojas ------------------------------------------------------------------------------------

export function openResolver(open = true): void {
  patch({ resolverOpen: open });
}
export function openReport(hash: string | null): void {
  patch({ reportFor: hash });
}
export function openPaste(open = true): void {
  patch({ pasteOpen: open });
}

/** Solo para los tests. */
export function resetSessionForTests(): void {
  endSession();
  clock = () => Date.now();
}
