/* El orquestador de la reproducción con un <video> simulado, motores
   simulados y un backend simulado (sin red): URL pedida al backend,
   precarga, primer fotograma real, vigilante, rebuffer, reconexiones con
   presupuesto y espera exponencial, paso de fuente, traspaso, cambio de
   modo del motor por SSE, latido, soltar la sesión y métricas. */

import { classifyCode, classifyWebEntry, PLAYBACK_PROFILES, type PlaybackMode } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { api } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import { resetMode, setMode } from '../api/mode.ts';
import { dispatchSse } from '../api/sse.ts';
import { clearWebLog, webLogSnapshot } from '../lib/web-log.ts';
import { mockFetch } from '../test/fetch.ts';
import { INITIAL_PLAYER_STATE, type PlayerState, type SourceFailure } from './api.ts';
import type { Platform } from './engines/index.ts';
import { mergePlayerState, PlayerRuntime } from './runtime.ts';
import { fakeEngines, FakeVideo, ranges } from './testing.ts';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const SID = 's_prueba1234';
const META = { id: '1', synthetic: false };
const DESKTOP: Platform = { ios: false, mse: true, nativeHls: false };
const IPHONE: Platform = { ios: true, mse: false, nativeHls: true };

type Input = {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};
type Handler = (input: Input) => unknown;

function grant(
  protocol: 'mpegts' | 'hls' | 'hls-fmp4' = 'mpegts',
  mode: PlaybackMode = 'balanced',
  sid = SID,
) {
  return {
    session: { id: sid, heartbeatMs: 15_000, expiresAfterMs: 45_000 },
    url:
      protocol === 'mpegts'
        ? `/ace/r/${HASH}/${sid}`
        : protocol === 'hls'
          ? `/ace/m/${HASH}/${sid}.m3u8`
          : `/remux/${HASH}/index.m3u8`,
    protocol,
    remux: protocol === 'hls-fmp4',
    codec: { video: 'h264', audio: 'aac', source: 'scanner' },
    latency: {
      mode,
      initialBufferS: PLAYBACK_PROFILES[mode].initial,
      rebuildS: PLAYBACK_PROFILES[mode].rebuild,
      liveSync: null,
    },
    stats: { via: 'sse' },
    handoff: false,
  };
}

const runtimes: PlayerRuntime[] = [];

function setup({
  platform = DESKTOP,
  lifecycle = null,
  mode = () => 'balanced' as PlaybackMode,
}: {
  platform?: Platform;
  lifecycle?: { window: Window; document: Document } | null;
  mode?: () => PlaybackMode;
} = {}) {
  const video = new FakeVideo();
  const engines = fakeEngines();
  const calls: Array<{ id: string; input: Input }> = [];
  // El latido devuelve la URL y el protocolo de la última concesión (como el backend).
  let current = grant();
  const handlers: Record<string, Handler> = {
    channelStream: (input) => {
      current = grant(
        IPHONE === platform || input.query?.client === 'ios' ? 'hls-fmp4' : 'mpegts',
        (input.query?.mode as PlaybackMode) ?? 'balanced',
      );
      return current;
    },
    sessionHeartbeat: () => ({
      session: current.session,
      url: current.url,
      protocol: current.protocol,
      viewers: 1,
    }),
    sessionRelease: () => ({ released: true, sessionClosed: true }),
    sourcesOutcome: () => ({ hash: null, proveedor: null }),
    diagnosticsReport: () => ({ accepted: true, id: 'diag_1' }),
    libraryMutate: () => ({}),
    playbackStatus: () => ({ nowPlaying: null, learningCount: 0, serverTime: 1, sessions: [] }),
  };
  const request = (async (id: string, input: Input = {}) => {
    calls.push({ id, input });
    const handler = handlers[id];
    if (!handler) throw new Error(`sin respuesta simulada para ${id}`);
    return handler(input);
  }) as unknown as typeof api;
  let state: PlayerState = INITIAL_PLAYER_STATE;
  const notices: string[] = [];
  const failures: SourceFailure[] = [];
  const beacons: Array<[string, string]> = [];
  /** Películas: las marcas de progreso mandadas y qué códecs «decodifica» el navegador. */
  const progress: Array<Record<string, unknown>> = [];
  const codecs = { supported: (_type: string) => true };
  const reply: { next: boolean; message: string | null } = { next: false, message: null };
  /** Lo que hace el oyente de onSourceFailed antes de contestar (p. ej. play() de la siguiente). */
  const hooks: { onFailed?: (failure: SourceFailure) => void } = {};
  const runtime = new PlayerRuntime({
    video,
    request,
    loadEngine: engines.loader,
    platform,
    isDemo: () => false,
    identity: () => ({ viewer: 'v_prueba', device: 'web_prueba' }),
    mode,
    notify: (text) => {
      notices.push(text);
    },
    sendBeacon: (url, body) => {
      beacons.push([url, body]);
      return true;
    },
    sourceFailed: (failure) => {
      failures.push(failure);
      hooks.onFailed?.(failure);
      return reply;
    },
    setState: (patch) => {
      state = mergePlayerState(state, patch);
    },
    setPresence: () => {},
    onLibrary: () => {},
    log: () => {},
    lifecycle,
    supportsType: (type) => codecs.supported(type),
    vodProgress: async (id, body, options) => {
      progress.push({ id, ...body, keepalive: options.keepalive === true });
    },
  });
  runtimes.push(runtime);
  return {
    video,
    engines,
    calls,
    handlers,
    runtime,
    notices,
    failures,
    beacons,
    progress,
    codecs,
    reply,
    hooks,
    get state() {
      return state;
    },
    callsTo: (id: string) => calls.filter((call) => call.id === id),
    outcomes: () =>
      calls
        .filter((call) => call.id === 'sourcesOutcome')
        .map((call) => call.input.body?.resultado),
  };
}

type Harness = ReturnType<typeof setup>;

const flush = () => vi.advanceTimersByTimeAsync(0);

/** Del motor enganchado al primer fotograma: señal, colchón y el cabezal avanza. */
async function reachFirstFrame(t: Harness, buffered: Array<[number, number]> = [[0, 7]]) {
  const engine = t.engines.last();
  engine.args.callbacks.onReady();
  const base = t.video.currentTime;
  t.video.setBuffered(buffered.map(([start, end]) => [start + base, end + base]));
  await vi.advanceTimersByTimeAsync(250);
  t.video.advance(0.1);
  await flush();
}

async function startPlaying(t: Harness, origin: 'user' | 'auto' = 'user') {
  t.runtime.play(
    { hash: HASH, title: 'M+ Liga de Campeones', source: 'Elcano', lead: 'Fuente 1 verificada.' },
    { origin },
  );
  await flush();
  await reachFirstFrame(t);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.destroy();
  vi.useRealTimers();
});

