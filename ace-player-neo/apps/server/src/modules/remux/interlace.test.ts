/* IPTV entrelazada para el iPhone (0.9.2): AVPlayer no desentrelaza.
   - Argumentos: `bwdif` + x264 (1080p50, claves cada 2 s) solo con
     `deinterlace`; sin él, `-c:v copy -copyinkf` byte a byte como antes.
   - Veredicto de ffprobe y la sonda por la tubería (init + segmento).
   - Gestor: con un iPhone mirando y aún copiando, sonda sobre lo escrito en
     disco y aviso `onDeinterlace`; la generación siguiente desentrelaza. La
     web sola no paga nada; lo progresivo sigue copiando; el veredicto se
     recuerda por canal; como mucho `MAX_DEINTERLACE` a la vez. */

import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCore } from '../../../test/helpers/index.js';
import { DEINTERLACE_THREADS, buildRemuxArgs } from './args.js';
import {
  COMBING_PROBE_ARGS,
  INTERLACE_PROBE_ARGS,
  interlacedFromFfprobe,
  interlacedFromIdet,
  probeInterlaced,
  type InterlaceSpawner,
} from './interlace.js';
import { MAX_DEINTERLACE, createRemuxRuntime } from './service.js';
import { createFakeLauncher } from './test-support.js';
import type { RemuxSource } from './types.js';

const RELAY = 'http://127.0.0.1:41999/r/AbCdEfGhIjKlMnOpQrStUv/in.ts';
const SID = 's_iptvsesion000000000001';
const HASH = 'c'.repeat(40);

const source = (extra: Partial<RemuxSource> = {}): RemuxSource => ({
  sessionId: SID,
  hash: HASH,
  playbackUrl: RELAY,
  mode: 'hls',
  inputUrl: RELAY,
  origin: 'iptv',
  ...extra,
});

describe('buildRemuxArgs con deinterlace', () => {
  const base = { url: RELAY, dir: '/data/remux/x', sessionId: SID, origin: 'iptv' as const };

  it('bwdif por campos y H.264 High con una clave cada 2 s; sin copiar el vídeo', () => {
    const args = buildRemuxArgs({ ...base, deinterlace: true });
    const at = (name: string) => args[args.indexOf(name) + 1];
    expect(at('-vf')).toBe('bwdif=mode=send_field');
    expect(at('-c:v')).toBe('libx264');
    expect(at('-preset')).toBe('veryfast');
    expect(at('-tune')).toBe('zerolatency');
    expect(at('-profile:v')).toBe('high');
    expect(at('-pix_fmt')).toBe('yuv420p');
    expect(at('-sc_threshold')).toBe('0');
    expect(at('-force_key_frames')).toBe('expr:gte(t,n_forced*2)');
    /* Los segmentos HLS siguen siendo de 2 s: una clave por segmento. */
    expect(at('-hls_time')).toBe('2');
    expect(args).not.toContain('copy');
    expect(args).not.toContain('-copyinkf');
    /* Sin escalar: 1080 se queda en 1080. */
    expect(args.join(' ')).not.toMatch(/scale|720/);
    /* `-threads:v` detrás del `-threads 2` del audio (el más concreto manda). */
    expect(args.indexOf('-threads:v')).toBeGreaterThan(args.indexOf('-threads'));
    expect(at('-threads:v')).toBe(String(DEINTERLACE_THREADS));
    /* El audio no cambia. */
    expect(at('-c:a')).toBe('aac');
    expect(at('-b:a')).toBe('160k');
  });

  it('sin deinterlace, los mismos argumentos de siempre', () => {
    expect(buildRemuxArgs({ ...base, deinterlace: false })).toEqual(buildRemuxArgs(base));
    const args = buildRemuxArgs(base);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).toContain('-copyinkf');
    expect(args).not.toContain('-threads:v');
    expect(args.join(' ')).not.toContain('bwdif');
  });
});

describe('veredicto de ffprobe', () => {
  it('entrelazado si lo son al menos la mitad de las imágenes; null sin imágenes', () => {
    expect(interlacedFromFfprobe('1\n1\n1,\n1\n')).toBe(true);
    expect(interlacedFromFfprobe('0\n0\n0\n0\n')).toBe(false);
    expect(interlacedFromFfprobe('1\r\n0\r\n')).toBe(true);
    expect(interlacedFromFfprobe('0\n0\n0\n1\n')).toBe(false);
    expect(interlacedFromFfprobe('')).toBe(null);
    expect(interlacedFromFfprobe('[mov] partial file\n')).toBe(null);
    /* Con la altura al lado (0.9.6). */
    expect(interlacedFromFfprobe('height=1080\ninterlaced_frame=1\n'.repeat(4))).toBe(true);
    expect(interlacedFromFfprobe('height=1080\ninterlaced_frame=0\n'.repeat(4))).toBe(false);
  });
});

