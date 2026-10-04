/* Sesiones VOD en playback (docs/vod.md §9.8, VOD-5) con un doble de la IPTV
   (relé VOD falso) y el `openVod` del remux sustituido (el productor y el
   índice tienen sus propias pruebas en remux/vod):

   - `vodStream` abre el relé y el productor, da la lista web sin token, el
     título, la duración del índice, las pistas con la castellana por
     defecto, el ritmo (bytes/s del título) y NO escribe el mando;
   - D-VOD11: un VOD corta el directo IPTV y otro VOD; convive con AceStream
     en los dos sentidos;
   - D-VOD13: el mismo VOD desde otro aparato es traspaso y reutiliza la
     sesión; con otro audio se reabre;
   - el productor que no puede seguir cierra con `vod_dropped`;
   - `channelStream` con un id de película → `validation_error` `vod_id`. */

import { describe, expect, it, vi } from 'vitest';
import type { ChannelStreamQuery, VodStreamQuery } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { AppError } from '../../core/errors.js';
import type { IptvInput, IptvService, VodInput } from '../iptv/types.js';
import type { RemuxVodHandle, RemuxVodRequest } from '../remux/types.js';
import type { VodIndex } from '../remux/vod/types.js';
import { partial, setupPlayback, type PlaybackSetup } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const CANAL = 'e'.repeat(40);
const PELI = 'f'.repeat(32) + '0'.repeat(8);
const OTRA = 'f'.repeat(32) + '1'.repeat(8);
const ACE = demoContentId(1);

const live = (): AbortSignal => new AbortController().signal;
const web = (viewerId: string, deviceId = `pc-${viewerId}`): ViewerIdentity => ({
  viewerId,
  deviceId,
  device: null,
});
const channel = (viewer: string): ChannelStreamQuery => ({
  client: 'web',
  kind: 'auto',
  mode: 'balanced',
  viewer,
});
const vodQuery = (viewer: string, over: Partial<VodStreamQuery> = {}): VodStreamQuery => ({
  client: 'web',
  viewer,
  hevc: '0',
  ...over,
});

const INDEX: VodIndex = {
  container: 'mkv',
  durationS: 5_400,
  keyframes: new Float64Array([0, 6, 12]),
  video: {
    codec: 'h264',
    codecs: 'avc1.640028',
    width: 1920,
    height: 1080,
    bitDepth: 8,
    profile: 100,
    chromaFormat: 1,
  },
  audio: [
    {
      index: 0,
      codec: 'ac3',
      aacLc: false,
      channels: 6,
      lang: 'eng',
      name: null,
      isDefault: true,
    },
    {
      index: 1,
      codec: 'aac',
      aacLc: true,
      channels: 2,
      lang: 'spa',
      name: null,
      isDefault: false,
    },
  ],
  subtitles: [],
  sizeBytes: 5_400 * 750_000,
};

interface FakeVodInput extends VodInput {
  closed: boolean;
  pace: number | null;
  duration: number | null;
  drop(code: string): void;
}

function fakeVodInput(id: string): FakeVodInput {
  const drops: ((code: string) => void)[] = [];
  const input: FakeVodInput = {
    id,
    inputUrl: `http://127.0.0.1:41999/r/TICKET${id.slice(-4)}/vod.mkv`,
    target: {
      kind: 'movie',
      source: 2005,
      ext: 'mkv',
      title: id === PELI ? 'Dune' : 'Otra',
      subtitle: null,
      seriesId: null,
      next: null,
      poster: null,
      resumeS: 0,
      audioLang: null,
      durationHintS: null,
    },
    closed: false,
    pace: null,
    duration: null,
    stats: () => ({ bytes: 0, kbps: 0, lastByteAt: null, opens: 1, timeouts: 0, pacedMs: 0 }),
    setPace: (bytesPerS) => {
      input.pace = bytesPerS;
    },
    release: async () => undefined,
    onDropped: (listener) => drops.push(listener),
    noteDuration: (durationS) => {
      input.duration = durationS;
    },
    close: async () => {
      input.closed = true;
    },
    drop: (code) => drops.forEach((listener) => listener(code)),
  };
  return input;
}

