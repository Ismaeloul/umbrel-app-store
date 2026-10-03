/* «Arranque instantáneo» en playback (D24): la sesión preparada sin visor.
   Con el motor falso y FakeClock (AceStream) y con un doble de la IPTV y el
   ffmpeg falso (relé + remux):
   - con la casa libre se abre la fuente y el «Ver» la reutiliza (sin otra
     apertura en el motor ni otro ffmpeg);
   - no sale en «Dónde se está reproduciendo», no escribe el mando ni manda
     `stream.*`: no es una reproducción;
   - nunca con algo sonando (D5) y cede al momento ante otro canal (cerrar
     antes de abrir), ante un 0.6.x o al soltarla;
   - IPTV: nunca con la plaza ocupada o recién soltada (§7). */

import { describe, expect, it, vi } from 'vitest';
import type { ChannelStreamQuery } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import type { IptvInput, IptvService } from '../iptv/types.js';
import { partial, setupPlayback } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const X = demoContentId(1);
const Y = demoContentId(2);
const CANAL_IPTV = 'e'.repeat(40);

const live = (): AbortSignal => new AbortController().signal;
const query = (over: Partial<ChannelStreamQuery> = {}): ChannelStreamQuery => ({
  client: 'web',
  kind: 'auto',
  mode: 'balanced',
  viewer: 'visor-web',
  ...over,
});
const web = (viewerId = 'visor-web'): ViewerIdentity => ({
  viewerId,
  deviceId: `dev-${viewerId}`,
  device: null,
});

