import { V1_ROUTES, V1_ROUTE_IDS } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { buildPath, buildQuery, ROUTES, routeOf, routeUrl } from './routes.ts';

describe('tabla de rutas ligera', () => {
  it('es exactamente V1_ROUTES sin los esquemas (sale del módulo virtual)', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...V1_ROUTE_IDS].sort());
    for (const id of V1_ROUTE_IDS) {
      const full = V1_ROUTES[id];
      expect(ROUTES[id]).toEqual({
        method: full.method,
        path: full.path,
        content: full.content,
        sideEffects: full.sideEffects,
      });
    }
  });

  it('routeOf avisa de una ruta que no existe', () => {
    expect(() => routeOf('noExiste' as never)).toThrow(/no existe/);
  });
});

describe('buildPath y buildQuery', () => {
  it('sustituye y escapa los parámetros', () => {
    expect(buildPath('/api/v1/devices/:id', { id: 'dev_1' })).toBe('/api/v1/devices/dev_1');
    expect(buildPath('/api/v1/football/preheat/:matchId', { matchId: 'a b/c' })).toBe(
      '/api/v1/football/preheat/a%20b%2Fc',
    );
    expect(() => buildPath('/api/v1/devices/:id', {})).toThrow(/Falta el parámetro «id»/);
  });

  it('query con repetidos (channel=a&channel=b) y sin vacíos', () => {
    expect(
      buildQuery({
        channel: ['M+ LaLiga', 'DAZN 1'],
        match: 'x',
        research: undefined,
        current: null,
      }),
    ).toBe('?channel=M%2B+LaLiga&channel=DAZN+1&match=x');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });

  it('routeUrl junta las dos cosas', () => {
    expect(routeUrl('footballScan', { id: '0123456789abcdef01234567' })).toBe(
      '/api/v1/football/scans/0123456789abcdef01234567',
    );
    expect(routeUrl('search', null, { q: 'dazn' })).toBe('/api/v1/search?q=dazn');
  });
});
