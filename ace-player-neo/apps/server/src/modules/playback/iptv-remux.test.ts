/* Playback con una IPTV sobre el remux (diagnostico-iptv-0.8.2 B2 y B3), con
   un doble de la IPTV (relé falso) y el ffmpeg falso:
   - el reinicio que pide el relé es continuo y sale `stream.reopened` con
     `seamless: true`; el de AceStream (retarget) sigue sin él;
   - la salida atascada reinicia el remux (y con él la conexión del relé) y,
     si tampoco avanza en `IPTV_STALL_RECOVER_MS`, cierra con `iptv_dropped`. */

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { ChannelStreamQuery, IptvReason } from '@ace/shared';
import { ioTurns } from '../remux/test-support.js';
import { IPTV_STALL_MIN_MS } from '../remux/service.js';
import type { IptvInput, IptvService } from '../iptv/types.js';
import { IPTV_STALL_RECOVER_MS } from './service.js';
import { partial, setupPlayback } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const CANAL = 'e'.repeat(40);
const live = (): AbortSignal => new AbortController().signal;
const query = (): ChannelStreamQuery => ({
  client: 'web',
  kind: 'auto',
  mode: 'balanced',
  viewer: 'visor-web',
});
const web = (): ViewerIdentity => ({ viewerId: 'visor-web', deviceId: 'pc', device: null });

/** Doble de la IPTV: un canal propio y un relé que avisa cuando el test quiere. */
function fakeIptv() {
  const restarts: (() => void)[] = [];
  const drops: ((code: IptvReason) => void)[] = [];
  const input: IptvInput = {
    id: CANAL,
    inputUrl: 'http://127.0.0.1:41999/r/TICKET/in.ts',
    isHls: false,
    title: 'La 1 --> Mi IPTV',
    stats: () => ({ bytes: 0, kbps: 0, lastByteAt: null }),
    onDropped: (listener) => drops.push(listener),
    onRestart: (listener) => restarts.push(listener),
    close: async () => undefined,
  };
  const service = partial<IptvService>('iptv', {
    classify: () => 'owned',
    titleOf: () => 'La 1',
    openInput: async () => input,
    subscribe: () => () => undefined,
  });
  return { service, restart: () => restarts.forEach((listener) => listener()) };
}

/** Deja correr la E/S real (con un tope en tiempo real) hasta que se cumpla `check`. */
async function until(what: string, check: () => boolean): Promise<void> {
  const limit = performance.now() + 3_000;
  while (!check() && performance.now() < limit) await ioTurns(1);
  expect(check(), what).toBe(true);
}

describe('IPTV: reinicio continuo del remux (B2)', () => {
  it('el relé pide reiniciar: ffmpeg nuevo con la numeración seguida y stream.reopened seamless', async () => {
    const iptv = fakeIptv();
    const { runtime, ffmpeg, events } = await setupPlayback({ iptv: iptv.service });
    const grant = await runtime.service.acquire(CANAL, query(), web(), live());
    expect(grant.protocol).toBe('hls');
    expect(ffmpeg.spawned).toHaveLength(1);
    iptv.restart();
    await until('reinicio', () => events.of('stream.reopened').length > 0);
    const second = ffmpeg.last();
    expect(ffmpeg.spawned).toHaveLength(2);
    expect(second.args[second.args.indexOf('-start_number') + 1]).toBe('3');
    expect(second.args).toContain('init_2.mp4');
    expect(events.of('stream.reopened')).toEqual([
      {
        sessionId: grant.session.id,
        viewerIds: ['visor-web'],
        url: grant.url,
        protocol: 'hls',
        reason: 'remux_restart',
        seamless: true,
      },
    ]);
    expect(events.of('stream.closed')).toEqual([]);
  });
});

describe('IPTV: vigilante de salida (B3)', () => {
  it('lista parada: reinicio continuo (el relé reconecta al engancharse el ffmpeg nuevo); sin lista nueva en 10 s, iptv_dropped', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const { runtime, ffmpeg, events, remux, clock } = setup;
    const grant = await runtime.service.acquire(CANAL, query(), web(), live());
    /* El ffmpeg del reinicio no escribirá nada. */
    ffmpeg.setAutoSegments(null);
    /* 10 s sin que la lista cambie: un aviso, un reinicio continuo. */
    await remux.watchStalls();
    clock.advance(IPTV_STALL_MIN_MS + 1_000);
    await remux.watchStalls();
    await until('reinicio por atasco', () => ffmpeg.spawned.length === 2);
    expect(ffmpeg.spawned[0]?.killed).toBe(true);
    expect(ffmpeg.last().args).toContain('init_2.mp4');
    /* Un segundo aviso del mismo atasco no lanza otro reinicio. */
    await remux.watchStalls();
    expect(ffmpeg.spawned).toHaveLength(2);
    /* El ffmpeg nuevo tampoco escribe: justo antes de IPTV_STALL_RECOVER_MS sigue abierta; pasado ese
       plazo (y mucho antes de los 20 s de `iptv_timeout`), iptv_dropped y no remux_died. El reloj ya no
       avanza más: el cierre solo espera a la E/S real. */
    await clock.advanceAsync(IPTV_STALL_RECOVER_MS - 500);
    await ioTurns(50);
    expect(events.of('stream.closed')).toEqual([]);
    await clock.advanceAsync(1_000);
    await until('cerrada', () => events.of('stream.closed').length > 0);
    expect(events.of('stream.closed')).toEqual([
      expect.objectContaining({
        sessionId: grant.session.id,
        reason: 'remux_failed',
        code: 'iptv_dropped',
      }),
    ]);
    expect(events.of('stream.reopened')).toEqual([]);
  });

  it('lista parada y el ffmpeg nuevo sí escribe: seamless y sin cierre', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const { runtime, ffmpeg, events, remux, clock } = setup;
    const grant = await runtime.service.acquire(CANAL, query(), web(), live());
    await remux.watchStalls();
    clock.advance(IPTV_STALL_MIN_MS + 1_000);
    await remux.watchStalls();
    await until('reabierta', () => events.of('stream.reopened').length > 0);
    expect(events.of('stream.reopened')[0]).toMatchObject({
      sessionId: grant.session.id,
      reason: 'remux_restart',
      seamless: true,
    });
    expect(ffmpeg.spawned).toHaveLength(2);
    expect(events.of('stream.closed')).toEqual([]);
  });
});
