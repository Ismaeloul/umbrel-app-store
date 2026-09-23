/* «Dónde se está reproduciendo» (0.7.1): las sesiones de GET /api/v1/playback
   llevan el canal (title, protocol) y quién lo ve (viewerId, deviceName,
   platform, playing), y el evento `playback.sessions` publica la lista entera
   cada vez que cambia algo que se ve, nunca por un latido que solo mueve
   `lastBeatAt`. Contra el motor falso, como sessions.test.ts. */

import { describe, expect, it } from 'vitest';
import {
  PlaybackSessionsEventSchema,
  PlaybackStatusSchema,
  type ChannelStreamQuery,
  type StateV1,
} from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { createMemoryState, setupPlayback } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const X = demoContentId(1);
const Y = demoContentId(2);

function query(over: Partial<ChannelStreamQuery> = {}): ChannelStreamQuery {
  return { client: 'web', kind: 'auto', mode: 'balanced', viewer: 'visor-web-1', ...over };
}

function web(viewerId: string, deviceId: string, deviceName = 'Chrome · Windows'): ViewerIdentity {
  return { viewerId, deviceId, device: null, deviceName };
}

function ios(viewerId: string, deviceId = 'iphone-1', name = 'iPhone de Isma'): ViewerIdentity {
  const device = {
    deviceId,
    device: { id: deviceId, name },
    via: 'bearer',
  } as unknown as AuthenticatedDevice;
  return { viewerId, deviceId, device };
}

const live = (): AbortSignal => new AbortController().signal;

describe('«Dónde se está reproduciendo»: resumen de sesiones', () => {
  it('lleva el canal y quién lo ve, y coincide con el último playback.sessions', async () => {
    const setup = await setupPlayback();
    const { runtime, events } = setup;
    const grant = await runtime.service.acquire(
      X,
      query({ title: 'DAZN 1' }),
      web('visor-web-1', 'pc-salon'),
      live(),
    );
    const status = PlaybackStatusSchema.parse(runtime.service.status());
    expect(status.sessions).toEqual([
      {
        id: grant.session.id,
        hash: X,
        mode: 'progressive',
        openedAt: expect.any(String),
        title: 'DAZN 1',
        protocol: 'mpegts',
        viewers: [
          {
            client: 'web',
            deviceId: 'pc-salon',
            lastBeatAt: expect.any(String),
            viewerId: 'visor-web-1',
            deviceName: 'Chrome · Windows',
            platform: 'web',
            playing: null,
          },
        ],
      },
    ]);
    const last = events.of('playback.sessions').at(-1);
    expect(PlaybackSessionsEventSchema.shape.data.parse(last)).toEqual({
      sessions: status.sessions,
    });
  });

  it('se comparte con un iPhone: dos visores, HLS y el nombre del emparejado', async () => {
    const setup = await setupPlayback();
    const { runtime, events } = setup;
    await runtime.service.acquire(X, query({ title: 'DAZN 1' }), web('visor-web-1', 'pc'), live());
    await runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-1'), live());
    const [session] = runtime.service.status().sessions;
    expect(session).toMatchObject({
      mode: 'hls',
      /* Hay un visor web: lo que da el motor, no el remux. */
      protocol: 'hls',
      /* El iPhone no mandó título: se queda el del visor que sí lo sabía. */
      title: 'DAZN 1',
      viewers: [
        { viewerId: 'visor-web-1', platform: 'web', deviceName: 'Chrome · Windows' },
        {
          viewerId: 'visor-ios-1',
          platform: 'ios',
          client: 'ios',
          deviceId: 'iphone-1',
          deviceName: 'iPhone de Isma',
        },
      ],
    });
    expect(events.of('playback.sessions').at(-1)?.sessions).toEqual([
      expect.objectContaining({ id: session?.id, mode: 'hls' }),
    ]);
  });

  it('solo iPhones: protocolo hls-fmp4 (remux)', async () => {
    const setup = await setupPlayback();
    const { runtime } = setup;
    await runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-1'), live());
    expect(runtime.service.status().sessions[0]).toMatchObject({
      protocol: 'hls-fmp4',
      title: '',
    });
  });

  it('sin título en la petición, el de la biblioteca; si no está, ""', async () => {
    const state = createMemoryState();
    await state.enqueue(
      (draft: StateV1) => {
        draft.favorites = [{ id: X, title: 'M+ LaLiga' }] as unknown as StateV1['favorites'];
        draft.history = [];
        draft.web = [];
      },
      { scopes: ['library'] },
    );
    const setup = await setupPlayback({ state });
    const { runtime } = setup;
    await runtime.service.acquire(X, query(), web('visor-web-1', 'pc'), live());
    expect(runtime.service.status().sessions[0]?.title).toBe('M+ LaLiga');
    /* El mando también se entera del nombre. */
    expect(state.get().nowPlaying?.title).toBe('M+ LaLiga');

    await runtime.service.acquire(Y, query(), web('visor-web-1', 'pc'), live());
    expect(runtime.service.status().sessions[0]?.title).toBe('');
    expect(state.get().nowPlaying?.title).toBe(`Stream ${Y.slice(0, 8)}`);
  });
});

