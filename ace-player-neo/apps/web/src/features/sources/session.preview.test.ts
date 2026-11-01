/* La vista previa del móvil (maqueta movil-ficha-partido.html, dirección B):
   al abrir la ficha de un partido con la maquetación móvil, lo automático
   solo arranca AceStream y en silencio; la IPTV espera a que se toque play
   (no se gasta la plaza de la cuenta por mirar un partido). Termina al tocar
   play, activar el sonido o elegir una fuente; el escritorio y los canales
   sueltos siguen como siempre. Sin red: fetch simulado con los esquemas del
   contrato. */

import type { BootstrapResponse, Resolution, ResolutionCandidate } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { noticeFlags } from '../../notices/notify.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import {
  connectRuntime,
  getPlayer,
  notePlayerGesture,
  notifySourceFailed,
  playerStore,
  resetPlayerApi,
  setPlayerMuted,
  type PlayerCommand,
  type SourceFailure,
} from '../../player/api.ts';
import { fixture, json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { playChannel, resetPlayGuard } from '../library/play.ts';
import {
  PREVIEW_CHECKING_TEXT,
  PREVIEW_IPTV_LABEL,
  PREVIEW_IPTV_ONLY_TEXT,
  endSession,
  enterMatch,
  getSession,
  leaveSession,
  resetSessionForTests,
  selectSource,
} from './session.ts';
import { candidate, hash, JOB, resolution, scanJob, testMatch } from './test-utils.ts';

const flush = () => vi.advanceTimersByTimeAsync(0);
const toasts = () => toastStore.get().map((t) => t.text);

const IPTV = hash(100);

function iptvCandidate(extra: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return candidate(100, {
    title: 'M+ Liga de Campeones --> Casa',
    source: 'iptv',
    score: 100,
    listaId: 'p_Ab3dE5gH',
    iptv: { provider: 'Casa', quality: 'fhd', backup: false, guide: false },
    ...extra,
  });
}

/** Tu IPTV primera y `count` AceStream, con el comprobador solo para las AceStream. */
function withIptv(count = 3): Resolution {
  const base = resolution(count);
  return {
    ...base,
    checked: ['iptv', ...base.checked],
    candidate: iptvCandidate(),
    candidates: [iptvCandidate(), ...base.candidates],
  };
}

/** Solo tu IPTV (sin AceStream ni comprobador). */
function onlyIptv(): Resolution {
  return {
    ...resolution(0, { scan: null }),
    checked: ['iptv', 'saved', 'm3u'],
    candidate: iptvCandidate(),
    candidates: [iptvCandidate()],
  };
}

let scan = scanJob(['checking', 'checking', 'checking']);
let net: ReturnType<typeof mockFetch>;
let resolve: () => Response | Promise<Response> = () => json(withIptv());
let commands: PlayerCommand[] = [];

function install() {
  net = mockFetch({
    'GET /api/v1/football/resolve': (_call: MockCall) => resolve(),
    [`GET /api/v1/football/scans/${JOB}`]: () => json(scan),
  });
}

function setIptvActive(active: boolean) {
  const boot = fixture<BootstrapResponse>('bootstrap');
  queryClient.setQueryData(routeKey('bootstrap'), {
    ...boot,
    features: { ...boot.features, ...(active ? { iptv: true } : {}) },
  });
}

/** Las órdenes de reproducir que han llegado al reproductor, por hash. */
const played = () =>
  commands.flatMap((command) => (command.type === 'play' ? [command.channel.hash] : []));

function failNow(extra: Partial<SourceFailure> = {}) {
  return notifySourceFailed({
    channel: getPlayer().channel!,
    origin: getPlayer().origin ?? 'auto',
    outcome: 'fallo',
    seconds: 0,
    reason: 'x',
    ...extra,
  });
}

/** El reproductor de los tests: apunta las órdenes y refleja el silencio en el estado. */
function fakeRuntime() {
  commands = [];
  connectRuntime({
    handle: (command) => {
      commands.push(command);
      if (command.type === 'mute') playerStore.set((state) => ({ ...state, muted: command.muted }));
      if (command.type === 'play')
        playerStore.set((state) => ({
          ...state,
          phase: 'cargando',
          channel: command.channel,
          origin: command.options.origin ?? 'user',
          started: false,
          idleReason: null,
        }));
    },
  });
}

/** La persona quita el silencio con los controles: el <video> cambia y el reproductor lo avisa. */
function userUnmutes() {
  playerStore.set((state) => ({ ...state, muted: false }));
  notePlayerGesture('unmute');
}

/** El reproductor da imagen con lo que tiene en pantalla. */
function started() {
  playerStore.set((state) => ({
    ...state,
    phase: 'reproduciendo',
    started: true,
    desiredPlaying: true,
  }));
}

/** Entra en móvil con la IPTV y tres AceStream, y el comprobador da por buena la primera. */
async function previewPlayingAce() {
  enterMatch(testMatch(), { preview: true });
  await flush();
  scan = scanJob(['working', 'checking', 'checking']);
  await vi.advanceTimersByTimeAsync(1500);
  expect(getPlayer().channel?.hash).toBe(hash(1));
}

beforeEach(() => {
  vi.useFakeTimers();
  setMode('live', 'bootstrap');
  realtimeStore.set({ status: 'fallback', lastEventId: null, attempts: 0 });
  resetPlayerApi();
  resetSessionForTests();
  resetToasts();
  resetPlayGuard();
  noticeFlags.set({ watching: false, immersive: false });
  scan = scanJob(['checking', 'checking', 'checking']);
  resolve = () => json(withIptv());
  install();
  fakeRuntime();
});

afterEach(() => {
  endSession();
  net.restore();
  resetMode();
  queryClient.removeQueries({ queryKey: ['v1', 'bootstrap'] });
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
  noticeFlags.set({ watching: false, immersive: false });
  vi.useRealTimers();
});

describe('vista previa del móvil', () => {
  it('con IPTV y AceStream: arranca la AceStream en silencio y no toca la IPTV', async () => {
    enterMatch(testMatch(), { preview: true });
    await flush();
    // Mientras comprueba, nada suena y la IPTV queda a un toque, sin prometer que arranca sola.
    expect(getSession().preview).toBe(true);
    expect(played()).toEqual([]);
    expect(toasts()).not.toContain('Arrancando tu IPTV');
    expect(getPlayer().waiting).toBe(PREVIEW_CHECKING_TEXT);
    expect(getPlayer().waiting).not.toMatch(/Arrancando tu IPTV/);
    expect(getPlayer().waitingAction?.label).toBe(PREVIEW_IPTV_LABEL);

    scan = scanJob(['working', 'checking', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(played()).toEqual([hash(1)]);
    expect(getPlayer().muted).toBe(true);
    // El silencio llega antes que el play (iOS Safari solo arranca solo en silencio).
    const muteAt = commands.findIndex((c) => c.type === 'mute' && c.muted);
    const playAt = commands.findIndex((c) => c.type === 'play');
    expect(muteAt).toBeGreaterThanOrEqual(0);
    expect(muteAt).toBeLessThan(playAt);
    expect(played()).not.toContain(IPTV);
    expect(getSession().entries[0]).toMatchObject({ origin: 'iptv', autoTried: false });
    // Algo suena: el botón grande ya no está.
    expect(getPlayer().waitingAction).toBeNull();
    expect(toasts()).toContain('Fuente 2 verificada: arrancando en silencio');
  });

  it('solo IPTV: no arranca nada hasta el play y entonces la IPTV con sonido', async () => {
    resolve = () => json(onlyIptv());
    enterMatch(testMatch(), { preview: true });
    await flush();
    expect(played()).toEqual([]);
    expect(getPlayer().channel).toBeNull();
    expect(getPlayer().waiting).toBe(PREVIEW_IPTV_ONLY_TEXT);
    const action = getPlayer().waitingAction;
    expect(action?.label).toBe(PREVIEW_IPTV_LABEL);

    action?.onAction();
    expect(played()).toEqual([IPTV]);
    expect(getPlayer().channel).toMatchObject({ hash: IPTV, iptv: true });
    expect(getPlayer().muted).toBe(false);
    expect(commands.some((c) => c.type === 'mute' && c.muted)).toBe(false);
    expect(getSession().preview).toBe(false);
    expect(getPlayer().waitingAction).toBeNull();
  });

  it('solo IPTV con comprobador de AceStream sin nada vivo: al tocar play, la IPTV primero (§7.1)', async () => {
    enterMatch(testMatch(), { preview: true });
    await flush();
    scan = scanJob(['failed', 'failed', 'failed']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(played()).toEqual([]);
    expect(getPlayer().waiting).toBe('Ninguna AceStream da señal ahora mismo.');
    // Tocar play en el vídeo es lo mismo que el botón grande.
    notePlayerGesture('play');
    expect(played()).toEqual([IPTV]);
    expect(getPlayer().muted).toBe(false);
    expect(toasts()).toContain('Arrancando tu IPTV');
  });

  it('activar el sonido termina la vista previa: sigue la misma AceStream y luego rigen las reglas', async () => {
    await previewPlayingAce();
    userUnmutes();
    expect(getSession().preview).toBe(false);
    expect(getPlayer().channel?.hash).toBe(hash(1));
    expect(played()).toEqual([hash(1)]);
    // Ya sin vista previa, el puente vuelve: cae la AceStream y pasa a tu IPTV.
    const reply = failNow();
    expect(reply.next).toBe(true);
    expect(getPlayer().channel?.hash).toBe(IPTV);
    expect(getPlayer().muted).toBe(false);
  });

  it('fallo de la AceStream en vista previa: no salta a la IPTV, la deja a un toque', async () => {
    await previewPlayingAce();
    const reply = failNow();
    expect(reply.next).toBe(false);
    // El reproductor se queda en su panel de error (con el botón de la IPTV).
    playerStore.set((state) => ({ ...state, phase: 'error', idleReason: 'fallo' }));
    expect(played()).not.toContain(IPTV);
    expect(getPlayer().waitingAction?.label).toBe(PREVIEW_IPTV_LABEL);
    expect(getSession().preview).toBe(true);
    // Si verifica otra AceStream, arranca sola (en silencio), tampoco la IPTV.
    scan = scanJob(['working', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(getPlayer().muted).toBe(true);
    expect(played()).not.toContain(IPTV);
  });

  it('elegir una fuente a mano la termina y devuelve el sonido como estaba', async () => {
    await previewPlayingAce();
    selectSource(IPTV);
    expect(getSession()).toMatchObject({ preview: false, manualChosen: true });
    expect(getPlayer().channel?.hash).toBe(IPTV);
    expect(getPlayer().muted).toBe(false);
  });

  it('quien ya tenía el vídeo silenciado lo sigue teniendo al terminar', async () => {
    setPlayerMuted(true);
    await previewPlayingAce();
    selectSource(hash(2));
    expect(getPlayer().muted).toBe(true);
  });

  it('salir del partido no deja la vista previa colgada ni el vídeo silenciado', async () => {
    await previewPlayingAce();
    endSession();
    expect(getSession().preview).toBe(false);
    // La AceStream sigue en el mini: en silencio, hasta que cambie lo que suena o se pare.
    expect(getPlayer().muted).toBe(true);
    // Para (sin nada sonando): el sonido vuelve. Entrar en escritorio a otro partido, como siempre.
    playerStore.set((state) => ({ ...state, phase: 'idle', channel: null, idleReason: 'inicio' }));
    expect(getPlayer().muted).toBe(false);
    enterMatch(testMatch({ id: 'm2' }));
    await flush();
    expect(getPlayer().channel?.hash).toBe(IPTV);
    expect(getPlayer().muted).toBe(false);
  });

  it('salir de la ficha sin nada sonando: el botón se va y no queda vista previa', async () => {
    resolve = () => json(onlyIptv());
    enterMatch(testMatch(), { preview: true });
    await flush();
    expect(getPlayer().waitingAction).not.toBeNull();
    leaveSession();
    expect(getSession().preview).toBe(false);
    expect(getPlayer().waitingAction).toBeNull();
  });

  it('detener termina la vista previa y devuelve el sonido', async () => {
    await previewPlayingAce();
    playerStore.set((state) => ({ ...state, phase: 'idle', idleReason: 'detenido' }));
    expect(getSession()).toMatchObject({ preview: false, stopped: true });
    expect(getPlayer().muted).toBe(false);
  });

  it('el botón de una sesión ya acabada no arranca nada', async () => {
    resolve = () => json(onlyIptv());
    enterMatch(testMatch(), { preview: true });
    await flush();
    const action = getPlayer().waitingAction;
    endSession();
    action?.onAction();
    expect(played()).toEqual([]);
  });
});

describe('la vista previa solo termina por la persona y por este partido', () => {
  it('el silencio pedido antes de montar el reproductor no la termina (el runtime nuevo publica «sin silencio»)', async () => {
    // El reproductor aún se descarga: las órdenes quedan guardadas.
    resetPlayerApi();
    commands = [];
    enterMatch(testMatch(), { preview: true });
    await flush();
    scan = scanJob(['working', 'checking', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().muted).toBe(true);
    // Al montar, el constructor del runtime publica el `muted` del <video> antes de conectarse.
    playerStore.set((state) => ({ ...state, muted: false }));
    expect(getSession().preview).toBe(true);
    fakeRuntime();
    // Primero el silencio pendiente, luego el play guardado.
    expect(commands[0]).toEqual({ type: 'mute', muted: true });
    expect(played()).toEqual([hash(1)]);
    expect(getPlayer().muted).toBe(true);
    expect(getSession().preview).toBe(true);
    // Sigue siendo vista previa: si cae, no salta a la IPTV.
    expect(failNow().next).toBe(false);
    expect(played()).not.toContain(IPTV);
    // Y el silencio no se queda para siempre: al detener vuelve el sonido.
    playerStore.set((state) => ({ ...state, phase: 'idle', idleReason: 'detenido' }));
    expect(getPlayer().muted).toBe(false);
  });

  it('un cambio de silencio que no viene de la persona no la termina', async () => {
    await previewPlayingAce();
    playerStore.set((state) => ({ ...state, muted: false }));
    expect(getSession().preview).toBe(true);
  });

  it('entrar en otro partido no le quita el silencio a la AceStream del anterior; el botón va encima', async () => {
    await previewPlayingAce();
    started();
    const before = commands.length;
    resolve = () => json(onlyIptv());
    enterMatch(testMatch({ id: 'm2' }), { preview: true });
    await flush();
    expect(getSession()).toMatchObject({ key: 'm:m2', preview: true, phase: 'ready' });
    expect(commands.slice(before).some((c) => c.type === 'mute' && !c.muted)).toBe(false);
    expect(getPlayer().muted).toBe(true);
    expect(getPlayer().channel?.hash).toBe(hash(1));
    // Lo de antes sigue en el escenario: el botón de la IPTV de este partido se pinta encima.
    expect(getPlayer().waitingAction).toMatchObject({ label: PREVIEW_IPTV_LABEL, cover: true });

    // Pausar y reanudar lo de antes no es «ver este partido»: ni termina ni abre la IPTV.
    playerStore.set((state) => ({ ...state, phase: 'pausado', desiredPlaying: false }));
    notePlayerGesture('play');
    expect(getSession().preview).toBe(true);
    expect(played()).not.toContain(IPTV);

    // El botón grande sí: la IPTV del partido nuevo, con sonido.
    getPlayer().waitingAction?.onAction();
    expect(played().at(-1)).toBe(IPTV);
    expect(getPlayer().muted).toBe(false);
    expect(getSession().preview).toBe(false);
  });

  it('quitarle el silencio a lo del partido anterior no termina la del nuevo', async () => {
    await previewPlayingAce();
    started();
    resolve = () => json(onlyIptv());
    enterMatch(testMatch({ id: 'm2' }), { preview: true });
    await flush();
    userUnmutes();
    expect(getSession().preview).toBe(true);
    expect(getPlayer().muted).toBe(false);
    expect(played()).not.toContain(IPTV);
    // Y al ver la IPTV, nadie vuelve a silenciar nada.
    getPlayer().waitingAction?.onAction();
    expect(played().at(-1)).toBe(IPTV);
    expect(getPlayer().muted).toBe(false);
  });

  it('la AceStream silenciada que queda en el mini recupera el sonido cuando suena otra cosa', async () => {
    await previewPlayingAce();
    started();
    endSession();
    expect(getPlayer().muted).toBe(true);
    const channel = getPlayer().channel!;
    playerStore.set((state) => ({ ...state, channel: { ...channel, hash: hash(9) } }));
    expect(getPlayer().muted).toBe(false);
  });

  it('el partido siguiente en vista previa hereda cómo estaba el sonido', async () => {
    await previewPlayingAce();
    started();
    // Otro partido, sin la AceStream que suena (si la tuviera, ya sonaría y no habría vista previa).
    const other = withIptv();
    resolve = () =>
      json({ ...other, candidates: other.candidates.filter((c) => c.id !== hash(1)) });
    enterMatch(testMatch({ id: 'm2' }), { preview: true });
    await flush();
    scan = scanJob(['checking', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(getPlayer().muted).toBe(true);
    // Al terminar la del nuevo, el sonido vuelve como estaba antes de la primera.
    selectSource(hash(3));
    expect(getPlayer().muted).toBe(false);
  });

  it('tocar play mientras el partido se resuelve no la termina', async () => {
    let release: () => void = () => {};
    resolve = () =>
      new Promise<Response>((done) => {
        release = () => done(json(withIptv()));
      });
    enterMatch(testMatch(), { preview: true });
    await flush();
    expect(getSession().phase).toBe('resolving');
    notePlayerGesture('play');
    expect(getSession().preview).toBe(true);
    release();
    await flush();
    expect(played()).toEqual([]);
    scan = scanJob(['working', 'checking', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(played()).toEqual([hash(1)]);
    expect(getPlayer().muted).toBe(true);
  });
});

describe('fuera de la vista previa, como siempre', () => {
  it('escritorio: la IPTV arranca la primera, con sonido', async () => {
    enterMatch(testMatch());
    await flush();
    expect(getSession().preview).toBe(false);
    expect(played()).toEqual([IPTV]);
    expect(getPlayer().muted).toBe(false);
    expect(toasts()).toContain('Arrancando tu IPTV');
  });

  it('canal suelto: suena la IPTV primero, con sonido (aunque antes hubiera una vista previa)', async () => {
    await previewPlayingAce();
    setIptvActive(true);
    resolve = () =>
      json({
        ...resolution(0, { scan: null }),
        channels: ['DAZN 1'],
        checked: ['iptv', 'saved', 'favorites', 'history'],
        candidate: iptvCandidate({ title: 'DAZN 1 --> Casa', matchedChannel: 'DAZN 1' }),
        candidates: [iptvCandidate({ title: 'DAZN 1 --> Casa', matchedChannel: 'DAZN 1' })],
      });
    playChannel(vi.fn(), {
      hash: hash(7),
      title: 'DAZN 1',
      ih: false,
      record: true,
      origin: 'biblioteca',
    });
    await flush();
    expect(getSession()).toMatchObject({ kind: 'channel', preview: false });
    expect(getPlayer().channel?.hash).toBe(IPTV);
    expect(getPlayer().muted).toBe(false);
  });
});