describe('arranque', () => {
  it('pide la URL al backend (client, modo, visor), engancha mpegts.js, precarga y arranca con el primer fotograma real', async () => {
    const t = setup();
    t.runtime.play({ hash: HASH, title: 'M+ Liga de Campeones', source: 'Elcano' });
    await flush();
    const stream = t.callsTo('channelStream')[0]!;
    expect(stream.input.params).toEqual({ id: HASH });
    expect(stream.input.query).toEqual({
      client: 'web',
      kind: 'auto',
      mode: 'balanced',
      viewer: 'v_prueba',
      device: 'web_prueba',
      title: 'M+ Liga de Campeones',
    });
    expect(t.callsTo('libraryMutate')[0]?.input.body).toEqual({
      action: 'history-upsert',
      item: { id: HASH, title: 'M+ Liga de Campeones', ih: false },
    });
    const engine = t.engines.last();
    expect(engine.kind).toBe('mpegts');
    expect(engine.args.url).toBe(`/ace/r/${HASH}/${SID}`);
    expect(engine.args.profile).toBe(PLAYBACK_PROFILES.balanced);
    expect(engine.started).toBe(true);
    expect(t.state).toMatchObject({ phase: 'cargando', conn: 'conectando', sessionId: SID });

    engine.args.callbacks.onReady();
    expect(t.state.conn).toBe('precarga');
    expect(t.state.message).toBe('Señal encontrada: cargando los primeros segundos…');
    t.video.setBuffered([[0, 3]]);
    await vi.advanceTimersByTimeAsync(250);
    expect(t.state.conn).toBe('precarga');
    t.video.setBuffered([[0, 6.2]]);
    await vi.advanceTimersByTimeAsync(250);
    expect(t.state.conn).toBe('arrancando');
    expect(t.video.playCalls).toBe(1);
    // P14: colchón lleno y play() pedido NO es «arrancó».
    expect(t.outcomes()).toEqual([]);

    t.video.advance(0.1);
    await flush();
    expect(t.state).toMatchObject({
      phase: 'reproduciendo',
      conn: 'activa',
      started: true,
      message: null,
    });
    expect(t.state.ttffMs).toBeGreaterThan(0);
    expect(t.outcomes()).toEqual(['arranco']);
    expect(t.callsTo('sourcesOutcome')[0]?.input.body).toMatchObject({
      id: HASH,
      resultado: 'arranco',
      segundos: 0,
      source: 'Elcano',
    });
  });

  it('una señal de lista pide kind=id (B-010); un hash pegado (record: false) no entra en Recientes (B-187)', async () => {
    const t = setup();
    t.runtime.play({ hash: HASH, title: 'DAZN 1', kind: 'id' });
    await flush();
    expect(t.callsTo('channelStream')[0]?.input.query).toMatchObject({ kind: 'id' });
    expect(t.callsTo('libraryMutate')).toHaveLength(1);
    t.runtime.play({ hash: OTHER, title: 'Stream b2c3d4e5', kind: 'auto' }, { record: false });
    await flush();
    expect(t.callsTo('channelStream')[1]?.input.query).toMatchObject({ kind: 'auto' });
    // Sigue habiendo UN solo history-upsert: el del canal de la lista.
    expect(t.callsTo('libraryMutate')).toHaveLength(1);
    expect(t.callsTo('libraryMutate')[0]?.input.body).toMatchObject({ item: { id: HASH } });
  });

  it('pedir otra vez el mismo canal no reinicia nada', async () => {
    const t = setup();
    await startPlaying(t);
    t.runtime.play({ hash: HASH, title: 'M+ Liga de Campeones', subtitle: 'Fuente 1, Elcano' });
    await flush();
    expect(t.callsTo('channelStream')).toHaveLength(1);
    expect(t.state.channel?.subtitle).toBe('Fuente 1, Elcano');
  });

  it('pasados 20 s basta con 1,5 s de colchón', async () => {
    const t = setup();
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    // Descargando a más de 50 KB/s el vigilante da 60 s (y no corta a los 30).
    dispatchSse(
      'stream.stats',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        status: 'dl',
        peers: 3,
        speedDown: 400,
        speedUp: 20,
        downloaded: null,
        at: new Date().toISOString(),
      },
      META,
    );
    t.engines.last().args.callbacks.onReady();
    t.video.setBuffered([[0, 1.6]]);
    await vi.advanceTimersByTimeAsync(19_750);
    expect(t.state.conn).toBe('precarga');
    await vi.advanceTimersByTimeAsync(500);
    expect(t.state.conn).toBe('arrancando');
  });

  it('sin señal suficiente a los 30 s, reconecta; bajando datos espera al tope de 55 s de mpegts.js', async () => {
    const t = setup();
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    t.engines.last().args.callbacks.onReady();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.state.conn).toBe('reconectando');
    expect(t.notices.at(-1)).toBe('Sin señal suficiente: reintentando (1/3)…');

    const u = setup();
    u.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    dispatchSse(
      'stream.stats',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        status: 'prebuf',
        peers: 2,
        speedDown: 120,
        speedUp: 5,
        downloaded: null,
        at: new Date().toISOString(),
      },
      META,
    );
    u.engines.last().args.callbacks.onReady();
    await vi.advanceTimersByTimeAsync(54_000);
    expect(u.state.conn).toBe('precarga');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(u.notices.at(-1)).toBe('La señal no termina de arrancar: reconectando (1/3)…');
  });

  it('iPhone: pide client=ios y usa el HLS nativo del remux sin precargar', async () => {
    const t = setup({ platform: IPHONE });
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    expect(t.callsTo('channelStream')[0]?.input.query?.client).toBe('ios');
    const engine = t.engines.last();
    expect(engine.kind).toBe('native');
    engine.args.callbacks.onReady();
    expect(t.state.conn).toBe('arrancando');
    expect(t.video.playCalls).toBe(1);
  });

  it('autoplay bloqueado: capa de toque, no cuenta como arranque ni como fallo; el toque arranca', async () => {
    const t = setup();
    t.video.playImpl = () =>
      Promise.reject(Object.assign(new Error('bloqueado'), { name: 'NotAllowedError' }));
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    t.engines.last().args.callbacks.onReady();
    t.video.setBuffered([[0, 7]]);
    await vi.advanceTimersByTimeAsync(250);
    expect(t.state.phase).toBe('bloqueado');
    await vi.advanceTimersByTimeAsync(90_000);
    expect(t.state.phase).toBe('bloqueado');
    expect(t.outcomes()).toEqual([]);
    expect(t.callsTo('diagnosticsReport')[0]?.input.body).toMatchObject({
      code: 'autoplay_blocked',
    });

    t.video.playImpl = null;
    await t.runtime.tapToPlay();
    t.video.advance(0.1);
    await flush();
    expect(t.state.phase).toBe('reproduciendo');
    expect(t.outcomes()).toEqual(['arranco']);
  });

  it('una respuesta tardía de un canal anterior se descarta (B-083)', async () => {
    const t = setup();
    let resolveFirst: () => void = () => {};
    t.handlers.channelStream = (input) =>
      input.params?.id === HASH
        ? new Promise((resolve) => {
            resolveFirst = () => resolve(grant());
          })
        : grant('mpegts', 'balanced', 's_segunda123');
    t.runtime.play({ hash: HASH, title: 'Primero' });
    await flush();
    t.runtime.play({ hash: OTHER, title: 'Segundo' });
    await flush();
    expect(t.engines.created).toHaveLength(1);
    resolveFirst();
    await flush();
    expect(t.engines.created).toHaveLength(1);
    expect(t.state.channel?.hash).toBe(OTHER);
    expect(t.state.sessionId).toBe('s_segunda123');
  });
});

describe('vigilante y rebuffer', () => {
  it('rebuffer: retiene, avisa una vez, NUNCA salta al directo y reanuda con el colchón del perfil', async () => {
    const t = setup();
    await startPlaying(t);
    t.video._currentTime = 5;
    t.video.setBuffered([[0, 5.5]]);
    t.video.stall();
    expect(t.state.phase).toBe('buffer');
    expect(t.state.rebuffering).toEqual({ targetS: 8 });
    expect(t.video.paused).toBe(true);
    expect(t.notices.filter((n) => n.startsWith('Señal irregular'))).toHaveLength(1);

    t.video.setBuffered([[0, 13.2]]);
    await vi.advanceTimersByTimeAsync(250);
    expect(t.state.phase).toBe('reproduciendo');
    expect(t.video.paused).toBe(false);
    expect(t.video.currentTime).toBe(5);

    // Otro bache a los pocos segundos: sin segundo aviso (uno por canal cada 60 s).
    t.video.setBuffered([[0, 5.3]]);
    t.video.stall();
    expect(t.notices.filter((n) => n.startsWith('Señal irregular'))).toHaveLength(1);
  });

  it('imagen parada 4,5 s (3 tics) → rebuffer; 45 s sin colchón → reconexión', async () => {
    const t = setup();
    await startPlaying(t);
    t.video.setBuffered([[0, 0.3]]);
    await vi.advanceTimersByTimeAsync(4_500);
    expect(t.state.phase).toBe('buffer');
    await vi.advanceTimersByTimeAsync(45_000);
    expect(t.state.conn).toBe('reconectando');
    expect(t.notices.at(-1)).toBe('La señal no se recupera: reconectando (1/3)…');
  });

  it('Safari/iOS con la imagen parada y vídeo por delante: salta al directo en vez de reiniciar; si sigue parada, reconecta', async () => {
    const t = setup({ platform: IPHONE });
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    t.engines.last().args.callbacks.onReady();
    t.video.advance(0.1);
    await flush();
    expect(t.state.conn).toBe('activa');
    t.video.seekable = ranges([[0, 30]]);
    t.video._currentTime = 10;
    // El primer tic ve avanzar el cabezal (0,1 → 10); luego 4 tics (6 s)
    // parado con 12,5 s por detrás del borde útil → salto.
    await vi.advanceTimersByTimeAsync(1_500 + 6_000);
    expect(t.video.currentTime).toBe(22.5);
    t.video.finishSeek();
    await flush();
    await vi.advanceTimersByTimeAsync(1_500 * 17);
    expect(t.notices.at(-1)).toBe('La imagen se ha quedado parada: reconectando (1/3)…');
  });

  it('cada 2 min con la imagen avanzando, «sigue» al backend', async () => {
    const t = setup();
    await startPlaying(t);
    const mover = setInterval(() => t.video.advance(1.5), 1_500);
    await vi.advanceTimersByTimeAsync(121_500);
    clearInterval(mover);
    expect(t.outcomes()).toEqual(['arranco', 'sigue']);
  });

  it('vuelta a primer plano sin datos: reconecta con el presupuesto entero', async () => {
    const t = setup();
    await startPlaying(t);
    t.video.readyState = 1;
    t.runtime.onForeground();
    expect(t.state.conn).toBe('reconectando');
    expect(t.notices.at(-1)).toBe('Reconectando al volver a la app (1/3)…');
  });
});

