/* La calidad ligera de «Ver juntos» en el remux (docs/ver-juntos.md §17): el
   productor VOD con el ffmpeg falso del banco, un trabajo ligero de eco (saca
   lo que le entra: los mismos tiempos y el mismo init) y `serveFile` detrás de
   un Fastify suelto.

   - Por la ruta de la sala (`party: true`): `master.m3u8`, `lo.m3u8`,
     `lo_init.mp4` y `lo_index<N>.m4s`; `index.m3u8` sale igual byte a byte
     que por la ruta de vídeo de siempre.
   - La ruta de vídeo de siempre no conoce ninguno de los nuevos.
   - Un `lo_index<N>` mueve el cursor del productor (`touch`).
   - Con `ACE_PARTY_LITE` apagado, nada ligero existe y nadie recibe oferta.
   - La plaza de la ligera cuenta en el tope de recodificaciones. */

import { PassThrough, Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCore } from '../../../test/helpers/index.js';
import { FakeFfmpegLauncher } from '../../../test/fake-vod/fake-ffmpeg.js';
import { isAppError } from '../../core/errors.js';
import { notImplementedService } from '../../core/stub.js';
import type { EngineService } from '../engine/types.js';
import { createRemuxRuntime, type RemuxRuntime } from './service.js';
import type { LiteProcess, LiteProcessLauncher, VodIndex } from './vod/types.js';

const SID = 's_vodlite0001';
const MOVIE = { keyframes: Array.from({ length: 60 }, (_, i) => i * 2), durationS: 120 };
const INDEX: VodIndex = {
  container: 'mkv',
  durationS: MOVIE.durationS,
  keyframes: Float64Array.from(MOVIE.keyframes),
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
    { index: 0, codec: 'aac', aacLc: true, channels: 2, lang: 'spa', name: null, isDefault: true },
  ],
  subtitles: [],
  sizeBytes: 1_000_000,
};

/** Un trabajo ligero que devuelve lo que le entra (init + segmento): tiempos y init idénticos. */
function echoLauncher(): LiteProcessLauncher & { readonly jobs: number[] } {
  const jobs: number[] = [];
  return {
    jobs,
    spawn(): LiteProcess {
      const stdout = new PassThrough();
      const chunks: Buffer[] = [];
      let onExit: ((code: number | null, signal: string | null) => void) | null = null;
      let done = false;
      const exit = (code: number | null, signal: string | null): void => {
        if (done) return;
        done = true;
        onExit?.(code, signal);
      };
      const stdin = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
        final(callback) {
          callback();
          jobs.push(jobs.length);
          setImmediate(() => {
            stdout.end(Buffer.concat(chunks));
            exit(0, null);
          });
        },
      });
      return {
        pid: 4243,
        stdout,
        stdin,
        onExit: (listener) => (onExit = listener),
        onError: () => undefined,
        onStderr: () => undefined,
        kill: () => {
          stdout.destroy();
          exit(null, 'SIGKILL');
        },
      };
    },
  };
}

const runtimes: RemuxRuntime[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  while (runtimes.length) await runtimes.pop()?.service.stop();
});

async function setup(lite: '0' | '1') {
  const core = createTestCore({ env: { ACE_PARTY_LITE: lite } });
  const liteLauncher = echoLauncher();
  const runtime = createRemuxRuntime({
    ...core,
    engine: notImplementedService<EngineService>('engine'),
    vodLauncher: new FakeFfmpegLauncher(MOVIE),
    liteLauncher,
    readVodIndex: async () => INDEX,
    procRoot: null,
    watchFiles: false,
  });
  runtimes.push(runtime);
  const service = runtime.service;
  await service.openVod({
    sessionId: SID,
    titleId: 'm_lite',
    inputUrl: 'http://127.0.0.1:41234/r/AbCdEfGhIjKlMnOpQrStUv/vod.mkv',
    hevc: false,
    startS: 0,
  });
  const app = Fastify();
  apps.push(app);
  for (const [prefix, party] of [
    ['/sala', true],
    ['/video', false],
  ] as const) {
    app.get<{ Params: { file: string } }>(`${prefix}/:file`, async (request, reply) => {
      try {
        const rangeHeader = request.headers.range;
        await service.serveFile(reply, SID, request.params.file, {
          ...(rangeHeader ? { rangeHeader } : {}),
          ...(party ? { party } : {}),
        });
      } catch (error) {
        await reply.code(isAppError(error) && error.code === 'not_found' ? 404 : 500).send();
      }
      return reply;
    });
  }
  return { core, service, app, liteLauncher };
}

