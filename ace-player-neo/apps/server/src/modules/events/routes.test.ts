/* GET /api/v1/events y /native/api/v1/events por HTTP (app.inject, sin
   sockets): la conexión se abre, se publican eventos por el bus y se cierra
   con closeAll/closeDevice; la respuesta entera se mira al terminar. */

import { describe, expect, it, vi } from 'vitest';
import type { DeviceRecord } from '@ace/shared';
import { createTestApp, native, web } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import type { AuthService } from '../auth/types.js';
import { lastEventIdFrom } from './routes.js';

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

async function setup() {
  return createTestApp({ services: { auth: fakeAuth() } });
}

const at = '2026-01-01T00:00:00.000Z';

describe('events · rutas v1', () => {
  it('web: 200 text/event-stream con X-Request-Id, retry y los eventos del bus', async () => {
    const { app, services, core } = await setup();
    const pending = app.inject({
      method: 'GET',
      url: '/api/v1/events?device=web_tab_1',
      headers: web({ 'x-request-id': 'req-sse-1' }),
    });
    await vi.waitFor(() => expect(services.events.connections()).toBe(1));
    core.bus.emit('state.changed', { scopes: ['library'], at });
    core.bus.emit('devices.changed', { reason: 'paired', deviceId: 'dev_x' });
    services.events.closeAll();
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBe('req-sse-1');
    expect(res.body.startsWith('retry: 3000\n\n')).toBe(true);
    expect(res.body).toContain('event: state.changed\ndata: {"scopes":["library"],');
    expect(res.body).toContain('event: devices.changed');
  });

  it('native: sin token 401 y sin conexión; con token, el dispositivo es el del token', async () => {
    const { app, services, core } = await setup();
    const denied = await app.inject({
      method: 'GET',
      url: '/native/api/v1/events',
      headers: native(),
    });
    expect(denied.statusCode).toBe(401);
    expect(services.events.connections()).toBe(0);

    const pending = app.inject({
      method: 'GET',
      url: '/native/api/v1/events?device=dev_suplantado',
      headers: native(TOKEN),
    });
    await vi.waitFor(() => expect(services.events.connections()).toBe(1));
    services.events.publish(
      { type: 'state.changed', data: { scopes: ['stats'], at } },
      { deviceIds: ['dev_suplantado'] },
    );
    services.events.publish(
      { type: 'state.changed', data: { scopes: ['learning'], at } },
      { deviceIds: [DEVICE.id] },
    );
    core.bus.emit('devices.changed', { reason: 'paired', deviceId: 'dev_otro' });
    /* Revocar su dispositivo cierra su SSE. */
    core.bus.emit('devices.changed', { reason: 'revoked', deviceId: DEVICE.id });
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"learning"');
    expect(res.body).not.toContain('"stats"');
    expect(res.body).not.toContain('devices.changed');
    expect(services.events.connections()).toBe(0);
  });

  it('Last-Event-ID (cabecera) o lastEventId (query) reanudan; la cabecera manda', async () => {
    const { app, services, core } = await setup();
    core.bus.emit('state.changed', { scopes: ['library'], at });
    core.bus.emit('state.changed', { scopes: ['preferences'], at });
    const hub = services.events as unknown as { lastEventId(): number };
    const last = hub.lastEventId();

    const byHeader = app.inject({
      method: 'GET',
      url: `/api/v1/events?lastEventId=1`,
      headers: web({ 'last-event-id': String(last - 1) }),
    });
    await vi.waitFor(() => expect(services.events.connections()).toBe(1));
    services.events.closeAll();
    const header = await byHeader;
    expect(header.body).toContain(`id: ${last}\nevent: state.changed`);
    expect(header.body).not.toContain('"library"');
    expect(header.body).not.toContain('resync');

    const byQuery = app.inject({
      method: 'GET',
      url: `/api/v1/events?lastEventId=1`,
      headers: web(),
    });
    await vi.waitFor(() => expect(services.events.connections()).toBe(1));
    services.events.closeAll();
    expect((await byQuery).body).toContain('"reason":"server_restart"');

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/events?lastEventId=abc',
      headers: web(),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('Last-Event-ID: cabecera, luego query; lo que no son dígitos se ignora', () => {
    expect(lastEventIdFrom('17', '3')).toBe(17);
    expect(lastEventIdFrom(['18', '19'], undefined)).toBe(18);
    expect(lastEventIdFrom(undefined, '3')).toBe(3);
    expect(lastEventIdFrom(' ', '4')).toBe(4);
    expect(lastEventIdFrom('abc', undefined)).toBeNull();
    expect(lastEventIdFrom(undefined, undefined)).toBeNull();
    expect(lastEventIdFrom('12345678901234567', undefined)).toBeNull();
  });
});