describe('reconexiones y paso de fuente', () => {
  it('espera exponencial 1-2-4 s; la primera reutiliza la sesión, las siguientes piden otra; agotadas → cayo y onSourceFailed', async () => {
    const t = setup();
    t.reply.message =
      'Esta señal no responde. Tienes 4 fuentes para este canal: prueba otra en el selector.';
    await startPlaying(t);
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.state).toMatchObject({ conn: 'reconectando', attempt: { n: 1, max: 3 } });
    expect(t.notices.at(-1)).toBe('La señal se ha cortado: reconectando (1/3)…');
    expect(t.engines.created[0]?.destroyed).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(t.callsTo('channelStream')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.callsTo('channelStream')).toHaveLength(2);
    expect(t.callsTo('sessionRelease')).toHaveLength(0);

    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(t.callsTo('channelStream')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.callsTo('sessionRelease')[0]?.input.body).toEqual({
      viewer: 'v_prueba',
      reason: 'error',
    });
    expect(t.callsTo('channelStream')).toHaveLength(3);

    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(t.callsTo('channelStream')).toHaveLength(4);
    // B-008: una reconexión no vuelve a apuntar el canal en Recientes.
    expect(t.callsTo('libraryMutate')).toHaveLength(1);

    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.state.phase).toBe('error');
    expect(t.state.message).toBe(t.reply.message);
    expect(t.failures).toHaveLength(1);
    expect(t.failures[0]).toMatchObject({
      outcome: 'cayo',
      origin: 'user',
      reason: 'La señal se ha cortado: reconectando',
    });
    expect(t.outcomes()).toEqual(['arranco', 'cayo']);
    expect(t.callsTo('diagnosticsReport').at(-1)?.input.body).toMatchObject({
      cause: 'source',
      code: 'player_source_failed',
      hash: HASH,
      metrics: { reconnects: 3 },
    });
  });

  it('arranque automático: 1 reconexión antes de la primera imagen y la fuente se da por fallida (fallo)', async () => {
    const t = setup();
    t.reply.next = true;
    t.runtime.play({ hash: HASH, title: 'Canal' }, { origin: 'auto' });
    await flush();
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.state.attempt).toEqual({ n: 1, max: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.failures[0]).toMatchObject({ outcome: 'fallo', seconds: 0, origin: 'auto' });
    expect(t.outcomes()).toEqual(['fallo']);
    expect(t.state.message).toBe('Esta fuente no responde: probando la siguiente…');
  });

  it('paso de fuente dentro del propio aviso (como hará el centro de partido): la siguiente arranca limpia', async () => {
    const t = setup();
    // El oyente llama a play() con la siguiente verificada ANTES de contestar.
    t.reply.next = true;
    t.hooks.onFailed = () =>
      t.runtime.play({ hash: OTHER, title: 'Canal', source: 'Faro' }, { origin: 'auto' });
    t.runtime.play({ hash: HASH, title: 'Canal', source: 'Elcano' }, { origin: 'auto' });
    await flush();
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    await vi.advanceTimersByTimeAsync(1_000);
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.failures).toHaveLength(1);
    // La nueva fuente manda: conectando, sin «fallo» heredado y con el porqué en el panel.
    expect(t.state).toMatchObject({
      phase: 'cargando',
      conn: 'pidiendo',
      idleReason: null,
      attempt: null,
      channel: { hash: OTHER },
      message: 'Esta fuente no responde: probando la siguiente…',
    });
    await flush();
    expect(t.callsTo('channelStream').at(-1)?.input.params).toEqual({ id: OTHER });
    await reachFirstFrame(t);
    expect(t.state.phase).toBe('reproduciendo');
    // Cada fuente con su resultado: la primera «fallo», la segunda «arranco».
    expect(t.outcomes()).toEqual(['fallo', 'arranco']);
  });

  it('P4: una señal que da un segundo de imagen entre cortes ya no reconecta sin fin', async () => {
    const t = setup();
    await startPlaying(t);
    for (let cut = 1; cut <= 3; cut += 1) {
      t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
      expect(t.state.attempt?.n).toBe(cut);
      await vi.advanceTimersByTimeAsync(4_000);
      await reachFirstFrame(t);
      expect(t.state.phase).toBe('reproduciendo');
    }
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.state.phase).toBe('error');
    expect(t.failures).toHaveLength(1);
  });

  it('P4: un corte de vez en cuando no agota la fuente (la ventana olvida los de hace más de 3 min)', async () => {
    const t = setup();
    await startPlaying(t);
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    await vi.advanceTimersByTimeAsync(1_000);
    await reachFirstFrame(t);
    t.runtime.pause();
    await vi.advanceTimersByTimeAsync(181_000);
    await t.runtime.resume();
    t.engines.last().args.callbacks.onFatal('La señal se ha cortado: reconectando');
    expect(t.state.attempt).toEqual({ n: 1, max: 3 });
  });

  it('errores tipados: remux_busy se enseña tal cual, sin reintentar ni saltar de fuente (P10)', async () => {
    const t = setup();
    const message =
      'Hay demasiados vídeos preparándose para iPhone a la vez. Cierra alguno y reintenta.';
    t.handlers.channelStream = () => {
      throw new ApiError({ code: 'remux_busy', status: 503, message });
    };
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    expect(t.state).toMatchObject({ phase: 'error', message });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.callsTo('channelStream')).toHaveLength(1);
    expect(t.failures).toHaveLength(0);
  });

  it('sin pares (504) sí es de la fuente: reconecta', async () => {
    const t = setup();
    t.handlers.channelStream = () => {
      throw new ApiError({
        code: 'source_no_peers',
        status: 504,
        message: 'Esta señal no tiene pares ahora mismo. Prueba otra fuente.',
      });
    };
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    expect(t.state.conn).toBe('reconectando');
    expect(t.notices.at(-1)).toBe(
      'Esta señal no tiene pares ahora mismo. Prueba otra fuente. (1/3)…',
    );
  });

  it('motor apagado: espera y, cuando vuelve, se reengancha solo (P13)', async () => {
    const t = setup();
    t.handlers.channelStream = () => {
      throw new ApiError({
        code: 'engine_unavailable',
        status: 503,
        message: 'El motor AceStream no responde.',
      });
    };
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    expect(t.state).toMatchObject({ phase: 'error', idleReason: 'sin-motor' });
    t.handlers.channelStream = () => grant();
    dispatchSse(
      'engine.status',
      {
        status: 'online',
        online: true,
        since: '2026-09-23T18:30:00.000Z',
        checkedAt: '2026-09-23T18:30:00.000Z',
        engineVersion: '3.2.3',
        autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
      } as never,
      META,
    );
    await flush();
    expect(t.callsTo('channelStream')).toHaveLength(2);
    expect(t.state.conn).toBe('conectando');
    // B-013: lo dice con el nombre del canal.
    expect(t.notices).toContain('Motor de vuelta: reconectando «Canal»…');
  });

  it('detener mientras espera al motor olvida el canal: cuando vuelve, no se reengancha (B-013)', async () => {
    const t = setup();
    t.handlers.channelStream = () => {
      throw new ApiError({
        code: 'engine_unavailable',
        status: 503,
        message: 'El motor AceStream no responde.',
      });
    };
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    expect(t.state.idleReason).toBe('sin-motor');
    t.runtime.stop();
    t.handlers.channelStream = () => grant();
    dispatchSse(
      'engine.status',
      {
        status: 'online',
        online: true,
        since: '2026-09-23T18:30:00.000Z',
        checkedAt: '2026-09-23T18:30:00.000Z',
        engineVersion: '3.2.3',
        autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
      } as never,
      META,
    );
    await flush();
    expect(t.callsTo('channelStream')).toHaveLength(1);
    expect(t.notices.some((n) => n.startsWith('Motor de vuelta'))).toBe(false);
  });
});

describe('sesión, traspaso y tiempo real', () => {
  it('latido cada 15 s con el estado; detener suelta la sesión y manda las métricas', async () => {
    const t = setup();
    await startPlaying(t);
    const mover = setInterval(() => t.video.advance(1.5), 1_500);
    await vi.advanceTimersByTimeAsync(15_000);
    clearInterval(mover);
    expect(t.callsTo('sessionHeartbeat')[0]?.input).toMatchObject({
      params: { sid: SID },
      body: { viewer: 'v_prueba', playing: true },
    });
    t.runtime.stop();
    expect(t.callsTo('sessionRelease')[0]?.input.body).toEqual({
      viewer: 'v_prueba',
      reason: 'user',
    });
    expect(t.state).toMatchObject({
      phase: 'idle',
      idleReason: 'detenido',
      message: 'Reproducción detenida. Elige otro partido o canal.',
    });
    expect(t.engines.last().destroyed).toBe(true);
    const report = t.callsTo('diagnosticsReport').at(-1)?.input.body;
    expect(report).toMatchObject({ cause: 'client', code: 'player_session', hash: HASH });
    expect((report?.metrics as { timeToFirstFrameMs?: number }).timeToFirstFrameMs).toBeGreaterThan(
      0,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.callsTo('sessionHeartbeat')).toHaveLength(1);
  });

  it('al cerrar la página suelta la sesión con sendBeacon y manda las métricas (una sola vez)', async () => {
    const t = setup({ lifecycle: { window, document } });
    await startPlaying(t);
    window.dispatchEvent(new Event('pagehide'));
    expect(t.beacons).toEqual([
      [
        `/api/v1/sessions/${SID}/release`,
        JSON.stringify({ viewer: 'v_prueba', reason: 'pagehide' }),
      ],
    ]);
    const reports = () =>
      t.callsTo('diagnosticsReport').filter((call) => call.input.body?.code === 'player_session');
    expect(reports()).toHaveLength(1);
    expect(reports()[0]?.input).toMatchObject({
      keepalive: true,
      body: { metrics: { timeToFirstFrameMs: expect.any(Number), rebuffers: 0, reconnects: 0 } },
    });
    // El desmontaje de después no la cuenta otra vez.
    t.runtime.destroy();
    expect(reports()).toHaveLength(1);
  });

  it('traspaso por SSE: se para al momento, sin soltar la sesión (ya lo hizo el backend) y lo dice', async () => {
    const t = setup();
    await startPlaying(t);
    dispatchSse(
      'playback.handoff',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        byDeviceId: 'dev_iphone01',
        byClient: 'ios',
        hash: HASH,
        title: 'M+',
        reason: 'other_channel',
      },
      META,
    );
    expect(t.state).toMatchObject({
      phase: 'idle',
      idleReason: 'traspasado',
      message: 'La reproducción ha pasado a otro dispositivo.',
    });
    expect(t.notices).toContain('La reproducción ha pasado a otro dispositivo');
    expect(t.callsTo('sessionRelease')).toHaveLength(0);
    expect(t.outcomes()).toEqual(['arranco']);
  });

  it('un traspaso para otro visor no le afecta', async () => {
    const t = setup();
    await startPlaying(t);
    dispatchSse(
      'playback.handoff',
      {
        sessionId: 's_otrasesion1',
        viewerIds: ['v_otro'],
        byDeviceId: null,
        byClient: 'web',
        hash: OTHER,
        title: 'x',
        reason: 'same_channel',
      },
      META,
    );
    expect(t.state.phase).toBe('reproduciendo');
  });

  it('sin SSE, el latido descubre el traspaso (410 y el mando es de otro dispositivo)', async () => {
    const t = setup();
    await startPlaying(t);
    t.handlers.sessionHeartbeat = () => {
      throw new ApiError({ code: 'session_expired', status: 410 });
    };
    t.handlers.playbackStatus = () => ({
      nowPlaying: { id: OTHER, title: 'Otro', dev: 'web_otro', token: 't', at: 2 },
      learningCount: 0,
      serverTime: 1,
      sessions: [],
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(t.state.idleReason).toBe('traspasado');
  });

  it('stream.modeChanged: pasa a hls.js sin que la persona haga nada y sin otro «arranco»', async () => {
    const t = setup();
    await startPlaying(t);
    dispatchSse(
      'stream.modeChanged',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        from: 'mpegts',
        to: 'hls',
        url: `/ace/m/${HASH}/${SID}.m3u8`,
        reason: 'shared',
      },
      META,
    );
    await flush();
    const engine = t.engines.last();
    expect(engine.kind).toBe('hls');
    expect(engine.args.url).toBe(`/ace/m/${HASH}/${SID}.m3u8`);
    expect(t.notices).toContain('Otro dispositivo se ha unido: pasando a HLS…');
    expect(t.state.conn).toBe('conectando');
    await reachFirstFrame(t);
    expect(t.state.phase).toBe('reproduciendo');
    expect(t.state.protocol).toBe('hls');
    expect(t.outcomes()).toEqual(['arranco']);
    expect(t.callsTo('channelStream')).toHaveLength(1);
  });

  it('stream.reopened tras reiniciar el motor: se reengancha a la URL nueva', async () => {
    const t = setup();
    await startPlaying(t);
    dispatchSse(
      'stream.reopened',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        url: `/ace/r/${HASH}/nueva`,
        protocol: 'mpegts',
        reason: 'engine_restart',
      },
      META,
    );
    await flush();
    expect(t.engines.last().args.url).toBe(`/ace/r/${HASH}/nueva`);
    expect(t.notices).toContain('El motor se ha reiniciado: reenganchando la señal…');
  });

  it('stream.stats llega al panel técnico', async () => {
    const t = setup();
    await startPlaying(t);
    dispatchSse(
      'stream.stats',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        status: 'dl',
        peers: 48,
        speedDown: 1966,
        speedUp: 214,
        downloaded: 1000,
        at: '2026-09-23T18:30:00.000Z',
      },
      META,
    );
    expect(t.state.stats).toMatchObject({ peers: 48, speedDown: 1966, speedUp: 214 });
  });

  it('cambiar de modo reengancha con el perfil nuevo; en iPhone no (P11)', async () => {
    let mode: PlaybackMode = 'balanced';
    const t = setup({ mode: () => mode });
    await startPlaying(t);
    mode = 'low';
    t.runtime.handle({ type: 'mode', mode: 'low' });
    await flush();
    expect(t.callsTo('channelStream')[1]?.input.query?.mode).toBe('low');
    expect(t.engines.last().args.profile).toBe(PLAYBACK_PROFILES.low);

    const ios = setup({ platform: IPHONE, mode: () => mode });
    ios.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    ios.engines.last().args.callbacks.onReady();
    ios.video.advance(0.1);
    await flush();
    ios.runtime.handle({ type: 'mode', mode: 'stable' });
    await flush();
    expect(ios.callsTo('channelStream')).toHaveLength(1);
  });
});

