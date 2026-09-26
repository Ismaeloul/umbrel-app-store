/* Varios dispositivos a la vez (docs/multidispositivo.md §2.3 y §6.1) contra
   el motor falso: `others` + `from` (seguir solo a la sesión que se vio),
   `join` (unirse sin cerrar nada), `byDeviceName`, `matchId`, `follows` y
   `away` en «Dónde se está reproduciendo», y las carreras al seguir. */

import { describe, expect, it } from 'vitest';
import { MULTI_TIMINGS, type ChannelStreamQuery, type SessionSummary } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { isAppError } from '../../core/errors.js';
import { advanceParked } from '../remux/test-support.js';
import { setupPlayback, type PlaybackSetup } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const H1 = demoContentId(1);
const H2 = demoContentId(2);
const H3 = demoContentId(3);

function query(over: Partial<ChannelStreamQuery> = {}): ChannelStreamQuery {
  return {
    client: 'web',
    kind: 'auto',
    mode: 'balanced',
    viewer: 'ignorado',
    follows: '1',
    ...over,
  };
}

/** Un visor web de un dispositivo, con su nombre de «Dónde se está reproduciendo». */
function web(viewerId: string, deviceId: string, deviceName = 'Chrome · Windows'): ViewerIdentity {
  return { viewerId, deviceId, device: null, deviceName };
}

const live = (): AbortSignal => new AbortController().signal;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return isAppError(error) ? error.code : String((error as Error).message);
  }
}

function sessionsNow(setup: PlaybackSetup): SessionSummary[] {
  return setup.runtime.service.status().sessions;
}

/** X (el PC) y Y (el iPhone por la web) juntos en H1. */
async function together(setup: PlaybackSetup, over: Partial<ChannelStreamQuery> = {}) {
  const x = await setup.runtime.service.acquire(
    H1,
    query({ title: 'Uno', ...over }),
    web('x', 'pc'),
    live(),
  );
  const y = await setup.runtime.service.acquire(
    H1,
    query({ title: 'Uno', ...over }),
    web('y', 'iphone', 'Safari · iPhone'),
    live(),
  );
  expect(y.session.id).toBe(x.session.id);
  return x.session.id;
}

describe('«Cambiar en los dos»: others=move y from (§2.3)', () => {
  it('move + from: los visores de la sesión from reciben follow, byDeviceName y matchId', async () => {
    const setup = await setupPlayback();
    const from = await together(setup);
    const grant = await setup.runtime.service.acquire(
      H2,
      query({ title: 'Dos', others: 'move', from, match: 'fltv-1' }),
      web('x', 'pc'),
      live(),
    );
    expect(grant.handoff).toBe(true);
    expect(setup.events.of('playback.handoff')).toEqual([
      {
        sessionId: from,
        viewerIds: ['y'],
        byDeviceId: 'pc',
        byClient: 'web',
        hash: H2,
        title: 'Dos',
        reason: 'other_channel',
        byDeviceName: 'Chrome · Windows',
        follow: true,
        matchId: 'fltv-1',
      },
    ]);
    /* Y sigue con join: se une a la sesión nueva sin cerrar nada. */
    const followed = await setup.runtime.service.acquire(
      H2,
      query({ title: 'Dos', join: '1' }),
      web('y', 'iphone', 'Safari · iPhone'),
      live(),
    );
    expect(followed.session.id).toBe(grant.session.id);
    expect(followed.handoff).toBe(false);
    expect(setup.events.of('playback.handoff')).toHaveLength(1);
    await setup.runtime.idle();
    expect(setup.fakeEngine.control.metrics().sessionsOpen).toBe(1);
    expect(sessionsNow(setup)).toMatchObject([{ hash: H2, matchId: 'fltv-1' }]);
  });

  it.each([
    ['move sin from', { others: 'move' as const }],
    ['stop', { others: 'stop' as const }],
    ['sin others (0.8.0)', {}],
  ])('%s: se paran sin follow', async (_name, over) => {
    const setup = await setupPlayback();
    const from = await together(setup);
    await setup.runtime.service.acquire(
      H2,
      query({
        title: 'Dos',
        ...over,
        ...('others' in over && over.others === 'stop' ? { from } : {}),
      }),
      web('x', 'pc'),
      live(),
    );
    const [event] = setup.events.of('playback.handoff');
    expect(event).toMatchObject({ viewerIds: ['y'], byDeviceName: 'Chrome · Windows' });
    expect(event).not.toHaveProperty('follow');
    expect(event).not.toHaveProperty('matchId');
  });

  it('move con la política handoff se trata como stop', async () => {
    const setup = await setupPlayback({ policy: 'handoff' });
    const x = await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    await setup.runtime.service.acquire(
      H2,
      query({ others: 'move', from: x.session.id }),
      web('y', 'iphone'),
      live(),
    );
    const [event] = setup.events.of('playback.handoff');
    expect(event).toMatchObject({ viewerIds: ['x'], reason: 'other_channel' });
    expect(event).not.toHaveProperty('follow');
  });

  it('otra pestaña del mismo dispositivo en la sesión from no sigue: se para con el aviso', async () => {
    const setup = await setupPlayback();
    const from = await together(setup);
    await setup.runtime.service.acquire(H1, query(), web('x2', 'pc'), live());
    await setup.runtime.service.acquire(
      H2,
      query({ others: 'move', from }),
      web('x', 'pc'),
      live(),
    );
    const events = setup.events.of('playback.handoff');
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.follow)?.viewerIds).toEqual(['y']);
    expect(events.find((event) => !event.follow)?.viewerIds).toEqual(['x2']);
  });

  it('mismo hash con move: se une sin traspaso', async () => {
    const setup = await setupPlayback();
    const x = await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    const y = await setup.runtime.service.acquire(
      H1,
      query({ others: 'move', from: x.session.id }),
      web('y', 'iphone'),
      live(),
    );
    expect(y.session.id).toBe(x.session.id);
    expect(y.handoff).toBe(false);
    expect(setup.events.of('playback.handoff')).toEqual([]);
  });

  it('same_channel (política handoff): byDeviceName y nunca follow', async () => {
    const setup = await setupPlayback({ policy: 'handoff' });
    await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    await setup.runtime.service.acquire(
      H1,
      query({ others: 'move' }),
      web('y', 'iphone', 'Safari · iPhone'),
      live(),
    );
    const [event] = setup.events.of('playback.handoff');
    expect(event).toMatchObject({
      viewerIds: ['x'],
      reason: 'same_channel',
      byDeviceName: 'Safari · iPhone',
    });
    expect(event).not.toHaveProperty('follow');
  });
});

