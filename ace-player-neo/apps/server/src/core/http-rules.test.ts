/* Reglas puras de la capa HTTP: CSRF (server.js:1257-1274), enrutado exacto
   de las rutas antiguas (api.md §2.1) y origen (arquitectura §5.12). */

import { LEGACY_OPERATIONS } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { isAllowedMutation, isLegacySideEffectGet } from './csrf.js';
import { fastifyPathForLegacy, legacyOperationKey, resolveLegacyRoute } from './legacy-routing.js';
import {
  extractBearer,
  isNativePath,
  isV1Path,
  pathOf,
  resolveOrigin,
  stripNativePrefix,
} from './origin.js';

describe('isAllowedMutation (T-033)', () => {
  const req = (method: string, url: string, headers: Record<string, string | string[]> = {}) => ({
    method,
    url,
    headers,
  });

  it('GET, HEAD y OPTIONS pasan salvo los GET con efectos', () => {
    const cross = { 'sec-fetch-site': 'cross-site' };
    expect(isAllowedMutation(req('GET', '/api/state', cross))).toBe(true);
    expect(isAllowedMutation(req('HEAD', '/api/remux', cross))).toBe(true);
    expect(isAllowedMutation(req('OPTIONS', '/api/state', cross))).toBe(true);
    expect(isAllowedMutation(req('GET', '/api/remux', cross))).toBe(false);
    expect(isAllowedMutation(req('GET', '/api/remux?id=x', cross))).toBe(false);
    expect(isAllowedMutation(req('GET', '/api/football/resolve?x', cross))).toBe(false);
    /* Comparación exacta, como la 0.6.59: /api/remuxx no es un GET con efectos. */
    expect(isAllowedMutation(req('GET', '/api/remuxx', cross))).toBe(true);
    expect(isAllowedMutation(req('GET', '/api/v1/x', cross), { sideEffectGet: true })).toBe(false);
  });

  it('Sec-Fetch-Site manda; sin Origin se acepta; con Origin, solo el mismo host', () => {
    expect(isAllowedMutation(req('POST', '/x', { 'sec-fetch-site': 'CROSS-SITE' }))).toBe(false);
    expect(
      isAllowedMutation(
        req('POST', '/x', { 'sec-fetch-site': 'same-origin', origin: 'https://otro' }),
      ),
    ).toBe(true);
    expect(isAllowedMutation(req('POST', '/x'))).toBe(true);
    expect(isAllowedMutation(req('POST', '/x', { origin: 'http://a:1', host: 'a:1' }))).toBe(true);
    expect(isAllowedMutation(req('POST', '/x', { origin: 'http://a:2', host: 'a:1' }))).toBe(false);
    expect(
      isAllowedMutation(req('POST', '/x', { origin: 'https://b', 'x-forwarded-host': ' b , c' })),
    ).toBe(true);
    expect(isAllowedMutation(req('POST', '/x', { origin: 'no es url', host: 'a' }))).toBe(false);
    expect(isAllowedMutation(req('DELETE', '/x', { origin: 'https://c', host: 'a' }))).toBe(false);
  });

  it('isLegacySideEffectGet solo con GET', () => {
    expect(isLegacySideEffectGet('GET', '/api/football/resolve')).toBe(true);
    expect(isLegacySideEffectGet('POST', '/api/football/resolve')).toBe(false);
  });
});

describe('enrutado exacto de las rutas antiguas', () => {
  it('reconoce las 27 operaciones con su URL exacta', () => {
    for (const op of LEGACY_OPERATIONS) {
      const url = op.path === '/remux/' ? `/remux/${'a'.repeat(40)}/index.m3u8` : op.path;
      const resolution = resolveLegacyRoute(op.method, url);
      expect(resolution.kind, legacyOperationKey(op)).toBe('route');
    }
    expect(LEGACY_OPERATIONS).toHaveLength(27);
  });

  it('query solo donde la 0.6.59 la aceptaba', () => {
    expect(resolveLegacyRoute('GET', '/api/search?q=a').kind).toBe('route');
    expect(resolveLegacyRoute('GET', '/api/state?x=1').kind).toBe('not_found');
    expect(resolveLegacyRoute('GET', '/api/football/scan?id=1').kind).toBe('route');
    expect(resolveLegacyRoute('POST', '/api/remux/stop?x=1').kind).toBe('not_found');
    expect(resolveLegacyRoute('GET', '/api/footballx').kind).toBe('not_found');
  });

  it('otro método → 405; en /remux/ sin cuerpo', () => {
    expect(resolveLegacyRoute('DELETE', '/api/state')).toEqual({
      kind: 'method_not_allowed',
      emptyBody: false,
    });
    expect(resolveLegacyRoute('POST', '/remux/x/y')).toEqual({
      kind: 'method_not_allowed',
      emptyBody: true,
    });
  });

  it('las rutas de Fastify: /remux/ como comodín', () => {
    const remux = LEGACY_OPERATIONS.find((op) => op.path === '/remux/');
    expect(remux && fastifyPathForLegacy(remux)).toBe('/remux/*');
  });
});

describe('origen', () => {
  it('sin cabecera es web; un valor raro es native; /native manda siempre', () => {
    expect(resolveOrigin(undefined, '/api/state')).toBe('web');
    expect(resolveOrigin('', '/api/state')).toBe('web');
    expect(resolveOrigin(' WEB ', '/api/state')).toBe('web');
    expect(resolveOrigin('native', '/api/state')).toBe('native');
    expect(resolveOrigin(['otra', 'web'], '/api/state')).toBe('native');
    expect(resolveOrigin('web', '/native/api/v1/ping')).toBe('native');
    expect(resolveOrigin('web', '/native')).toBe('native');
    expect(resolveOrigin('web', '/nativeX/api')).toBe('web');
  });

  it('rutas v1 con y sin /native, y el resto', () => {
    expect(isV1Path('/api/v1/ping?x=1')).toBe(true);
    expect(isV1Path('/native/api/v1/ping')).toBe(true);
    expect(isV1Path('/api/v1')).toBe(true);
    expect(isV1Path('/api/v10/x')).toBe(false);
    expect(isV1Path('/api/state')).toBe(false);
    expect(isNativePath('/native/x')).toBe(true);
    expect(stripNativePrefix('/native/api/v1/ping')).toBe('/api/v1/ping');
    expect(stripNativePrefix('/native')).toBe('/');
    expect(pathOf('/a?b')).toBe('/a');
  });

  it('extractBearer', () => {
    expect(extractBearer('Bearer abc.def')).toBe('abc.def');
    expect(extractBearer('bearer   abc')).toBe('abc');
    expect(extractBearer(['Bearer x'])).toBe('x');
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer('Bearer a b')).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });
});
