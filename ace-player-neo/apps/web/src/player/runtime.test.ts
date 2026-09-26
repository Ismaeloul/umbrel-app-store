/* El orquestador de la reproducción con un <video> simulado, motores
   simulados y un backend simulado (sin red): URL pedida al backend,
   precarga, primer fotograma real, vigilante, rebuffer, reconexiones con
   presupuesto y espera exponencial, paso de fuente, traspaso, cambio de
   modo del motor por SSE, latido, soltar la sesión y métricas. */

import { PLAYBACK_PROFILES, type PlaybackMode } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { api } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import { resetMode, setMode } from '../api/mode.ts';
import { dispatchSse } from '../api/sse.ts';
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
});
