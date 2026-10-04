/* Agenda híbrida en el servicio (docs/iptv.md §4.7), con una IPTV falsa:
   - sin IPTV, en pausa, sin guía o sin nada de la guía: la agenda de siempre,
     igual a la de un servicio sin IPTV;
   - con la guía: etiqueta, canal de la guía delante y la resolución busca
     primero ese canal; un partido que solo trae la guía se puede abrir;
   - si la IPTV se pausa, la resolución vuelve a la agenda de siempre sin
     esperar a que alguien pida la agenda. */

import { describe, expect, it } from 'vitest';
import {
  FootballScheduleSchema,
  LegacyFootballResponseSchema,
  channelMatchScore,
  type FootballSchedule,
} from '@ace/shared';
import { createTestApp, web } from '../../../test/helpers/index.js';
import type { GuideAgendaRequest, GuideAgendaResult, IptvService } from '../iptv/types.js';
import { createFootball } from './test-support.js';
import { madridLocalToEpoch } from './time.js';

const DEMO = { FOOTBALL_DEMO_ONLY: 'true' };
/* El reloj falso empieza el 1 de enero de 2026: la demo pone RSO–VIL (demo-4) hoy a las 18:30. */
const TODAY = '2026-01-01';
const RSO_START = madridLocalToEpoch(TODAY, '18:30') as number;

interface FakeIptvState {
  active: boolean;
  result: GuideAgendaResult | null;
  hints?: string[];
}

function fakeIptv(state: FakeIptvState) {
  const requests: GuideAgendaRequest[] = [];
  const service = {
    active: () => state.active,
    guideAgenda: (request: GuideAgendaRequest) => {
      requests.push(request);
      return state.result;
    },
    sameChannelScore: (base: string, other: string) => channelMatchScore(base, other),
    touch: () => undefined,
    resolve: () => ({ candidates: [], hints: state.hints ?? [], consulted: true }),
    classify: () => 'engine' as const,
    candidateFor: () => null,
    tappedCandidates: () => [],
  };
  return { service: service as unknown as IptvService, requests };
}

const confirmed: GuideAgendaResult = {
  confirmations: [
    { matchId: 'demo-4', channels: ['M+ LaLiga TV 2'], start: RSO_START, moved: false },
  ],
  additions: [],
};

function match(payload: FootballSchedule, id: string) {
  return payload.days.flatMap((day) => day.matches).find((m) => m.id === id);
}

function searched(harness: ReturnType<typeof createFootball>): string[] {
  return harness.search.search.mock.calls.map((call) => call[0]);
}

