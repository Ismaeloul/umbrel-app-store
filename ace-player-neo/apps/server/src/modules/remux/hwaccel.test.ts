/* La gráfica del NAS (hwaccel.ts, docs/ver-juntos.md §17.6) con un ffmpeg
   falso que decide por los argumentos:

   - los argumentos de la gráfica: la ligera del VOD, la del directo y el
     desentrelazado; lo que copia el vídeo no la usa nunca;
   - el ensayo prueba los modos en orden y se queda con el primero que sale;
     sin ffmpeg, sin gráfica o con `ACE_HWACCEL=off`, x264 y el motivo;
   - sin `deinterlace_vaapi`, la gráfica solo para la ligera progresiva;
   - 3 fallos seguidos en uso la apagan; uno bueno entre medias, no;
   - el ensayo con el ffmpeg de verdad (Windows: sin VAAPI) acaba en x264. */

import { spawnSync } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../core/clock.js';
import { createSilentLogger } from '../../core/logger.js';
import {
  LITE_MAXRATE,
  VAAPI_UPLOAD,
  buildRemuxArgs,
  liveUsesVaapi,
  type VaapiProfile,
} from './args.js';
import {
  HW_FAILURES_TO_DISABLE,
  MAX_RECODE_HW,
  VAAPI_CANDIDATES,
  avcCOf,
  buildDeinterlaceProbeArgs,
  buildEncodeProbeArgs,
  createVideoAccel,
  isVaapiFailure,
} from './hwaccel.js';
import { createSpawnLauncher } from './process.js';
import type { LiteProcess, LiteProcessLauncher } from './vod/types.js';

const HW: VaapiProfile = {
  device: '/dev/dri/renderD128',
  lowPower: true,
  rateControl: 'VBR',
  deinterlace: true,
  liteCodecs: 'avc1.640c28',
};

const after = (args: readonly string[], flag: string): string | undefined =>
  args[args.indexOf(flag) + 1];

/** ffmpeg falso: `answer(args)` dice cómo sale cada ensayo. */
class FakeProbeLauncher implements LiteProcessLauncher {
  readonly runs: string[][] = [];
  constructor(
    private readonly answer: (args: readonly string[]) => {
      code?: number;
      stderr?: string;
      missing?: boolean;
    },
  ) {}

  spawn(args: readonly string[]): LiteProcess {
    this.runs.push([...args]);
    const result = this.answer(args);
    if (result.missing) throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
    const stdout = new PassThrough();
    let onExit: ((code: number | null, signal: string | null) => void) | null = null;
    let onStderr: ((chunk: Buffer) => void) | null = null;
    setImmediate(() => {
      if (result.stderr) onStderr?.(Buffer.from(result.stderr));
      stdout.end(result.code ? Buffer.alloc(0) : Buffer.from('fmp4'));
      onExit?.(result.code ?? 0, null);
    });
    return {
      pid: 7,
      stdout,
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      onExit: (listener) => (onExit = listener),
      onError: () => undefined,
      onStderr: (listener) => (onStderr = listener),
      kill: () => undefined,
    };
  }
}

function accelWith(launcher: LiteProcessLauncher, mode: 'auto' | 'off' = 'auto') {
  return createVideoAccel({
    launcher,
    clock: new FakeClock(),
    logger: createSilentLogger(),
    mode,
    softwareSlots: 2,
    readCodecs: (out) => (out.toString('latin1') === 'fmp4' ? 'avc1.640c28' : null),
  });
}

