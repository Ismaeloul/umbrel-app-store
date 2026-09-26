/* La puerta de la casa (docs/multidispositivo.md §2.1 y §2.6): la tabla de
   combinaciones sobre la función pura. Son también los vectores que calcará
   la app nativa (Casa.swift). */

import { describe, expect, it } from 'vitest';
import { MULTI_TIMINGS, type SessionSummary, type SessionViewer } from '@ace/shared';
import {
  decideHouseChange,
  devicesKey,
  houseSession,
  isLiveViewer,
  isOtherDevice,
  type DecideInput,
} from './decide.ts';

const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const H2 = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const H3 = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';
const NOW = 1_800_000_000_000;
const ME = { viewerId: 'v_yo', deviceId: 'web_pc' };

function viewer(over: Partial<SessionViewer> = {}): SessionViewer {
  return {
    client: 'ios',
    deviceId: 'dev_iphone',
    lastBeatAt: new Date(NOW).toISOString(),
    viewerId: 'v_iphone',
    deviceName: 'iPhone de Isma',
    platform: 'ios',
    playing: true,
    follows: true,
    ...over,
  };
}

function session(hash: string, viewers: SessionViewer[], over: Partial<SessionSummary> = {}) {
  return {
    id: `s_${hash.slice(0, 10)}`,
    hash,
    mode: 'hls',
    openedAt: new Date(NOW - 60_000).toISOString(),
    viewers,
    title: hash === H1 ? 'DAZN LaLiga' : 'Antena 3',
    protocol: 'hls',
    ...over,
  } satisfies SessionSummary;
}

const mine = viewer({
  viewerId: ME.viewerId,
  deviceId: ME.deviceId,
  client: 'web',
  platform: 'web',
  deviceName: 'Chrome · Windows',
});

function input(over: Partial<DecideInput> = {}): DecideInput {
  return {
    sessions: [session(H1, [viewer()])],
    me: ME,
    hash: H2,
    policy: 'share',
    remembered: null,
    now: NOW,
    sseOpen: true,
    fresh: false,
    pausedSince: new Map(),
    ...over,
  };
}

describe('quién cuenta (§2.1, D-M8)', () => {
  it('otra pestaña de este navegador no cuenta; sin deviceId, sí', () => {
    expect(isOtherDevice(viewer({ deviceId: ME.deviceId, viewerId: 'v_otra' }), ME)).toBe(false);
    expect(isOtherDevice(viewer({ deviceId: null }), ME)).toBe(true);
    expect(isOtherDevice(mine, ME)).toBe(false);
  });

  it('away o más de 10 min en pausa no cuenta', () => {
    expect(isLiveViewer(viewer(), NOW, new Map())).toBe(true);
    expect(isLiveViewer(viewer({ away: true }), NOW, new Map())).toBe(false);
    const paused = viewer({ playing: false });
    const since = (ms: number) => new Map([[paused.viewerId, NOW - ms]]);
    expect(isLiveViewer(paused, NOW, since(MULTI_TIMINGS.pausedStaleMs - 1))).toBe(true);
    expect(isLiveViewer(paused, NOW, since(MULTI_TIMINGS.pausedStaleMs + 1))).toBe(false);
    /* Sin apunte todavía (recién visto en pausa): cuenta desde ahora. */
    expect(isLiveViewer(paused, NOW, new Map())).toBe(true);
  });

  it('houseSession: la sesión con visores vivos de otros dispositivos', () => {
    expect(houseSession([session(H1, [mine])], ME, NOW, new Map())).toBeNull();
    const found = houseSession([session(H1, [mine, viewer()])], ME, NOW, new Map());
    expect(found?.others.map((v) => v.viewerId)).toEqual(['v_iphone']);
  });
});

