/* Simulador: un único almacén con datos falsos, reloj simulado, comprobador
   de fuentes, reproductor (misma máquina que la app real), sesiones,
   directorios, dispositivos y escenarios del panel de depuración. Sin red. */

import { useSyncExternalStore } from 'react';
import type {
  ConnState,
  Device,
  DiagnosticEntry,
  Directory,
  EngineStatus,
  GoalEvent,
  Item,
  Match,
  MediaPhase,
  PlaybackMode,
  PlayerPhase,
  PlayerState,
  PlayerTarget,
  Preferences,
  SessionSummary,
  Source,
  Theme,
} from './types';
import { buildAgenda } from './data/agenda';
import { DEVICES, DIRECTORIES, DIRECTORY_CHANNELS, FAVORITES, HISTORY, secondDeviceSession } from './data/library';
import { buildChannelSources, buildSources } from './data/sources';
import { scoreAt } from './score';
import { hhmm } from './format';
import { team } from './data/teams';

// ---------------------------------------------------------------- Tipos del estado

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'err';
  action?: { label: string; run: () => void };
  count: number;
  until: number;
}

export interface StatusLine {
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'err';
  meta?: string;
  until: number | null;
}

export interface PairingState {
  phase: 'idle' | 'creating' | 'code' | 'expired' | 'paired' | 'error';
  code: string;
  expiresAt: number;
}

export interface SourceSession {
  targetKind: 'match' | 'channel';
  targetId: string;
  sources: Source[];
  startedAt: number; // cuándo empezó el comprobador
  /** true: cambio automático permitido (hasta que el usuario elige a mano). */
  automatic: boolean;
  research: boolean;
  researchUntil: number | null;
}

export interface SimState {
  /** Diferencia entre el reloj simulado y el real (ms). */
  clockOffset: number;
  /** Se incrementa cada segundo: las vistas que dependen del reloj se suscriben a él. */
  tick: number;
  agenda: Match[];
  favorites: Item[];
  history: Item[];
  directories: Directory[];
  activeDirectoryId: string;
  devices: Device[];
  sessions: SessionSummary[];
  preferences: Preferences;
  engine: { status: EngineStatus; version: string; since: number; autoRestartsLastHour: number };
  diagnostics: DiagnosticEntry[];
  sameChannelPolicy: 'share' | 'handoff';
  playbackMode: PlaybackMode;
  theme: Theme;
  reducedTransparency: boolean;
  reducedMotion: boolean;
  /** Primer uso: sin gustos y sin emparejar (iPhone). */
  firstUse: boolean;
  paired: boolean;
  pairing: PairingState;
  player: PlayerState;
  sourceSessions: Record<string, SourceSession>;
  toasts: Toast[];
  statusLine: StatusLine | null;
  /** Marcador del partido que se está viendo: tapado salvo que se destape. */
  scoreRevealed: Record<string, boolean>;
  /** Último gol (para el «momento de gol»). */
  lastGoal: { matchId: string; side: 'home' | 'away'; at: number } | null;
  /** Escenario de depuración activo (para mostrarlo en el panel). */
  scenario: string | null;
  /** «Un segundo dispositivo reproduciendo» activo. */
  secondDevice: boolean;
  /** Días de la tira que se han visto (para el escalonado). */
  onboardingStep: number;
}

type Listener = () => void;

// ---------------------------------------------------------------- Estado inicial

function initialClockOffset(): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 12, 0, 0);
  return target.getTime() - now.getTime();
}

const IDLE_PLAYER: PlayerState = {
  conn: 'idle',
  media: 'paused',
  target: null,
  behindS: 0,
  bufferS: 0,
  reconnects: 0,
  errorCode: null,
  volume: 0.8,
  muted: false,
  expanded: false,
  fullscreen: false,
  stats: { peers: 0, speedDown: 0, speedUp: 0, status: 'idle' },
  ttffMs: null,
  handoff: null,
  sharedWith: [],
  autoSwitchedFrom: null,
  startedAt: null,
};

function initialState(): SimState {
  const today = new Date();
  return {
    clockOffset: initialClockOffset(),
    tick: 0,
    agenda: buildAgenda(today),
    favorites: FAVORITES,
    history: HISTORY,
    directories: DIRECTORIES,
    activeDirectoryId: 'principal',
    devices: DEVICES,
    sessions: [],
    preferences: { onboardingComplete: true, country: 'Spain', leagues: ['LaLiga', 'Liga de Campeones'], teams: ['Real Madrid'], nationalities: ['España'] },
    engine: { status: 'online', version: '3.2.3', since: Date.now() - 3 * 3600_000 - 25 * 60_000, autoRestartsLastHour: 0 },
    diagnostics: [
      { id: 'd1', at: new Date(Date.now() - 4 * 60_000).toISOString(), cause: 'source', code: 'source_no_peers', message: 'La fuente no tiene pares.', channel: 'DAZN 1' },
      { id: 'd2', at: new Date(Date.now() - 38 * 60_000).toISOString(), cause: 'network', code: 'stream_stalled', message: 'La imagen se quedó parada 24 s y se reconectó.', channel: 'M+ LaLiga' },
      { id: 'd3', at: new Date(Date.now() - 3 * 3600_000).toISOString(), cause: 'engine', code: 'engine_auto_restart', message: 'El motor dejó de responder y se reinició solo.' },
      { id: 'd4', at: new Date(Date.now() - 7 * 3600_000).toISOString(), cause: 'codec', code: 'unsupported_codec', message: 'Vídeo HEVC: no se puede reproducir en este navegador.', channel: 'Sky Sports Main Event' },
    ],
    sameChannelPolicy: 'share',
    playbackMode: 'balanced',
    theme: 'sistema',
    reducedTransparency: false,
    reducedMotion: false,
    firstUse: false,
    paired: true,
    pairing: { phase: 'idle', code: '', expiresAt: 0 },
    player: IDLE_PLAYER,
    sourceSessions: {},
    toasts: [],
    statusLine: null,
    scoreRevealed: {},
    lastGoal: null,
    scenario: null,
    secondDevice: false,
    onboardingStep: 0,
  };
}

// ---------------------------------------------------------------- Store