describe('argumentos con la gráfica', () => {
  it('el directo: solo cuando recodifica, la entrada por la gráfica delante de -i y sin x264', () => {
    const base = { url: 'http://127.0.0.1:6878/x', dir: '/tmp/r', sessionId: 's_1' };
    const copy = buildRemuxArgs({ ...base, vaapi: HW });
    expect(copy).not.toContain('-hwaccel');
    expect(after(copy, '-c:v')).toBe('copy');

    const lite = buildRemuxArgs({ ...base, lite: true, vaapi: HW });
    expect(lite.indexOf('-hwaccel')).toBeLessThan(lite.indexOf('-i'));
    expect(after(lite, '-hwaccel_output_format')).toBe('vaapi');
    expect(after(lite, '-init_hw_device')).toBe('vaapi=va:/dev/dri/renderD128');
    expect(after(lite, '-vf')).toBe(`${VAAPI_UPLOAD},scale_vaapi=w=-2:h='min(720,ih)':format=nv12`);
    expect(after(lite, '-c:v')).toBe('h264_vaapi');
    expect(after(lite, '-low_power')).toBe('1');
    expect(after(lite, '-maxrate')).toBe(LITE_MAXRATE);
    expect(after(lite, '-bf')).toBe('0');
    expect(after(lite, '-force_key_frames')).toBe('expr:gte(t,n_forced*2)');
    expect(lite).not.toContain('-threads:v');
    expect(lite).not.toContain('libx264');
    /* El audio, igual que con x264. */
    expect(after(lite, '-c:a')).toBe('aac');

    const deint = buildRemuxArgs({ ...base, deinterlace: true, vaapi: HW });
    expect(after(deint, '-vf')).toBe(`${VAAPI_UPLOAD},deinterlace_vaapi=rate=field`);
    expect(after(deint, '-maxrate')).toBe('12M');
    const both = buildRemuxArgs({ ...base, deinterlace: true, lite: true, vaapi: HW });
    expect(after(both, '-vf')).toContain('deinterlace_vaapi=rate=frame,scale_vaapi=');
  });

  it('sin deinterlace_vaapi lo entrelazado sigue con bwdif + x264; sin gráfica, como siempre', () => {
    const noDeint = { ...HW, deinterlace: false };
    expect(liveUsesVaapi(noDeint, { lite: true })).toBe(true);
    expect(liveUsesVaapi(noDeint, { deinterlace: true })).toBe(false);
    expect(liveUsesVaapi(noDeint, { lite: true, deinterlace: true })).toBe(false);
    expect(liveUsesVaapi(null, { lite: true })).toBe(false);
    const base = { url: 'http://127.0.0.1:6878/x', dir: '/tmp/r', sessionId: 's_1' };
    const args = buildRemuxArgs({ ...base, deinterlace: true, vaapi: noDeint });
    expect(after(args, '-vf')).toBe('bwdif=mode=send_field');
    expect(after(args, '-c:v')).toBe('libx264');
    expect(args).not.toContain('-hwaccel');
    expect(buildRemuxArgs({ ...base, lite: true })).toEqual(
      buildRemuxArgs({ ...base, lite: true, vaapi: null }),
    );
  });

  it('CQP sin caudal y sin low_power cuando el ensayo lo eligió así', () => {
    const base = { url: 'http://127.0.0.1:6878/x', dir: '/tmp/r', sessionId: 's_1' };
    const args = buildRemuxArgs({
      ...base,
      lite: true,
      vaapi: { ...HW, lowPower: false, rateControl: 'CQP' },
    });
    expect(args).not.toContain('-low_power');
    expect(after(args, '-rc_mode')).toBe('CQP');
    expect(after(args, '-qp')).toBe('25');
    expect(args).not.toContain('-maxrate');
  });

  it('los ensayos: testsrc2 → gráfica → h264_vaapi en fMP4 por pipe:1, sin marca de sesión', () => {
    const encode = buildEncodeProbeArgs('/dev/dri/renderD128', VAAPI_CANDIDATES[0] as VaapiProfile);
    expect(after(encode, '-f')).toBe('lavfi');
    expect(after(encode, '-c:v')).toBe('h264_vaapi');
    expect(after(encode, '-level:v')).toBe('40');
    expect(after(encode, '-g')).toBe('9999');
    expect(encode.slice(-1)).toEqual(['pipe:1']);
    expect(encode.join(' ')).not.toContain('ace_session');
    const deint = buildDeinterlaceProbeArgs(
      '/dev/dri/renderD128',
      VAAPI_CANDIDATES[0] as VaapiProfile,
    );
    expect(after(deint, '-vf')).toContain('deinterlace_vaapi');
  });

  it('avcCOf saca la caja avcC de un stsd', () => {
    const avcC = Buffer.from([1, 0x64, 0x0c, 0x28, 0xff, 0xe0, 0x00]);
    const box = Buffer.concat([Buffer.from([0, 0, 0, 8 + avcC.length]), Buffer.from('avcC'), avcC]);
    const stsd = Buffer.concat([Buffer.alloc(20), box]);
    expect(avcCOf(stsd)).toEqual(avcC);
    expect(avcCOf(Buffer.alloc(20))).toBeNull();
  });
});

describe('isVaapiFailure: qué fin de un ffmpeg con la gráfica es culpa suya', () => {
  it('los errores de VAAPI sí; el fin de la entrada y la salida con 0, no', () => {
    expect(isVaapiFailure(1, '[h264_vaapi @ 0x7f] Failed to end picture encode issue: 23')).toBe(
      true,
    );
    expect(isVaapiFailure(1, 'Failed to sync surface: 1 (operation failed)')).toBe(true);
    expect(
      isVaapiFailure(234, 'Device creation failed: -5. hwaccel initialisation returned error'),
    ).toBe(true);
    expect(
      isVaapiFailure(1, '[AVHWDeviceContext @ 0x1] Failed to initialise VAAPI connection'),
    ).toBe(true);
    expect(isVaapiFailure(1, 'Server returned 404 Not Found')).toBe(false);
    expect(isVaapiFailure(1, 'Connection refused')).toBe(false);
    expect(isVaapiFailure(255, 'Error during demuxing: End of file')).toBe(false);
    expect(isVaapiFailure(0, '[h264_vaapi @ 0x7f] Failed to sync surface')).toBe(false);
    expect(isVaapiFailure(null, '')).toBe(false);
  });
});