describe('directo y −30 s', () => {
  it('DIRECTO por detrás salta al borde útil (con colchón) y lo dice; en el borde no salta', async () => {
    const t = setup();
    await startPlaying(t);
    t.video.seekable = ranges([[0, 60]]);
    t.video._currentTime = 20;
    const pending = t.runtime.goLive();
    // Ventana de 60 s: colchón min(8, max(1,2; 15)) = 8 → borde útil 52.
    expect(t.video.currentTime).toBe(52);
    t.video.finishSeek();
    await pending;
    expect(t.notices.at(-1)).toBe('De vuelta al directo');

    await t.runtime.goLive();
    expect(t.video.currentTime).toBe(52);
    expect(t.notices.at(-1)).toBe('Ya estabas en el directo');
  });

  it('−30 s dentro de lo guardado, sin pasarse, y deja de seguir el directo', async () => {
    const t = setup();
    await startPlaying(t);
    t.video.seekable = ranges([[0, 60]]);
    t.video._currentTime = 50;
    const pending = t.runtime.back();
    expect(t.video.currentTime).toBe(20);
    t.video.finishSeek();
    await pending;
    expect(t.notices.at(-1)).toBe('Retrocedido 30 s · pulsa DIRECTO para volver');
    expect(t.runtime.controller.state.followingLiveEdge).toBe(false);

    t.video.seekable = ranges([[19.5, 60]]);
    await t.runtime.back();
    expect(t.notices.at(-1)).toBe('No hay más imagen guardada hacia atrás');
  });
});

describe('con el cliente de la API de verdad', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetMode();
    setMode('live', 'bootstrap');
  });
  afterEach(() => {
    resetMode();
  });

  it('GET /api/v1/channels/:id/stream con la query de §6.3 y una respuesta que cumple el contrato', async () => {
    const net = mockFetch({
      [`GET /api/v1/channels/${HASH}/stream`]: grant(),
      'POST /api/v1/library': {
        web: [],
        webSyncedAt: null,
        webSources: [],
        activeWebSourceId: null,
        favorites: [],
        history: [],
      },
    });
    const video = new FakeVideo();
    const engines = fakeEngines();
    const runtime = new PlayerRuntime({
      video,
      loadEngine: engines.loader,
      platform: DESKTOP,
      isDemo: () => false,
      identity: () => ({ viewer: 'v_prueba', device: 'web_prueba' }),
      mode: () => 'stable',
      notify: () => {},
      setState: () => {},
      setPresence: () => {},
      onLibrary: () => {},
      log: () => {},
      lifecycle: null,
    });
    runtimes.push(runtime);
    runtime.play({ hash: HASH, title: 'M+ LaLiga' });
    await vi.waitFor(() => expect(engines.created).toHaveLength(1));
    const call = net.calls.find((c) => c.url.includes('/stream'))!;
    const url = new URL(call.url, 'http://x');
    expect(url.pathname).toBe(`/api/v1/channels/${HASH}/stream`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client: 'web',
      kind: 'auto',
      mode: 'stable',
      viewer: 'v_prueba',
      device: 'web_prueba',
      title: 'M+ LaLiga',
    });
    net.restore();
  });
});

/* IPTV (docs/iptv.md §7.2 y §8.3): la concesión trae `source: 'iptv'` y
   `protocol: 'hls'` (hls.js sobre el remux del servidor). Sus fallos agotan
   la fuente al momento: el servidor ya reintentó y el puente pasa a AceStream. */
