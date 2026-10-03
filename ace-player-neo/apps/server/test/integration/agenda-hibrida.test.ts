/* Agenda híbrida de punta a punta (docs/iptv.md §4.7): el backend entero
   (harness.ts, agenda de demostración) contra el proveedor IPTV falso y su
   guía XMLTV de verdad (RSO–VIL de la demo en «M+ LaLiga TV 2», con la previa,
   el resumen, una repetición y la trampa de Champions):
   - sin IPTV: /api/v1/football, la de siempre (sin `guide`);
   - con la IPTV y su guía: RSO–VIL lleva «Confirmado en tu guía» con M+
     LaLiga TV 2 delante de DAZN LaLiga; la ruta antigua, lo mismo sin `guide`;
     ningún partido añadido (la guía falsa no trae ninguno que no esté);
   - el partido se resuelve con la guía primero, la búsqueda de AceStream
     (el motor falso con una fuente de cada canal) empieza por ese canal y
     su AceStream va delante de la de DAZN LaLiga aunque tenga menos pares;
   - en pausa: la agenda de siempre otra vez, al momento. */

import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FootballScheduleSchema,
  IptvViewSchema,
  LegacyFootballResponseSchema,
  ResolutionSchema,
  type FootballSchedule,
} from '@ace/shared';
import { FakeClock } from '../../src/core/clock.js';
import { createLogger } from '../../src/core/logger.js';
import { contentIdToInfohash } from '../fake-engine/catalog.js';
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

/* Ids inventados del motor falso (como en iptv.test.ts). */
function aceId(n: number): string {
  return `a9e0${n.toString(16).padStart(36, '0')}`;
}
/* Una AceStream del canal que confirma la guía (pocos pares) y otra del que anuncia la agenda (muchos). */
const CATALOG = [
  { id: aceId(1), title: 'M+ LaLiga TV 2 --> NEW ERA', bitrateKbps: 2500, peers: 3 },
  { id: aceId(2), title: 'DAZN LaLiga --> ELCANO', bitrateKbps: 2500, peers: 20 },
];
/* En la resolución, una AceStream va por su infohash. */
const ACE_GUIDE = contentIdToInfohash(aceId(1));
const ACE_AGENDA = contentIdToInfohash(aceId(2));

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
    catalog: CATALOG,
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

    /* La resolución: la guía primero; y nada del proveedor en la respuesta. «Rebuscar» hace
       siempre una pasada nueva por el motor (sin precalentado). */
    const searched: string[] = [];
    const search = h.services.search;
    const original = search.search.bind(search);
    const spy = vi.spyOn(search, 'search').mockImplementation((query, options) => {
      searched.push(query);
      return original(query, options);
    });
    const resolved = await get(
      h,
      `/api/v1/football/resolve?match=${match?.id}&client=web_1&research=1`,
    );
    spy.mockRestore();
    expect(resolved.statusCode, resolved.body).toBe(200);
    const resolution = ResolutionSchema.parse(resolved.json());
    expect(resolution.candidates[0]?.title).toBe('M+ LaLiga TV 2 --> Casa');
    expect(resolution.candidates[0]?.iptv?.guide).toBe(true);
    expect(resolution.channels[0]).toBe('M+ LaLiga TV 2');
    /* AceStream: primero el canal de la guía (tal cual y sin la marca del operador), luego el de la agenda… */
    expect(searched.slice(0, 3)).toEqual(['M+ LaLiga TV 2', 'laliga tv 2', 'DAZN LaLiga']);
    /* …y su fuente va delante de la de DAZN LaLiga aunque esta tenga muchos más pares. */
    const ace = resolution.candidates.filter((candidate) => candidate.source === 'acestream');
    expect(ace.map((candidate) => candidate.id)).toEqual([ACE_GUIDE, ACE_AGENDA]);
    const order = resolution.candidates.map((candidate) => candidate.id);
    expect(order.indexOf(ACE_GUIDE)).toBe(1);
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
