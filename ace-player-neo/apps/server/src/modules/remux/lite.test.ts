/* Calidad ligera (0.9.8): el iPhone fuera de casa con poca conexión pide `lite=1` y el remux recodifica a
   720p y ~2,5 Mb/s en vez de copiar. Comparte el tope de recodificaciones con el desentrelazado. */

import { afterEach, describe, expect, it } from 'vitest';
import { createTestCore } from '../../../test/helpers/index.js';
import { DEINTERLACE_THREADS, LITE_MAXRATE, buildRemuxArgs, liteVideoArgs } from './args.js';
import { MAX_DEINTERLACE, createRemuxRuntime } from './service.js';
import { HW_FAILURES_TO_DISABLE, MAX_RECODE_HW, createVideoAccel } from './hwaccel.js';
import { createFakeLauncher } from './test-support.js';
import type { RemuxSource } from './types.js';

const RELAY = 'http://127.0.0.1:41999/r/AbCdEfGhIjKlMnOpQrStUv/in.ts';

const source = (n: number, extra: Partial<RemuxSource> = {}): RemuxSource => ({
  sessionId: `s_lite${String(n).padStart(18, '0')}`,
  hash: String(n).repeat(40).slice(0, 40),
  playbackUrl: RELAY,
  mode: 'hls',
  inputUrl: RELAY,
  origin: 'iptv',
  ...extra,
});

describe('argumentos de la calidad ligera', () => {
  const base = { url: RELAY, dir: '/data/remux/x', sessionId: 's_x', origin: 'iptv' as const };

  it('720p como mucho (sin agrandar), x264 High, tope de caudal y una clave cada 2 s; sin copiar', () => {
    const args = buildRemuxArgs({ ...base, lite: true });
    const at = (name: string) => args[args.indexOf(name) + 1];
    expect(at('-vf')).toBe("scale=-2:'min(720,ih)'");
    expect(at('-c:v')).toBe('libx264');
    expect(at('-maxrate')).toBe(LITE_MAXRATE);
    expect(at('-force_key_frames')).toBe('expr:gte(t,n_forced*2)');
    expect(at('-threads:v')).toBe(String(DEINTERLACE_THREADS));
    expect(at('-hls_time')).toBe('2');
    expect(args).not.toContain('-copyinkf');
    /* El audio, igual. */
    expect(at('-c:a')).toBe('aac');
  });

  it('ligera y entrelazada: desentrelaza imagen a imagen (25p) antes de escalar', () => {
    expect(liteVideoArgs(true)[1]).toBe("bwdif=mode=send_frame,scale=-2:'min(720,ih)'");
    const args = buildRemuxArgs({ ...base, lite: true, deinterlace: true });
    expect(args).not.toContain('bwdif=mode=send_field');
  });
});

describe('remux con un iPhone que pide calidad ligera', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  function runtime() {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher();
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher: ffmpeg.launcher,
      procRoot: null,
      watchFiles: false,
      probeInterlaced: async () => false,
    });
    stops.push(() => rt.service.stopAll());
    return { ffmpeg, rt };
  }

  it('copia sin pedirlo; al pedirlo, el reinicio sale ligero; y vuelve a copiar si ya nadie lo pide', async () => {
    const { ffmpeg, rt } = runtime();
    let lite = false;
    const src = source(1, { wantsLite: () => lite });
    await rt.service.ensure(src, 'v_ios');
    expect(ffmpeg.last().args).toContain('copy');
    expect(rt.service.liteActive(src.sessionId)).toBe(false);
    lite = true;
    await rt.service.restart(src.sessionId);
    expect(ffmpeg.last().args).toContain("scale=-2:'min(720,ih)'");
    expect(rt.service.liteActive(src.sessionId)).toBe(true);
    expect(rt.entries()[0]?.lite).toBe(true);
    lite = false;
    await rt.service.restart(src.sessionId);
    expect(ffmpeg.last().args).toContain('copy');
    expect(rt.service.liteActive(src.sessionId)).toBe(false);
  });

  it('también un canal de AceStream (origen del motor) puede salir ligero', async () => {
    const { ffmpeg, rt } = runtime();
    const src = source(2, { origin: 'engine', inputUrl: undefined, wantsLite: () => true });
    await rt.service.ensure(src, 'v_ios');
    expect(ffmpeg.last().args).toContain('libx264');
  });

  it(`como mucho ${MAX_DEINTERLACE} recodificaciones a la vez: la siguiente copia`, async () => {
    const { ffmpeg, rt } = runtime();
    for (let n = 1; n <= MAX_DEINTERLACE; n += 1) {
      await rt.service.ensure(source(n, { wantsLite: () => true }), `v_${n}`);
      expect(ffmpeg.last().args).toContain('libx264');
    }
    expect(rt.service.canTranscode()).toBe(false);
    await rt.service.ensure(source(9, { wantsLite: () => true }), 'v_9');
    expect(ffmpeg.last().args).toContain('copy');
    expect(rt.service.liteActive(source(9).sessionId)).toBe(false);
  });
});

