/* Agenda híbrida de punta a punta (docs/iptv.md §4.7): el backend entero
   (harness.ts, agenda de demostración) contra el proveedor IPTV falso y su
   guía XMLTV de verdad (RSO–VIL de la demo en «M+ LaLiga TV 2», con la previa,
   el resumen, una repetición y la trampa de Champions):
   - sin IPTV: /api/v1/football, la de siempre (sin `guide`);
   - con la IPTV y su guía: RSO–VIL lleva «Confirmado en tu guía» con M+
     LaLiga TV 2 delante de DAZN LaLiga; la ruta antigua, lo mismo sin `guide`;
     ningún partido añadido (la guía falsa no trae ninguno que no esté);
   - el partido se resuelve con la guía primero y la búsqueda de AceStream
     empieza por ese canal;
   - en pausa: la agenda de siempre otra vez, al momento. */

import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FootballScheduleSchema,
  IptvViewSchema,
  LegacyFootballResponseSchema,
  ResolutionSchema,
  type FootballSchedule,
} from '@ace/shared';
import { FakeClock } from '../../src/core/clock.js';
import { createLogger } from '../../src/core/logger.js';
import { loopbackHost } from '../fake-engine/test-utils.js';
import {
  FAKE_IPTV_PASSWORD,
  FAKE_IPTV_USER,
  createFakeIptv,
  demoMatchStart,
  type FakeIptv,
} from '../fake-iptv/provider.js';
import { FAKE_IPTV_HOST, fakeIptvResolver, fakeIptvTransport } from '../fake-iptv/net.js';
import { createHarness, until, WEB, type Harness } from './harness.js';

const SERVER = `http://${FAKE_IPTV_HOST}`;

let current: { h: Harness; provider: FakeIptv } | null = null;

afterEach(async () => {
  if (!current) return;
  const { h, provider } = current;
  current = null;
  await h.close();
  await provider.close();
});

async function setup(): Promise<{ h: Harness; provider: FakeIptv }> {
  const clock = new FakeClock();
  const host = await loopbackHost();
  const provider = await createFakeIptv({
    host,
    publicHost: FAKE_IPTV_HOST,
    now: () => clock.now(),
    matchStart: demoMatchStart(clock.now()),
  });
  const h = await createHarness({
    clock,
    logger: createLogger({
      level: 'silent',
      destination: new Writable({ write: (_chunk, _encoding, done) => done() }),
    }),
    net: {
      resolver: fakeIptvResolver(),
      transport: fakeIptvTransport({ host, port: provider.port }),
    },
  });
  current = { h, provider };
  return current;
}

async function get(h: Harness, url: string) {
  return h.app.inject({ method: 'GET', url, headers: WEB });
}

async function agenda(h: Harness): Promise<FootballSchedule> {
  const res = await get(h, '/api/v1/football');
  expect(res.statusCode, res.body).toBe(200);
  return FootballScheduleSchema.parse(res.json());
}

function rso(schedule: FootballSchedule) {
  return schedule.days
    .flatMap((day) => day.matches)
    .find((match) => match.home === 'Real Sociedad' && match.away === 'Villarreal');
}

describe('agenda híbrida de punta a punta', () => {
  it('sin IPTV, la de siempre; con su guía, confirmado en M+ LaLiga TV 2; en pausa, la de siempre otra vez', async () => {
    const { h } = await setup();
    const before = await agenda(h);
    expect(JSON.stringify(before)).not.toContain('"guide"');
    expect(rso(before)?.channels.map((c) => c.name)).toEqual(['DAZN LaLiga']);

    const saved = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/iptv',
      headers: WEB,
      payload: {
        kind: 'xtream',
        name: 'Casa',
        server: SERVER,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await h.iptv.idle();
    await until('IPTV activa', () => h.iptv.active(), 10_000);
    /* Con la IPTV y sin guía todavía: la de siempre. */
    expect(rso(await agenda(h))?.guide).toBeUndefined();
    await h.advance(2_000);
    await until('guía cargada', () => (h.iptv.guideForTests()?.programmes ?? 0) > 0, 10_000);
    await h.iptv.idle();

    const hybrid = await agenda(h);
    const match = rso(hybrid);
    expect(match?.guide).toEqual({
      channel: 'M+ LaLiga TV 2',
      time: '18:30',
      added: false,
    });
    expect(match?.channels.map((c) => c.name)).toEqual(['M+ LaLiga TV 2', 'DAZN LaLiga']);
    /* La guía falsa no trae ningún partido que no esté en la agenda. */
    expect(hybrid.days.flatMap((day) => day.matches).some((m) => m.id.startsWith('guia-'))).toBe(
      false,
    );
    /* La ruta antigua: lo mismo, sin `guide`. */
    const legacy = await get(h, '/api/football');
    const legacyData = LegacyFootballResponseSchema.parse(legacy.json());
    expect(JSON.stringify(legacyData)).not.toContain('"guide"');
    expect(rso(legacyData)?.channels[0]?.name).toBe('M+ LaLiga TV 2');

    /* La resolución: la guía primero; y nada del proveedor en la respuesta. */
    const resolved = await get(h, `/api/v1/football/resolve?match=${match?.id}&client=web_1`);
    expect(resolved.statusCode, resolved.body).toBe(200);
    const resolution = ResolutionSchema.parse(resolved.json());
    expect(resolution.candidates[0]?.title).toBe('M+ LaLiga TV 2 --> Casa');
    expect(resolution.candidates[0]?.iptv?.guide).toBe(true);
    expect(resolution.channels[0]).toBe('M+ LaLiga TV 2');
    expect(JSON.stringify(resolution)).not.toContain(FAKE_IPTV_PASSWORD);

    /* En pausa: la agenda de siempre, sin esperar a nada. */
    const paused = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/iptv',
      headers: WEB,
      payload: { enabled: false },
    });
    expect(IptvViewSchema.parse(paused.json()).provider?.enabled).toBe(false);
    const after = await agenda(h);
    expect(JSON.stringify(after)).not.toContain('"guide"');
    expect(rso(after)?.channels.map((c) => c.name)).toEqual(['DAZN LaLiga']);
  });
});
