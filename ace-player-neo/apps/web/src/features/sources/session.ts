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
     sesión (index.html:4887-4896). */

import type {
  FootballMatch,
  Item,
  PreheatPublic,
  Resolution,
  ResolutionCandidate,
  ScanJob,
  ScanRef,
  SourceReportReason,
  WebSourceSummary,
} from '@ace/shared';
import { normalizeHash } from '@ace/shared';
import { api, getViewerId, isAbortError, isApiError, onSseEvent } from '../../api/index.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import type { Route } from '../../app/routes.ts';
import { hueFromName, oklchCss } from '../../lib/color.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { notify, toast } from '../../notices/index.ts';
import {
  getPlayer,
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
import {
  applyScan,
  applyVerdict,
  channelPartOf,
  clearScan,
  dedupeEntries,
  effectiveOf,
  entryFromCandidate,
  entryFromItem,
  failureVerdict,
  INVALID_HASH_TEXT,
  isReported,
  isShownWhileScanning,
  LOCAL_QUARANTINE_MS,
  manualEntry,
  onScreenOf,
  pickAutoSource,
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
};

export const sessionStore = createStore<SessionState>(EMPTY);

export function useSession<S>(selector: (state: SessionState) => S, isEqual?: (a: S, b: S) => boolean): S {
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
  };
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
  if (state.kind === 'match' && state.match) return { vista: 'partido', id: state.match.id, canal: null };
  if (state.kind === 'channel' && state.key) return { vista: 'partido', id: null, canal: state.key.slice(2) };
  return undefined;
}

function glow(name: string): string {
  return oklchCss({ l: 0.66, c: 0.13, h: hueFromName(name || '?') });
}

/** Frase de la fuente para la línea de estado: «Fuente 1 verificada.» */
function leadFor(number: number, effective: Effective | undefined, state: SessionState): string | undefined {
  if (state.kind !== 'match') return undefined;
  if (effective?.state === 'working' && !effective.reported) return `Fuente ${number} verificada.`;
  if (effective?.state === 'weak') return `Fuente ${number}, señal floja.`;
  return `Fuente ${number}.`;
}

// ---- Suscripciones mientras hay sesión --------------------------------------------------

let generation = 0;
let resolveAbort: AbortController | null = null;
let stopScanWatch: (() => void) | null = null;
let scanFailures = 0;
const reportWatches = new Map<string, () => void>();
let researchWatch: { before: Set<string>; ai: string } | null = null;
let offFailed: (() => void) | null = null;
let offPlayer: (() => void) | null = null;
let lastPlayer: PlayerState = getPlayer();

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
  stopWatchers();
  detach();
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
  patch({ autoVerified: false, switchArmed: false, phase: state.phase === 'resolving' ? 'idle' : state.phase });
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
    patch({ phase: 'no_channels' });
    toast('El canal todavía no está anunciado', { tone: 'warn', icon: 'tv' });
    return;
  }
  void resolveMatch();
}

async function resolveMatch(): Promise<void> {
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
      timeoutMs: RESOLVE_TIMEOUT_MS,
      signal: controller.signal,
    });
    if (gen !== generation) return;
    applyEntryResolution(data);
  } catch (error) {
    if (gen !== generation || controller.signal.aborted) return;
    if (isAbortError(error)) return;
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
  const playingOne = screen.hash && entries.some((entry) => entry.id === screen.hash) ? screen.hash : null;
  patch({ phase: 'ready', resolution: data, preheat: data.preheat, entries, activeHash: playingOne });
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
}

/**
 * Centro de partido de un canal suelto (`partido/canal/<hash>`): sus
 * hermanas del mismo canal (regla 23) y, si nada suena todavía (la página
 * se abrió con ese enlace), lo reproduce. Tras un «Detener» no lo relanza.
 */
