/* La IPTV en la sesión de fuentes (docs/iptv.md §7 y §8.4): arranca la
   primera, el puente IPTV ↔ AceStream (P16.6) con su aviso y «Volver a la
   IPTV», el tope de saltos, el motor caído, los canales sueltos preguntando
   con `scope=channel` y el partido sin canales. Sin red: fetch simulado con
   los mismos esquemas del contrato (el cliente valida en los tests). */

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
  notifySourceFailed,
  playerStore,
  resetPlayerApi,
  type PlayerCommand,
  type SourceFailure,
} from '../../player/api.ts';
import { fixture, json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { playChannel, resetPlayGuard } from '../library/play.ts';
import {
  BOTH_DOWN_TEXT,
  endSession,
  enterChannel,
  enterMatch,
  getSession,
  resetSessionForTests,
  selectSource,
} from './session.ts';
import { candidate, hash, JOB, resolution, scanJob, testMatch } from './test-utils.ts';

const flush = () => vi.advanceTimersByTimeAsync(0);
const toasts = () => toastStore.get().map((t) => t.text);

const IPTV = hash(100);
const IPTV_2 = hash(101);

function iptvCandidate(n = 100, extra: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return candidate(n, {
    title: 'M+ Liga de Campeones --> Casa',
    source: 'iptv',
    score: 100,
    listaId: 'p_Ab3dE5gH',
    iptv: { provider: 'Casa', quality: 'fhd', backup: false, guide: false },
    ...extra,
  });
}

/** Una IPTV primera (o dos) y `count` AceStream, con el comprobador solo para las AceStream. */
function withIptv(count = 3, iptvs: ResolutionCandidate[] = [iptvCandidate()]): Resolution {
  const base = resolution(count);
  return {
    ...base,
    checked: ['iptv', ...base.checked],
    candidate: iptvs[0] ?? null,
    candidates: [...iptvs, ...base.candidates],
  };
}

let scan = scanJob(['checking', 'checking', 'checking']);
let net: ReturnType<typeof mockFetch>;
let resolve: () => Response | Promise<Response> = () => json(withIptv());

function install(routes: Record<string, unknown> = {}) {
  net = mockFetch({
    'GET /api/v1/football/resolve': (call: MockCall) => resolveFor(call),
    [`GET /api/v1/football/scans/${JOB}`]: () => json(scan),
    ...(routes as Record<string, never>),
  });
}
const resolveFor = (_call: MockCall) => resolve();
const calls = (path: string): MockCall[] => net.calls.filter((call) => call.url.startsWith(path));

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

function setIptvActive(active: boolean) {
  const boot = fixture<BootstrapResponse>('bootstrap');
  queryClient.setQueryData(routeKey('bootstrap'), {
    ...boot,
    features: { ...boot.features, ...(active ? { iptv: true } : {}) },
  });
}

/** Entra al partido con la IPTV sonando y las AceStream ya comprobadas. */
async function iptvPlaying(states: Array<'working' | 'weak' | 'failed' | 'checking' | 'queued'>) {
  enterMatch(testMatch());
  await flush();
  expect(getPlayer().channel?.hash).toBe(IPTV);
  scan = scanJob(states);
  await vi.advanceTimersByTimeAsync(1500);
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

describe('IPTV primero (§7.1)', () => {
  it('arranca la IPTV sin esperar al comprobador y lo dice', async () => {
    enterMatch(testMatch());
    await flush();
    expect(getPlayer().channel).toMatchObject({
      hash: IPTV,
      iptv: true,
      title: 'M+ Liga de Campeones',
      subtitle: 'Fuente 1, Casa',
      source: 'Casa',
    });
    expect(getPlayer().origin).toBe('auto');
    expect(toasts()).toContain('Arrancando tu IPTV');
    // La IPTV nunca se pliega aunque el comprobador no la mire.
    expect(getSession().entries[0]).toMatchObject({ origin: 'iptv', autoTried: true });
  });

  it('una IPTV se reproduce sin apuntarla en Recientes', async () => {
    const commands: PlayerCommand[] = [];
    connectRuntime({ handle: (command) => commands.push(command) });
    enterMatch(testMatch());
    await flush();
    const play = commands.find((command) => command.type === 'play');
    expect(play).toMatchObject({
      channel: { hash: IPTV, iptv: true },
      options: { origin: 'auto', record: false },
    });
  });

  it('elegirla a mano: «Fuente 1 · IPTV · Casa», sin trozo de hash', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    selectSource(hash(2));
    selectSource(IPTV);
    expect(toasts()).toContain('Fuente 1 · IPTV · Casa');
    expect(getSession().manualChosen).toBe(true);
  });
});

describe('el puente (P16.6)', () => {
  it('cae la IPTV → la mejor AceStream verificada, con el aviso y «Volver a la IPTV»', async () => {
    await iptvPlaying(['failed', 'working', 'working']);
    const reply = failNow({ code: 'iptv_dropped' });
    expect(reply).toEqual({
      next: true,
      message: 'Tu IPTV no responde: seguimos por AceStream (fuente 3)',
    });
    expect(getPlayer().channel?.hash).toBe(hash(2));
    // El cartel de la IPTV dice por qué: «se cortó en el proveedor».
    expect(getSession().entries[0]?.playerVerdict).toMatchObject({
      state: 'failed',
      reason: 'iptv_dropped',
    });
    const back = toastStore.get().find((t) => t.text === 'Seguimos por AceStream');
    expect(back).toMatchObject({ tone: 'warn', icon: 'tv' });
    expect(back?.action?.label).toBe('Volver a la IPTV');
    back?.action?.onAction();
    expect(getPlayer().channel?.hash).toBe(IPTV);
    expect(getSession()).toMatchObject({ manualChosen: true, activeHash: IPTV });
  });

  it('con la conexión ocupada lo dice así', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    const reply = failNow({ code: 'iptv_busy' });
    expect(reply.message).toBe(
      'Tu IPTV tiene la conexión ocupada: seguimos por AceStream (fuente 2)',
    );
    // Ocupada es dudosa: «Floja», no «Sin señal».
    expect(getSession().entries[0]?.playerVerdict).toMatchObject({
      state: 'weak',
      reason: 'iptv_busy',
    });
  });

  it('en pausa o eliminada durante la reproducción: sin toast de volver', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    const reply = failNow({ code: 'iptv_disabled' });
    expect(reply.message).toBe('Tu IPTV está en pausa: seguimos por AceStream (fuente 2)');
    expect(toasts()).not.toContain('Seguimos por AceStream');
  });

  it('sin ninguna verificada todavía: espera a la primera que funcione', async () => {
    await iptvPlaying(['checking', 'checking', 'queued']);
    const reply = failNow({ code: 'iptv_timeout' });
    expect(reply).toEqual({
      next: false,
      message:
        'Tu IPTV no responde. Sigo comprobando las fuentes de AceStream y arranco la primera que funcione.',
    });
    expect(toasts()).toContain('Seguimos por AceStream');
    // El reproductor deja la IPTV en error (aquí no hay reproductor de verdad).
    playerStore.set((state) => ({ ...state, phase: 'error' }));
    scan = scanJob(['failed', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
  });

  it('cae una AceStream elegida a mano → pasa sola a la IPTV', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    selectSource(hash(1));
    // La IPTV se probó hace más de 60 s y no falló.
    await vi.advanceTimersByTimeAsync(61_000);
    const reply = failNow();
    expect(reply).toEqual({ next: true, message: 'Esta fuente no responde: pasamos a tu IPTV' });
    expect(getPlayer().channel?.hash).toBe(IPTV);
  });

  it('una IPTV probada hace menos de 60 s no recibe el salto', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    selectSource(hash(1));
    const reply = failNow();
    expect(reply.next).toBe(false);
    expect(reply.message).toContain('Tienes');
  });

  it('motor caído con una AceStream: a la IPTV; sin IPTV, que espere al motor', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    selectSource(hash(1));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(failNow({ code: 'engine_unavailable' })).toEqual({
      next: true,
      message: 'El motor AceStream no responde: pasamos a tu IPTV',
    });
    endSession();
    resolve = () => json(resolution(3));
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['working', 'working', 'working']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(failNow({ code: 'engine_unavailable' })).toEqual({ next: false, message: null });
  });

  it('un fallo de cuenta da por probadas todas las IPTV del proveedor', async () => {
    resolve = () => json(withIptv(3, [iptvCandidate(100), iptvCandidate(101)]));
    await iptvPlaying(['working', 'working', 'working']);
    failNow({ code: 'iptv_auth_failed' });
    expect(getPlayer().channel?.hash).toBe(hash(1));
    const second = getSession().entries.find((entry) => entry.id === IPTV_2);
    expect(second?.autoTried).toBe(true);
    // Cae la AceStream enseguida: ni a la otra IPTV (misma cuenta) ni vuelta a la primera.
    const reply = failNow();
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(reply.next).toBe(true);
  });

  it('tope: 2 saltos del puente cada 3 min; después, solo entre AceStream', async () => {
    resolve = () => json(withIptv(3, [iptvCandidate(100), iptvCandidate(101)]));
    await iptvPlaying(['working', 'working', 'working']);
    failNow({ code: 'iptv_dropped' }); // 1: IPTV → AceStream 1
    expect(getPlayer().channel?.hash).toBe(hash(1));
    failNow(); // 2: AceStream 1 → la otra IPTV
    expect(getPlayer().channel?.hash).toBe(IPTV_2);
    const reply = failNow({ code: 'iptv_dropped' }); // tope: ya no salta por el puente
    expect(getSession().bridgeJumps).toHaveLength(2);
    expect(reply.next).toBe(true);
    expect(reply.message).toBeNull();
    expect(getPlayer().channel?.hash).toBe(hash(2));
  });

  it('el toast se quita al cambiar de partido y su acción ya no hace nada', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    failNow({ code: 'iptv_dropped' });
    const back = toastStore.get().find((t) => t.text === 'Seguimos por AceStream');
    expect(back).toBeDefined();
    endSession();
    expect(toastStore.get().find((t) => t.id === back?.id)?.leaving).toBe(true);
    const before = getPlayer().channel?.hash;
    back?.action?.onAction();
    expect(getPlayer().channel?.hash).toBe(before);
  });

  it('a pantalla completa no hay toast: la línea de estado dice cómo volver', async () => {
    await iptvPlaying(['working', 'working', 'working']);
    noticeFlags.set({ watching: true, immersive: true });
    const reply = failNow({ code: 'iptv_dropped' });
    expect(reply.message).toBe(
      'Tu IPTV no responde: seguimos por AceStream (fuente 2). Para volver a la IPTV, toca su cartel.',
    );
    expect(toasts()).not.toContain('Seguimos por AceStream');
  });

  it('ni la IPTV ni AceStream: el texto final solo cuando no queda ninguna', async () => {
    await iptvPlaying(['failed', 'failed', 'failed']);
    const reply = failNow({ code: 'iptv_dropped' });
    expect(reply).toEqual({ next: false, message: BOTH_DOWN_TEXT });
    expect(getSession().failureText).toBe(BOTH_DOWN_TEXT);
  });
});

