/* GET y POST /api/v1/diagnostics por HTTP (app.inject), con la capa de
   acceso de app.ts: validación, 201, 429 y el dispositivo del token. */

import { describe, expect, it } from 'vitest';
import {
  DiagnosticReportResponseSchema,
  DiagnosticsListResponseSchema,
  type DeviceRecord,
} from '@ace/shared';
import { createTestApp, native, web } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import type { AuthService } from '../auth/types.js';
import { CLIENT_REPORTS_PER_MINUTE } from './service.js';

const TOKEN = 'dev_iphone01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DEVICE: DeviceRecord = {
  id: 'dev_iphone01',
  name: 'iPhone',
  platform: 'ios',
  secretSha256: '0'.repeat(64),
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: null,
  revokedAt: null,
};

function fakeAuth(): AuthService {
  return new Proxy({} as AuthService, {
    get(_target, property) {
      if (property === 'authenticateBearer') {
        return async (token: string): Promise<AuthenticatedDevice> => {
          if (token !== TOKEN) throw new AppError('unauthorized');
          return { deviceId: DEVICE.id, device: DEVICE, via: 'bearer' };
        };
      }
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw new Error(`fakeAuth.${String(property)}`);
      };
    },
  });
}

describe('diagnostics · rutas v1', () => {
  it('POST (web y iOS) → 201 { accepted, id }; GET los devuelve con recuento de 24 h', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const fromWeb = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics',
      headers: web({ 'x-request-id': 'req-web' }),
      payload: { code: 'autoplay_blocked', metrics: { timeToFirstFrameMs: 1200 } },
    });
    expect(fromWeb.statusCode).toBe(201);
    expect(DiagnosticReportResponseSchema.parse(fromWeb.json())).toMatchObject({ accepted: true });
    const fromIos = await app.inject({
      method: 'POST',
      url: '/native/api/v1/diagnostics',
      headers: native(TOKEN),
      payload: { cause: 'codec', code: 'audio_decode', message: 'AC-3 sin soporte' },
    });
    expect(fromIos.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/diagnostics?limit=10',
      headers: web(),
    });
    expect(list.statusCode).toBe(200);
    const body = DiagnosticsListResponseSchema.parse(list.json());
    expect(body.total).toBe(2);
    expect(body.counts24h).toEqual({
      engine: 0,
      source: 0,
      network: 0,
      codec: 1,
      client: 1,
      state: 0,
    });
    expect(body.entries[0]).toMatchObject({
      cause: 'codec',
      code: 'audio_decode',
      deviceId: DEVICE.id,
    });
    expect(body.entries[1]).toMatchObject({
      cause: 'client',
      requestId: 'req-web',
      metrics: { timeToFirstFrameMs: 1200 },
    });
    expect(body.entries[1]).not.toHaveProperty('deviceId');

    const filtered = await app.inject({
      method: 'GET',
      url: '/native/api/v1/diagnostics?cause=codec',
      headers: native(TOKEN),
    });
    expect(filtered.json<{ entries: unknown[] }>().entries).toHaveLength(1);
  });

  it('cuerpo o query sin forma → 400; el cliente no puede poner id, at ni deviceId', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    for (const payload of [
      {},
      { code: 'Con Mayúsculas' },
      { code: 'x', cause: 'otra' },
      { code: 'x', deviceId: 'dev_otro' },
      { code: 'x', id: 'diag_000001' },
      { code: 'x', message: 'm'.repeat(501) },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics',
        headers: web(),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    const badQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/diagnostics?since=ayer',
      headers: web(),
    });
    expect(badQuery.statusCode).toBe(400);
  });

  it(`más de ${CLIENT_REPORTS_PER_MINUTE} informes por minuto del mismo cliente → 429 rate_limited`, async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/native/api/v1/diagnostics',
        headers: native(TOKEN),
        payload: { code: 'rebuffer' },
      });
    for (let index = 0; index < CLIENT_REPORTS_PER_MINUTE; index += 1) {
      expect((await send()).statusCode).toBe(201);
    }
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
    /* La web tiene su propio cupo. */
    const fromWeb = await app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics',
      headers: web(),
      payload: { code: 'rebuffer' },
    });
    expect(fromWeb.statusCode).toBe(201);
  });
});