export function enterChannel({ hash, title, siblings, activeListId }: ChannelEntry): void {
  const key = `c:${hash}`;
  const entries =
    siblings.length > 1 ? dedupeEntries(siblings.map((item) => entryFromItem(item, activeListId))) : [];
  const current = sessionStore.get();
  if (current.key === key) {
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
  if (current.kind === 'channel' && current.entries.some((entry) => entry.id === hash)) {
    patch({ channelTitle: title || current.channelTitle });
    return;
  }
  begin({ key, kind: 'channel', channelTitle: title, entries, activeHash: hash, phase: 'ready' });
  const player = getPlayer();
  const idle = player.phase === 'idle' || player.phase === 'error';
  if (player.channel?.hash !== hash && idle && (player.idleReason === 'inicio' || player.idleReason === null)) {
    play(
      { hash, title: title || `Canal ${hash.slice(0, 8)}` },
      { origin: 'library', route: { vista: 'partido', id: null, canal: hash } },
    );
  }
}

// ---- Comprobador -------------------------------------------------------------------------

interface WatchOptions {
  onJob(job: ScanJob): void;
  onError(error: unknown): void;
  onVerdict?(data: { hash: string; state: 'working' | 'weak' | 'failed'; reason: string; playableOn?: { web: boolean; ios: boolean } }): void;
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

function configureScan(ref: ScanRef): void {
  stopScanWatch?.();
  scanFailures = 0;
  const state = sessionStore.get();
  const entries = startScan(state.entries, ref.initialCount);
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
      patch({ entries: applyVerdict(sessionStore.get().entries, data) });
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
  const entries = applyScan(state.entries, job);
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
  if (job.status === 'complete') {
    stopScanWatch?.();
    stopScanWatch = null;
  }
  if (job.status === 'complete' || job.status === 'waiting') announceResearch();
  afterScanChange();
}

function onMainScanError(): void {
  scanFailures += 1;
  if (scanFailures < SCAN_MAX_FAILURES) return;
  stopScanWatch?.();
  stopScanWatch = null;
  const state = sessionStore.get();
  patch({ entries: clearScan(state.entries), scan: null, autoVerified: false, switchArmed: false });
  toast('El comprobador no responde; se muestran todas las fuentes', { tone: 'warn', icon: 'aviso' });
  // Sin comprobador y sin nada en pantalla: la mejor colocada, como si no
  // hubiera comprobador desde el principio (la 0.6.59 se quedaba esperando).
  const after = sessionStore.get();
  if (after.kind === 'match' && !after.manualChosen && !after.stopped && !belongsOnScreen(after, screenNow())) {
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
  if (!state.autoVerified || state.stopped || state.kind !== 'match') return false;
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
    const text = total
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
    entries: state.entries.map((entry) => (entry.id === hash ? { ...entry, autoTried: true } : entry)),
  }));
}