describe('«Dónde se está reproduciendo»: evento playback.sessions', () => {
  it('se emite al entrar, al cambiar playing y al irse; un latido sin cambios no emite', async () => {
    const setup = await setupPlayback();
    const { runtime, events, clock } = setup;
    const grant = await runtime.service.acquire(
      X,
      query({ title: 'DAZN 1' }),
      web('visor-web-1', 'pc'),
      live(),
    );
    const sid = grant.session.id;
    const lists = () => events.of('playback.sessions');
    expect(lists().at(-1)?.sessions[0]?.viewers[0]?.playing).toBeNull();

    const beat = (playing?: boolean) =>
      runtime.service.heartbeat(
        sid,
        { viewer: 'visor-web-1', ...(playing === undefined ? {} : { playing }) },
        web('visor-web-1', 'pc'),
      );

    await beat(true);
    expect(lists().at(-1)?.sessions[0]?.viewers[0]?.playing).toBe(true);
    const afterPlaying = lists().length;

    /* Latidos que solo mueven lastBeatAt: nada nuevo por SSE. */
    await clock.advanceAsync(15_000);
    await beat(true);
    await clock.advanceAsync(15_000);
    await beat();
    expect(lists()).toHaveLength(afterPlaying);

    await beat(false);
    expect(lists()).toHaveLength(afterPlaying + 1);
    expect(lists().at(-1)?.sessions[0]?.viewers[0]?.playing).toBe(false);

    await runtime.service.release(
      sid,
      { viewer: 'visor-web-1', reason: 'user' },
      web('visor-web-1', 'pc'),
    );
    expect(lists().at(-1)).toEqual({ sessions: [] });
    for (const data of lists())
      expect(PlaybackSessionsEventSchema.shape.data.parse(data)).toEqual(data);
  });

  it('un visor que caduca (sin latido en 45 s) desaparece de la lista', async () => {
    const setup = await setupPlayback();
    const { runtime, events, clock } = setup;
    await runtime.service.acquire(X, query(), web('visor-web-1', 'pc'), live());
    expect(events.of('playback.sessions').at(-1)?.sessions).toHaveLength(1);
    await clock.advanceAsync(60_000);
    await runtime.idle();
    expect(events.of('playback.sessions').at(-1)).toEqual({ sessions: [] });
  });

  it('cambiar de canal: la lista pasa al canal nuevo', async () => {
    const setup = await setupPlayback();
    const { runtime, events } = setup;
    await runtime.service.acquire(X, query({ title: 'Uno' }), web('visor-web-1', 'pc'), live());
    await runtime.service.acquire(
      Y,
      query({ client: 'ios', title: 'Dos' }),
      ios('visor-ios-1'),
      live(),
    );
    expect(events.of('playback.sessions').at(-1)?.sessions).toEqual([
      expect.objectContaining({
        hash: Y,
        title: 'Dos',
        viewers: [expect.objectContaining({ viewerId: 'visor-ios-1', platform: 'ios' })],
      }),
    ]);
  });
});