describe('agenda híbrida en el servicio', () => {
  it('sin IPTV, en pausa, sin guía o sin nada de la guía: la agenda de siempre', async () => {
    const plain = await createFootball({ env: DEMO }).football.schedule();
    for (const state of [
      { active: false, result: confirmed },
      { active: true, result: null },
      { active: true, result: { confirmations: [], additions: [] } },
    ]) {
      const iptv = fakeIptv(state);
      const { football } = createFootball({ env: DEMO, iptv: iptv.service });
      expect(await football.schedule()).toEqual(plain);
      /* En pausa, ni se le pregunta a la guía. */
      if (!state.active) expect(iptv.requests).toEqual([]);
    }
    expect(JSON.stringify(plain)).not.toContain('"guide"');
  });

  it('con la guía: etiqueta, canal de la guía delante y la resolución lo busca el primero', async () => {
    const iptv = fakeIptv({ active: true, result: confirmed });
    const harness = createFootball({ env: DEMO, iptv: iptv.service });
    const payload = await harness.football.schedule();
    const rso = match(payload, 'demo-4');
    expect(rso?.guide).toEqual({ channel: 'M+ LaLiga TV 2', time: '18:30', added: false });
    expect(rso?.channels.map((c) => c.name)).toEqual(['M+ LaLiga TV 2', 'DAZN LaLiga']);
    /* Hoy y mañana; la clave cambia con la agenda. */
    expect(iptv.requests[0]?.dates).toEqual([TODAY, '2026-01-02']);
    await harness.football.resolve({ match: 'demo-4' });
    expect(searched(harness)).toEqual(['M+ LaLiga TV 2', 'DAZN LaLiga']);
    expect(harness.football.programChannels('demo-4')).toEqual(['M+ LaLiga TV 2', 'DAZN LaLiga']);
  });

  it('si lo de la guía no cuadra (o falla), la agenda de siempre: nunca la rompe ni la deja vacía', async () => {
    const plain = await createFootball({ env: DEMO }).football.schedule();
    for (const result of [
      /* Un saque imposible: pintarlo falla. */
      {
        confirmations: [
          { matchId: 'demo-4', channels: ['M+ LaLiga TV 2'], start: Number.NaN, moved: true },
        ],
        additions: [],
      },
      /* Un partido añadido con una hora rara: no cumple el contrato. */
      {
        confirmations: [],
        additions: [
          {
            home: 'Girona',
            away: 'Sevilla',
            family: 'laliga' as const,
            competition: 'LaLiga EA Sports',
            date: TODAY,
            start: -1e20,
            channels: ['DAZN LaLiga'],
          },
        ],
      },
    ]) {
      const iptv = fakeIptv({ active: true, result });
      const { football } = createFootball({ env: DEMO, iptv: iptv.service });
      expect(await football.schedule()).toEqual(plain);
    }
    /* Y si la IPTV lanza al preguntarle, también. */
    const broken = {
      ...fakeIptv({ active: true, result: confirmed }).service,
      guideAgenda: () => {
        throw new Error('guía rota');
      },
    } as unknown as IptvService;
    expect(await createFootball({ env: DEMO, iptv: broken }).football.schedule()).toEqual(plain);
  });

  it('si la IPTV se pausa, la resolución vuelve a los canales de siempre sin esperar a la agenda', async () => {
    const state: FakeIptvState = { active: true, result: confirmed };
    const iptv = fakeIptv(state);
    const harness = createFootball({ env: DEMO, iptv: iptv.service });
    await harness.football.schedule();
    state.active = false;
    await harness.football.resolve({ match: 'demo-4' });
    expect(searched(harness)).toEqual(['DAZN LaLiga']);
  });

  it('la guía mueve la hora: la agenda y la resolución usan la de la guía', async () => {
    const moved = madridLocalToEpoch(TODAY, '21:15') as number;
    const iptv = fakeIptv({
      active: true,
      result: {
        confirmations: [
          { matchId: 'demo-4', channels: ['M+ LaLiga TV 2'], start: moved, moved: true },
        ],
        additions: [],
      },
    });
    const harness = createFootball({ env: DEMO, iptv: iptv.service });
    const payload = await harness.football.schedule();
    expect(match(payload, 'demo-4')).toMatchObject({
      time: '21:15',
      start: moved,
      guide: { channel: 'M+ LaLiga TV 2', time: '21:15', agendaTime: '18:30', added: false },
    });
  });

  it('por HTTP: /api/v1/football lleva `guide`; la ruta antigua, lo mismo sin `guide` (forma de la 0.6.59)', async () => {
    const iptv = fakeIptv({ active: true, result: confirmed });
    const harness = createFootball({ env: DEMO, iptv: iptv.service });
    const { app } = await createTestApp({ services: { football: harness.football } });
    const v1 = await app.inject({ method: 'GET', url: '/api/v1/football', headers: web() });
    expect(v1.statusCode).toBe(200);
    const v1Data = FootballScheduleSchema.parse(v1.json());
    expect(match(v1Data, 'demo-4')?.guide?.channel).toBe('M+ LaLiga TV 2');
    const legacy = await app.inject({ method: 'GET', url: '/api/football', headers: web() });
    const legacyData = LegacyFootballResponseSchema.parse(legacy.json());
    expect(JSON.stringify(legacyData)).not.toContain('"guide"');
    expect(match(legacyData, 'demo-4')?.channels[0]?.name).toBe('M+ LaLiga TV 2');
  });

  it('un partido que solo trae la guía sale en la agenda y se puede abrir', async () => {
    const start = madridLocalToEpoch(TODAY, '16:15') as number;
    const iptv = fakeIptv({
      active: true,
      result: {
        confirmations: [],
        additions: [
          {
            home: 'Girona',
            away: 'Sevilla',
            family: 'laliga',
            competition: 'LaLiga EA Sports',
            date: TODAY,
            start,
            channels: ['DAZN LaLiga 2'],
          },
        ],
      },
    });
    const harness = createFootball({ env: DEMO, iptv: iptv.service });
    const payload = await harness.football.schedule();
    const added = payload.days[0]?.matches.find((m) => m.home === 'Girona');
    expect(added?.id).toMatch(/^guia-/);
    /* La competición, con el rótulo que ya usa la agenda para LaLiga (la demo dice «LaLiga»). */
    expect(added).toMatchObject({ competition: 'LaLiga', guide: { added: true } });
    await harness.football.resolve({ match: added?.id });
    expect(searched(harness)).toEqual(['DAZN LaLiga 2']);
  });
});
