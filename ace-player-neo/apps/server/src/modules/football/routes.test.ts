/* Rutas de fútbol por HTTP con app.inject (api.md §4.8-4.13; tabla v1 de
   @ace/shared/routes.ts): la forma exacta de la 0.6.59 y las gemelas v1. */

import {
  BindResponseSchema,
  FootballScheduleSchema,
  LegacyFootballResponseSchema,
  LegacyResolveResponseSchema,
  ResolveResponseSchema,
} from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, web } from '../../../test/helpers/index.js';
import { FLTV_URL } from './constants.js';
import { LEGACY_ROUTES, V1_ROUTE_IDS, legacyResolveQuery, v1ScanRef } from './routes.js';
import { ID_A, ID_B, createFootball, fixture, withStreams } from './test-support.js';

async function appWith(options: Parameters<typeof createFootball>[0] = {}) {
  const harness = createFootball(options);
  const { app } = await createTestApp({ services: { football: harness.football } });
  return { app, ...harness };
}

const json = web({ 'content-type': 'application/json' });

describe('T-024 · sirve una agenda de desarrollo completa sin consultar servicios externos (B-126)', () => {
  it('GET /api/football en modo demo', async () => {
    const { app, net } = await appWith({ env: { FOOTBALL_DEMO_ONLY: 'true' } });
    const response = await app.inject({ method: 'GET', url: '/api/football', headers: web() });
    const data = response.json();
    expect(response.statusCode).toBe(200);
    expect(LegacyFootballResponseSchema.parse(data)).toEqual(data);
    expect(Object.keys(data)[0]).toBe('success');
    expect(data.success).toBe(true);
    expect(data.demo).toBe(true);
    expect(data.days.length).toBeGreaterThanOrEqual(3);
    type Match = { home: string; away: string; competition: string };
    const matches: Match[] = data.days.flatMap((day: { matches: Match[] }) => day.matches);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((match) => match.home === 'España' && match.away === 'Portugal')).toBe(
      true,
    );
    expect(
      matches.some((match) => match.home === 'FC Barcelona' && match.competition === 'Amistoso'),
    ).toBe(true);
    expect(
      matches.some((match) => match.home === 'Barcelona SC' && match.competition === 'Amistoso'),
    ).toBe(true);
    expect(net.fetchText).not.toHaveBeenCalled();
  });
});