let state: SimState = initialState();
const listeners = new Set<Listener>();
let toastSeq = 1;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<SimState> | ((s: SimState) => Partial<SimState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

function setPlayer(patch: Partial<PlayerState> | ((p: PlayerState) => Partial<PlayerState>)) {
  const p = typeof patch === 'function' ? patch(state.player) : patch;
  state = { ...state, player: { ...state.player, ...p } };
  emit();
}

function later(key: string, ms: number, fn: () => void) {
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, ms),
  );
}

function cancel(key: string) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.delete(key);
}

function cancelAll(prefix: string) {
  for (const k of [...timers.keys()]) if (k.startsWith(prefix)) cancel(k);
}

export function getState(): SimState {
  return state;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSim<T>(selector: (s: SimState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export function now(): number {
  return Date.now() + state.clockOffset;
}

export function useNow(): number {
  useSim((s) => s.tick);
  return now();
}

// ---------------------------------------------------------------- Reloj

setInterval(() => {
  const t = now();
  // caducidad de toasts y línea de estado
  const toasts = state.toasts.filter((x) => x.until > Date.now());
  const statusLine = state.statusLine && state.statusLine.until && state.statusLine.until < Date.now() ? null : state.statusLine;
  // reproductor: retraso crece en pausa, estadísticas
  let player = state.player;
  if (player.conn === 'activa') {
    const rnd = Math.random();
    const base = player.media === 'playing' ? 1 : 0;
    player = {
      ...player,
      behindS: player.media === 'paused' ? player.behindS + 1 : Math.max(0, player.behindS + (rnd < 0.05 ? 0.2 : 0)),
      bufferS: Math.min(180, player.bufferS + 1),
      stats: {
        peers: Math.max(4, Math.round(player.stats.peers + (rnd - 0.5) * 3)),
        speedDown: Math.max(200, Math.round(player.stats.speedDown + (rnd - 0.5) * 120)),
        speedUp: Math.max(20, Math.round(player.stats.speedUp + (rnd - 0.5) * 30)),
        status: base ? 'dl' : 'paused',
      },
    };
  }
  // goles nuevos en el reloj simulado
  let lastGoal = state.lastGoal;
  for (const m of state.agenda) {
    const prev = scoreAt(m, t - 1000);
    const cur = scoreAt(m, t);
    if (cur.state === 'in' && cur.home + cur.away > prev.home + prev.away) {
      const g = cur.goals[cur.goals.length - 1];
      lastGoal = { matchId: m.id, side: g.side, at: Date.now() };
      toastGoal(m, g, cur);
    }
  }
  // pairing caducado
  let pairing = state.pairing;
  if (pairing.phase === 'code' && pairing.expiresAt < Date.now()) pairing = { ...pairing, phase: 'expired' };
  // directorios sincronizando
  const directories = state.directories.map((d) => {
    if (!d.syncing) return d;
    const p = (d.syncProgress ?? 0) + 0.12;
    if (p >= 1) return { ...d, syncing: false, syncProgress: undefined, syncedAt: new Date().toISOString(), lastError: null, lastErrorAt: null };
    return { ...d, syncProgress: p };
  });
  state = { ...state, tick: state.tick + 1, toasts, statusLine, player, lastGoal, pairing, directories };
  emit();
}, 1000);

function toastGoal(m: Match, g: GoalEvent, s: ReturnType<typeof scoreAt>) {
  const scorerTeam = team(g.side === 'home' ? m.home : m.away);
  const watching = state.player.target?.kind === 'match' && state.player.target.id === m.id;
  if (watching) return; // el que ves va tapado: nada de spoilers
  toast(`⚽ Gol de ${scorerTeam.name} · ${team(m.home).short} ${s.home}–${s.away} ${team(m.away).short} · ${s.clock}`, 'ok');
}

// ---------------------------------------------------------------- Avisos

export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms = 2800) {
  const existing = state.toasts.find((t) => t.text === text);
  if (existing) {
    set({ toasts: state.toasts.map((t) => (t === existing ? { ...t, count: t.count + 1, until: Date.now() + ms } : t)) });
    return;
  }
  const t: Toast = { id: toastSeq++, text, tone, action, count: 1, until: Date.now() + ms };
  set({ toasts: [...state.toasts.slice(-1), t] });
}

export function dismissToast(id: number) {
  set({ toasts: state.toasts.filter((t) => t.id !== id) });
}

export function clearToasts() {
  set({ toasts: [] });
}

export function statusLine(text: string, tone: StatusLine['tone'] = 'info', meta?: string, ms: number | null = 4500) {
  set({ statusLine: { text, tone, meta, until: ms ? Date.now() + ms : null } });
}

// ---------------------------------------------------------------- Agenda y gustos

export function matchById(id: string): Match | undefined {
  return state.agenda.find((m) => m.id === id);
}

export function setPreferences(p: Partial<Preferences>) {
  set({ preferences: { ...state.preferences, ...p } });
}

export function toggleTeamFollow(name: string) {
  const teams = state.preferences.teams.includes(name) ? state.preferences.teams.filter((t) => t !== name) : [...state.preferences.teams, name];
  setPreferences({ teams });
  toast(state.preferences.teams.includes(name) ? `Ahora sigues ${name}` : `Ya no sigues ${name}`);
}

export function toggleLeagueFollow(name: string) {
  const leagues = state.preferences.leagues.includes(name) ? state.preferences.leagues.filter((t) => t !== name) : [...state.preferences.leagues, name];
  setPreferences({ leagues });
}

export function completeOnboarding() {
  set({ preferences: { ...state.preferences, onboardingComplete: true }, firstUse: false });
}

/** «Para ti»: unión de ligas, equipos y selecciones. */
export function isForYou(m: Match, prefs: Preferences): boolean {
  const comp = m.competition;
  const compName = compNameOf(comp);
  if (prefs.leagues.includes(compName)) return true;
  const h = team(m.home).name;
  const a = team(m.away).name;
  if (prefs.teams.includes(h) || prefs.teams.includes(a)) return true;
  if (prefs.nationalities.some((n) => h === n || a === n)) return true;
  return false;
}

export function isMine(m: Match, prefs: Preferences): boolean {
  const h = team(m.home).name;
  const a = team(m.away).name;
  return prefs.teams.includes(h) || prefs.teams.includes(a) || prefs.nationalities.some((n) => h === n || a === n);
}

function compNameOf(id: string): string {
  const names: Record<string, string> = {
    laliga: 'LaLiga',
    ucl: 'Liga de Campeones',
    uel: 'Europa League',
    epl: 'Premier League',
    sea: 'Serie A',
    bun: 'Bundesliga',
    l1: 'Ligue 1',
    cdr: 'Copa del Rey',
    hyp: 'LaLiga Hypermotion',
    nat: 'Clasificación Mundial',
    ami: 'Amistoso',
  };
  return names[id] ?? id;
}

export function revealScore(matchId: string, revealed = true) {
  set({ scoreRevealed: { ...state.scoreRevealed, [matchId]: revealed } });
}

// ---------------------------------------------------------------- Fuentes y comprobador

function sessionKey(kind: 'match' | 'channel', id: string) {
  return `${kind}:${id}`;
}

export function ensureSources(kind: 'match' | 'channel', id: string): SourceSession {
  const key = sessionKey(kind, id);
  const existing = state.sourceSessions[key];
  if (existing) return existing;
  let sources: Source[];
  if (kind === 'match') {
    const m = matchById(id);
    sources = m ? buildSources(m) : [];
  } else {
    const item = findItem(id);
    sources = buildChannelSources(id, item?.title ?? 'Canal');
  }
  const session: SourceSession = { targetKind: kind, targetId: id, sources, startedAt: Date.now(), automatic: kind === 'match', research: false, researchUntil: null };
  state = { ...state, sourceSessions: { ...state.sourceSessions, [key]: session } };
  emit();
  scheduleProbes(key);
  return session;
}

function updateSource(key: string, sourceId: string, patch: Partial<Source>) {
  const s = state.sourceSessions[key];
  if (!s) return;
  const sources = s.sources.map((x) => (x.id === sourceId ? { ...x, ...patch } : x));
  state = { ...state, sourceSessions: { ...state.sourceSessions, [key]: { ...s, sources } } };
  emit();
}

function scheduleProbes(key: string) {
  const s = state.sourceSessions[key];
  if (!s) return;
  s.sources.forEach((src, i) => {
    if (src.state !== 'queued') return;
    const startAt = 200 + i * 650;
    later(`probe:${key}:${src.id}:start`, startAt, () => updateSource(key, src.id, { state: 'checking', attempts: src.attempts + 1 }));
    later(`probe:${key}:${src.id}:verdict`, startAt + src.probeS * 1000, () => {
      const reason = src.fate === 'working' ? 'playable_media' : src.fate === 'weak' ? 'starved' : src.videoCodec === 'hevc' ? 'unsupported_codec' : 'timeout';
      updateSource(key, src.id, {
        state: src.fate,
        reason,
        checkedAt: Date.now(),
        retryAt: src.fate === 'failed' ? now() + 10 * 60_000 : null,
      });
      maybeAutoStart(key);
    });
  });
}

/** Arranque automático: la primera verificada (o floja si terminó el comprobador). */
function maybeAutoStart(key: string) {
  const s = state.sourceSessions[key];
  if (!s || !s.automatic) return;
  const p = state.player;
  const targetMatches = p.target && p.target.kind === s.targetKind && p.target.id === s.targetId;
  if (!targetMatches) return;
  if (p.conn !== 'idle' || p.target?.sourceId) return;
  const working = s.sources.find((x) => x.state === 'working');
  if (working) {
    statusLine(`Fuente ${s.sources.indexOf(working) + 1} verificada: arrancando`, 'ok');
    connect(working.id, 'auto');
    return;
  }
  const done = s.sources.every((x) => x.state !== 'queued' && x.state !== 'checking');
  if (done) {
    const weak = s.sources.find((x) => x.state === 'weak');
    if (weak) {
      statusLine(`Ninguna verificada del todo; probamos la fuente ${s.sources.indexOf(weak) + 1}, que da señal floja`, 'warn');
      connect(weak.id, 'auto');
    } else {
      const retry = s.sources.find((x) => x.retryAt)?.retryAt;
      statusLine(`Ninguna de las ${s.sources.length} fuentes da señal ahora mismo.${retry ? ` Las vuelvo a probar a las ${hhmm(retry)}.` : ''}`, 'err', undefined, null);
    }
  }
}

export function research(kind: 'match' | 'channel', id: string) {
  const key = sessionKey(kind, id);
  const s = ensureSources(kind, id);
  const extra = s.sources.filter((x) => x.state === 'failed').slice(0, 2);
  set({ sourceSessions: { ...state.sourceSessions, [key]: { ...s, research: true, researchUntil: Date.now() + 4000 } } });
  toast(`Rebuscando: ${s.sources.length} señales reunidas, ${extra.length} sin probar antes…`);
  extra.forEach((src, i) => {
    updateSource(key, src.id, { state: 'queued' });
    later(`probe:${key}:${src.id}:start`, 400 + i * 500, () => updateSource(key, src.id, { state: 'checking' }));
    later(`probe:${key}:${src.id}:verdict`, 2500 + i * 900, () => updateSource(key, src.id, { state: i === 0 ? 'working' : 'failed', reason: i === 0 ? 'playable_media' : 'timeout', checkedAt: Date.now() }));
  });
  later(`research:${key}`, 4200, () => {
    const cur = state.sourceSessions[key];
    if (!cur) return;
    set({ sourceSessions: { ...state.sourceSessions, [key]: { ...cur, research: false, researchUntil: null } } });
    toast(extra.length ? 'Rebúsqueda terminada · 1 fuente nueva que funciona' : 'No han aparecido fuentes nuevas para este partido', extra.length ? 'ok' : 'info');
  });
}

export function reportSource(kind: 'match' | 'channel', id: string, sourceId: string, reason: string) {
  const key = sessionKey(kind, id);
  updateSource(key, sourceId, { state: 'failed', reason: `reported:${reason}`, quarantined: true, retryAt: now() + 30 * 60_000 });
  const s = state.sourceSessions[key];
  const wasPlaying = state.player.target?.sourceId === sourceId;
  toast('Fuente apartada; se vuelve a comprobar en segundo plano', 'ok');
  if (wasPlaying && s) {
    const next = s.sources.find((x) => x.state === 'working' && x.id !== sourceId);
    if (next) connect(next.id, 'auto');
    else stop('fallo');
  }
}

export function markCorrect(kind: 'match' | 'channel', id: string, sourceId: string, correct: boolean) {
  updateSource(sessionKey(kind, id), sourceId, { learned: correct ? 'correct' : 'incorrect' });
  toast(correct ? 'Anotado: es el canal correcto' : 'Anotado: no se volverá a proponer', 'ok');
}

export function addManualSource(kind: 'match' | 'channel', id: string, hash: string) {
  const key = sessionKey(kind, id);
  const s = ensureSources(kind, id);
  const src: Source = {
    ...s.sources[0],
    id: hash,
    title: `Fuente pegada ${hash.slice(0, 6)}`,
    origin: 'manual',
    listaId: null,
    listaName: 'Pegada a mano',
    state: 'queued',
    reason: '',
    learned: null,
    fate: 'working',
    probeS: 1.5,
    score: 0,
  };
  set({ sourceSessions: { ...state.sourceSessions, [key]: { ...s, sources: [src, ...s.sources] } } });
  scheduleProbes(key);
  selectSource(kind, id, hash);
  toast('Fuente externa añadida y reproduciendo', 'ok');
}

export function selectSource(kind: 'match' | 'channel', id: string, sourceId: string) {
  const key = sessionKey(kind, id);
  const s = ensureSources(kind, id);
  set({ sourceSessions: { ...state.sourceSessions, [key]: { ...s, automatic: false } } });
  if (!state.player.target || state.player.target.kind !== kind || state.player.target.id !== id) openTarget(kind, id);
  connect(sourceId, 'manual');
}

export function nextSource(kind: 'match' | 'channel', id: string, dir: 1 | -1 = 1) {
  const s = ensureSources(kind, id);
  const visible = s.sources.filter((x) => x.state !== 'failed');
  if (!visible.length) return;
  const cur = visible.findIndex((x) => x.id === state.player.target?.sourceId);
  const next = visible[(cur + dir + visible.length) % visible.length];
  selectSource(kind, id, next.id);
}

// ---------------------------------------------------------------- Reproductor

function findItem(id: string): Item | undefined {
  for (const list of Object.values(DIRECTORY_CHANNELS)) {
    const f = list.find((c) => c.id === id);
    if (f) return f;
  }
  return state.favorites.find((c) => c.id === id) ?? state.history.find((c) => c.id === id);
}

export function itemById(id: string): Item | undefined {
  return findItem(id);
}

function targetFor(kind: 'match' | 'channel', id: string): PlayerTarget {
  if (kind === 'match') {
    const m = matchById(id)!;
    return { kind, id, title: `${team(m.home).name} – ${team(m.away).name}`, subtitle: compNameOf(m.competition), sourceId: null };
  }
  const item = findItem(id);
  return { kind, id, title: item?.title ?? `Canal ${id.slice(0, 8)}`, subtitle: item?.category ?? 'Canal', sourceId: null };
}

/** Entrar en un partido o canal: se preparan las fuentes y arranca sola la primera verificada. */
export function openTarget(kind: 'match' | 'channel', id: string) {
  const same = state.player.target?.kind === kind && state.player.target.id === id;
  if (same) return;
  cancelAll('conn:');
  const target = targetFor(kind, id);
  setPlayer({ ...IDLE_PLAYER, target, expanded: state.player.expanded, volume: state.player.volume, muted: state.player.muted });
  const s = ensureSources(kind, id);
  if (kind === 'channel') {
    connect(s.sources[0].id, 'manual');
  } else {
    statusLine(`Comprobando ${s.sources.length} fuentes: arranca la primera que funcione…`, 'info', undefined, null);
    maybeAutoStart(sessionKey(kind, id));
  }
}

export function playMatch(id: string) {
  openTarget('match', id);
  setPlayer({ expanded: true });
}

export function playChannel(id: string) {
  const known = findItem(id);
  if (known && !state.history.some((h) => h.id === id)) {
    set({ history: [{ ...known, type: 'recent' as const, date: new Date().toISOString() }, ...state.history].slice(0, 60) });
  } else if (known) {
    set({ history: [{ ...known, type: 'recent' as const, date: new Date().toISOString() }, ...state.history.filter((h) => h.id !== id)] });
  }
  openTarget('channel', id);
}

function sourceOf(sourceId: string): Source | undefined {
  const t = state.player.target;
  if (!t) return undefined;
  return state.sourceSessions[sessionKey(t.kind, t.id)]?.sources.find((s) => s.id === sourceId);
}

const CONN_STEPS: { state: ConnState; ms: number }[] = [
  { state: 'pidiendo', ms: 300 },
  { state: 'conectando', ms: 550 },
  { state: 'precarga', ms: 1000 },
  { state: 'arrancando', ms: 400 },
];

export function connect(sourceId: string, origin: 'auto' | 'manual') {
  cancelAll('conn:');
  const src = sourceOf(sourceId);
  const t = state.player.target;
  if (!t) return;
  const prevSource = t.sourceId;
  setPlayer({
    target: { ...t, sourceId },
    conn: 'pidiendo',
    media: 'buffering',
    behindS: 0,
    bufferS: 0,
    errorCode: null,
    startedAt: Date.now(),
    ttffMs: null,
    // Conectar aquí recupera el mando: el traspaso a otro dispositivo deja de estar vigente.
    handoff: null,
    autoSwitchedFrom: origin === 'auto' && prevSource && prevSource !== sourceId ? prevSource : null,
  });
  if (origin === 'manual') {
    const s = state.sourceSessions[sessionKey(t.kind, t.id)];
    const idx = s ? s.sources.findIndex((x) => x.id === sourceId) + 1 : 0;
    statusLine(`Fuente ${idx}: ${src?.listaName ?? 'manual'} · conectando…`, 'info');
  }
  if (state.engine.status !== 'online') {
    later('conn:nomotor', 600, () => {
      setPlayer({ conn: 'error', errorCode: 'engine_unavailable' });
      statusLine('El motor AceStream no responde. Se reanudará solo cuando vuelva.', 'err', undefined, null);
    });
    return;
  }
  let acc = 0;
  CONN_STEPS.forEach((step, i) => {
    acc += step.ms;
    later(`conn:step:${i}`, acc, () => {
      if (state.player.conn === 'idle' || state.player.conn === 'error') return;
      setPlayer({ conn: step.state });
      if (step.state === 'precarga') statusLine('Señal encontrada: cargando los primeros segundos…', 'info');
    });
  });
  const failed = src?.state === 'failed' || src?.fate === 'failed';
  later('conn:first-frame', acc + 250, () => {
    if (state.player.conn === 'idle' || state.player.conn === 'error') return;
    if (failed) {
      fail('source_no_peers');
      return;
    }
    const m = t.kind === 'match' ? matchById(t.id) : null;
    const behind = state.playbackMode === 'low' ? 3 : state.playbackMode === 'stable' ? 12 : 6;
    setPlayer({
      conn: 'activa',
      media: 'playing',
      behindS: 0,
      bufferS: behind,
      reconnects: 0,
      ttffMs: Date.now() - (state.player.startedAt ?? Date.now()),
      stats: { peers: src?.peers ?? 20, speedDown: src?.speedDown ?? 800, speedUp: 120, status: 'dl' },
      sharedWith: state.secondDevice && m ? ['iPhone de Isma'] : [],
    });
    const s = state.sourceSessions[sessionKey(t.kind, t.id)];
    const idx = s ? s.sources.findIndex((x) => x.id === sourceId) + 1 : 1;
    statusLine(`Fuente ${idx} ${src?.state === 'weak' ? 'floja' : 'verificada'}. Vas en directo.`, src?.state === 'weak' ? 'warn' : 'ok', `${behind} s de colchón`, null);
    if (src && src.state !== 'working') updateSource(sessionKey(t.kind, t.id), sourceId, { state: src.state === 'weak' ? 'weak' : 'working', reason: 'player_ok' });
  });
}

function fail(code: string) {
  const p = state.player;
  const t = p.target;
  if (!t || !t.sourceId) return;
  const key = sessionKey(t.kind, t.id);
  const s = state.sourceSessions[key];
  const maxRetries = p.ttffMs === null ? 1 : 3;
  if (p.reconnects < maxRetries) {
    const n = p.reconnects + 1;
    const delay = Math.min(8000, 1000 * 2 ** (n - 1));
    setPlayer({ conn: 'reconectando', reconnects: n, errorCode: code });
    statusLine(`La señal se ha cortado: reconectando (${n}/${maxRetries})…`, 'warn', undefined, null);
    later('conn:retry', delay, () => {
      if (state.player.conn !== 'reconectando') return;
      // reintento: si el escenario dice que la fuente está muerta, vuelve a fallar
      const src = sourceOf(t.sourceId!);
      setPlayer({ conn: 'pidiendo' });
      let acc = 0;
      CONN_STEPS.forEach((step, i) => {
        acc += step.ms;
        later(`conn:step:${i}`, acc, () => state.player.conn !== 'idle' && setPlayer({ conn: step.state }));
      });
      later('conn:first-frame', acc + 250, () => {
        if (src?.state === 'failed' || src?.fate === 'failed') fail(code);
        else {
          setPlayer({ conn: 'activa', media: 'playing', ttffMs: state.player.ttffMs ?? 2600 });
          statusLine('Señal recuperada', 'ok');
        }
      });
    });
    return;
  }
  // agotado: veredicto y cambio automático
  updateSource(key, t.sourceId, { state: 'failed', reason: p.ttffMs && Date.now() - (p.startedAt ?? 0) > 60_000 ? 'player_dropped' : 'player_failed', retryAt: now() + 10 * 60_000 });
  if (s?.automatic) {
    const next = s.sources.find((x) => x.state === 'working' && x.id !== t.sourceId);
    if (next) {
      const idx = s.sources.indexOf(next) + 1;
      statusLine(`Esta fuente no responde: probando la fuente ${idx}…`, 'warn');
      toast(`Cambio automático a la fuente ${idx} (${next.listaName})`, 'warn');
      connect(next.id, 'auto');
      return;
    }
  }
  setPlayer({ conn: 'error', errorCode: code, media: 'paused' });
  statusLine(s?.automatic ? 'Ninguna fuente responde ahora mismo. Prueba «Rebuscar» o pega un Content ID.' : 'Esta fuente no responde. Prueba con otra.', 'err', undefined, null);
}

export function stop(reason: 'usuario' | 'fallo' | 'traspaso' = 'usuario') {
  cancelAll('conn:');
  const prev = state.player;
  setPlayer({ ...IDLE_PLAYER, target: null, expanded: false, fullscreen: false, volume: prev.volume, muted: prev.muted });
  set({ statusLine: null });
  if (reason === 'usuario' && prev.target) {
    const t = prev.target;
    const src = t.sourceId;
    toast('Reproducción detenida', 'info', {
      label: 'Deshacer',
      run: () => {
        openTarget(t.kind, t.id);
        if (src) connect(src, 'manual');
      },
    }, 6000);
  }
}

export function togglePlay() {
  const p = state.player;
  if (p.conn === 'error') {
    if (p.target?.sourceId) connect(p.target.sourceId, 'manual');
    return;
  }
  if (p.conn !== 'activa') return;
  setPlayer({ media: p.media === 'playing' ? 'paused' : 'playing' });
  if (p.media === 'playing') statusLine('En pausa. Pulsa Directo para volver al directo.', 'info', undefined, null);
  else statusLine('Reanudado', 'ok');
}

export function pause() {
  if (state.player.conn === 'activa') setPlayer({ media: 'paused' });
}

export function goLive() {
  const p = state.player;
  if (p.conn !== 'activa') return;
  if (p.behindS < 1.25 && p.media === 'playing') {
    toast('Ya estabas en el directo');
    return;
  }
  setPlayer({ media: 'seeking' });
  later('conn:seek', 500, () => {
    setPlayer({ media: 'playing', behindS: 0 });
    statusLine('De vuelta al directo', 'ok');
  });
}

export function seekBack(seconds = 30) {
  const p = state.player;
  if (p.conn !== 'activa') return;
  const can = Math.min(seconds, Math.max(0, p.bufferS - p.behindS));
  if (can < 1) {
    toast('No hay más imagen guardada hacia atrás');
    return;
  }
  setPlayer({ media: 'seeking' });
  later('conn:seek', 350, () => {
    setPlayer({ media: 'playing', behindS: state.player.behindS + can });
    statusLine(`Retrocedido ${Math.round(can)} s · pulsa Directo para volver`, 'info');
  });
}

export function setExpanded(expanded: boolean) {
  setPlayer({ expanded, fullscreen: expanded ? state.player.fullscreen : false });
}

export function setFullscreen(fullscreen: boolean) {
  setPlayer({ fullscreen, expanded: fullscreen ? true : state.player.expanded });
}

export function setMuted(muted: boolean) {
  setPlayer({ muted });
}

export function setVolume(volume: number) {
  setPlayer({ volume, muted: volume === 0 });
}

export function setPlaybackMode(mode: PlaybackMode) {
  set({ playbackMode: mode });
  const label = mode === 'low' ? 'Baja latencia' : mode === 'stable' ? 'Estable' : 'Equilibrado';
  toast(`Modo «${label}» activado`);
}

/** Hay algo en marcha (buscando señal, sonando, reconectando o en error): manda el objetivo. */
export function isEngaged(p: PlayerState): boolean {
  return p.target !== null;
}

export function derivePhase(p: PlayerState): PlayerPhase {
  switch (p.conn) {
    case 'idle':
      return 'idle';
    case 'pidiendo':
    case 'conectando':
    case 'precarga':
    case 'arrancando':
      return 'cargando';
    case 'reconectando':
      return 'reconectando';
    case 'error':
      return 'error';
    case 'activa':
      switch (p.media as MediaPhase) {
        case 'seeking':
          return 'buscando';
        case 'buffering':
          return 'buffer';
        case 'playing':
          return 'reproduciendo';
        case 'blocked':
          return 'bloqueado';
        default:
          return 'pausado';
      }
  }
}

/** Zapping: favoritos + directorio activo. */
export function zap(dir: 1 | -1) {
  const list = zapList();
  if (!list.length) return;
  const cur = state.player.target?.kind === 'channel' ? list.findIndex((c) => c.id === state.player.target!.id) : -1;
  const next = list[(cur + dir + list.length) % list.length];
  playChannel(next.id);
  statusLine(`Zapping: ${next.title}`, 'info');
}

export function zapList(): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const c of [...state.favorites, ...(DIRECTORY_CHANNELS[state.activeDirectoryId] ?? [])]) {
    if (seen.has(c.title)) continue;
    seen.add(c.title);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- Biblioteca

export function isFavorite(id: string): boolean {
  return state.favorites.some((f) => f.id === id);
}

export function toggleFavorite(id: string, title?: string) {
  if (isFavorite(id)) {
    const removed = state.favorites.find((f) => f.id === id)!;
    set({ favorites: state.favorites.filter((f) => f.id !== id) });
    toast(`«${removed.title}» quitado de favoritos`, 'info', { label: 'Deshacer', run: () => set({ favorites: [removed, ...state.favorites] }) }, 6000);
  } else {
    const item = findItem(id);
    const fav: Item = { ...(item ?? { id, title: title ?? `Canal ${id.slice(0, 6)}`, category: 'Fútbol', date: '', fromWebSync: false, ih: false }), type: 'fav', date: new Date().toISOString() };
    set({ favorites: [fav, ...state.favorites] });
    toast(`«${fav.title}» guardado en favoritos`, 'ok');
  }
}

export function renameItem(id: string, title: string) {
  set({
    favorites: state.favorites.map((f) => (f.id === id ? { ...f, title } : f)),
    history: state.history.map((f) => (f.id === id ? { ...f, title } : f)),
  });
  toast('Canal renombrado', 'ok');
}

export function removeRecent(id: string) {
  const removed = state.history.find((f) => f.id === id);
  if (!removed) return;
  set({ history: state.history.filter((f) => f.id !== id) });
  toast(`«${removed.title}» quitado de recientes`, 'info', { label: 'Deshacer', run: () => set({ history: [removed, ...state.history] }) }, 6000);
}

export function channelsOf(directoryId = state.activeDirectoryId): Item[] {
  return DIRECTORY_CHANNELS[directoryId] ?? [];
}

export function allChannels(): Item[] {
  return Object.values(DIRECTORY_CHANNELS).flat();
}

// ---------------------------------------------------------------- Directorios

export function activateDirectory(id: string) {
  set({ activeDirectoryId: id });
  toast(`Lista «${state.directories.find((d) => d.id === id)?.name}» en uso`, 'ok');
}

export function syncDirectory(id: string) {
  set({ directories: state.directories.map((d) => (d.id === id ? { ...d, syncing: true, syncProgress: 0 } : d)) });
}

export function deleteDirectory(id: string) {
  if (state.directories.length <= 1) {
    toast('Debe quedar al menos un directorio guardado.', 'err');
    return;
  }
  const removed = state.directories.find((d) => d.id === id)!;
  set({ directories: state.directories.filter((d) => d.id !== id), activeDirectoryId: state.activeDirectoryId === id ? state.directories.find((d) => d.id !== id)!.id : state.activeDirectoryId });
  toast(`Lista «${removed.name}» borrada`, 'info', { label: 'Deshacer', run: () => set({ directories: [...state.directories, removed] }) }, 6000);
}

export function addDirectory(name: string, url: string, type: 'm3u' | 'html' = 'm3u') {
  if (state.directories.length >= 8) {
    toast('Ya tienes 8 directorios. Elimina uno antes de añadir otro.', 'err');
    return;
  }
  if (/localhost|192\.168\.|10\.\d+\.|umbrel\.local/.test(url)) {
    toast('Por seguridad, las direcciones de tu red local están bloqueadas.', 'err');
    return;
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `lista-${Date.now()}`;
  DIRECTORY_CHANNELS[id] = DIRECTORY_CHANNELS['nueva-era'].slice(0, 24).map((c) => ({ ...c, listaId: id }));
  set({ directories: [...state.directories, { id, name, url, type, count: 24, syncedAt: null, lastErrorAt: null, lastError: null, syncing: true, syncProgress: 0 }] });
  toast(`Guardando y sincronizando «${name}»…`);
}

// ---------------------------------------------------------------- Dispositivos y emparejamiento

export function createPairingCode() {
  set({ pairing: { phase: 'creating', code: '', expiresAt: 0 } });
  later('pairing:create', 600, () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    set({ pairing: { phase: 'code', code, expiresAt: Date.now() + 5 * 60_000 } });
    // en la demo, el iPhone «canjea» el código a los 12 s
    later('pairing:claim', 12_000, () => {
      if (state.pairing.phase !== 'code') return;
      const dev: Device = { id: `dev_${Date.now()}`, name: 'iPhone de Isma (nuevo)', platform: 'ios', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: null };
      set({ devices: [dev, ...state.devices], pairing: { ...state.pairing, phase: 'paired' } });
      toast(`«${dev.name}» se ha emparejado`, 'ok');
    });
  });
}

export function cancelPairing() {
  cancelAll('pairing:');
  set({ pairing: { phase: 'idle', code: '', expiresAt: 0 } });
}

export function revokeDevice(id: string) {
  const d = state.devices.find((x) => x.id === id);
  if (!d) return;
  set({ devices: state.devices.map((x) => (x.id === id ? { ...x, revokedAt: new Date().toISOString() } : x)) });
  toast(`«${d.name}» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez.`, 'info');
}

/** Emparejar desde el iPhone (pantalla de primer uso). */
export function claimPairing(code: string): 'ok' | 'invalid' {
  if (!/^\d{6}$/.test(code)) return 'invalid';
  set({ paired: true });
  toast('iPhone emparejado', 'ok');
  return 'ok';
}

// ---------------------------------------------------------------- Sesiones y mando

export function joinSession(sessionId: string) {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s) return;
  const item = findItem(s.hash);
  if (item) playChannel(item.id);
  toast(`Viendo aquí «${s.title}»`, 'ok');
}

export function setSameChannelPolicy(policy: 'share' | 'handoff') {
  set({ sameChannelPolicy: policy });
  toast(policy === 'handoff' ? 'Un solo dispositivo a la vez: activado' : 'Varios dispositivos pueden ver el mismo canal');
}

// ---------------------------------------------------------------- Motor

export function restartEngine() {
  set({ engine: { ...state.engine, status: 'restarting' } });
  toast('Reiniciando el motor…', 'warn');
  if (state.player.conn !== 'idle') {
    statusLine('El motor se está reiniciando: reenganchando la señal…', 'warn', undefined, null);
  }
  later('engine:restart', 3500, () => {
    set({ engine: { ...state.engine, status: 'online', since: Date.now(), autoRestartsLastHour: state.engine.autoRestartsLastHour } });
    toast('Motor de vuelta', 'ok');
    const t = state.player.target;
    if (t?.sourceId && (state.player.conn === 'error' || state.player.conn === 'activa')) connect(t.sourceId, 'auto');
  });
}

// ---------------------------------------------------------------- Apariencia

export function setTheme(theme: Theme) {
  set({ theme });
}
export function setReducedTransparency(v: boolean) {
  set({ reducedTransparency: v });
}
export function setReducedMotion(v: boolean) {
  set({ reducedMotion: v });
}
export function setClockOffsetTo(hour: number, minute: number) {
  const n = new Date();
  const target = new Date(n.getFullYear(), n.getMonth(), n.getDate(), hour, minute, 0, 0);
  set({ clockOffset: target.getTime() - Date.now() });
}

// ---------------------------------------------------------------- Escenarios (panel de depuración)

export type Scenario =
  | 'gol'
  | 'fuente-cae'
  | 'reconectando'
  | 'sin-senal'
  | 'directorio'
  | 'segundo-dispositivo'
  | 'traspaso'
  | 'primer-uso'
  | 'sin-motor'
  | 'reset';

/** Partido en directo «destacado» (el que se ve, o el primero en directo). */
export function featuredLiveMatch(): Match | undefined {
  const t = now();
  const watching = state.player.target?.kind === 'match' ? matchById(state.player.target.id) : undefined;
  if (watching && scoreAt(watching, t).state === 'in') return watching;
  return state.agenda.find((m) => scoreAt(m, t).state === 'in');
}

export function runScenario(sc: Scenario) {
  set({ scenario: sc });
  switch (sc) {
    case 'gol': {
      const m = featuredLiveMatch();
      if (!m) {
        toast('No hay ningún partido en directo ahora mismo');
        return;
      }
      const s = scoreAt(m, now());
      const side: 'home' | 'away' = Math.random() < 0.55 ? 'home' : 'away';
      const teamId = side === 'home' ? m.home : m.away;
      const goal: GoalEvent = { minute: Math.max(1, s.minute), side, scorer: pickScorer(teamId) };
      set({ agenda: state.agenda.map((x) => (x.id === m.id ? { ...x, goals: [...x.goals, goal].sort((a, b) => a.minute - b.minute) } : x)) });
      const cur = scoreAt(matchById(m.id)!, now());
      set({ lastGoal: { matchId: m.id, side, at: Date.now() } });
      toastGoal(matchById(m.id)!, goal, cur);
      break;
    }
    case 'fuente-cae': {
      const t = state.player.target;
      if (!t?.sourceId || state.player.conn !== 'activa') {
        toast('Primero reproduce algo: el escenario corta la fuente en pantalla');
        return;
      }
      updateSource(sessionKey(t.kind, t.id), t.sourceId, { fate: 'failed' });
      setPlayer({ media: 'buffering' });
      statusLine('Señal irregular: recuperando la imagen…', 'warn');
      later('conn:scenario-fail', 1800, () => fail('stream_stalled'));
      break;
    }
    case 'reconectando': {
      if (state.player.conn !== 'activa') {
        toast('Primero reproduce algo');
        return;
      }
      setPlayer({ conn: 'reconectando', reconnects: 1 });
      statusLine('La imagen se ha quedado parada: reconectando (1/3)…', 'warn', undefined, null);
      later('conn:scenario-reconnect', 2600, () => {
        setPlayer({ conn: 'activa', media: 'playing' });
        statusLine('Señal recuperada', 'ok');
      });
      break;
    }
    case 'sin-senal': {
      const t = state.player.target;
      const key = t ? sessionKey(t.kind, t.id) : null;
      if (!key || !state.sourceSessions[key]) {
        toast('Abre un partido primero');
        return;
      }
      cancelAll(`probe:${key}`);
      cancelAll('conn:');
      const s = state.sourceSessions[key];
      const sources = s.sources.map((x) => ({ ...x, state: 'failed' as const, fate: 'failed' as const, reason: 'timeout', retryAt: now() + 10 * 60_000 }));
      set({ sourceSessions: { ...state.sourceSessions, [key]: { ...s, sources } } });
      setPlayer({ conn: 'error', errorCode: 'source_no_peers', media: 'paused' });
      statusLine(`Ninguna de las ${sources.length} fuentes da señal ahora mismo. Las vuelvo a probar a las ${hhmm(now() + 10 * 60_000)}.`, 'err', undefined, null);
      break;
    }
    case 'directorio': {
      syncDirectory('principal');
      toast('Actualizando «Principal»…');
      break;
    }
    case 'segundo-dispositivo': {
      const on = !state.secondDevice;
      const fav = state.favorites[0];
      set({ secondDevice: on, sessions: on ? [secondDeviceSession(fav.id, fav.title)] : [] });
      setPlayer({ sharedWith: on && state.player.conn === 'activa' ? ['iPhone de Isma'] : [] });
      toast(on ? 'El iPhone de Isma está viendo «M+ LaLiga»' : 'El iPhone ha dejado de reproducir');
      break;
    }
    case 'traspaso': {
      if (state.player.conn === 'idle') {
        toast('Primero reproduce algo aquí');
        return;
      }
      const t = state.player.target!;
      cancelAll('conn:');
      setPlayer({ conn: 'idle', media: 'paused', handoff: { byDevice: 'iPhone de Isma', title: 'DAZN 1' }, sharedWith: [] });
      set({ sessions: [secondDeviceSession(state.favorites[3].id, 'DAZN 1')], secondDevice: true });
      statusLine('La reproducción ha pasado a otro dispositivo', 'warn', 'iPhone de Isma', null);
      toast('El iPhone de Isma se ha quedado el mando: aquí se para', 'warn', {
        label: 'Reproducir aquí',
        run: () => {
          setPlayer({ handoff: null });
          if (t.sourceId) connect(t.sourceId, 'manual');
        },
      }, 8000);
      break;
    }
    case 'primer-uso': {
      cancelAll('conn:');
      set({ firstUse: true, paired: false, preferences: { onboardingComplete: false, country: 'Spain', leagues: [], teams: [], nationalities: [] }, player: IDLE_PLAYER, favorites: [], history: [], sessions: [], secondDevice: false });
      toast('Primer uso: sin gustos, sin favoritos y el iPhone sin emparejar');
      break;
    }
    case 'sin-motor': {
      const off = state.engine.status === 'online';
      set({ engine: { ...state.engine, status: off ? 'offline' : 'online', since: Date.now(), autoRestartsLastHour: off ? state.engine.autoRestartsLastHour + 1 : state.engine.autoRestartsLastHour } });
      if (off) {
        cancelAll('conn:');
        if (state.player.conn !== 'idle') {
          setPlayer({ conn: 'error', errorCode: 'engine_unavailable' });
          statusLine('El motor AceStream no responde. Se reanudará solo cuando vuelva.', 'err', undefined, null);
        }
        toast('Motor apagado', 'err');
        later('engine:auto', 9000, () => {
          set({ engine: { ...state.engine, status: 'restarting' } });
          toast('El motor se está reiniciando solo…', 'warn');
          later('engine:auto2', 4000, () => {
            set({ engine: { ...state.engine, status: 'online', since: Date.now() } });
            toast('Motor de vuelta', 'ok');
            const t = state.player.target;
            if (t?.sourceId) connect(t.sourceId, 'auto');
          });
        });
      } else {
        cancelAll('engine:');
        toast('Motor en línea', 'ok');
      }
      break;
    }
    case 'reset': {
      for (const k of [...timers.keys()]) cancel(k);
      state = { ...initialState(), theme: state.theme, reducedTransparency: state.reducedTransparency, reducedMotion: state.reducedMotion };
      emit();
      toast('Datos de muestra restaurados');
      break;
    }
  }
}

function pickScorer(teamId: string): string {
  const names: Record<string, string[]> = {
    rma: ['Mbappé', 'Vinícius', 'Bellingham'],
    fcb: ['Lewandowski', 'Yamal', 'Raphinha'],
    ath: ['Williams', 'Sancet'],
    psg: ['Dembélé', 'Doué'],
    ars: ['Saka', 'Gyökeres'],
    nap: ['Lukaku', 'McTominay'],
    mci: ['Haaland', 'Foden'],
    mun: ['Cunha', 'Mbeumo'],
    bay: ['Kane', 'Olise'],
    che: ['Palmer', 'João Pedro'],
    bet: ['Isco', 'Bakambu'],
    sev: ['Romero', 'Lukebakio'],
    gir: ['Stuani', 'Vanat'],
    vil: ['Pérez', 'Moleiro'],
  };
  const l = names[teamId] ?? ['Gol'];
  return l[Math.floor(Math.random() * l.length)];
}

// ---------------------------------------------------------------- Gancho para pruebas (Playwright)
declare global {
  interface Window {
    __aceSim?: { runScenario: typeof runScenario; getState: typeof getState; setClockOffsetTo: typeof setClockOffsetTo; setTheme: typeof setTheme; playMatch: typeof playMatch; playChannel: typeof playChannel; stop: typeof stop; clearToasts: typeof clearToasts; setExpanded: typeof setExpanded; setReducedTransparency: typeof setReducedTransparency; setReducedMotion: typeof setReducedMotion; claimPairing: typeof claimPairing; createPairingCode: typeof createPairingCode };
  }
}
if (typeof window !== 'undefined') {
  window.__aceSim = { runScenario, getState, setClockOffsetTo, setTheme, playMatch, playChannel, stop, clearToasts, setExpanded, setReducedTransparency, setReducedMotion, claimPairing, createPairingCode };
}
