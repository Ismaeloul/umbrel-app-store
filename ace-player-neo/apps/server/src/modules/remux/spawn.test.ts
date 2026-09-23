/* El lanzador real (`child_process.spawn`) con un ffmpeg falso hecho en node:
   proceso de verdad, `fs.watch` de la carpeta, stderr al búfer circular y
   kill al soltarlo. Y sin ffmpeg instalado, `ffmpeg_missing` sin romper nada.

   El proceso hijo corre en tiempo real; el reloj del servicio sigue siendo
   el falso (solo se avanza para la relectura de respaldo). */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCore, tempDir, type FakeClock } from '../../../test/helpers/index.js';
import { isAppError } from '../../core/errors.js';
import { notImplementedService } from '../../core/stub.js';
import type { EngineService } from '../engine/types.js';
import { createSpawnLauncher } from './process.js';
import { READY_POLL_MS, createRemuxRuntime, type RemuxRuntime } from './service.js';
import { FAKE_FFMPEG_SCRIPT } from './test-support.js';

const HASH = 'c'.repeat(40);
const SID = 's_procesoreal1';

const runtimes: RemuxRuntime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.service.stop();
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Espera real con tope (el hijo es un proceso de verdad). */
async function until(check: () => boolean, maxMs = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > maxMs) throw new Error('tiempo agotado esperando al proceso');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Mientras la promesa no termina, avanza el reloj falso de la relectura de respaldo. */
async function drive<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let step = 0; step < 40 && !settled; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!settled) await clock.advanceAsync(READY_POLL_MS);
  }
  return promise;
}

function runtimeWith(launcherCommand: string, prefixArgs: string[] = []) {
  const core = createTestCore();
  const runtime = createRemuxRuntime({
    ...core,
    engine: notImplementedService<EngineService>('engine'),
    launcher: createSpawnLauncher({ command: launcherCommand, prefixArgs }),
    procRoot: null,
  });
  runtimes.push(runtime);
  return { core, runtime };
}

describe('ffmpeg de verdad (proceso hijo)', () => {
  it('lanza el proceso, espera la lista, guarda su stderr y lo mata al soltar al último visor', async () => {
    const dir = tempDir('ffmpeg-falso-');
    const script = path.join(dir, 'ffmpeg.cjs');
    writeFileSync(script, FAKE_FFMPEG_SCRIPT);
    const { core, runtime } = runtimeWith(process.execPath, [script]);
    const source = {
      sessionId: SID,
      hash: HASH,
      playbackUrl: `/ace/r/${HASH}/x`,
      mode: 'progressive' as const,
    };
    const handle = await drive(core.clock, runtime.service.ensure(source, 'visor-1'));
    expect(handle.ready).toBe(true);
    const pid = runtime.entries()[0]?.pid as number;
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid)).toBe(true);
    await until(() => (runtime.entries()[0]?.log ?? '').includes('ffmpeg falso'));
    expect(runtime.entries()[0]?.log).toContain(`ace_session=${SID}`);
    await runtime.service.detach(SID, 'visor-1');
    await until(() => !isAlive(pid));
    expect(runtime.service.stats().sessions).toBe(0);
  });

  it('sin ffmpeg instalado: ffmpeg_missing y el remux queda desactivado', async () => {
    const { runtime } = runtimeWith(`ffmpeg-que-no-existe-${process.pid}`);
    const source = {
      sessionId: SID,
      hash: HASH,
      playbackUrl: `/ace/r/${HASH}/x`,
      mode: 'progressive' as const,
    };
    const error = await runtime.service
      .ensure(source, 'visor-1')
      .catch((reason: unknown) => reason);
    expect(isAppError(error) && error.code).toBe('ffmpeg_missing');
    expect(runtime.service.stats()).toMatchObject({ ffmpegMissing: true, sessions: 0 });
    await runtime.idle();
    expect(runtime.entries()).toEqual([]);
  });
});