describe('canal suelto con IPTV (§8.4)', () => {
  const item = (n: number, title: string) => ({
    id: hash(n),
    title,
    type: 'web' as const,
    category: 'Deportes',
    date: '2026-09-23T18:30:00.000Z',
    fromWebSync: true,
    ih: false,
  });
  const channelIptv = () =>
    iptvCandidate(100, { title: 'DAZN 1 --> Casa', matchedChannel: 'DAZN 1' });

  function tap(navigate = vi.fn()) {
    playChannel(navigate, {
      hash: hash(1),
      title: 'DAZN 1',
      ih: false,
      record: true,
      origin: 'biblioteca',
    });
    return navigate;
  }

  beforeEach(() => {
    queryClient.setQueryData(routeKey('libraryGet'), {
      ...fixture('libraryGet'),
      web: [item(1, 'DAZN 1'), item(2, 'DAZN 1 FHD')],
      favorites: [],
      history: [],
    });
  });
  afterEach(() => queryClient.removeQueries({ queryKey: ['v1', 'libraryGet'] }));

  it('sin IPTV activa: exactamente lo de hoy (reproduce ya, sin preguntar)', async () => {
    setIptvActive(false);
    const navigate = tap();
    expect(getPlayer().channel?.hash).toBe(hash(1));
    expect(navigate).toHaveBeenCalledWith({ vista: 'partido', id: null, canal: hash(1) });
    await flush();
    expect(calls('/api/v1/football/resolve')).toHaveLength(0);
  });

  it('con IPTV activa pregunta con scope=channel y, si está, suena primero la IPTV', async () => {
    setIptvActive(true);
    resolve = () =>
      json({
        ...resolution(0, { scan: null }),
        channels: ['DAZN 1'],
        checked: ['iptv', 'saved', 'favorites', 'history'],
        candidate: channelIptv(),
        candidates: [channelIptv()],
      });
    const navigate = tap();
    // No arranca AceStream antes de saber si está en la IPTV.
    expect(getPlayer().channel).toBeNull();
    expect(navigate).toHaveBeenCalled();
    await flush();
    const [call] = calls('/api/v1/football/resolve');
    const query = new URLSearchParams(call!.url.split('?')[1]);
    expect(query.get('scope')).toBe('channel');
    expect(query.get('channel')).toBe('DAZN 1');
    expect(query.get('match')).toBeNull();
    expect(getSession()).toMatchObject({ kind: 'channel', iptvBridge: true, key: `c:${hash(1)}` });
    // IPTV, el que se tocó y sus hermanas.
    expect(getSession().entries.map((entry) => entry.id)).toEqual([IPTV, hash(1), hash(2)]);
    expect(getPlayer().channel).toMatchObject({ hash: IPTV, iptv: true, title: 'DAZN 1' });
    // La vista entra al canal después: no rehace nada.
    enterChannel({
      hash: hash(1),
      title: 'DAZN 1',
      siblings: [item(1, 'DAZN 1'), item(2, 'DAZN 1 FHD')],
      activeListId: null,
    });
    expect(getSession().iptvBridge).toBe(true);
    expect(calls('/api/v1/football/resolve')).toHaveLength(1);
    // Cae la IPTV sin ninguna verificada: el hash que se tocó.
    const reply = failNow({ code: 'iptv_dropped' });
    expect(reply).toEqual({ next: true, message: 'Tu IPTV no responde: seguimos por AceStream' });
    expect(getPlayer().channel?.hash).toBe(hash(1));
  });

  it('si no está en la IPTV (not_found) reproduce el que se tocó, como hoy', async () => {
    setIptvActive(true);
    resolve = () =>
      json({
        ...resolution(0, { scan: null }),
        status: 'not_found',
        candidate: null,
        candidates: [],
      });
    tap();
    await flush();
    expect(getPlayer().channel?.hash).toBe(hash(1));
    expect(getPlayer().channel?.iptv).toBeUndefined();
    expect(getSession()).toMatchObject({ iptvBridge: false, activeHash: hash(1) });
    expect(getSession().entries).toHaveLength(2);
  });

  it('si el servidor tarda más de 2,5 s, sigue como hoy', async () => {
    setIptvActive(true);
    resolve = () => new Promise<Response>(() => {});
    net.restore();
    net = mockFetch({
      'GET /api/v1/football/resolve': (call: MockCall) =>
        new Promise<Response>((_, reject) =>
          call.signal?.addEventListener('abort', () => reject(call.signal?.reason)),
        ),
    });
    tap();
    await vi.advanceTimersByTimeAsync(2_400);
    expect(getPlayer().channel).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(getPlayer().channel?.hash).toBe(hash(1));
  });

  it('«Pegar hash» no pregunta por la IPTV', async () => {
    setIptvActive(true);
    playChannel(vi.fn(), {
      hash: hash(7),
      title: 'Stream 00000000',
      ih: null,
      record: false,
      origin: 'pegado',
    });
    expect(getPlayer().channel?.hash).toBe(hash(7));
    await flush();
    expect(calls('/api/v1/football/resolve')).toHaveLength(0);
  });
});