describe('remux ligero con la gráfica del NAS (docs/ver-juntos.md §17.6)', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  function runtime() {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher();
    const accel = createVideoAccel({
      launcher: {
        spawn: () => {
          throw new Error('sin ensayo en este test');
        },
      },
      clock: core.clock,
      logger: core.logger,
      mode: 'auto',
      softwareSlots: MAX_DEINTERLACE,
    });
    const profile = {
      device: '/dev/dri/renderD128',
      lowPower: true,
      rateControl: 'VBR' as const,
      deinterlace: true,
      liteCodecs: 'avc1.640c28',
    };
    /* La gráfica «ya ensayada»: el perfil de pega hasta que `failed` la apague. */
    let on = true;
    const videoAccel = {
      ...accel,
      vaapi: () => (on ? profile : null),
      recodeSlots: () => (on ? MAX_RECODE_HW : MAX_DEINTERLACE),
      failed: (detail: string) => {
        accel.failed(detail);
        fails += 1;
        if (fails >= HW_FAILURES_TO_DISABLE) on = false;
      },
    };
    let fails = 0;
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher: ffmpeg.launcher,
      videoAccel,
      procRoot: null,
      watchFiles: false,
      probeInterlaced: async () => false,
    });
    stops.push(() => rt.service.stopAll());
    return { ffmpeg, rt, failures: () => fails };
  }

  it(`con la gráfica caben ${MAX_RECODE_HW} ligeras a la vez y van con h264_vaapi`, async () => {
    const { ffmpeg, rt } = runtime();
    for (let n = 1; n <= Math.min(MAX_RECODE_HW, 3); n += 1) {
      await rt.service.ensure(source(n, { wantsLite: () => true }), `v_${n}`);
      expect(ffmpeg.last().args).toContain('h264_vaapi');
      expect(ffmpeg.last().args).not.toContain('libx264');
    }
    /* El tope de 3 remux (MAX_REMUX_SESSIONS) llega antes: la gráfica nunca es el cuello aquí. */
    expect(rt.service.canTranscode()).toBe(true);
  });

  it('un ffmpeg con la gráfica que muere cuenta; con la gráfica apagada vuelve x264', async () => {
    const { ffmpeg, rt, failures } = runtime();
    const src = source(1, { wantsLite: () => true });
    await rt.service.ensure(src, 'v_1');
    expect(ffmpeg.last().args).toContain('h264_vaapi');
    for (let i = 0; i < HW_FAILURES_TO_DISABLE; i += 1) {
      ffmpeg.last().stderr('Failed to sync surface: 1 (operation failed)');
      ffmpeg.last().exit(1);
      await new Promise((resolve) => setImmediate(resolve));
      await rt.service.ensure(src, `v_${i + 2}`);
    }
    expect(failures()).toBe(HW_FAILURES_TO_DISABLE);
    expect(ffmpeg.last().args).toContain('libx264');
  });

  it('el fin de la entrada (sin pares, la IPTV caída, código 0) no cuenta como fallo de la gráfica', async () => {
    const { ffmpeg, rt, failures } = runtime();
    const src = source(1, { wantsLite: () => true });
    const ends: [string, number][] = [
      ['http://127.0.0.1:6878/ace/getstream: Connection refused', 1],
      ['Server returned 404 Not Found', 1],
      ['', 0],
      ['Error during demuxing: End of file', 255],
    ];
    for (const [i, [tail, code]] of ends.entries()) {
      await rt.service.ensure(src, `v_${i + 1}`);
      expect(ffmpeg.last().args).toContain('h264_vaapi');
      if (tail) ffmpeg.last().stderr(tail);
      ffmpeg.last().exit(code);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(failures()).toBe(0);
    await rt.service.ensure(src, 'v_9');
    expect(ffmpeg.last().args).toContain('h264_vaapi');
  });
});