describe('veredicto de idet (0.9.6: entrelazado camuflado)', () => {
  const linea = (f: string) => `frame:0 pts:0 pts_time:0\nlavfi.idet.multiple.current_frame=${f}\n`;
  it('peinado si TFF + BFF superan a las progresivas y son al menos 8; null sin datos', () => {
    expect(interlacedFromIdet(linea('tff').repeat(40))).toBe(true);
    expect(interlacedFromIdet(linea('bff').repeat(10) + linea('progressive').repeat(5))).toBe(true);
    expect(interlacedFromIdet(linea('progressive').repeat(40))).toBe(false);
    expect(interlacedFromIdet(linea('tff').repeat(5) + linea('undetermined').repeat(30))).toBe(
      false,
    );
    expect(interlacedFromIdet(linea('tff').repeat(20) + linea('progressive').repeat(25))).toBe(
      false,
    );
    expect(interlacedFromIdet('')).toBe(null);
  });
});

describe('probeInterlaced (ffprobe por la tubería)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  function files(): string[] {
    const dir = mkdtempSync(path.join(tmpdir(), 'ace-interlace-'));
    dirs.push(dir);
    writeFileSync(path.join(dir, 'init.mp4'), 'INIT');
    writeFileSync(path.join(dir, 'index0.m4s'), 'SEG0');
    return [path.join(dir, 'init.mp4'), path.join(dir, 'index0.m4s')];
  }

  /** ffprobe de pega: junta lo que le llega por stdin y contesta `answer` al cerrarse. */
  function fakeProbe(answer: string) {
    const calls: { command: string; args: readonly string[]; stdin: string }[] = [];
    const spawner: InterlaceSpawner = (command, args) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        kill: () => boolean;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.kill = () => true;
      const call = { command, args, stdin: '' };
      calls.push(call);
      child.stdin.on('data', (chunk: Buffer) => {
        call.stdin += chunk.toString();
      });
      child.stdin.on('finish', () => {
        child.stdout.end(answer);
        child.stdout.on('end', () => child.emit('close', 0));
        child.stdout.resume();
      });
      return child as never;
    };
    return { spawner, calls };
  }

  it('manda el init y el segmento seguidos y lee el veredicto', async () => {
    const probe = fakeProbe('1\n1\n1\n');
    const verdict = await probeInterlaced(files(), new AbortController().signal, probe.spawner);
    expect(verdict).toBe(true);
    expect(probe.calls[0]?.command).toBe('ffprobe');
    expect(probe.calls[0]?.args).toEqual(INTERLACE_PROBE_ARGS);
    expect(probe.calls[0]?.stdin).toBe('INITSEG0');
  });

  it('la marca dice progresivo: se mira la imagen con idet (las mismas imágenes)', async () => {
    const calls: { command: string; args: readonly string[]; stdin: string }[] = [];
    const answers: Record<string, string> = {
      ffprobe: '0\n0\n0\n',
      ffmpeg: 'lavfi.idet.multiple.current_frame=tff\n'.repeat(30),
    };
    const spawner: InterlaceSpawner = (command, args) => {
      const one = fakeProbe(answers[command] ?? '');
      const child = one.spawner(command, args);
      calls.push(one.calls[0] as (typeof calls)[number]);
      return child;
    };
    expect(await probeInterlaced(files(), new AbortController().signal, spawner)).toBe(true);
    expect(calls.map((c) => c.command)).toEqual(['ffprobe', 'ffmpeg']);
    expect(calls[1]?.args).toEqual(COMBING_PROBE_ARGS);
    expect(calls[1]?.stdin).toBe('INITSEG0');
  });

  it('la marca dice entrelazado: no hace falta mirar más; progresivo de verdad: false', async () => {
    const marcado = fakeProbe('1\n1\n1\n');
    expect(await probeInterlaced(files(), new AbortController().signal, marcado.spawner)).toBe(
      true,
    );
    expect(marcado.calls.map((c) => c.command)).toEqual(['ffprobe']);
    const progresivo = fakeProbe(
      '0\n0\n0\nlavfi.idet.multiple.current_frame=progressive\n'.repeat(20),
    );
    /* Poca altura: ni se mira la imagen (720p50 o SD nunca vienen peinados en un 1080i). */
    const bajo = fakeProbe('height=720\ninterlaced_frame=0\n'.repeat(3));
    expect(await probeInterlaced(files(), new AbortController().signal, bajo.spawner)).toBe(false);
    expect(bajo.calls.map((c) => c.command)).toEqual(['ffprobe']);
    expect(await probeInterlaced(files(), new AbortController().signal, progresivo.spawner)).toBe(
      false,
    );
  });

  it('sin ffprobe o con la señal cancelada: null, nunca lanza', async () => {
    const missing: InterlaceSpawner = () => {
      throw Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' });
    };
    expect(await probeInterlaced(files(), new AbortController().signal, missing)).toBe(null);
    const aborted = new AbortController();
    aborted.abort();
    expect(await probeInterlaced(files(), aborted.signal, fakeProbe('1\n').spawner)).toBe(null);
  });
});