describe('A1 · interruptor apagado (share)', () => {
  it('1-4 · el mismo canal que ya se ve en casa: se une sin preguntar', () => {
    expect(decideHouseChange(input({ hash: H1 }))).toEqual({ go: {} });
  });

  it('5-6 · otro canal y este no veía nada: pregunta «se está viendo»', () => {
    const decision = decideHouseChange(input());
    expect(decision).toMatchObject({
      ask: {
        from: `s_${H1.slice(0, 10)}`,
        sessionHash: H1,
        together: false,
        ability: 'all',
        hash: H2,
      },
    });
  });

  it('7 · juntos: pregunta «también se está viendo»', () => {
    const decision = decideHouseChange(input({ sessions: [session(H1, [mine, viewer()])] }));
    expect(decision).toMatchObject({ ask: { together: true } });
  });

  it('10 · juntos y la fuente cae (continue): se los lleva, con from = la sesión', () => {
    const decision = decideHouseChange(
      input({ sessions: [session(H1, [mine, viewer()])], house: 'continue' }),
    );
    expect(decision).toEqual({ go: { others: 'move', from: `s_${H1.slice(0, 10)}` } });
    expect(decideHouseChange(input({ house: 'continue' }))).toEqual({ go: {} });
  });

  it('seguir y unirse nunca preguntan', () => {
    expect(decideHouseChange(input({ house: 'follow' }))).toEqual({ go: {} });
    expect(decideHouseChange(input({ house: 'join' }))).toEqual({ go: {} });
  });

  it('12 · el otro no sabe seguir (0.8.0): ability none', () => {
    const decision = decideHouseChange(
      input({ sessions: [session(H1, [viewer({ follows: undefined })])] }),
    );
    expect(decision).toMatchObject({ ask: { ability: 'none' } });
  });

  it('unos sí y otros no: ability some con los que no', () => {
    const decision = decideHouseChange(
      input({
        sessions: [
          session(H1, [
            viewer(),
            viewer({
              viewerId: 'v_tele',
              deviceId: 'web_tele',
              client: 'web',
              platform: 'web',
              deviceName: 'Navegador · Smart TV',
              follows: undefined,
            }),
          ]),
        ],
      }),
    );
    expect(decision).toMatchObject({ ask: { ability: 'some' } });
    if ('ask' in decision)
      expect(decision.ask.cannotFollow.map((v) => v.viewerId)).toEqual(['v_tele']);
  });

  it('14 · «en los dos» recordado 5 min con los mismos dispositivos (y juntos)', () => {
    const sessions = [session(H1, [mine, viewer()])];
    const devices = devicesKey([viewer()]);
    expect(
      decideHouseChange(input({ sessions, remembered: { devices, at: NOW - 60_000 } })),
    ).toEqual({ go: { others: 'move', from: `s_${H1.slice(0, 10)}` } });
    expect(
      decideHouseChange(
        input({ sessions, remembered: { devices, at: NOW - MULTI_TIMINGS.rememberBothMs - 1 } }),
      ),
    ).toHaveProperty('ask');
    expect(
      decideHouseChange(input({ sessions, remembered: { devices: 'otro|conjunto', at: NOW } })),
    ).toHaveProperty('ask');
    /* Sin estar juntos, el recuerdo no vale. */
    expect(decideHouseChange(input({ remembered: { devices, at: NOW } }))).toHaveProperty('ask');
  });

  it('14b-14c · away o en pausa más de 10 min: no pregunta', () => {
    expect(decideHouseChange(input({ sessions: [session(H1, [viewer({ away: true })])] }))).toEqual(
      { go: {} },
    );
    const paused = viewer({ playing: false });
    expect(
      decideHouseChange(
        input({
          sessions: [session(H1, [paused])],
          pausedSince: new Map([[paused.viewerId, NOW - MULTI_TIMINGS.pausedStaleMs - 1]]),
        }),
      ),
    ).toEqual({ go: {} });
  });

  it('otra pestaña de este navegador viendo otra cosa: no pregunta', () => {
    expect(
      decideHouseChange(
        input({ sessions: [session(H1, [viewer({ deviceId: ME.deviceId, viewerId: 'v_otra' })])] }),
      ),
    ).toEqual({ go: {} });
  });

  it('sin sesiones o sin nadie más: sigue ya', () => {
    expect(decideHouseChange(input({ sessions: [] }))).toEqual({ go: {} });
    expect(decideHouseChange(input({ sessions: undefined }))).toEqual({ go: {} });
    expect(decideHouseChange(input({ sessions: [session(H1, [mine])] }))).toEqual({ go: {} });
  });

  it('lo que ya suena aquí no pregunta', () => {
    expect(decideHouseChange(input({ engagedHash: H2 }))).toEqual({ go: {} });
  });
});

describe('A2 · interruptor encendido (handoff): nunca pregunta (D-M1)', () => {
  it.each([
    ['15-16 · mismo canal', H1],
    ['18 · otro canal', H2],
  ])('%s', (_name, hash) => {
    expect(decideHouseChange(input({ policy: 'handoff', hash }))).toEqual({ go: {} });
  });

  it('19 · continue con handoff: sin move', () => {
    expect(
      decideHouseChange(
        input({ policy: 'handoff', house: 'continue', sessions: [session(H1, [mine, viewer()])] }),
      ),
    ).toEqual({ go: {} });
  });
});

describe('frescura sin SSE (§2.1)', () => {
  it('sin SSE y sin fresh: pending; con fresh, nunca pending', () => {
    expect(decideHouseChange(input({ sseOpen: false }))).toEqual({ pending: true });
    expect(decideHouseChange(input({ sseOpen: false, fresh: true }))).toHaveProperty('ask');
    /* Sin nadie más en casa no hace falta refrescar. */
    expect(decideHouseChange(input({ sseOpen: false, sessions: [] }))).toEqual({ go: {} });
  });
});

describe('A3 · la sesión en la que se basa (from)', () => {
  it('con dos sesiones (transitorio), pregunta por la más reciente', () => {
    const older = session(H1, [viewer()], { openedAt: new Date(NOW - 120_000).toISOString() });
    const newer = session(H3, [viewer({ viewerId: 'v_tele', deviceId: 'web_tele' })], {
      openedAt: new Date(NOW - 10_000).toISOString(),
    });
    const decision = decideHouseChange(input({ sessions: [older, newer] }));
    expect(decision).toMatchObject({ ask: { from: newer.id, sessionHash: H3 } });
  });
});