describe('T-027 · recuerda una vinculación manual y la usa antes que la búsqueda (B-149)', () => {
  it('POST /api/football/bind y después GET /api/football/resolve', async () => {
    const { app, state } = await appWith();
    const binding = await app.inject({
      method: 'POST',
      url: '/api/football/bind',
      headers: json,
      payload: {
        channel: 'Amazon Prime Video',
        id: `acestream://${ID_B}`,
        title: 'Mi señal de Prime',
        ih: false,
      },
    });
    expect(binding.statusCode).toBe(200);
    expect(binding.json().binding.id).toBe(ID_B);
    expect(binding.json()).toMatchObject({
      success: true,
      binding: {
        channel: 'Amazon Prime Video',
        channelKey: 'amazon prime video',
        title: 'Mi señal de Prime',
        ih: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(state.enqueue).toHaveBeenCalledWith(expect.any(Function), { scopes: ['bindings'] });
    const response = await app.inject({
      method: 'GET',
      url: '/api/football/resolve?channel=Amazon%20Prime%20Video',
      headers: web(),
    });
    const data = response.json();
    expect(response.statusCode).toBe(200);
    expect(data.status).toBe('found');
    expect(data.candidate.id).toBe(ID_B);
    expect(data.candidate.title).toBe('Mi señal de Prime');
    expect(data.candidate.source).toBe('saved');
    expect(LegacyResolveResponseSchema.parse(data)).toEqual(data);
  });

  it('un vínculo nuevo del mismo canal sustituye al anterior y va el primero', async () => {
    const { app } = await appWith();
    const bind = (channel: string, id: string) =>
      app.inject({
        method: 'POST',
        url: '/api/football/bind',
        headers: json,
        payload: { channel, id },
      });
    await bind('DAZN', ID_A);
    await bind('M+ LALIGA', ID_A);
    const last = await bind('dazn', ID_B);
    expect(
      last
        .json()
        .channelBindings.map((item: { channelKey: string; id: string }) => [
          item.channelKey,
          item.id,
        ]),
    ).toEqual([
      ['dazn', ID_B],
      ['movistar laliga', ID_A],
    ]);
    expect(last.json().binding.title).toBe('dazn');
  });

  it('sin canal o sin hash válido: 400 bad_binding; con un cuerpo raro, también', async () => {
    const { app } = await appWith();
    for (const payload of [
      { channel: 'DAZN' },
      { id: ID_A },
      { channel: '***', id: ID_A },
      [1, 2],
      'x',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/football/bind',
        headers: json,
        payload: JSON.stringify(payload),
      });
      expect([response.statusCode, response.json()]).toEqual([400, { error: 'bad_binding' }]);
    }
  });
});

describe('Rutas antiguas de fútbol (api.md §4.8-4.13)', () => {
  it('GET /api/football: la agenda con `success` y la query se ignora', async () => {
    const { app } = await appWith({ net: { [FLTV_URL]: fixture('futbolenlatv.html') } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/football?dia=hoy',
      headers: web(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, source: 'futbolenlatv' });
  });

  it('GET /api/football sin ninguna fuente: 502 football_unavailable', async () => {
    const { app } = await appWith();
    const response = await app.inject({ method: 'GET', url: '/api/football', headers: web() });
    expect([response.statusCode, response.json()]).toEqual([
      502,
      { error: 'football_unavailable' },
    ]);
  });

  it('GET /api/football/resolve sin canales: 400 channel_required', async () => {
    const { app } = await appWith();
    const response = await app.inject({
      method: 'GET',
      url: '/api/football/resolve',
      headers: web(),
    });
    expect([response.statusCode, response.json()]).toEqual([400, { error: 'channel_required' }]);
  });

  it('GET /api/football/resolve con `channel` repetido, `client` y el comprobador', async () => {
    const { app, scanner } = await appWith({
      scanner: { enabled: true },
      state: withStreams([{ id: ID_A, title: 'M+ Liga de Campeones' }]),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/football/resolve?channel=M%2B%20Liga%20de%20Campeones&channel=DAZN&client=tv1',
      headers: web(),
    });
    const data = response.json();
    expect(response.statusCode).toBe(200);
    expect(data).toMatchObject({
      success: true,
      status: 'found',
      channels: ['M+ Liga de Campeones', 'DAZN'],
      preheat: null,
      scan: { statusUrl: `/api/football/scan?id=${data.scan.id}`, total: 1, initialCount: 1 },
    });
    expect(scanner.enqueue.mock.lastCall?.[0]).toMatchObject({ clientKey: 'tv1', matchId: '' });
  });

  it('GET /api/football/preheat: `{ success, preheat }` (null si no hay)', async () => {
    const { app } = await appWith();
    for (const url of ['/api/football/preheat?match=m1', '/api/football/preheat']) {
      const response = await app.inject({ method: 'GET', url, headers: web() });
      expect([response.statusCode, response.json()]).toEqual([
        200,
        { success: true, preheat: null },
      ]);
    }
  });

  it('GET /api/scores: `success: false` con 200 si no hay agenda', async () => {
    const { app } = await appWith();
    const response = await app.inject({ method: 'GET', url: '/api/scores', headers: web() });
    expect([response.statusCode, response.json()]).toEqual([
      200,
      { success: false, error: 'sin_agenda', scores: {} },
    ]);
  });

  it('la query antigua se lee como server.js:4770-4808', () => {
    expect(
      legacyResolveQuery(
        new URLSearchParams(
          'match=m1&channel=A&channel=B&research=1&current=x&current_ih=1&client=c',
        ),
      ),
    ).toEqual({
      match: 'm1',
      channel: ['A', 'B'],
      research: '1',
      current: 'x',
      current_ih: '1',
      client: 'c',
    });
    expect(v1ScanRef(null)).toBeNull();
  });

  it('cada ruta tiene su manejador (sin 501)', () => {
    expect(LEGACY_ROUTES).toHaveLength(5);
    expect(V1_ROUTE_IDS).toHaveLength(5);
  });
});

describe('Rutas /api/v1 de fútbol', () => {
  it('GET /api/v1/football: la agenda sin `success`', async () => {
    const { app } = await appWith({ env: { FOOTBALL_DEMO_ONLY: 'true' } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/football', headers: web() });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data).not.toHaveProperty('success');
    expect(FootballScheduleSchema.parse(data)).toEqual(data);
  });

  it('GET /api/v1/football sin agenda: 502 con el error v1', async () => {
    const { app } = await appWith();
    const response = await app.inject({ method: 'GET', url: '/api/v1/football', headers: web() });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({ code: 'football_unavailable' });
  });

  it('GET /api/v1/football/resolve: la resolución y el trabajo en /api/v1/football/scans/:id', async () => {
    const { app } = await appWith({
      scanner: { enabled: true },
      state: withStreams([{ id: ID_A, title: 'M+ Liga de Campeones' }]),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/football/resolve?channel=M%2B%20Liga%20de%20Campeones&client=tv1',
      headers: web(),
    });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(ResolveResponseSchema.parse(data)).toEqual(data);
    expect(data).not.toHaveProperty('success');
    expect(data.scan.statusUrl).toBe(`/api/v1/football/scans/${data.scan.id}`);
    expect(data.candidate.id).toBe(ID_A);
  });

  it('GET /api/v1/football/resolve sin canal: 400 channel_required con mensaje', async () => {
    const { app } = await appWith();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/football/resolve',
      headers: web(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'channel_required',
      message: 'Este partido no anuncia ningún canal.',
    });
  });

  it('GET /api/v1/football/preheat/:matchId', async () => {
    const { app } = await appWith();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/football/preheat/fltv-2026-01-01-abcdef0123',
      headers: web(),
    });
    expect([response.statusCode, response.json()]).toEqual([200, { preheat: null }]);
  });

  it('POST /api/v1/football/bindings: el vínculo y la lista, sin `success`', async () => {
    const { app } = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/football/bindings',
      headers: json,
      payload: { channel: 'DAZN', id: ID_A, title: 'DAZN 1', ih: true },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(BindResponseSchema.parse(data)).toEqual(data);
    expect(data.binding).toMatchObject({ channel: 'DAZN', id: ID_A, ih: true });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/football/bindings',
      headers: json,
      payload: { channel: '***', id: ID_A },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_binding');
  });

  it('GET /api/v1/scores: `available: false` sin agenda', async () => {
    const { app } = await appWith();
    const response = await app.inject({ method: 'GET', url: '/api/v1/scores', headers: web() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: false, source: 'espn', scores: {} });
  });
});