describe('partido sin canales en la agenda (§4.5)', () => {
  it('con IPTV activa pregunta por la guía; si no hay nada, «El canal todavía no está anunciado»', async () => {
    setIptvActive(true);
    resolve = () =>
      json({
        ...resolution(0, { scan: null }),
        status: 'not_found',
        channels: [],
        candidate: null,
        candidates: [],
      });
    enterMatch(testMatch({ channels: [] }));
    await flush();
    expect(calls('/api/v1/football/resolve')).toHaveLength(1);
    expect(getSession()).toMatchObject({ phase: 'no_channels', resolverOpen: false });
    expect(toasts()).toContain('El canal todavía no está anunciado');
  });

  it('si la guía encuentra el canal, sigue como un partido normal', async () => {
    setIptvActive(true);
    resolve = () => json({ ...withIptv(0), channels: [], scan: null });
    enterMatch(testMatch({ channels: [] }));
    await flush();
    expect(getSession().phase).toBe('ready');
    expect(getPlayer().channel?.hash).toBe(IPTV);
  });

  it('sin IPTV activa no pregunta nada', async () => {
    setIptvActive(false);
    enterMatch(testMatch({ channels: [] }));
    await flush();
    expect(calls('/api/v1/football/resolve')).toHaveLength(0);
    expect(getSession().phase).toBe('no_channels');
  });
});