describe('remux: calidad ligera de «Ver juntos» (§17)', () => {
  it('por la sala: maestra, lista ligera e init y segmentos ligeros; index.m3u8, igual que siempre', async () => {
    const { service, app, liteLauncher } = await setup('1');
    const master = await app.inject({ method: 'GET', url: '/sala/master.m3u8' });
    expect(master.statusCode).toBe(200);
    expect(master.body.split('\n').filter((l) => l && !l.startsWith('#'))).toEqual([
      'lo.m3u8',
      'index.m3u8',
    ]);
    expect(master.body).toContain('CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720');
    const lo = await app.inject({ method: 'GET', url: '/sala/lo.m3u8' });
    expect(lo.body).toContain('#EXT-X-MAP:URI="lo_init.mp4"');
    expect(lo.body).toContain('\nlo_index0.m4s\n');
    const fromParty = await app.inject({ method: 'GET', url: '/sala/index.m3u8' });
    const fromVideo = await app.inject({ method: 'GET', url: '/video/index.m3u8' });
    expect(fromParty.body).toBe(fromVideo.body);
    expect(fromParty.body.replace(/index(\d+)\.m4s/g, 'lo_index$1.m4s')).toBe(
      lo.body.replace('lo_init.mp4', 'init.mp4'),
    );

    const segment = await app.inject({ method: 'GET', url: '/sala/lo_index0.m4s' });
    expect(segment.statusCode).toBe(200);
    expect(segment.rawPayload.subarray(4, 8).toString('latin1')).toBe('moof');
    const init = await app.inject({ method: 'GET', url: '/sala/lo_init.mp4' });
    expect(init.statusCode).toBe(200);
    expect(init.rawPayload.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(liteLauncher.jobs.length).toBeGreaterThanOrEqual(1);
    /* Con Range, como los segmentos de siempre. */
    const ranged = await app.inject({
      method: 'GET',
      url: '/sala/lo_index0.m4s',
      headers: { range: 'bytes=0-7' },
    });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.rawPayload.length).toBe(8);

    expect(service.stats().partyLite).toEqual([
      expect.objectContaining({ sessionId: SID, state: 'on', reason: null }),
    ]);
    expect(service.vodLiteOffer(SID, false)).toMatchObject({
      kind: 'master',
      file: 'master.m3u8',
      variants: { hd: 'avc1.640028', lite: 'avc1.640028' },
    });
    /* La ligera ocupa una de las 2 plazas: queda otra. */
    expect(service.canTranscode()).toBe(true);
    expect(service.vodLiteOffer('s_otra000001', false)).toBeNull();
  });

  it('la ruta de vídeo de siempre no conoce nada de la versión ligera', async () => {
    const { app } = await setup('1');
    for (const file of ['master.m3u8', 'lo.m3u8', 'lo_init.mp4', 'lo_index0.m4s']) {
      const response = await app.inject({ method: 'GET', url: `/video/${file}` });
      expect(response.statusCode, file).toBe(404);
    }
  });

  it('un lo_index<N> mueve el cursor del productor (un salto lejos reinicia allí)', async () => {
    const { service, app } = await setup('1');
    await app.inject({ method: 'GET', url: '/sala/lo_index0.m4s' });
    void app.inject({ method: 'GET', url: '/sala/lo_index15.m4s' });
    for (let i = 0; i < 200 && service.vodStats(SID)?.lastRequested !== 15; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(service.vodStats(SID)?.lastRequested).toBe(15);
    const late = await app.inject({ method: 'GET', url: '/sala/lo_index15.m4s' });
    expect([200, 503, 404]).toContain(late.statusCode);
  });

  it('con ACE_PARTY_LITE=0 no existe nada ligero, nadie recibe oferta y los stats no cambian', async () => {
    const { service, app, liteLauncher } = await setup('0');
    for (const file of ['master.m3u8', 'lo.m3u8', 'lo_init.mp4', 'lo_index0.m4s']) {
      const response = await app.inject({ method: 'GET', url: `/sala/${file}` });
      expect(response.statusCode, file).toBe(404);
      expect(response.headers['cache-control'], file).toBe('no-store');
    }
    expect((await app.inject({ method: 'GET', url: '/sala/index.m3u8' })).statusCode).toBe(200);
    expect(liteLauncher.jobs).toEqual([]);
    expect(service.vodLiteOffer(SID, false)).toBeNull();
    expect(await service.vodLiteCovers('m_lite')).toBe(false);
    expect(service.stats()).toEqual({ sessions: 0, max: 3, ffmpegMissing: false });
  });
});
