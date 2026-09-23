/* Estrés del SessionManager contra el motor falso: 200 reproducciones
   abiertas y cerradas de todas las formas (web, iPhone con remux, dos
   visores que comparten, cambio de canal y revocación). Al final no puede
   quedar ninguna sesión en el motor ni en sessions.json, ningún
   temporizador, ningún ffmpeg, ninguna cola y la memoria tiene que volver a
   su nivel (con `--expose-gc` la medida es exacta; sin él, holgada). */

import { describe, expect, it } from 'vitest';
import type { ChannelStreamQuery } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { setupPlayback, type PlaybackSetup } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const live = (): AbortSignal => new AbortController().signal;

function query(viewer: string, client: 'web' | 'ios' = 'web'): ChannelStreamQuery {
  return { client, kind: 'auto', mode: 'balanced', viewer };
}

function web(viewerId: string, deviceId: string): ViewerIdentity {
  return { viewerId, deviceId, device: null };
}

function ios(viewerId: string, deviceId: string): ViewerIdentity {
  const device = {
    deviceId,
    device: { id: deviceId },
    via: 'bearer',
  } as unknown as AuthenticatedDevice;
  return { viewerId, deviceId, device };
}

async function play(setup: PlaybackSetup, round: number): Promise<void> {
  const service = setup.runtime.service;
  const hash = demoContentId((round % 7) + 1);
  const other = demoContentId(((round + 3) % 7) + 1);
  const viewer = `visor-${round}`;
  const release = (sid: string, id: string) =>
    service.release(sid, { viewer: id, reason: 'user' }, web(id, 'x'));
  switch (round % 4) {
    case 0: {
      const grant = await service.acquire(
        hash,
        query(viewer, 'ios'),
        ios(viewer, `iphone-${round}`),
        live(),
      );
      await release(grant.session.id, viewer);
      break;
    }
    case 1: {
      const first = await service.acquire(hash, query(viewer), web(viewer, `pc-${round}`), live());
      await service.acquire(hash, query(`${viewer}-b`), web(`${viewer}-b`, `tv-${round}`), live());
      await release(first.session.id, viewer);
      await release(first.session.id, `${viewer}-b`);
      break;
    }
    case 2: {
      await service.acquire(hash, query(viewer), web(viewer, `pc-${round}`), live());
      const moved = await service.acquire(other, query(viewer), web(viewer, `pc-${round}`), live());
      await release(moved.session.id, viewer);
      break;
    }
    default: {
      await service.acquire(hash, query(viewer), web(viewer, `movil-${round}`), live());
      await service.releaseDevice(`movil-${round}`);
    }
  }
}

function heapUsed(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  gc?.();
  return process.memoryUsage().heapUsed;
}

describe('estrés: 200 reproducciones sin dejar nada detrás', () => {
  it(
    'no quedan sesiones, temporizadores, procesos, colas ni memoria',
    { timeout: 120_000 },
    async () => {
      const setup = await setupPlayback();
      const { runtime, clock, fakeEngine, ffmpeg, remux, state } = setup;
      for (let round = 0; round < 20; round += 1) await play(setup, round);
      await runtime.idle();
      const before = heapUsed();
      const opened = fakeEngine.control.metrics().sessionsOpened;

      for (let round = 20; round < 220; round += 1) await play(setup, round);
      await runtime.idle();
      await remux.idle();

      const metrics = fakeEngine.control.metrics();
      expect(metrics.sessionsOpened - opened).toBeGreaterThanOrEqual(200);
      expect(metrics.sessionsOpen).toBe(0);
      expect(metrics.sessionsExpired).toBe(0);
      expect(runtime.inspect()).toEqual({
        sessions: [],
        viewers: [],
        viewerQueues: 0,
        background: 0,
        ticking: false,
      });
      expect(clock.pendingTimers()).toBe(0);
      expect(ffmpeg.alive()).toBe(0);
      expect(ffmpeg.spawned.length).toBe(55);
      expect(remux.service.stats().sessions).toBe(0);
      expect(state.sessions().read().sessions).toEqual([]);

      const growth = heapUsed() - before;
      const exposed = typeof (globalThis as { gc?: unknown }).gc === 'function';
      expect(growth).toBeLessThan((exposed ? 8 : 64) * 1024 * 1024);
    },
  );
});
