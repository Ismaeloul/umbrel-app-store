/* La fachada antigua del módulo (legacy-exports.ts): mismas entradas y
   salidas que la 0.6.59. La red de la fachada (`fetchText` de net) se
   sustituye por los fixtures y la fecha del sistema se fija: nada real. */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EPG_BASE, FLTV_URL, THESPORTSDB_BASE } from './constants.js';
import {
  buildFootballDemoSchedule,
  enrichFootballLeagues,
  fetchEpgFootballSchedule,
  fetchFutbolEnLaTvSchedule,
  footballPreheatStage,
  footballProgramChannelNames,
  footballProgramMatch,
  getFootballSchedule,
  pruneScoresCache,
  rememberFootballProgramming,
  scoresCache,
} from './legacy-exports.js';
import { createFootball, fixture } from './test-support.js';

const EPG_GRID = `${EPG_BASE}/OTT/epg?from=2026-01-01T00:00:00&span=7&channel=`;

const routes: Record<string, string> = {
  [FLTV_URL]: fixture('futbolenlatv.html'),
  [`${EPG_BASE}/OTT/contents/channels`]: fixture('epg-channels.json'),
  [`${EPG_GRID}MLIGA`]: fixture('epg-grid-mliga.json'),
  [`${EPG_GRID}CHAPIO`]: fixture('epg-grid-chapio.json'),
  [`${EPG_BASE}/contents/501/details`]: fixture('epg-details-501.json'),
  [`${EPG_BASE}/contents/502/details`]: fixture('epg-details-502.json'),
  [`${THESPORTSDB_BASE}/123/lookupevent.php?id=9001`]: fixture('thesportsdb-lookupevent.json'),
};

const netCalls: { url: string; deadline: number; maxBytes: number }[] = [];

vi.mock('../net/legacy-exports.js', () => ({
  fetchText: vi.fn(
    async (
      url: string,
      _redirects: number,
      _visited: Set<string>,
      deadline: number,
      maxBytes: number,
    ) => {
      netCalls.push({ url, deadline, maxBytes });
      const prefix = Object.keys(routes).find((key) => url.startsWith(key));
      if (prefix === undefined) throw new Error('http_404');
      return routes[prefix];
    },
  ),
}));

const T0 = Date.UTC(2026, 0, 1);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterAll(() => {
  vi.useRealTimers();
});

describe('T-020 · la agenda completa queda disponible para clasificar las fuentes de cada partido (B-164)', () => {
  it('canales de la parrilla y partido por id', () => {
    const schedule = buildFootballDemoSchedule('2026-08-19');
    rememberFootballProgramming(schedule);
    const channels = footballProgramChannelNames(schedule);
    expect(channels).toContain('M+ Liga de Campeones');
    expect(channels).toContain('DAZN LaLiga 2');
    const programmed = schedule.days
      .flatMap((day) => day.matches)
      .find((item) => item.home === 'Real Madrid' && item.away === 'Manchester City');
    expect(programmed).toBeDefined();
    const match = footballProgramMatch(programmed!.id);
    expect(match?.competition).toBe('Champions League');
    expect(match?.channels).toEqual(['M+ Liga de Campeones']);
    expect(match?.start).toBeNull();
    expect(footballProgramMatch('no-existe')).toBeNull();
    expect(footballProgramMatch(undefined)).toBeNull();
  });

  it('los canales como texto o `{ name }` cuentan igual y sin repetir por clave', () => {
    expect(
      footballProgramChannelNames({
        days: [
          { matches: [{ channels: ['DAZN 1', { name: 'dazn 1 hd' }, { id: 'x' }, '', null] }] },
          { matches: 'no es lista' },
          null,
        ],
      }),
    ).toEqual(['DAZN 1', '[object Object]']);
    expect(footballProgramChannelNames(null)).toEqual([]);
  });
});

describe('Agenda de la fachada (server.js:1917-2086, 2430-2520)', () => {
  it('buildFootballDemoSchedule: `success`, 7 días desde hoy, ids demo-N y sin `start`', () => {
    const schedule = buildFootballDemoSchedule();
    expect(Object.keys(schedule)[0]).toBe('success');
    expect(schedule).toMatchObject({
      success: true,
      generatedAt: '2026-01-01T00:00:00.000Z',
      source: 'demo',
      demo: true,
    });
    expect(schedule.days.map((day) => day.date)[0]).toBe('2026-01-01');
    expect(schedule.days).toHaveLength(7);
    const matches = schedule.days.flatMap((day) => day.matches);
    expect(matches.map((match) => match.id)).toContain('demo-10');
    expect(matches.every((match) => !('start' in match))).toBe(true);
  });

  it('fetchFutbolEnLaTvSchedule: ids posicionales como la 0.6.59', async () => {
    const schedule = await fetchFutbolEnLaTvSchedule();
    expect(schedule).toMatchObject({ success: true, source: 'futbolenlatv' });
    const ids = schedule.days.flatMap((day) => day.matches.map((match) => match.id));
    expect(ids).toEqual(['fltv-2026-01-01-0', 'fltv-2026-01-01-1', 'fltv-2026-01-02-2']);
    const call = netCalls.find((entry) => entry.url === FLTV_URL);
    expect(call).toMatchObject({ deadline: T0 + 45_000, maxBytes: 6 * 1024 * 1024 });
  });

  it('fetchEpgFootballSchedule: sin `start`, como la 0.6.59', async () => {
    const schedule = await fetchEpgFootballSchedule();
    expect(schedule).toMatchObject({ success: true, source: 'movistarplus', partial: true });
    const matches = schedule.days.flatMap((day) => day.matches);
    expect(matches).toHaveLength(3);
    expect(matches.every((match) => !('start' in match))).toBe(true);
    expect(netCalls.find((entry) => entry.url.includes('/OTT/contents/channels'))?.maxBytes).toBe(
      2 * 1024 * 1024,
    );
  });

  it('enrichFootballLeagues sin `lookup` pregunta a TheSportsDB con la clave pública', async () => {
    const matches = [{ id: '9001', competition: 'Fútbol' }];
    await enrichFootballLeagues(matches);
    expect(matches[0]?.competition).toBe('Spanish La Liga');
  });

  it('getFootballSchedule necesita el servicio', async () => {
    await expect(getFootballSchedule()).rejects.toMatchObject({ code: 'not_implemented' });
    const { football } = createFootball({ env: { FOOTBALL_DEMO_ONLY: 'true' } });
    const schedule = await getFootballSchedule(football);
    expect(schedule).toMatchObject({ success: true, demo: true });
    expect(Object.keys(schedule)[0]).toBe('success');
  });
});

describe('Valores por defecto de la fachada (la hora del sistema)', () => {
  it('footballPreheatStage y pruneScoresCache sin `now`', () => {
    expect(footballPreheatStage(T0 + 10 * 60_000)).toBe('scan');
    scoresCache().set('liga@viejo', {
      payload: [],
      expiresAt: T0 - 25 * 3600 * 1000,
      pending: null,
    });
    pruneScoresCache();
    expect(scoresCache().has('liga@viejo')).toBe(false);
  });
});
