/* Una ejecución de ffmpeg del VOD (docs/vod.md §9.7): cómo acaba (completa,
   matada o fallida), la contrapresión por motivos, sin ffmpeg →
   `ffmpeg_missing`, una salida rota mata el proceso, y con procesos de
   verdad (`createSpawnLauncher({ stdout: 'pipe' })`): matar no deja ningún
   hijo vivo (también en Windows). Con ffmpeg (@ffmpeg), una ejecución real
   sobre una muestra acaba «completa» con sus fragmentos. */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../../../test/helpers/index.js';
import { FakeFfmpegLauncher } from '../../../../test/fake-vod/fake-ffmpeg.js';
import { HAS_FFMPEG, ensureVodSample } from '../../../../test/fake-vod/samples.js';
import { createSpawnLauncher } from '../process.js';
import type { Fmp4FragmentInfo, Fmp4Handlers } from './fmp4.js';
import { VodRun } from './run.js';

const MOVIE = { keyframes: [0, 2, 4, 6, 8, 10], durationS: 12 };

function recorder(): { handlers: Fmp4Handlers; fragments: Fmp4FragmentInfo[]; inits: number } {
  const out = { fragments: [] as Fmp4FragmentInfo[], inits: 0 };
  return {
    get inits() {
      return out.inits;
    },
    fragments: out.fragments,
    handlers: {
      onInit: () => (out.inits += 1),
      onFragment: (info) => out.fragments.push(info),
      onData: () => undefined,
      onFragmentEnd: () => undefined,
    },
  };
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, maxMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > maxMs) throw new Error('tiempo agotado');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('VodRun con el ffmpeg falso', () => {
  it('código 0 con la salida entera = completa', async () => {
    const launcher = new FakeFfmpegLauncher(MOVIE, { stderr: 'Non-monotonic DTS; changing to 1' });
    const rec = recorder();
    const run = new VodRun({ launcher, args: [], handlers: rec.handlers });
    expect(await run.ended).toEqual({ kind: 'complete' });
    expect(rec.inits).toBe(1);
    expect(rec.fragments.map((f) => f.startS)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(run.stderrTail()).toContain('Non-monotonic DTS');
    expect(run.finished).toBe(true);
  });

  it('otro código = fallida (vod_dropped con la cola de stderr redactada)', async () => {
    const launcher = new FakeFfmpegLauncher(MOVIE, { failAfter: () => 2, stderr: 'clave=secreta' });
    const run = new VodRun({
      launcher,
      args: [],
      handlers: recorder().handlers,
      redact: (text) => text.replace('secreta', '•••'),
    });
    const end = await run.ended;
    expect(end.kind).toBe('failed');
    if (end.kind === 'failed') {
      expect(end.error.code).toBe('vod_dropped');
      expect(end.code).toBe(1);
      expect(end.error.detail).not.toContain('secreta');
    }
  });

  it('matarla = matada, y no queda ningún proceso', async () => {
    const launcher = new FakeFfmpegLauncher(MOVIE, { fragmentDelayMs: 200 });
    const run = new VodRun({ launcher, args: [], handlers: recorder().handlers });
    expect(await run.kill()).toEqual({ kind: 'killed' });
    expect(launcher.alive).toBe(0);
  });

  it('la contrapresión va por motivos: sigue cuando no queda ninguno', async () => {
    const launcher = new FakeFfmpegLauncher(MOVIE, { fragmentDelayMs: 20 });
    const rec = recorder();
    const run = new VodRun({ launcher, args: [], handlers: rec.handlers });
    run.pause('adelanto');
    run.pause('disco');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const stopped = rec.fragments.length;
    expect(stopped).toBeLessThanOrEqual(2);
    run.resume('disco');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(rec.fragments.length).toBe(stopped);
    expect(run.isPaused('adelanto')).toBe(true);
    run.resume('adelanto');
    expect(await run.ended).toEqual({ kind: 'complete' });
    expect(rec.fragments).toHaveLength(6);
  });
});

describe('VodRun con procesos de verdad', () => {
  it('sin ffmpeg → ffmpeg_missing', async () => {
    const launcher = createSpawnLauncher({ command: 'ffmpeg-que-no-existe-ace', stdout: 'pipe' });
    const end = await new VodRun({ launcher, args: [], handlers: recorder().handlers }).ended;
    expect(end.kind).toBe('failed');
    if (end.kind === 'failed') expect(end.error.code).toBe('ffmpeg_missing');
  });

  it('una salida rota (mdat sin moof) mata el proceso y es fallida', async () => {
    const dir = tempDir('ace-vod-run-');
    const script = path.join(dir, 'roto.cjs');
    writeFileSync(
      script,
      [
        'const box = Buffer.alloc(16); box.writeUInt32BE(16); box.write("mdat", 4, "latin1");',
        'process.stdout.write(box);',
        'setInterval(() => process.stdout.write(Buffer.alloc(1024)), 20);',
      ].join('\n'),
    );
    const launcher = createSpawnLauncher({
      command: process.execPath,
      prefixArgs: [script],
      stdout: 'pipe',
    });
    const run = new VodRun({ launcher, args: [], handlers: recorder().handlers });
    const end = await run.ended;
    expect(end.kind).toBe('failed');
    if (end.kind === 'failed') expect(end.error.code).toBe('vod_dropped');
    await until(() => !isAlive(run.pid));
  });

  it('matar un proceso que escribe sin parar (y que está en pausa) no deja hijos vivos', async () => {
    const dir = tempDir('ace-vod-run-');
    const script = path.join(dir, 'grifo.cjs');
    writeFileSync(
      script,
      'const chunk = Buffer.alloc(65536, 7); const loop = () => process.stdout.write(chunk) ? setImmediate(loop) : process.stdout.once("drain", loop); loop();',
    );
    const launcher = createSpawnLauncher({
      command: process.execPath,
      prefixArgs: [script],
      stdout: 'pipe',
    });
    const run = new VodRun({ launcher, args: [], handlers: recorder().handlers });
    run.pause('adelanto');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(isAlive(run.pid)).toBe(true);
    /* La salida es basura, pero en pausa no se lee: sigue viva hasta que se mata. */
    expect(await run.kill()).toEqual({ kind: 'killed' });
    await until(() => !isAlive(run.pid));
  });
});

describe.skipIf(!HAS_FFMPEG)('VodRun con ffmpeg de verdad (@ffmpeg)', () => {
  it('una muestra entera sale completa, con sus fragmentos en sus fotogramas clave', async () => {
    /* Prioridad normal: en Windows «nice 10» puede quedarse sin turno con la CPU llena. */
    const launcher = createSpawnLauncher({ stdout: 'pipe', niceness: 0 });
    const rec = recorder();
    const run = new VodRun({
      launcher,
      args: [
        ...['-hide_banner', '-loglevel', 'warning', '-nostdin'],
        ...['-i', ensureVodSample('mkv-h264-ac3'), '-map', '0:v:0', '-map', '0:a:0'],
        ...['-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-copyts'],
        ...['-movflags', '+frag_keyframe+delay_moov+default_base_moof+frag_discont'],
        ...['-f', 'mp4', 'pipe:1'],
      ],
      handlers: rec.handlers,
    });
    expect(await run.ended).toEqual({ kind: 'complete' });
    expect(rec.inits).toBe(1);
    expect(rec.fragments.length).toBe(24);
    expect(rec.fragments.slice(0, 3).map((f) => f.startS)).toEqual([0, 2.5, 5]);
    expect(rec.fragments.every((f) => f.firstIsSync)).toBe(true);
  });
});