function maybeInitialSwitch(): void {
  const state = sessionStore.get();
  if (!state.switchArmed || state.stopped) return;
  const next = pickInitialSwitch(state.entries, state.activeHash, screenNow(), clock());
  if (!next) return;
  patch({ switchArmed: false });
  notify(`La señal inicial no responde; probamos automáticamente la fuente ${numberOf(state, next.id)}`, {
    kind: 'signal',
    icon: 'tv',
  });
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
  if (state.kind === 'channel') return entry.title;
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
  const subtitle =
    state.kind === 'match'
      ? `Fuente ${number}, ${presentation.short}`
      : state.entries.length > 1
        ? `Fuente ${number} de ${state.entries.length}`
        : undefined;
  play(
    {
      hash: entry.id,
      title: channelTitleFor(state, entry),
      kind: entry.ih === true ? 'infohash' : 'auto',
      ...(subtitle ? { subtitle } : {}),
      ...(leadFor(number, effective, state) ? { lead: leadFor(number, effective, state) } : {}),
      source: presentation.short.slice(0, 60),
      ...(entry.listaId ? { listaId: entry.listaId } : {}),
      ...(match ? { colors: [glow(match.home), glow(match.away || match.home)] as const } : {}),
    },
    { origin, ...(routeFor(state) ? { route: routeFor(state) } : {}) },
  );
  patch({ activeHash: entry.id, stopped: false, failureText: null });
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
  if (hash && hash !== previous.channel?.hash && !state.entries.some((entry) => entry.id === hash)) {
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
  const verdict = failureVerdict(failure.outcome, failure.seconds);
  const entries = state.entries.map((entry, i) =>
    i === index ? { ...entry, playerVerdict: { ...verdict, at: clock() } } : entry,
  );
  patch({ entries });
  const now = clock();
  const screen: OnScreen = { hash: null, playing: false, connecting: false };
  const effective = effectiveMap(entries, screen, now);

  if (state.autoVerified && !state.stopped && state.kind === 'match') {
    const next = pickAutoSource(entries, effective, scanFinished(state.scan));
    if (next) {
      markAutoTried(next.id);
      playEntry(next, 'auto');
      return { next: true };
    }
    if (!scanFinished(state.scan))
      return {
        message: 'Esta fuente no responde. Sigo comprobando las demás y arranco la primera que funcione.',
      };
    const total = entries.length;
    const text = `Ninguna de las ${total} fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.`;
    patch({ autoVerified: false, failureText: text });
    return { message: text };
  }

  // Manual: se dice cuántas quedan y se deja elegir (regla 19).
  const others = entries.filter(
    (entry, i) => i !== index && !effective.get(entry.id)?.reported && effective.get(entry.id)?.state !== 'failed',
  ).length;
  const what = state.kind === 'match' ? 'partido' : 'canal';
  return {
    message: others
      ? `Esta señal no responde. Tienes ${others} ${others === 1 ? 'fuente más' : 'fuentes más'} para este ${what}: prueba otra en el selector.`
      : `Esta señal no responde y no quedan más fuentes para este ${what}. Prueba «Rebuscar» o pega un Content ID.`,
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
  const presentation = presentationOf(entry, webSources());
  notify(`${presentation.label} · ${hash.slice(0, 10)}`, { kind: 'signal', icon: 'tv' });
  playEntry(entry, 'user');
}

/** La siguiente (o anterior) de las que se ven: deslizar en el móvil y la tecla N. */
export function stepSource(direction: 1 | -1, visible: readonly string[]): void {
  const state = sessionStore.get();
  if (!visible.length) return;
  const current = state.activeHash ? visible.indexOf(state.activeHash) : -1;
  const index =
    current < 0 ? (direction > 0 ? 0 : visible.length - 1) : (current + direction + visible.length) % visible.length;
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
    state.match?.channels[0] || getPlayer().channel?.title || state.channelTitle || `Stream ${hash.slice(0, 8)}`;
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
    ...(state.scan ? { scan: { ...state.scan, total: Math.max(state.scan.total, entries.length) } } : {}),
  });
  setWaitingMessage(null);
  const entry = entries.find((item) => item.id === hash);
  if (entry) playEntry(entry, 'user');
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
          !state.scan || isShownWhileScanning(entry, effective.get(entry.id) as Effective, state.activeHash),
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
        return seen ? { ...entry, playerVerdict: seen.playerVerdict, autoTried: seen.autoTried } : entry;
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
        ...(matchChannelFor(state, entry) ? { channel: matchChannelFor(state, entry).slice(0, 200) } : {}),
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
            return !effective.reported && (effective.state === 'working' || effective.state === 'weak');
          })
        : undefined;
    // Reportar no cambia de fuente sola (index.html:4034-4038); se ofrece hacerlo.
    toast('Fuente apartada; el segundo motor ya la está comprobando', {
      tone: 'info',
      icon: 'refresh',
      ...(alternative
        ? { action: { label: `Ver la ${numberOf(latest, alternative.id)}`, onAction: () => selectSource(alternative.id) } }
        : {}),
    });
    if (result.scan) followReport(hash, reason, result.scan.id);
    return true;
  } catch (error) {
    if (isAbortError(error)) return false;
    toast('No se pudo enviar el reporte', { tone: 'err', icon: 'aviso' });
    return false;
  }
}

function markReported(hash: string, report: { reason: SourceReportReason; until: number } | null): void {
  sessionStore.set((state) => ({
    ...state,
    entries: state.entries.map((entry) => (entry.id === hash ? { ...entry, reported: report } : entry)),
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
          sessionStore.set((state) => ({ ...state, entries: applyScan(state.entries, { candidates: [result] }) }));
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
          toast(outcome.message, { tone: outcome.tone, icon: outcome.tone === 'ok' ? 'check' : 'aviso' });
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
      entries: current.entries.map((item) => (item.id === hash ? { ...item, learned: 'correct' } : item)),
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
        body: { channel: channel.slice(0, 200), id: choice.id, title: (choice.title || channel).slice(0, 200), ih: choice.ih },
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
    toast('El canal se reproduce, pero no pudimos recordar la asociación', { tone: 'warn', icon: 'aviso' });
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