describe('IPTV', () => {
  const IPTV_ID = 'd4e5f60718293a4b5c6d7e8f9012345601a2b3c4';
  const IPTV_SID = 's_Q2FuYWxEZVBydWViYQ';

  function iptvGrant() {
    return {
      ...grant('hls', 'balanced', IPTV_SID),
      url: `/api/v1/video/${IPTV_SID}/index.m3u8`,
      remux: true,
      codec: { video: 'h264', audio: 'aac', source: 'ffprobe' },
      source: 'iptv' as const,
    };
  }

  function iptvSetup() {
    const t = setup();
    t.handlers.channelStream = () => iptvGrant();
    return t;
  }

  const playIptv = (t: Harness, origin: 'user' | 'auto' = 'auto') =>
    t.runtime.play({ hash: IPTV_ID, title: 'DAZN LaLiga', source: 'Casa', iptv: true }, { origin });

  it('«Conectando con tu IPTV…», hls.js sobre /api/v1/video sin token y la fuente en el estado', async () => {
    const t = iptvSetup();
    playIptv(t);
    expect(t.state.message).toBe('Conectando con tu IPTV…');
    await flush();
    const engine = t.engines.last();
    expect(engine.kind).toBe('hls');
    expect(engine.args.url).toBe(`/api/v1/video/${IPTV_SID}/index.m3u8`);
    expect(t.state).toMatchObject({ protocol: 'hls', streamSource: 'iptv' });
  });

  it('un iptv_* al abrir agota la fuente al momento, sin reconexiones', async () => {
    const t = iptvSetup();
    t.handlers.channelStream = () => {
      throw new ApiError({
        code: 'iptv_timeout',
        status: 504,
        message: 'Tu IPTV no respondió a tiempo.',
      });
    };
    playIptv(t, 'user');
    await flush();
    expect(t.failures).toHaveLength(1);
    expect(t.failures[0]).toMatchObject({ outcome: 'fallo', code: 'iptv_timeout' });
    expect(t.callsTo('channelStream')).toHaveLength(1);
    // Sin alternativa: «Tu IPTV no da señal ahora mismo.»
    expect(t.state).toMatchObject({ phase: 'error', message: 'Tu IPTV no da señal ahora mismo.' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.callsTo('channelStream')).toHaveLength(1);
  });

  it('remux_busy o ffmpeg_missing con la fuente IPTV son fallo de fuente, no de sistema', async () => {
    const t = iptvSetup();
    t.handlers.channelStream = () => {
      throw new ApiError({ code: 'remux_busy', status: 503, message: 'Hay demasiados vídeos…' });
    };
    t.reply.next = true;
    t.reply.message = 'Tu IPTV no responde: seguimos por AceStream (fuente 2)';
    playIptv(t);
    await flush();
    expect(t.failures).toHaveLength(1);
    expect(t.failures[0]?.code).toBe('remux_busy');
    expect(t.state.message).toBe('Tu IPTV no responde: seguimos por AceStream (fuente 2)');
    expect(t.notices.at(-1)).toBe('Tu IPTV no responde: seguimos por AceStream (fuente 2)');
  });

  it('stream.closed con un iptv_* agota ya (sin las 3 reconexiones)', async () => {
    const t = iptvSetup();
    playIptv(t, 'user');
    await flush();
    await reachFirstFrame(t);
    expect(t.state.phase).toBe('reproduciendo');
    dispatchSse(
      'stream.closed',
      {
        sessionId: IPTV_SID,
        viewerIds: ['v_prueba'],
        reason: 'remux_failed',
        code: 'iptv_dropped',
      },
      META,
    );
    await flush();
    expect(t.failures).toHaveLength(1);
    expect(t.failures[0]).toMatchObject({ outcome: 'cayo', code: 'iptv_dropped' });
    expect(t.callsTo('channelStream')).toHaveLength(1);
  });

  it('un remux_died que gana la carrera a iptv_dropped también agota ya', async () => {
    const t = iptvSetup();
    playIptv(t, 'user');
    await flush();
    await reachFirstFrame(t);
    dispatchSse(
      'stream.closed',
      { sessionId: IPTV_SID, viewerIds: ['v_prueba'], reason: 'remux_failed', code: 'remux_died' },
      META,
    );
    await flush();
    expect(t.failures).toHaveLength(1);
    expect(t.failures[0]?.code).toBe('remux_died');
  });

  it('stream.reopened remux_restart: se reengancha a la URL nueva sin contarlo como fallo', async () => {
    const t = iptvSetup();
    playIptv(t, 'user');
    await flush();
    await reachFirstFrame(t);
    dispatchSse(
      'stream.reopened',
      {
        sessionId: IPTV_SID,
        viewerIds: ['v_prueba'],
        url: `/api/v1/video/${IPTV_SID}/index.m3u8?r=2`,
        protocol: 'hls',
        reason: 'remux_restart',
      },
      META,
    );
    await flush();
    expect(t.engines.last().args.url).toBe(`/api/v1/video/${IPTV_SID}/index.m3u8?r=2`);
    expect(t.notices).toContain('Tu IPTV se ha reconectado: reenganchando la señal…');
    expect(t.failures).toHaveLength(0);
  });

  it('no apunta en Recientes si la sesión lo pide (record: false)', async () => {
    const t = iptvSetup();
    t.runtime.play(
      { hash: IPTV_ID, title: 'DAZN LaLiga', iptv: true },
      { origin: 'auto', record: false },
    );
    await flush();
    expect(t.callsTo('libraryMutate')).toHaveLength(0);
  });

  it('motor caído con una AceStream: pregunta si hay IPTV; si la sesión salta, no espera al motor', async () => {
    const t = setup();
    t.handlers.channelStream = (input) => {
      if (input.params?.id === IPTV_ID) return iptvGrant();
      throw new ApiError({
        code: 'engine_unavailable',
        status: 503,
        message: 'El motor AceStream no responde.',
      });
    };
    t.reply.next = true;
    t.reply.message = 'El motor AceStream no responde: pasamos a tu IPTV';
    t.hooks.onFailed = () =>
      t.runtime.play({ hash: IPTV_ID, title: 'DAZN LaLiga', iptv: true }, { origin: 'auto' });
    t.runtime.play({ hash: HASH, title: 'DAZN LaLiga' });
    await flush();
    expect(t.failures[0]).toMatchObject({ code: 'engine_unavailable' });
    expect(t.state.channel?.hash).toBe(IPTV_ID);
    expect(t.state.idleReason).toBeNull();
    expect(t.state.message).toBe('El motor AceStream no responde: pasamos a tu IPTV');
  });

  it('motor caído sin IPTV a la que pasar: espera al motor como siempre', async () => {
    const t = setup();
    t.handlers.channelStream = () => {
      throw new ApiError({
        code: 'engine_unavailable',
        status: 503,
        message: 'El motor AceStream no responde.',
      });
    };
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    expect(t.failures).toHaveLength(1);
    expect(t.state).toMatchObject({ phase: 'error', idleReason: 'sin-motor' });
  });

  /* ---- 0.8.2: retención, DIRECTO y recuperación en el sitio (C2 y C3) ---- */

  /** IPTV sonando: cabezal en 10 s y 7 s cargados por delante. */
  async function iptvPlaying(t: Harness) {
    playIptv(t, 'user');
    await flush();
    const engine = t.engines.last();
    engine.args.callbacks.onReady();
    t.video._currentTime = 10;
    t.video.setBuffered([[0, 17]]);
    await vi.advanceTimersByTimeAsync(250);
    t.video.advance(0.1);
    await flush();
    expect(t.state.conn).toBe('activa');
    return engine;
  }

  const reopened = (extra: Record<string, unknown> = {}) =>
    dispatchSse(
      'stream.reopened',
      {
        sessionId: IPTV_SID,
        viewerIds: ['v_prueba'],
        url: `/api/v1/video/${IPTV_SID}/index.m3u8`,
        protocol: 'hls',
        reason: 'remux_restart',
        ...extra,
      },
      META,
    );

  it('C2 · hls.js: un `waiting` no pausa en 1,5 s si el cabezal se mueve (E2)', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    t.video.setBuffered([[0, 10.2]]);
    t.video.stall();
    // La rueda sale ya, pero sin pausar: hls.js tiene su margen.
    expect(t.video.paused).toBe(false);
    expect(t.state.rebuffering).toBeNull();
    await vi.advanceTimersByTimeAsync(800);
    t.video.advance(0.4);
    await vi.advanceTimersByTimeAsync(700);
    expect(t.video.paused).toBe(false);
    expect(t.state.rebuffering).toBeNull();
  });

  it('C2 · hls.js: con el cabezal quieto 1,5 s, entonces sí retiene; con datos (readyState ≥ 3) ni lo mira', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    t.video.readyState = 4;
    t.video.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.state.rebuffering).toBeNull();

    t.video.setBuffered([[0, 10.2]]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(t.video.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.video.paused).toBe(true);
    expect(t.state.rebuffering).toEqual({ targetS: 8 });
  });

  it('C2 · un hueco en el búfer ([0, 20] y [20,6, 40]) se salta a ~20,7 en vez de retener (E2)', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    t.video._currentTime = 20;
    t.video.setBuffered([
      [0, 20],
      [20.6, 40],
    ]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.video.currentTime).toBeCloseTo(20.7);
    expect(t.video.seeking).toBe(true);
    expect(t.state.rebuffering).toBeNull();
    t.video.finishSeek();
    await flush();
    expect(t.video.paused).toBe(false);
  });

  it('C2 · retenido, lo que llega tras un hueco pequeño (remux reiniciado sin cortar) se salta al momento (ts-silencio)', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    t.video.seekable = ranges([[0, 64]]);
    t.video._currentTime = 57.98;
    t.video.setBuffered([[0, 57.984]]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.state.rebuffering).toEqual({ targetS: 8 });
    expect(t.video.paused).toBe(true);
    // Sin nada detrás, se sigue reteniendo.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(t.state.rebuffering).not.toBeNull();
    // La generación nueva del remux empieza 0,1 s más allá: antes, «0 de 8 s» hasta que hls.js saltaba +11 s.
    t.video.setBuffered([
      [0, 57.984],
      [58.08, 64],
    ]);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.state.rebuffering).toBeNull();
    expect(t.video.currentTime).toBeCloseTo(58.18);
    t.video.finishSeek();
    await flush();
    expect(t.video.paused).toBe(false);
  });

  it('C2 · rebuffer: no se suelta en el mismo evento que lo pone (sin tormenta retener/soltar)', async () => {
    // mpegts.js retiene al momento: con el colchón justo lleno, antes se pausaba y se reanudaba a la vez.
    const t = setup();
    await startPlaying(t);
    const pauses = t.video.pauseCalls;
    const plays = t.video.playCalls;
    t.video.setBuffered([[0, 9]]);
    t.video.stall();
    expect(t.video.pauseCalls).toBe(pauses + 1);
    expect(t.video.playCalls).toBe(plays);
    expect(t.state.rebuffering).toEqual({ targetS: 8 });
    await vi.advanceTimersByTimeAsync(250);
    expect(t.video.paused).toBe(false);
    expect(t.state.rebuffering).toBeNull();
  });

  it('C2 · el vigilante reanuda un vídeo en pausa que nadie ha pedido (2 tics); con el autoplay bloqueado, no', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    const plays = t.video.playCalls;
    // Pausa técnica «perdida» (como la del play() viejo): la persona sigue queriendo que suene.
    t.runtime.controller.pauseMedia();
    expect(t.runtime.controller.state.desiredPlaying).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.video.playCalls).toBe(plays);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.video.playCalls).toBe(plays + 1);
    expect(t.video.paused).toBe(false);

    // Pausa de la persona: se respeta.
    t.runtime.pause();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(t.video.paused).toBe(true);
  });

  it('C2 · el vigilante no insiste: un play() que falla de verdad no se repite y hay tope de 3 sin que suene', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    const plays = t.video.playCalls;
    for (let i = 0; i < 4; i += 1) {
      t.runtime.controller.pauseMedia();
      await vi.advanceTimersByTimeAsync(3_000);
    }
    expect(t.video.playCalls).toBe(plays + 3);
    expect(t.video.paused).toBe(true);

    const other = iptvSetup();
    await iptvPlaying(other);
    const before = other.video.playCalls;
    other.video.playImpl = () =>
      Promise.reject(Object.assign(new Error('no'), { name: 'NotSupportedError' }));
    other.runtime.controller.pauseMedia();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(other.video.playCalls).toBe(before + 1);
    other.runtime.controller.pauseMedia();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(other.video.playCalls).toBe(before + 1);
  });

  it('C2 · DIRECTO en plena retención con retraso: suelta, salta y no dice «Ya estabas» (E4)', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    engine.liveSyncPosition = () => 50;
    t.video.seekable = ranges([[0, 60]]);
    t.video._currentTime = 20;
    t.video.setBuffered([[0, 20.2]]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.state.rebuffering).not.toBeNull();
    const pending = t.runtime.goLive();
    expect(t.video.currentTime).toBe(50);
    expect(t.state.rebuffering).toBeNull();
    t.video.finishSeek();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(t.video.paused).toBe(false);
    expect(t.notices).not.toContain('Ya estabas en el directo');
    expect(t.notices.at(-1)).toBe('De vuelta al directo');
  });

  it('C2 · DIRECTO en plena retención con un hueco delante: salta pasado el hueco', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    t.video.seekable = ranges([[0, 21]]);
    t.video._currentTime = 20;
    t.video.setBuffered([[0, 20.2]]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.state.rebuffering).not.toBeNull();
    // Mientras se retiene, llega emisión DETRÁS de un hueco.
    t.video.setBuffered([
      [0, 20.2],
      [20.8, 26],
    ]);
    const pending = t.runtime.goLive();
    expect(t.video.currentTime).toBeCloseTo(20.9);
    t.video.finishSeek();
    await pending;
    expect(t.notices).not.toContain('Ya estabas en el directo');
  });

  it('C2 · DIRECTO en plena retención ya en el borde y sin hueco: no salta (T-133) y dice que se recupera', async () => {
    const t = iptvSetup();
    await iptvPlaying(t);
    t.video.seekable = ranges([[0, 21]]);
    t.video._currentTime = 20;
    t.video.setBuffered([[0, 20.2]]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await t.runtime.goLive();
    expect(result.reason).toBe('held');
    expect(t.video.currentTime).toBe(20);
    expect(t.notices.at(-1)).toBe('Recuperando la imagen…');
  });

  it('C2 · −30 s con hls.js: no más atrás que borde − maxLatency + 3 s, y dice los segundos de verdad', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    engine.liveWindow = () => ({ start: 0, end: 60, targetDuration: 2, maxLatency: 22 });
    t.video.seekable = ranges([[0, 60]]);
    t.video._currentTime = 50;
    const pending = t.runtime.back();
    expect(t.video.currentTime).toBe(41);
    t.video.finishSeek();
    await pending;
    expect(t.notices.at(-1)).toBe('Retrocedido 9 s · pulsa DIRECTO para volver');
    // Ya en el suelo: no hay más.
    t.video._currentTime = 41.5;
    await t.runtime.back();
    expect(t.notices.at(-1)).toBe('No hay más imagen guardada hacia atrás');
  });

  it('C3 · un error del vídeo con hls.js se recupera en el sitio; sin presupuesto, reconecta', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    const answers = [true, false];
    let asked = 0;
    engine.recoverInPlace = () => {
      asked += 1;
      return answers.shift() ?? false;
    };
    t.video.dispatchEvent(new Event('error'));
    await flush();
    expect(asked).toBe(1);
    expect(t.state.conn).toBe('activa');
    expect(t.engines.created).toHaveLength(1);
    expect(t.notices.at(-1)).toBe('La imagen llegó dañada: saltando ese trozo…');

    t.video.dispatchEvent(new Event('error'));
    expect(asked).toBe(2);
    expect(t.state.conn).toBe('reconectando');
    expect(t.notices.at(-1)).toBe('La señal se ha cortado: reconectando (1/3)…');
  });

  it('Descargar fallos · el trozo dañado que se salta en el sitio cuenta como decodificación', async () => {
    clearWebLog();
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    engine.recoverInPlace = () => true;
    t.video.dispatchEvent(new Event('error'));
    await flush();
    expect(t.state.conn).toBe('activa');
    const entry = webLogSnapshot().find((line) => line.code === 'player_decode_skipped');
    expect(entry).toMatchObject({ kind: 'player', level: 'warn' });
    expect(classifyWebEntry(entry!)).toEqual({ side: 'nuestro', piece: 'decodificacion' });
    clearWebLog();
  });

  it('C3 · sin presupuesto en el sitio, la instancia nueva sigue DESPUÉS del roto y con el presupuesto gastado', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    const used = [
      { at: Date.now(), position: 10 },
      { at: Date.now(), position: 10.1 },
    ];
    engine.recoverInPlace = () => false;
    // El motor ya da el segmento de después del roto (sn 45 → 46).
    engine.position = () => ({ sn: 46, offset: 0 });
    engine.inPlaceUsed = () => used;
    t.video.dispatchEvent(new Event('error'));
    expect(t.state.conn).toBe('reconectando');
    await vi.advanceTimersByTimeAsync(1_000);
    const second = t.engines.last();
    expect(second).not.toBe(engine);
    expect(second.args.startFrom).toEqual({ sn: 46, offset: 0 });
    expect(second.args.inPlaceUsed).toEqual(used);
  });

  it('C3 · una instancia que no llega a saber dónde va deja la posición de la anterior', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    engine.position = () => ({ sn: 40, offset: 1.2 });
    engine.args.callbacks.onFatal('HLS no pudo recuperarse (x)', 'x');
    await vi.advanceTimersByTimeAsync(1_000);
    const second = t.engines.last();
    expect(second.args.startFrom).toEqual({ sn: 40, offset: 1.2 });
    // La segunda cae antes de cargar nada (sin position): la tercera sigue en el sn 40.
    second.args.callbacks.onFatal('HLS no pudo recuperarse (x)', 'x');
    await vi.advanceTimersByTimeAsync(2_000);
    const third = t.engines.last();
    expect(third).not.toBe(second);
    expect(third.args.startFrom).toEqual({ sn: 40, offset: 1.2 });
  });

  it('C3 · un reenganche (otra lista) no se lleva la posición de la vieja', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    engine.position = () => ({ sn: 40, offset: 1.2 });
    reopened();
    await flush();
    expect(engine.destroyed).toBe(true);
    expect(t.engines.last().args.startFrom).toBeUndefined();
  });

  it('C3 · la reconexión sobre el mismo remux sigue en el mismo segmento (startFrom); con otra sesión, no', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    expect(engine.args.guardSequence).toBe(true);
    expect(engine.args.startFrom).toBeUndefined();
    engine.position = () => ({ sn: 40, offset: 1.2 });
    engine.args.callbacks.onFatal('HLS no pudo recuperarse (x)', 'x');
    await vi.advanceTimersByTimeAsync(1_000);
    const second = t.engines.last();
    expect(second).not.toBe(engine);
    expect(second.args.startFrom).toEqual({ sn: 40, offset: 1.2 });

    // Otra sesión del remux: la posición de la vieja no vale.
    second.position = () => ({ sn: 41, offset: 0.5 });
    t.handlers.channelStream = () => ({
      ...iptvGrant(),
      session: { id: 's_OtraSesion0001', heartbeatMs: 15_000, expiresAfterMs: 45_000 },
      url: '/api/v1/video/s_OtraSesion0001/index.m3u8',
    });
    second.args.callbacks.onFatal('HLS no pudo recuperarse (x)', 'x');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.engines.last()).not.toBe(second);
    expect(t.engines.last().args.startFrom).toBeUndefined();
  });

  it('C3 · cambiar de modo con hls.js se lleva la posición (no arranca de cero)', async () => {
    let mode: PlaybackMode = 'balanced';
    const t = setup({ mode: () => mode });
    t.handlers.channelStream = () => iptvGrant();
    const engine = await iptvPlaying(t);
    engine.position = () => ({ sn: 77, offset: 0.3 });
    mode = 'low';
    t.runtime.handle({ type: 'mode', mode: 'low' });
    await flush();
    expect(t.engines.last()).not.toBe(engine);
    expect(t.engines.last().args.startFrom).toEqual({ sn: 77, offset: 0.3 });
  });

  it('C3 · stream.reopened `seamless` de la IPTV: no se destruye hls.js, solo se avisa', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    reopened({ seamless: true });
    await flush();
    expect(engine.destroyed).toBe(false);
    expect(t.engines.created).toHaveLength(1);
    expect(t.state.conn).toBe('activa');
    expect(t.notices.at(-1)).toBe('Tu IPTV se ha reconectado sin cortar la imagen');
    // Sin `seamless` (un servidor de antes): se reengancha como siempre.
    reopened();
    await flush();
    expect(engine.destroyed).toBe(true);
    expect(t.engines.created).toHaveLength(2);
  });

  it('C3 · el reinicio del remux de AceStream (retargetRemux) sí reengancha aunque diga `seamless`', async () => {
    const t = setup();
    await startPlaying(t);
    const engine = t.engines.last();
    expect(engine.args.guardSequence).toBeUndefined();
    dispatchSse(
      'stream.reopened',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        url: `/ace/r/${HASH}/${SID}`,
        protocol: 'mpegts',
        reason: 'remux_restart',
        seamless: true,
      },
      META,
    );
    await flush();
    expect(engine.destroyed).toBe(true);
    expect(t.engines.created).toHaveLength(2);
  });

  it('C3 · el reinicio del remux de AceStream con hls.js (D5) sí reengancha aunque diga `seamless`', async () => {
    const t = setup();
    t.handlers.channelStream = () => grant('hls');
    await startPlaying(t);
    const engine = t.engines.last();
    expect(engine.kind).toBe('hls');
    dispatchSse(
      'stream.reopened',
      {
        sessionId: SID,
        viewerIds: ['v_prueba'],
        url: `/ace/m/${HASH}/${SID}.m3u8`,
        protocol: 'hls',
        reason: 'remux_restart',
        seamless: true,
      },
      META,
    );
    await flush();
    expect(engine.destroyed).toBe(true);
    expect(t.engines.created).toHaveLength(2);
  });

  it('C3 · lista que vuelve a empezar durante la precarga: también reengancha (y sin la posición vieja)', async () => {
    const t = iptvSetup();
    playIptv(t, 'user');
    await flush();
    const engine = t.engines.last();
    engine.position = () => ({ sn: 40, offset: 1 });
    engine.args.callbacks.onReady();
    expect(t.state.conn).toBe('precarga');
    engine.args.callbacks.onReset?.('La lista del remux ha vuelto a empezar (41 → 0)');
    await flush();
    expect(engine.destroyed).toBe(true);
    expect(t.engines.created).toHaveLength(2);
    expect(t.engines.last().args.startFrom).toBeUndefined();
    expect(t.failures).toHaveLength(0);
  });

  it('C3 · lista que vuelve a empezar (servidor de antes): se reengancha una vez aunque luego llegue el SSE', async () => {
    const t = iptvSetup();
    const engine = await iptvPlaying(t);
    engine.args.callbacks.onReset?.('La lista del remux ha vuelto a empezar (41 → 0)');
    await flush();
    expect(engine.destroyed).toBe(true);
    expect(t.engines.created).toHaveLength(2);
    expect(t.notices).toContain('Tu IPTV se ha reconectado: reenganchando la señal…');
    reopened();
    await flush();
    expect(t.engines.created).toHaveLength(2);
    expect(t.failures).toHaveLength(0);
  });
});