describe('createVideoAccel', () => {
  it('prueba los modos en orden y se queda con el primero que sale (y su avcC)', async () => {
    const launcher = new FakeProbeLauncher((args) =>
      args.includes('-low_power') && args.includes('VBR')
        ? { code: 1, stderr: 'No usable encoding entrypoint' }
        : {},
    );
    const accel = accelWith(launcher);
    expect(accel.status().hwaccel).toBe('probing');
    expect(accel.vaapi()).toBeNull();
    await accel.probe();
    await accel.probe();
    expect(accel.vaapi()).toMatchObject({
      lowPower: false,
      rateControl: 'VBR',
      deinterlace: true,
      liteCodecs: 'avc1.640c28',
    });
    expect(accel.status()).toMatchObject({
      hwaccel: 'vaapi',
      encoder: 'h264_vaapi',
      deinterlace: 'vaapi',
      recodeSlots: MAX_RECODE_HW,
      reason: null,
    });
    /* Dos de codificar (el primero falla) y uno de desentrelazar; el segundo probe() no repite. */
    expect(launcher.runs).toHaveLength(3);
  });

  it('sin deinterlace_vaapi: la gráfica para la ligera, bwdif para desentrelazar', async () => {
    const accel = accelWith(
      new FakeProbeLauncher((args) =>
        args.join(' ').includes('deinterlace_vaapi') ? { code: 1, stderr: 'not supported' } : {},
      ),
    );
    await accel.probe();
    expect(accel.vaapi()?.deinterlace).toBe(false);
    expect(accel.status()).toMatchObject({ hwaccel: 'vaapi', deinterlace: 'bwdif' });
    expect(accel.status().reason).toContain('bwdif');
  });

  it('sin gráfica: x264, el tope de CPU y el motivo de ffmpeg', async () => {
    const launcher = new FakeProbeLauncher(() => ({
      code: 1,
      stderr: 'Failed to initialise VAAPI connection: -1 (unknown libva error).',
    }));
    const accel = accelWith(launcher);
    await accel.probe();
    expect(launcher.runs).toHaveLength(VAAPI_CANDIDATES.length);
    expect(accel.vaapi()).toBeNull();
    expect(accel.status()).toMatchObject({ hwaccel: 'none', encoder: 'libx264', recodeSlots: 2 });
    expect(accel.status().reason).toContain('Failed to initialise VAAPI');
  });

  it('sin ffmpeg, un solo intento; con ACE_HWACCEL=off, ninguno', async () => {
    const missing = new FakeProbeLauncher(() => ({ missing: true }));
    const accel = accelWith(missing);
    await accel.probe();
    expect(missing.runs).toHaveLength(1);
    expect(accel.status()).toMatchObject({ hwaccel: 'none', reason: 'no hay ffmpeg' });

    const off = new FakeProbeLauncher(() => ({}));
    const none = accelWith(off, 'off');
    await none.probe();
    expect(off.runs).toHaveLength(0);
    expect(none.status()).toMatchObject({ hwaccel: 'none', reason: 'apagado (ACE_HWACCEL=off)' });
  });

  it('3 fallos seguidos en uso la apagan (uno bueno entre medias pone la cuenta a cero)', async () => {
    const accel = accelWith(new FakeProbeLauncher(() => ({})));
    await accel.probe();
    for (let i = 0; i < HW_FAILURES_TO_DISABLE - 1; i += 1) accel.failed('error');
    accel.succeeded();
    for (let i = 0; i < HW_FAILURES_TO_DISABLE - 1; i += 1) accel.failed('error');
    expect(accel.vaapi()).not.toBeNull();
    accel.failed('Error while filtering: Input/output error');
    expect(accel.vaapi()).toBeNull();
    expect(accel.status()).toMatchObject({ hwaccel: 'none', recodeSlots: 2 });
    expect(accel.status().reason).toContain('Input/output error');
  });
});

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!HAS_FFMPEG || process.platform === 'linux')(
  'ensayo con ffmpeg de verdad (@ffmpeg)',
  () => {
    it('sin VAAPI (Windows/macOS) acaba en x264 con el motivo, sin colgarse', async () => {
      const accel = createVideoAccel({
        launcher: createSpawnLauncher({ stdout: 'pipe', stdin: 'pipe', niceness: 0 }),
        clock: new FakeClock(),
        logger: createSilentLogger(),
        mode: 'auto',
        softwareSlots: 2,
      });
      await accel.probe();
      expect(accel.status()).toMatchObject({ hwaccel: 'none', encoder: 'libx264' });
      expect(accel.status().reason).toBeTruthy();
    }, 60_000);
  },
);