describe('remux de una IPTV entrelazada con un iPhone mirando', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  function runtime(verdict: boolean | null = true) {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher();
    const probes: string[][] = [];
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher: ffmpeg.launcher,
      procRoot: null,
      watchFiles: false,
      probeInterlaced: async (list) => {
        probes.push([...list]);
        return verdict;
      },
    });
    const asks: string[] = [];
    rt.service.subscribe({ onDeinterlace: (sessionId) => asks.push(sessionId) });
    stops.push(() => rt.service.stopAll());
    return { ffmpeg, rt, probes, asks };
  }

  it('sonda sobre el init y el primer segmento de disco, aviso, y la generación siguiente desentrelaza', async () => {
    const { ffmpeg, rt, probes, asks } = runtime(true);
    let ios = true;
    const src = source({ wantsDeinterlace: () => ios });
    await rt.service.ensure(src, 'v_ios');
    await rt.interlaceChecks();
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(ffmpeg.last().args).toContain('copy');
    expect(probes).toHaveLength(1);
    expect(probes[0]?.map((file) => path.basename(file))).toEqual(['init.mp4', 'index0.m4s']);
    expect(asks).toEqual([SID]);
    /* Lo que hace playback con el aviso: un reinicio continuo. */
    const handle = await rt.service.restart(SID);
    expect(handle?.seamless).toBe(true);
    const second = ffmpeg.last();
    expect(second).not.toBe(ffmpeg.spawned[0]);
    expect(second.args).toContain('bwdif=mode=send_field');
    expect(second.args).toContain('init_2.mp4');
    expect(rt.entries()[0]?.deinterlace).toBe(true);
    await rt.interlaceChecks();
    expect(probes).toHaveLength(1);
    expect(asks).toEqual([SID]);
    /* Otro reinicio (atasco o relé) con el iPhone ya fuera: vuelve a copiar. */
    ios = false;
    await rt.service.restart(SID);
    expect(ffmpeg.last().args).toContain('copy');
    expect(rt.entries()[0]?.deinterlace).toBe(false);
  });

  it('con el canal ya conocido como entrelazado, el primer ffmpeg del iPhone desentrelaza directamente', async () => {
    const { ffmpeg, rt, probes, asks } = runtime(true);
    const src = source({ wantsDeinterlace: () => true });
    await rt.service.ensure(src, 'v_ios');
    await rt.interlaceChecks();
    await rt.service.stopAll();
    await rt.service.ensure(src, 'v_ios');
    await rt.interlaceChecks();
    expect(ffmpeg.last().args).toContain('bwdif=mode=send_field');
    expect(probes).toHaveLength(1);
    expect(asks).toEqual([SID]);
  });

  it('la web sola (sin iPhone) ni sondea ni desentrelaza', async () => {
    const { ffmpeg, rt, probes, asks } = runtime(true);
    await rt.service.ensure(source({ wantsDeinterlace: () => false }), 'v_web');
    await rt.service.ensure(source(), 'v_web2');
    await rt.interlaceChecks();
    expect(probes).toEqual([]);
    expect(asks).toEqual([]);
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(ffmpeg.last().args).toContain('copy');
  });

  it('progresivo: sigue copiando y el veredicto se recuerda (una sola sonda)', async () => {
    const { ffmpeg, rt, probes, asks } = runtime(false);
    const src = source({ wantsDeinterlace: () => true });
    await rt.service.ensure(src, 'v_ios');
    await rt.interlaceChecks();
    await rt.service.ensure(src, 'v_ios2');
    await rt.interlaceChecks();
    expect(probes).toHaveLength(1);
    expect(asks).toEqual([]);
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(ffmpeg.last().args).toContain('copy');
  });

  it('sonda sin veredicto (null): sigue copiando y lo vuelve a intentar con el siguiente visor', async () => {
    const { rt, probes, asks } = runtime(null);
    const src = source({ wantsDeinterlace: () => true });
    await rt.service.ensure(src, 'v_ios');
    await rt.interlaceChecks();
    await rt.service.ensure(src, 'v_ios2');
    await rt.interlaceChecks();
    expect(probes).toHaveLength(2);
    expect(asks).toEqual([]);
  });

  it('AceStream nunca se sondea', async () => {
    const { rt, probes } = runtime(true);
    await rt.service.ensure(
      source({ origin: 'engine', inputUrl: undefined, wantsDeinterlace: () => true }),
      'v_ios',
    );
    await rt.interlaceChecks();
    expect(probes).toEqual([]);
  });

  it(`como mucho ${MAX_DEINTERLACE} canales desentrelazando a la vez; el resto sigue copiando`, async () => {
    const { ffmpeg, rt, asks } = runtime(true);
    const hashes = ['a', 'b', 'd'].map((letter) => letter.repeat(40));
    const sources = hashes.map((hash, index) =>
      source({
        hash,
        sessionId: `s_iptvsesion00000000000${index + 2}`,
        wantsDeinterlace: () => true,
      }),
    );
    for (const src of sources) {
      await rt.service.ensure(src, `v_${src.hash.slice(0, 1)}`);
      await rt.interlaceChecks();
    }
    expect(asks).toHaveLength(3);
    for (const src of sources) await rt.service.restart(src.sessionId);
    const flags = rt.entries().map((entry) => entry.deinterlace);
    expect(flags.filter(Boolean)).toHaveLength(MAX_DEINTERLACE);
    expect(
      ffmpeg.spawned.filter((proc) => proc.args.includes('bwdif=mode=send_field')),
    ).toHaveLength(MAX_DEINTERLACE);
    await rt.interlaceChecks();
    /* El tercero no pide otro reinicio en bucle: sin hueco, no avisa. */
    expect(asks).toHaveLength(3);
  });
});