describe('Descargar fallos: con qué código se da una fuente por perdida', () => {
  /** Cuatro fallos seguidos con la espera de cada reconexión (1-2-4 s): la fuente se agota. */
  async function exhaustWith(t: Harness, fire: () => void) {
    for (const wait of [1_000, 2_000, 4_000]) {
      fire();
      await vi.advanceTimersByTimeAsync(wait);
    }
    fire();
  }
  const lastReport = (t: Harness) => t.callsTo('diagnosticsReport').at(-1)?.input.body;

  beforeEach(() => clearWebLog());
  afterEach(() => clearWebLog());

  it('mpegts.js con un error de MSE: decodificación (causa codec), no «una fuente que no va»', async () => {
    const t = setup();
    await startPlaying(t);
    await exhaustWith(t, () =>
      t.engines
        .last()
        .args.callbacks.onFatal(
          'La señal se ha cortado: reconectando',
          'MediaError · MediaMSEError',
        ),
    );
    expect(t.state.phase).toBe('error');
    expect(lastReport(t)).toMatchObject({ cause: 'codec', code: 'player_decode_failed' });
    // Quien decide la siguiente fuente sigue sin código (no viene del servidor).
    expect(t.failures[0]?.code).toBeUndefined();
    const entry = webLogSnapshot().find((line) => line.code === 'player_decode_failed');
    expect(entry).toMatchObject({ level: 'warn', detail: 'MediaError · MediaMSEError' });
    expect(classifyWebEntry(entry!).side).toBe('nuestro');
  });

  it('hls.js que no puede añadir un trozo: también decodificación', async () => {
    const t = setup();
    await startPlaying(t);
    await exhaustWith(t, () =>
      t.engines
        .last()
        .args.callbacks.onFatal('HLS no pudo recuperarse (bufferAppendError)', 'bufferAppendError'),
    );
    expect(lastReport(t)).toMatchObject({ cause: 'codec', code: 'player_decode_failed' });
  });

  it('el <video> con MEDIA_ERR_DECODE lo dice en el detalle y cuenta como decodificación', async () => {
    const t = setup();
    await startPlaying(t);
    t.video.error = { code: 3, message: 'PIPELINE_ERROR_DECODE' };
    await exhaustWith(t, () => t.video.dispatchEvent(new Event('error')));
    expect(lastReport(t)).toMatchObject({ cause: 'codec', code: 'player_decode_failed' });
    expect(webLogSnapshot().find((line) => line.code === 'player_decode_failed')?.detail).toBe(
      'evento del vídeo (MEDIA_ERR_DECODE: PIPELINE_ERROR_DECODE)',
    );
  });

  it('un corte de red de mpegts.js sigue siendo de la fuente', async () => {
    const t = setup();
    await startPlaying(t);
    await exhaustWith(t, () =>
      t.engines
        .last()
        .args.callbacks.onFatal(
          'La señal se ha cortado: reconectando',
          'NetworkError · NetworkException',
        ),
    );
    expect(lastReport(t)).toMatchObject({ cause: 'source', code: 'player_source_failed' });
  });

  it('un código del servidor en el cierre (stream.closed) va tal cual: el remux que muere es nuestro', async () => {
    const t = setup();
    await startPlaying(t);
    await exhaustWith(t, () =>
      dispatchSse(
        'stream.closed',
        { sessionId: SID, viewerIds: ['v_prueba'], reason: 'remux_failed', code: 'remux_died' },
        META,
      ),
    );
    expect(t.state.phase).toBe('error');
    expect(lastReport(t)).toMatchObject({ cause: 'source', code: 'remux_died' });
    expect(classifyCode('remux_died', 'source').piece).toBe('remux');
  });

  it('Safari/iOS · imagen parada con búfer de sobra hasta agotar: el reproductor (player_stalled)', async () => {
    const t = setup({ platform: IPHONE });
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    for (let round = 0; round < 4; round += 1) {
      t.engines.last().args.callbacks.onReady();
      t.video.advance(0.1);
      await flush();
      expect(t.state.conn).toBe('activa');
      // 4 s cargados: de sobra para que no sea la señal, y sin retraso para saltar al directo.
      t.video.setBuffered([[t.video.currentTime - 0.5, t.video.currentTime + 4]]);
      // Gracia (4 tics) + 16 tics parada → reconexión; la última agota la fuente.
      await vi.advanceTimersByTimeAsync(1_500 * 24);
      if (round < 3) {
        expect(t.notices).toContain(
          `La imagen se ha quedado parada: reconectando (${round + 1}/3)…`,
        );
        await vi.advanceTimersByTimeAsync(4_000);
      }
    }
    expect(t.state.phase).toBe('error');
    expect(lastReport(t)).toMatchObject({ cause: 'client', code: 'player_stalled' });
  });

  it('Safari/iOS · imagen parada SIN búfer: no llega señal, es de la fuente', async () => {
    const t = setup({ platform: IPHONE });
    t.runtime.play({ hash: HASH, title: 'Canal' });
    await flush();
    for (let round = 0; round < 4; round += 1) {
      t.engines.last().args.callbacks.onReady();
      t.video.advance(0.1);
      await flush();
      t.video.setBuffered([]);
      await vi.advanceTimersByTimeAsync(1_500 * 24);
      if (round < 3) await vi.advanceTimersByTimeAsync(4_000);
    }
    expect(t.state.phase).toBe('error');
    expect(lastReport(t)).toMatchObject({ cause: 'source', code: 'player_source_failed' });
  });
});