describe('join=1: unirse sin cambiar el canal de la casa (§2.3, D-M7)', () => {
  it('sin sesión de ese hash: session_expired y ninguna sesión cerrada ni abierta', async () => {
    const setup = await setupPlayback();
    const x = await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    const opened = setup.fakeEngine.control.metrics().sessionsOpened;
    expect(
      await codeOf(
        setup.runtime.service.acquire(H2, query({ join: '1' }), web('y', 'iphone'), live()),
      ),
    ).toBe('session_expired');
    await setup.runtime.idle();
    expect(setup.fakeEngine.control.metrics()).toMatchObject({
      sessionsOpen: 1,
      sessionsOpened: opened,
    });
    expect(sessionsNow(setup).map((session) => session.id)).toEqual([x.session.id]);
    expect(setup.events.of('playback.handoff')).toEqual([]);
  });

  it('sin nada en casa: session_expired (no abre nada)', async () => {
    const setup = await setupPlayback();
    expect(
      await codeOf(
        setup.runtime.service.acquire(H1, query({ join: '1' }), web('y', 'iphone'), live()),
      ),
    ).toBe('session_expired');
    expect(setup.fakeEngine.control.metrics().sessionsOpened).toBe(0);
  });

  it('con sesión: se une; others y from se ignoran', async () => {
    const setup = await setupPlayback();
    const x = await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    const y = await setup.runtime.service.acquire(
      H1,
      query({ join: '1', others: 'move', from: x.session.id }),
      web('y', 'iphone'),
      live(),
    );
    expect(y.session.id).toBe(x.session.id);
    expect(setup.events.of('playback.handoff')).toEqual([]);
    expect(sessionsNow(setup)[0]?.viewers.map((viewer) => viewer.viewerId)).toEqual(['x', 'y']);
  });

  it('con sesión y la política handoff: se lo queda (same_channel para los demás)', async () => {
    const setup = await setupPlayback({ policy: 'handoff' });
    await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    await setup.runtime.service.acquire(H1, query({ join: '1' }), web('y', 'iphone'), live());
    expect(setup.events.of('playback.handoff')).toMatchObject([
      { viewerIds: ['x'], reason: 'same_channel' },
    ]);
  });
});

