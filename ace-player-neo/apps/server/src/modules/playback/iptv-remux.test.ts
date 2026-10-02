/* Playback con una IPTV sobre el remux (diagnostico-iptv-0.8.2 B2 y B3), con
   un doble de la IPTV (relé falso) y el ffmpeg falso:
   - el reinicio que pide el relé es continuo y sale `stream.reopened` con
     `seamless: true`; el de AceStream (retarget) sigue sin él;
   - la salida atascada reinicia el remux (y con él la conexión del relé) y,
     si la generación nueva no escribe ni un segmento en `max(10 s, 3×TD)`,
     cierra con `iptv_dropped`; si avanza (aunque tarde en estar lista), no;
   - dos reinicios a la vez (vigilante y relé): manda el último, sin cierre. */

import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelStreamQuery, IptvReason } from '@ace/shared';
import type { FakeClock } from '../../core/clock.js';
import type * as RemuxFiles from '../remux/files.js';
import { ioTurns } from '../remux/test-support.js';
import { IPTV_STALL_MIN_MS } from '../remux/service.js';
import type { IptvInput, IptvService } from '../iptv/types.js';
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

/* Lecturas de index.m3u8 que el remux tiene a medias (E/S real). `step` no adelanta el reloj falso con una
   en curso: en la CI cargada una lectura empezada antes de `writeSegments` cruzaba varios pasos y acababa,
   sin el segmento recién escrito, ya pasado `max(10 s, 3×TD)`, y salía un iptv_dropped que no toca. */
const lecturas = vi.hoisted(() => ({ enCurso: 0 }));

vi.mock('../remux/files.js', async (importOriginal) => {
  const original = await importOriginal<typeof RemuxFiles>();
  return {
    ...original,
    readPlaylistInfo: async (file: string) => {
      lecturas.enCurso += 1;
      try {
        return await original.readPlaylistInfo(file);
      } finally {
        lecturas.enCurso -= 1;
      }
    },
  };
});

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

/**
 * Avanza el reloj a pasos cortos dejando correr la E/S real entre paso y paso: la espera del remux relee la
 * lista (E/S real) antes de volver a aparcarse en el reloj, y así no se salta ninguna vuelta. El paso
 * siguiente no empieza hasta que esa lectura termina: para el reloj falso, leer la lista no lleva tiempo.
 */
async function step(clock: FakeClock, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 250) {
    await clock.advanceAsync(Math.min(250, left));
    await ioTurns(10);
    await until('lectura de la lista terminada', () => lecturas.enCurso === 0);
  }
}

/** Como `step`, pero para en cuanto se cumple `check` (hasta `maxMs` de reloj y luego el tope de `until`). */
async function stepUntil(
  clock: FakeClock,
  what: string,
  check: () => boolean,
  maxMs: number,
): Promise<void> {
  for (let left = maxMs; left > 0 && !check(); left -= 250) await step(clock, 250);
  await until(what, check);
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
  it('lista parada: reinicio continuo (el relé reconecta al engancharse el ffmpeg nuevo); sin segmento nuevo en 10 s, iptv_dropped', async () => {
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
    /* El ffmpeg nuevo tampoco escribe: justo antes de max(10 s, 3×TD) sigue abierta; pasado ese plazo (y
       mucho antes de los 20 s de `iptv_timeout`), iptv_dropped y no remux_died. El reloj ya no avanza
       más: el cierre solo espera a la E/S real. */
    await step(clock, IPTV_STALL_MIN_MS - 500);
    await ioTurns(50);
    expect(events.of('stream.closed')).toEqual([]);
    await step(clock, 1_500);
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

  it('el ffmpeg nuevo tarda en estar listo (GOP de 6 s) pero avanza: no se cierra y sale seamless', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const { runtime, ffmpeg, events, remux, clock } = setup;
    const grant = await runtime.service.acquire(CANAL, query(), web(), live());
    ffmpeg.setAutoSegments(null);
    await remux.watchStalls();
    clock.advance(IPTV_STALL_MIN_MS + 1_000);
    await remux.watchStalls();
    await until('reinicio por atasco', () => ffmpeg.spawned.length === 2);
    /* Relé reconectado, sondeo y el segmento 0 (sin clave) de 6 s: el primer segmento llega a los 8 s. */
    await step(clock, 8_000);
    ffmpeg.last().writeSegments([6]);
    /* Pasados los 10 s todavía no está lista (le falta el segundo segmento), pero avanza: no se cierra. */
    await step(clock, 6_000);
    await ioTurns(50);
    expect(events.of('stream.closed')).toEqual([]);
    ffmpeg.last().writeSegments([6]);
    await stepUntil(clock, 'reabierta', () => events.of('stream.reopened').length > 0, 4_000);
    expect(events.of('stream.reopened')).toEqual([
      expect.objectContaining({ sessionId: grant.session.id, seamless: true }),
    ]);
    expect(events.of('stream.closed')).toEqual([]);
  });

  it('el relé pide otro reinicio a mitad del de atasco: manda el último, sin iptv_dropped', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const { runtime, ffmpeg, events, remux, clock } = setup;
    const grant = await runtime.service.acquire(CANAL, query(), web(), live());
    ffmpeg.setAutoSegments(null);
    await remux.watchStalls();
    clock.advance(IPTV_STALL_MIN_MS + 1_000);
    await remux.watchStalls();
    await until('reinicio por atasco', () => ffmpeg.spawned.length === 2);
    /* El relé cambia de variante: otro reinicio mata la generación 2 antes de que escriba nada. */
    iptv.restart();
    await until('segundo reinicio', () => ffmpeg.spawned.length === 3);
    expect(ffmpeg.spawned[1]?.killed).toBe(true);
    expect(ffmpeg.last().args).toContain('init_3.mp4');
    await ioTurns(50);
    expect(events.of('stream.closed')).toEqual([]);
    ffmpeg.last().writeSegments([2, 2]);
    await stepUntil(clock, 'reabierta', () => events.of('stream.reopened').length > 0, 4_000);
    expect(events.of('stream.reopened')).toEqual([
      expect.objectContaining({ sessionId: grant.session.id, seamless: true }),
    ]);
    expect(events.of('stream.closed')).toEqual([]);
  });
});