function fakeIptv() {
  const vodInputs: FakeVodInput[] = [];
  const liveInputs: (IptvInput & { closed: boolean })[] = [];
  const service = partial<IptvService>('iptv', {
    classify: (id: string) =>
      id === CANAL ? 'owned' : id === PELI || id === OTRA ? 'iptv_gone' : 'engine',
    isVodId: (id: string) => id === PELI || id === OTRA,
    /* Con IPTV Xtream: `status()` dice algo (sin ella, `vod_unavailable`). */
    vod: { status: () => ({ state: 'ready' }) } as unknown as IptvService['vod'],
    titleOf: () => 'La 1',
    subscribe: () => () => undefined,
    openInput: async () => {
      const input = {
        id: CANAL,
        inputUrl: 'http://127.0.0.1:41999/r/TICKETLIVE/in.ts',
        isHls: false,
        title: 'La 1 --> Mi IPTV',
        closed: false,
        stats: () => ({ bytes: 0, kbps: 0, lastByteAt: null }),
        onDropped: () => undefined,
        onRestart: () => undefined,
        close: async () => {
          input.closed = true;
        },
      };
      liveInputs.push(input);
      return input;
    },
    openVod: async (id: string) => {
      const input = fakeVodInput(id);
      vodInputs.push(input);
      return input;
    },
  });
  return { service, vodInputs, liveInputs };
}