describe('«Dónde se está reproduciendo» con matchId, follows y away (§2.3)', () => {
  it('matchId del último visor que lo dijo; follows solo en quien lo declaró', async () => {
    const setup = await setupPlayback();
    await setup.runtime.service.acquire(
      H1,
      query({ match: 'fltv-1', follows: '0' }),
      web('x', 'pc'),
      live(),
    );
    await setup.runtime.service.acquire(H1, query({ follows: '1' }), web('y', 'iphone'), live());
    const [session] = sessionsNow(setup);
    expect(session?.matchId).toBe('fltv-1');
    expect(session?.viewers[0]).not.toHaveProperty('follows');
    expect(session?.viewers[1]).toMatchObject({ follows: true });
    /* Una reconexión sin match (la web no lo repite) conserva el partido. */
    await setup.runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    expect(sessionsNow(setup)[0]?.matchId).toBe('fltv-1');
  });

  it('sin partido ni follows, la forma de siempre', async () => {
    const setup = await setupPlayback();
    await setup.runtime.service.acquire(H1, query({ follows: undefined }), web('x', 'pc'), live());
    const [session] = sessionsNow(setup);
    expect(session).not.toHaveProperty('matchId');
    expect(Object.keys(session?.viewers[0] ?? {}).sort()).toEqual(
      ['client', 'deviceId', 'deviceName', 'lastBeatAt', 'platform', 'playing', 'viewerId'].sort(),
    );
  });

  it('away tras 20 s sin latido, publicado al cruzarlo, y se quita al volver a latir', async () => {
    const setup = await setupPlayback();
    const { runtime, clock, events } = setup;
    const x = await runtime.service.acquire(H1, query(), web('x', 'pc'), live());
    await runtime.service.acquire(H1, query(), web('y', 'iphone'), live());
    await advanceParked(clock, MULTI_TIMINGS.viewerAwayMs - 4000, { step: 2000 });
    await runtime.service.heartbeat(x.session.id, { viewer: 'x', playing: true }, web('x', 'pc'));
    expect(sessionsNow(setup)[0]?.viewers.every((viewer) => !viewer.away)).toBe(true);
    const before = events.of('playback.sessions').length;
    await advanceParked(clock, 6000, { step: 2000 });
    const [session] = sessionsNow(setup);
    expect(session?.viewers.find((viewer) => viewer.viewerId === 'y')).toMatchObject({
      away: true,
    });
    expect(session?.viewers.find((viewer) => viewer.viewerId === 'x')).not.toHaveProperty('away');
    const published = events.of('playback.sessions').slice(before);
    expect(
      published.some((event) =>
        event.sessions[0]?.viewers.some((viewer) => viewer.viewerId === 'y' && viewer.away),
      ),
    ).toBe(true);
    await runtime.service.heartbeat(x.session.id, { viewer: 'y' }, web('y', 'iphone'));
    expect(
      events
        .of('playback.sessions')
        .at(-1)
        ?.sessions[0]?.viewers.every((viewer) => !viewer.away),
    ).toBe(true);
  });
});

describe('carreras al seguir (§2.3, tabla de carreras)', () => {
  it('zapping H1 → H2 → H3 con «en los dos»: el join tardío de Y a H2 no cierra H3', async () => {
    const setup = await setupPlayback();
    const { runtime, events } = setup;
    const from = await together(setup);
    const h2 = await runtime.service.acquire(
      H2,
      query({ others: 'move', from }),
      web('x', 'pc'),
      live(),
    );
    /* Antes de que Y siga a H2, X ya ha pasado a H3 (con move desde H2). */
    const h3 = await runtime.service.acquire(
      H3,
      query({ others: 'move', from: h2.session.id }),
      web('x', 'pc'),
      live(),
    );
    const handoffs = events.of('playback.handoff').length;
    expect(
      await codeOf(runtime.service.acquire(H2, query({ join: '1' }), web('y', 'iphone'), live())),
    ).toBe('session_expired');
    await runtime.idle();
    expect(sessionsNow(setup).map((session) => session.id)).toEqual([h3.session.id]);
    /* X no nota nada. */
    expect(events.of('playback.handoff')).toHaveLength(handoffs);
    /* Y relee y sigue a H3, donde está X. */
    const y = await runtime.service.acquire(H3, query({ join: '1' }), web('y', 'iphone'), live());
    expect(y.session.id).toBe(h3.session.id);
    expect(setup.fakeEngine.control.metrics().sessionsOpen).toBe(1);
  });

  it('Y cambia a H3 antes de que llegue el move de X (que vio a Y en H1): Y se para sin follow', async () => {
    const setup = await setupPlayback();
    const { runtime, events } = setup;
    const from = await together(setup);
    const y3 = await runtime.service.acquire(H3, query(), web('y', 'iphone'), live());
    expect(y3.session.id).not.toBe(from);
    await runtime.service.acquire(H2, query({ others: 'move', from }), web('x', 'pc'), live());
    const last = events.of('playback.handoff').at(-1);
    expect(last).toMatchObject({ sessionId: y3.session.id, viewerIds: ['y'], hash: H2 });
    expect(last).not.toHaveProperty('follow');
  });

  it('los dos cambian a la vez: una sola sesión al final y el perdedor con su traspaso', async () => {
    const setup = await setupPlayback();
    const { runtime, events } = setup;
    const from = await together(setup);
    const results = await Promise.allSettled([
      runtime.service.acquire(H2, query({ others: 'move', from }), web('x', 'pc'), live()),
      runtime.service.acquire(H3, query({ others: 'move', from }), web('y', 'iphone'), live()),
    ]);
    /* El primero en colocarse pierde su sesión cuando el segundo coloca la suya:
       su petición acaba en session_expired o en un traspaso, nunca en dos sesiones. */
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    await runtime.idle();
    const open = sessionsNow(setup);
    expect(open).toHaveLength(1);
    expect(setup.fakeEngine.control.metrics().sessionsOpen).toBe(1);
    const winner = open[0]!.viewers[0]!.viewerId;
    const loser = winner === 'x' ? 'y' : 'x';
    expect(events.of('playback.handoff').some((event) => event.viewerIds.includes(loser))).toBe(
      true,
    );
  });
});