describe('películas y series (VOD-6, docs/vod.md §12.7 y §12.9)', () => {
  const MOVIE_ID = 'c1d2e3f4a5b60718293a4b5c6d7e8f9012345678';
  const EP2 = 'e1d2e3f4a5b60718293a4b5c6d7e8f9012345678';
  const VOD_SID = 's_vodPrueba1234';

  function vodGrant(extra: Record<string, unknown> = {}) {
    return {
      ...grant('hls', 'balanced', VOD_SID),
      url: `/api/v1/video/${VOD_SID}/index.m3u8`,
      remux: true,
      source: 'iptv' as const,
      codec: { video: 'h264', audio: 'aac', source: 'ffprobe' },
      vod: {
        id: MOVIE_ID,
        kind: 'movie',
        seriesId: null,
        title: 'Dune',
        subtitle: null,
        durationS: 9360,
        startS: 0,
        resumed: false,
        audio: [
          {
            index: 0,
            label: 'Castellano 5.1',
            lang: 'spa',
            codec: 'ac3',
            channels: 6,
            converted: true,
          },
        ],
        audioIndex: 0,
        video: { codec: 'h264', codecs: 'avc1.640028', width: 1920, height: 1080 },
        next: null,
        poster: null,
        ...extra,
      },
    };
  }

  function vodSetup(extra: Record<string, unknown> = {}) {
    const t = setup();
    t.handlers.vodStream = (input) =>
      vodGrant({ startS: Number(input.query?.start ?? 0), ...extra });
    return t;
  }

  async function vodPlaying(t: Harness, startS?: number) {
    t.runtime.playVod(
      { id: MOVIE_ID, kind: 'movie', title: 'Dune' },
      startS === undefined ? {} : { startS },
    );
    await flush();
    const engine = t.engines.last();
    const at = startS ?? 0;
    engine.args.callbacks.onReady();
    t.video._currentTime = at;
    t.video.setBuffered([[at, at + 20]]);
    await vi.advanceTimersByTimeAsync(250);
    t.video.advance(0.1);
    await flush();
    expect(t.state.conn).toBe('activa');
    return engine;
  }

  it('pide vodStream (cliente, visor, hevc) y engancha hls.js con la lista VOD; ni Recientes ni sourcesOutcome', async () => {
    const t = vodSetup();
    const engine = await vodPlaying(t);
    expect(t.callsTo('channelStream')).toHaveLength(0);
    expect(t.callsTo('vodStream')[0]!.input).toMatchObject({
      params: { id: MOVIE_ID },
      query: { client: 'web', viewer: 'v_prueba', device: 'web_prueba', hevc: '1' },
    });
    expect(t.callsTo('vodStream')[0]!.input.query).not.toHaveProperty('start');
    expect(engine.kind).toBe('hls');
    expect(engine.args.vod).toEqual({ startS: 0 });
    expect(engine.args.guardSequence).toBeUndefined();
    expect(t.state).toMatchObject({ kind: 'vod', streamSource: 'iptv', phase: 'reproduciendo' });
    expect(t.state.vod).toMatchObject({ id: MOVIE_ID, durationS: 9360, failure: null });
    expect(t.callsTo('libraryMutate')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.callsTo('sourcesOutcome')).toHaveLength(0);
  });

  it('un vídeo que el navegador no decodifica: error de códec sin cargar ni reintentar, y suelta la sesión', async () => {
    const t = vodSetup({
      video: { codec: 'hevc', codecs: 'hvc1.2.4.L120.B0', width: 3840, height: 2160 },
    });
    t.codecs.supported = (type) => !type.includes('hvc1');
    t.runtime.playVod({ id: MOVIE_ID, kind: 'movie', title: 'Dune' });
    await flush();
    expect(t.callsTo('vodStream')[0]!.input.query).toMatchObject({ hevc: '0' });
    expect(t.engines.created).toHaveLength(0);
    expect(t.state.phase).toBe('error');
    expect(t.state.message).toBe(
      'Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el iPhone.',
    );
    expect(t.state.vod?.failure).toEqual({ code: 'vod_codec', action: 'title' });
    expect(t.callsTo('sessionRelease')[0]!.input.params).toEqual({ sid: VOD_SID });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.callsTo('vodStream')).toHaveLength(1);
  });

  it('el salto de hueco de la 0.8.3 NO actúa con una película, ni la retención por rebúfer', async () => {
    const t = vodSetup();
    await vodPlaying(t);
    t.video._currentTime = 20;
    t.video.setBuffered([
      [0, 20],
      [20.6, 40],
    ]);
    t.video.stall();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.video.currentTime).toBe(20);
    expect(t.video.seeking).toBe(false);
    expect(t.state.rebuffering).toBeNull();
    expect(t.video.paused).toBe(false);
    // Ni el vigilante: la imagen parada 30 s no reconecta (hls.js reintenta sus trozos).
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.callsTo('vodStream')).toHaveLength(1);
    expect(t.state.conn).toBe('activa');
  });

  it('`ended` es el final, no un corte: «Terminada» y la marca `ended`', async () => {
    const t = vodSetup();
    await vodPlaying(t);
    t.video.dispatchEvent(new Event('ended'));
    await flush();
    expect(t.state.vod?.ended).toBe(true);
    expect(t.progress.at(-1)).toMatchObject({ id: MOVIE_ID, event: 'ended', posS: 9360 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.callsTo('vodStream')).toHaveLength(1);
  });

  it('un corte reconecta UNA vez en la posición con sesión nueva; el segundo, el error con «Reintentar» (sigue ahí)', async () => {
    const t = vodSetup();
    const engine = await vodPlaying(t, 100);
    await vi.advanceTimersByTimeAsync(500);
    engine.args.callbacks.onFatal('HLS no pudo recuperarse (fragLoadError)', 'fragLoadError');
    expect(t.state.message).toBe('Se ha cortado. Seguimos desde 1:40.');
    expect(t.state.phase).toBe('reconectando');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.callsTo('sessionRelease').length).toBeGreaterThanOrEqual(1);
    const second = t.callsTo('vodStream')[1]!;
    expect(second.input.query?.start).toBeCloseTo(100.1, 0);
    const engine2 = t.engines.last();
    expect(engine2).not.toBe(engine);
    expect(engine2.args.vod?.startS).toBeCloseTo(100.1, 0);
    engine2.args.callbacks.onFatal('HLS no pudo recuperarse (fragLoadError)');
    expect(t.state.phase).toBe('error');
    expect(t.state.vod?.failure?.action).toBe('retry');
    expect(t.state.vod?.restarts).toBe(1);
    t.runtime.retry();
    await flush();
    expect(t.callsTo('vodStream')).toHaveLength(3);
    expect(t.callsTo('vodStream')[2]!.input.query?.start).toBeCloseTo(100.1, 0);
  });

  it('vod_busy con retryAfterS: «El proveedor tarda en liberar la conexión…» y un reintento solo, a los retryAfterS s', async () => {
    const t = vodSetup();
    let first = true;
    t.handlers.vodStream = () => {
      if (first) {
        first = false;
        throw new ApiError({ code: 'vod_busy', status: 503, data: { retryAfterS: 3 } });
      }
      return vodGrant();
    };
    t.runtime.playVod({ id: MOVIE_ID, kind: 'movie', title: 'Dune' });
    await flush();
    expect(t.state.message).toBe('El proveedor tarda en liberar la conexión…');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(t.callsTo('vodStream')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(t.callsTo('vodStream')).toHaveLength(2);
    expect(t.engines.created).toHaveLength(1);
  });

  it('vod_unsupported con su motivo: el texto de §13 y «Volver a la ficha», sin reintentos ni puente', async () => {
    const t = vodSetup();
    t.handlers.vodStream = () => {
      throw new ApiError({ code: 'vod_unsupported', status: 422, data: { reason: 'sin_saltos' } });
    };
    t.runtime.playVod({ id: MOVIE_ID, kind: 'movie', title: 'Dune' });
    await flush();
    expect(t.state.phase).toBe('error');
    expect(t.state.message).toBe(
      'Tu proveedor no deja saltar dentro del vídeo; no se puede reproducir aquí.',
    );
    expect(t.state.vod?.failure).toEqual({ code: 'vod_unsupported', action: 'title' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.callsTo('vodStream')).toHaveLength(1);
    expect(t.failures).toHaveLength(0);
  });

  it('progreso: `tick` cada 15 s sonando, `pause` al pausar y `stop` al detener', async () => {
    const t = vodSetup();
    await vodPlaying(t, 600);
    for (let i = 0; i < 34; i += 1) {
      t.video.advance(0.5);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(t.progress.some((entry) => entry['event'] === 'tick')).toBe(true);
    t.runtime.pause();
    await flush();
    expect(t.progress.at(-1)).toMatchObject({ event: 'pause', durS: 9360 });
    t.runtime.stop();
    expect(t.progress.at(-1)).toMatchObject({ event: 'stop', id: MOVIE_ID });
    expect((t.progress.at(-1)!['posS'] as number) > 600).toBe(true);
    expect(t.state).toMatchObject({ kind: 'live', vod: null });
  });

  it('±10 s seguidos se juntan en un salto a los 300 ms y el `seek` sale 2 s después', async () => {
    const t = vodSetup();
    await vodPlaying(t, 100);
    await vi.advanceTimersByTimeAsync(500);
    t.runtime.vodSeekBy(10);
    t.runtime.vodSeekBy(10);
    t.runtime.vodSeekBy(10);
    expect(t.state.vod?.seekingTo).toBeCloseTo(130.1, 0);
    expect(t.video.currentTime).toBeCloseTo(100.1, 0);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.video.currentTime).toBeCloseTo(130.1, 0);
    t.video.finishSeek();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(t.progress.at(-1)).toMatchObject({ event: 'seek' });
  });

  it('siguiente episodio: tarjeta con cuenta atrás al final y a los 10 s, el siguiente (otra sesión, sin start)', async () => {
    const t = vodSetup({
      kind: 'episode',
      seriesId: 'f1d2e3f4a5b60718293a4b5c6d7e8f9012345678',
      title: 'The Office',
      subtitle: 'T2 · E6 · Todo cambia',
      durationS: 1440,
      next: { id: EP2, title: 'La verdad', label: 'T2 · E7' },
    });
    await vodPlaying(t, 1425);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.state.vod?.nextUp?.mode).toBe('countdown');
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    const last = t.callsTo('vodStream').at(-1)!;
    expect(last.input.params).toEqual({ id: EP2 });
    expect(last.input.query).not.toHaveProperty('start');
    expect(t.progress.some((entry) => entry['id'] === MOVIE_ID && entry['event'] === 'ended')).toBe(
      true,
    );
    expect(t.state.channel).toMatchObject({ hash: EP2, subtitle: 'T2 · E7 · La verdad' });
  });

  it('«¿Sigues viendo?» tras 3 episodios seguidos solos; sin respuesta en 60 s, pausa y suelta la sesión', async () => {
    const t = vodSetup({
      kind: 'episode',
      durationS: 1440,
      next: { id: EP2, title: 'La verdad', label: 'T2 · E7' },
    });
    t.runtime.playVod({ id: MOVIE_ID, kind: 'episode', title: 'The Office' }, {}, 3);
    await flush();
    const engine = t.engines.last();
    engine.args.callbacks.onReady();
    t.video._currentTime = 1425;
    t.video.setBuffered([[1425, 1440]]);
    await vi.advanceTimersByTimeAsync(250);
    t.video.advance(0.1);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.state.vod?.nextUp?.mode).toBe('still');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.state.phase).toBe('error');
    expect(t.state.vod?.failure?.code).toBe('vod_idle');
    expect(t.callsTo('sessionRelease').length).toBeGreaterThanOrEqual(1);
    expect(t.callsTo('vodStream')).toHaveLength(1);
  });

  it('de una película a un canal en directo: la marca `stop` y el directo como siempre (kind live)', async () => {
    const t = vodSetup();
    await vodPlaying(t, 50);
    t.runtime.play({ hash: HASH, title: 'M+ Liga de Campeones' });
    expect(t.progress.at(-1)).toMatchObject({ event: 'stop', id: MOVIE_ID });
    await flush();
    expect(t.state).toMatchObject({ kind: 'live', vod: null });
    expect(t.callsTo('channelStream')).toHaveLength(1);
    expect(t.engines.last().args.vod).toBeUndefined();
  });
});