describe('Arranque instantáneo con AceStream (D24)', () => {
  it('casa libre: abre la sesión sin visor y el «Ver» la reutiliza sin otra apertura', async () => {
    const setup = await setupPlayback();
    const { runtime, events, state, fakeEngine } = setup;
    const result = await runtime.service.prewarm({ hash: X, matchId: 'm1', title: 'DAZN 1' });
    expect(result).toMatchObject({ status: 'warm', source: 'engine' });
    expect(fakeEngine.control.metrics()).toMatchObject({ sessionsOpened: 1, sessionsOpen: 1 });
    /* No es una reproducción: ni lista de sesiones, ni mando, ni stream.*, ni actividad. */
    expect(runtime.service.status().sessions).toEqual([]);
    expect(events.of('stream.ready')).toEqual([]);
    expect(events.of('playback.sessions')).toEqual([]);
    expect(state.get().nowPlaying).toBeNull();
    expect(runtime.service.prewarmInfo().active).toMatchObject({
      matchId: 'm1',
      hash: X,
      source: 'engine',
      ready: true,
    });

    const grant = await runtime.service.acquire(X, query(), web(), live());
    expect(grant.session.id).toBe(result.status === 'warm' ? result.sessionId : '');
    expect(fakeEngine.control.metrics().sessionsOpened).toBe(1);
    expect(runtime.service.prewarmInfo()).toMatchObject({
      active: null,
      last: { matchId: 'm1', outcome: 'used' },
    });
    /* Desde aquí es una reproducción normal del usuario. */
    expect(runtime.service.status().sessions).toHaveLength(1);
    expect(state.get().nowPlaying).toMatchObject({ id: X, token: 'visor-web' });
  });

  it('con algo sonando no se prepara nada (D5) y lo que suena no se toca', async () => {
    const { runtime, fakeEngine } = await setupPlayback();
    const grant = await runtime.service.acquire(Y, query(), web(), live());
    const result = await runtime.service.prewarm({ hash: X, matchId: 'm1' });
    expect(result).toEqual({ status: 'skipped', reason: 'busy' });
    expect(fakeEngine.control.metrics()).toMatchObject({ sessionsOpened: 1, sessionsOpen: 1 });
    expect(runtime.inspect().sessions.map((session) => session.id)).toEqual([grant.session.id]);
  });

  it('otro canal: la preparación se cierra ANTES de abrir lo nuevo, sin traspaso', async () => {
    const setup = await setupPlayback();
    const { runtime, events, fakeEngine } = setup;
    await runtime.service.prewarm({ hash: X, matchId: 'm1' });
    const grant = await runtime.service.acquire(Y, query(), web(), live());
    expect(grant.handoff).toBe(false);
    expect(events.of('playback.handoff')).toEqual([]);
    expect(events.of('stream.closed')).toEqual([]);
    expect(fakeEngine.control.metrics()).toMatchObject({
      sessionsOpened: 2,
      sessionsOpen: 1,
      sessionsStopped: 1,
    });
    expect(runtime.service.prewarmInfo().last).toMatchObject({ outcome: 'yielded' });
    expect(
      setup.state
        .sessions()
        .read()
        .sessions.map((entry) => entry.hash),
    ).toEqual([Y]);
  });

  it('un mando 0.6.x también la cierra', async () => {
    const { runtime, fakeEngine } = await setupPlayback();
    await runtime.service.prewarm({ hash: X, matchId: 'm1' });
    await runtime.service.legacyClaim({ id: Y, title: 'Otro', dev: 'tele', token: 'tk' });
    await runtime.idle();
    expect(runtime.inspect().sessions).toEqual([]);
    expect(fakeEngine.control.metrics().sessionsStopped).toBe(1);
    expect(runtime.service.prewarmInfo().last).toMatchObject({ outcome: 'yielded' });
  });

  it('soltarla (nadie pulsó «Ver») para la sesión del motor y la quita de sessions.json', async () => {
    const setup = await setupPlayback();
    const { runtime, fakeEngine } = setup;
    await runtime.service.prewarm({ hash: X, matchId: 'm1' });
    expect(await runtime.service.releasePrewarm('expired')).toBe(true);
    expect(runtime.inspect().sessions).toEqual([]);
    expect(fakeEngine.control.metrics()).toMatchObject({ sessionsOpen: 0, sessionsStopped: 1 });
    expect(setup.state.sessions().read().sessions).toEqual([]);
    expect(runtime.service.prewarmInfo()).toMatchObject({
      active: null,
      last: { matchId: 'm1', outcome: 'expired' },
    });
    expect(await runtime.service.releasePrewarm('expired')).toBe(false);
  });

  it('una preparación que el motor ya no conoce se reabre al pulsar «Ver»', async () => {
    const setup = await setupPlayback();
    const { runtime, fakeEngine } = setup;
    await runtime.service.prewarm({ hash: X, matchId: 'm1' });
    await fakeEngine.control.reset({ sessions: true });
    const grant = await runtime.service.acquire(X, query(), web(), live());
    expect(grant.url).toBeTruthy();
    expect(runtime.service.prewarmInfo().last).toMatchObject({
      outcome: 'failed',
      code: 'session_expired',
    });
    expect(runtime.inspect().sessions).toHaveLength(1);
    expect(runtime.inspect().sessions[0]?.viewers).toEqual(['visor-web']);
  });

  it('solo una a la vez', async () => {
    const { runtime } = await setupPlayback();
    await runtime.service.prewarm({ hash: X, matchId: 'm1' });
    expect(await runtime.service.prewarm({ hash: Y, matchId: 'm2' })).toEqual({
      status: 'skipped',
      reason: 'other_prewarm',
    });
    expect(await runtime.service.prewarm({ hash: X, matchId: 'm1' })).toEqual({
      status: 'skipped',
      reason: 'already',
    });
  });
});

/** Doble de la IPTV: un canal propio, un relé falso y la regla de la plaza a mano. */
function fakeIptv(blocker: { value: string | null } = { value: null }) {
  const drops: ((code: 'iptv_dropped') => void)[] = [];
  const openInput = vi.fn(async () => {
    const input: IptvInput = {
      id: CANAL_IPTV,
      inputUrl: 'http://127.0.0.1:41999/r/TICKET/in.ts',
      isHls: false,
      title: 'DAZN 1 --> Mi IPTV',
      stats: () => ({ bytes: 0, kbps: 0, lastByteAt: null }),
      onDropped: (listener) => drops.push(listener),
      onRestart: () => undefined,
      close: async () => undefined,
    };
    return input;
  });
  const service = partial<IptvService>('iptv', {
    classify: (id: string) => (id === CANAL_IPTV ? 'owned' : 'engine'),
    titleOf: () => 'DAZN 1',
    openInput,
    prewarmBlocker: () => blocker.value,
    subscribe: () => () => undefined,
  });
  return { service, openInput, drop: () => drops.forEach((listener) => listener('iptv_dropped')) };
}