const HAS_X264 =
  spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes(
    'libx264',
  ) ?? false;

describe.skipIf(!HAS_X264)('probeInterlaced con ffmpeg de verdad (@ffmpeg)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  /* Un canal de 2 s en fMP4 troceado como el remux (init + primer segmento): con las imágenes peinadas por
     `interlace` y, si `camuflado`, marcadas como progresivas (como DAZN y M+ LaLiga en el proveedor de Isma). */
  function canal(peinado: boolean, camuflado: boolean, alto = 1080, fps = 25): string[] {
    const ancho = Math.round((alto * 16) / 9 / 2) * 2;
    const dir = mkdtempSync(path.join(tmpdir(), 'ace-idet-'));
    dirs.push(dir);
    const r = spawnSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-t', '2'],
      ...['-i', `testsrc2=size=${ancho}x${alto}:rate=${peinado ? 50 : fps},format=yuv420p`],
      ...(peinado ? ['-vf', 'interlace=scan=tff'] : []),
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50'],
      ...(peinado && !camuflado ? ['-flags', '+ildct+ilme', '-x264-params', 'tff=1'] : []),
      ...[
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_segment_type',
        'fmp4',
        '-hls_fmp4_init_filename',
        'init.mp4',
      ],
      path.join(dir, 'index.m3u8'),
    ]);
    expect(r.status).toBe(0);
    const seg = readdirSync(dir).find((f) => f.endsWith('.m4s')) as string;
    return [path.join(dir, 'init.mp4'), path.join(dir, seg)];
  }

  it('camuflado (peinado y marcado progresivo): entrelazado', async () => {
    expect(await probeInterlaced(canal(true, true), new AbortController().signal)).toBe(true);
  });

  it('marcado entrelazado: entrelazado; progresivo de verdad (1080p25, 720p50, 360p): no', async () => {
    expect(await probeInterlaced(canal(true, false), new AbortController().signal)).toBe(true);
    expect(await probeInterlaced(canal(false, false), new AbortController().signal)).toBe(false);
    expect(await probeInterlaced(canal(false, false, 720, 50), new AbortController().signal)).toBe(
      false,
    );
    expect(await probeInterlaced(canal(false, false, 360, 25), new AbortController().signal)).toBe(
      false,
    );
  });
});