/** Sustituye el `openVod` del remux: guarda lo pedido y da el índice de prueba. */
function stubProducer(setup: PlaybackSetup) {
  const requests: RemuxVodRequest[] = [];
  const closed: string[] = [];
  vi.spyOn(setup.remux.service, 'openVod').mockImplementation(async (request) => {
    requests.push(request);
    const handle: RemuxVodHandle = {
      sessionId: request.sessionId,
      index: INDEX,
      audio: INDEX.audio[request.audio ?? 1] ?? null,
      startS: request.startS,
    };
    return handle;
  });
  vi.spyOn(setup.remux.service, 'closeVod').mockImplementation(async (sessionId) => {
    closed.push(sessionId);
  });
  return { requests, closed };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

describe('vodStream (docs/vod.md §9.8)', () => {
  it('abre relé y productor, da la lista web, el título, las pistas y el ritmo; sin mando', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const producer = stubProducer(setup);
    const grant = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-a', { start: 120 }),
      web('visor-a'),
      live(),
    );
    expect(grant.url).toBe(`/api/v1/video/${grant.session.id}/index.m3u8`);
    expect(grant.protocol).toBe('hls');
    expect(grant.source).toBe('iptv');
    expect(grant.latency.liveSync).toBeNull();
    expect(grant.vod).toMatchObject({
      id: PELI,
      kind: 'movie',
      title: 'Dune',
      durationS: 5_400,
      startS: 120,
      resumed: false,
      audioIndex: 1,
      video: { codec: 'h264', codecs: 'avc1.640028', width: 1920, height: 1080 },
    });
    expect(grant.vod.audio.map((track) => track.label)).toEqual(['Inglés 5.1', 'Castellano']);
    expect(grant.vod.audio[0]?.converted).toBe(true);
    expect(producer.requests[0]).toMatchObject({
      titleId: PELI,
      inputUrl: iptv.vodInputs[0]?.inputUrl,
      hevc: false,
      startS: 120,
    });
    /* Ritmo: la tasa media del título (tamaño / duración). */
    expect(iptv.vodInputs[0]?.pace).toBe(750_000);
    expect(iptv.vodInputs[0]?.duration).toBe(5_400);
    /* Las apps 0.6.x leen `nowPlaying` como un canal: un VOD no lo escribe. */
    expect(setup.state.get().nowPlaying).toBeNull();
    expect(setup.events.of('stream.ready')).toHaveLength(1);
  });

  it('apagar (stopAll) también cierra las sesiones VOD: el productor y el relé', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const producer = stubProducer(setup);
    const grant = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-a'),
      web('visor-a'),
      live(),
    );
    await setup.runtime.service.stopAll(5_000);
    expect(producer.closed).toContain(grant.session.id);
    expect(iptv.vodInputs[0]?.closed).toBe(true);
  });

  it('un VOD corta el directo IPTV y otro VOD (D-VOD11)', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const producer = stubProducer(setup);
    await setup.runtime.service.acquire(CANAL, channel('visor-a'), web('visor-a'), live());
    const first = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-b'),
      web('visor-b'),
      live(),
    );
    expect(iptv.liveInputs[0]?.closed).toBe(true);
    expect(setup.events.of('playback.handoff')[0]).toMatchObject({ viewerIds: ['visor-a'] });
    await setup.runtime.service.acquireVod(OTRA, vodQuery('visor-c'), web('visor-c'), live());
    expect(iptv.vodInputs[0]?.closed).toBe(true);
    expect(producer.closed).toContain(first.session.id);
    expect(setup.runtime.inspect().sessions).toHaveLength(1);
  });

  it('convive con AceStream en los dos sentidos (D-VOD11, 30-sep)', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    stubProducer(setup);
    await setup.runtime.service.acquire(ACE, channel('visor-a'), web('visor-a'), live());
    await setup.runtime.service.acquireVod(PELI, vodQuery('visor-b'), web('visor-b'), live());
    expect(setup.runtime.inspect().sessions).toHaveLength(2);
    expect(setup.events.of('playback.handoff')).toEqual([]);
    /* Y abrir AceStream con la película sonando no la cierra. */
    await setup.runtime.service.acquire(
      demoContentId(2),
      channel('visor-c'),
      web('visor-c'),
      live(),
    );
    expect(iptv.vodInputs[0]?.closed).toBe(false);
    expect(setup.runtime.inspect().sessions.map((session) => session.hash)).toContain(PELI);
    /* Abrir un canal IPTV sí la cierra (la plaza del proveedor es una). */
    await setup.runtime.service.acquire(CANAL, channel('visor-d'), web('visor-d'), live());
    expect(iptv.vodInputs[0]?.closed).toBe(true);
  });

  it('el mismo VOD en otro aparato es traspaso y reutiliza la sesión; con otro audio se reabre (D-VOD13)', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const producer = stubProducer(setup);
    const first = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-a'),
      web('visor-a'),
      live(),
    );
    const second = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-b', { start: 600 }),
      web('visor-b'),
      live(),
    );
    expect(second.session.id).toBe(first.session.id);
    expect(second.handoff).toBe(true);
    expect(second.vod.startS).toBe(600);
    expect(producer.requests).toHaveLength(1);
    const third = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-b', { audio: 0 }),
      web('visor-b'),
      live(),
    );
    expect(third.session.id).not.toBe(first.session.id);
    expect(third.vod.audioIndex).toBe(0);
    expect(producer.requests).toHaveLength(2);
    expect(iptv.vodInputs[0]?.closed).toBe(true);
  });

  it('el productor no puede seguir: stream.closed con vod_dropped y todo cerrado', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const producer = stubProducer(setup);
    const grant = await setup.runtime.service.acquireVod(
      PELI,
      vodQuery('visor-a'),
      web('visor-a'),
      live(),
    );
    producer.requests[0]?.onDropped?.(new AppError('vod_dropped'));
    await setup.runtime.idle();
    expect(setup.events.of('stream.closed')).toEqual([
      expect.objectContaining({
        sessionId: grant.session.id,
        viewerIds: ['visor-a'],
        reason: 'remux_failed',
        code: 'vod_dropped',
      }),
    ]);
    expect(iptv.vodInputs[0]?.closed).toBe(true);
    expect(producer.closed).toContain(grant.session.id);
  });

  it('un índice que no se puede ver suelta el relé y no deja sesión', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    vi.spyOn(setup.remux.service, 'openVod').mockRejectedValue(
      new AppError('vod_unsupported', { data: { reason: 'hevc' } }),
    );
    expect(
      await codeOf(
        setup.runtime.service.acquireVod(PELI, vodQuery('visor-a'), web('visor-a'), live()),
      ),
    ).toBe('vod_unsupported');
    expect(iptv.vodInputs[0]?.closed).toBe(true);
    expect(setup.runtime.inspect().sessions).toHaveLength(0);
  });

  it('channelStream con un id de película: validation_error vod_id (§5.3)', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const error = await setup.runtime.service
      .acquire(PELI, channel('visor-a'), web('visor-a'), live())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('validation_error');
    expect((error as AppError).detail).toBe('vod_id');
  });
});