describe('Arranque instantáneo con IPTV (D24, docs/iptv.md §7)', () => {
  it('abre el relé y el remux (segmentos listos); el «Ver» no abre nada más', async () => {
    const iptv = fakeIptv();
    const { runtime, ffmpeg, remux } = await setupPlayback({ iptv: iptv.service });
    const result = await runtime.service.prewarm({ hash: CANAL_IPTV, matchId: 'm1' });
    expect(result).toMatchObject({ status: 'warm', source: 'iptv' });
    expect(iptv.openInput).toHaveBeenCalledTimes(1);
    expect(ffmpeg.spawned).toHaveLength(1);
    const sessionId = result.status === 'warm' ? result.sessionId : '';
    expect(remux.service.viewersOf(sessionId)).toEqual([`prewarm_${sessionId}`]);

    const grant = await runtime.service.acquire(CANAL_IPTV, query(), web(), live());
    expect(grant.session.id).toBe(sessionId);
    expect(grant.source).toBe('iptv');
    expect(iptv.openInput).toHaveBeenCalledTimes(1);
    expect(ffmpeg.spawned).toHaveLength(1);
    /* El visor de la preparación deja el remux en cuanto se engancha el de verdad. */
    expect(remux.service.viewersOf(sessionId)).toEqual(['visor-web']);
    expect(runtime.service.prewarmInfo().last).toMatchObject({ outcome: 'used' });
  });

  it('plaza recién soltada, ocupada o en uso: no se abre ninguna conexión con el proveedor', async () => {
    for (const reason of ['iptv_recent_close', 'iptv_busy', 'iptv_in_use', 'iptv_probing']) {
      const iptv = fakeIptv({ value: reason });
      const { runtime, ffmpeg } = await setupPlayback({ iptv: iptv.service });
      expect(await runtime.service.prewarm({ hash: CANAL_IPTV, matchId: 'm1' })).toEqual({
        status: 'skipped',
        reason,
      });
      expect(iptv.openInput).not.toHaveBeenCalled();
      expect(ffmpeg.spawned).toHaveLength(0);
      expect(runtime.service.prewarmInfo()).toEqual({ active: null, last: null });
    }
  });

  it('con una IPTV sonando no se prepara otra (una sola conexión)', async () => {
    const iptv = fakeIptv();
    const { runtime } = await setupPlayback({ iptv: iptv.service });
    await runtime.service.acquire(CANAL_IPTV, query(), web(), live());
    expect(await runtime.service.prewarm({ hash: X, matchId: 'm1' })).toEqual({
      status: 'skipped',
      reason: 'busy',
    });
    expect(iptv.openInput).toHaveBeenCalledTimes(1);
  });

  it('si el relé se cae durante la preparación, se cierra sin veredicto «del reproductor»', async () => {
    const iptv = fakeIptv();
    const setup = await setupPlayback({ iptv: iptv.service });
    const recordVerdict = vi.fn();
    (setup.scanner as unknown as Record<string, unknown>).recordVerdict = recordVerdict;
    await setup.runtime.service.prewarm({ hash: CANAL_IPTV, matchId: 'm1' });
    iptv.drop();
    await setup.runtime.idle();
    expect(setup.runtime.inspect().sessions).toEqual([]);
    expect(recordVerdict).not.toHaveBeenCalled();
    expect(setup.runtime.service.prewarmInfo().last).toMatchObject({
      outcome: 'failed',
      code: 'iptv_dropped',
    });
  });
});
