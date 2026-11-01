/* El permiso «Acceso desde fuera de casa» de cada aparato (tv.ismaeloul.es): apagado por defecto,
   se enciende desde la web, caduca, se quita al momento (cierra lo abierto por el dominio y no lo
   de casa) y no toca devices.json (volver a la 1.1.2 no deja a nadie sin emparejar). */

import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DevicesFileSchema, REMOTE_EXPIRES_IN_MS, REMOTE_LIMITS, V2_FILES } from '@ace/shared';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEdgeTest,
  expectError,
  expectHidden,
  openEdgeSse,
  PUBLIC_IP,
} from '../../../test/helpers/edge.js';
import { native, web } from '../../../test/helpers/index.js';

const BOOT = '/native/api/v1/bootstrap';

describe('permiso de fuera por aparato', () => {
  it('sin permiso: 403 remote_forbidden y el suceso «intentó entrar desde fuera» (una vez)', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    for (let index = 0; index < 3; index += 1) {
      const response = await t.edge({ path: BOOT, token });
      expect(response.status).toBe(403);
      expect(response.json()).toMatchObject({
        error: {
          code: 'remote_forbidden',
          message: expect.stringContaining('Activa el acceso desde fuera'),
        },
      });
    }
    await t.remote.flush();
    const denied = t.remote.view().events.filter((event) => event.kind === 'denied-device');
    expect(denied).toEqual([
      expect.objectContaining({ deviceId, ip: PUBLIC_IP, route: 'bootstrap' }),
    ]);
  });

  it('se enciende desde la web (nunca desde /native) y entonces pasa; bootstrap lo dice', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    /* Un iPhone no puede darse permiso: la ruta es solo web, desde casa y por el dominio. */
    const fromPhone = await t.app.inject({
      method: 'PUT',
      url: `/native/api/v1/devices/${deviceId}/remote`,
      headers: native(token, { 'content-type': 'application/json' }),
      payload: { enabled: true },
    });
    expect(fromPhone.statusCode).toBe(403);
    const viaDomain = await t.edge({
      method: 'PUT',
      path: `/native/api/v1/devices/${deviceId}/remote`,
      token,
      body: { enabled: true },
    });
    expectHidden(viaDomain, 403, 'remote_forbidden_route');
    expect(t.remote.isAllowed(deviceId)).toBe(false);

    const fromWeb = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/devices/${deviceId}/remote`,
      headers: web({ 'content-type': 'application/json' }),
      payload: { enabled: true, expiresIn: '7d' },
    });
    expect(fromWeb.statusCode).toBe(200);
    expect(fromWeb.json().devices).toEqual([
      expect.objectContaining({
        deviceId,
        enabled: true,
        expired: false,
        expiresAt: expect.any(String),
      }),
    ]);
    const boot = await t.edge({ path: BOOT, token });
    expect(boot.status).toBe(200);
    expect(boot.json<{ remote: unknown }>().remote).toEqual({
      viaDomain: true,
      allowed: true,
      expiresAt: new Date(t.core.clock.now() - 0 + REMOTE_EXPIRES_IN_MS['7d']!).toISOString(),
    });
    /* Desde casa, la app ve que no entró por el dominio. */
    const home = await t.app.inject({ method: 'GET', url: BOOT, headers: native(token) });
    expect(home.json<{ remote?: unknown }>().remote).toBeUndefined();
    await t.remote.flush();
    const view = t.remote.view();
    expect(view.devices[0]?.lastAccess).toEqual({ at: expect.any(String), ip: PUBLIC_IP });
    expect(view.events.map((event) => event.kind)).toContain('ok-new-ip');
  });

  it('caduca: pasado el plazo, 403 remote_forbidden y el suceso expired', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId, '24h');
    expect((await t.edge({ path: BOOT, token })).status).toBe(200);
    t.core.clock.set(t.core.clock.now() + REMOTE_EXPIRES_IN_MS['24h']! + 1000);
    const after = await t.edge({ path: BOOT, token });
    expectError(after, 403, 'remote_forbidden');
    await t.remote.flush();
    const view = t.remote.view();
    expect(view.devices[0]).toMatchObject({ enabled: true, expired: true });
    expect(view.events.filter((event) => event.kind === 'expired')).toHaveLength(1);
  });

  it('«Sin caducidad» no caduca', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId, 'never');
    t.core.clock.set(t.core.clock.now() + 400 * 24 * 60 * 60 * 1000);
    expect((await t.edge({ path: BOOT, token })).status).toBe(200);
    expect(t.remote.view().devices[0]?.expiresAt).toBeNull();
  });

  it('interruptor general apagado («Cerrar el dominio ya»): 403 remote_disabled a todos, sin contar como fallo', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const closed = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/remote',
      headers: web({ 'content-type': 'application/json' }),
      payload: { enabled: false },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ enabled: false });
    for (let index = 0; index < 10; index += 1) {
      const response = await t.edge({ path: BOOT, token });
      expectHidden(response, 403, 'remote_disabled');
    }
    expect(t.remote.lockState(PUBLIC_IP)).toBeNull();
    await t.remote.setEnabled(true);
    expect((await t.edge({ path: BOOT, token })).status).toBe(200);
  });

  it('quitar el permiso cierra al momento el SSE del dominio y no el de casa', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    /* Casa: el mismo Fastify escuchando de verdad (como nginx → 3000). */
    await t.app.listen({ host: '127.0.0.1', port: 0 });
    const homePort = (t.app.server.address() as AddressInfo).port;
    const home = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: homePort,
          path: '/native/api/v1/events',
          headers: native(token),
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
    let homeOpen = true;
    home.on('data', () => undefined);
    home.on('close', () => {
      homeOpen = false;
    });
    const remoteSse = await openEdgeSse(t.port, token);
    expect(remoteSse.status).toBe(200);
    expect(t.services.events.connections()).toBe(2);

    await t.remote.setDevice(deviceId, { enabled: false, expiresIn: '30d' });
    await remoteSse.closed;
    expect(remoteSse.isOpen()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(homeOpen).toBe(true);
    expect(t.services.events.connections()).toBe(1);
    home.destroy();
  });

  it('cada aparato, como mucho 4 SSE por el dominio: al abrir el quinto se cierra el más viejo', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    const opened = [];
    for (let index = 0; index < 4; index += 1) opened.push(await openEdgeSse(t.port, token));
    const fifth = await openEdgeSse(t.port, token);
    expect(fifth.status).toBe(200);
    await opened[0]?.closed;
    expect(opened.map((sse) => sse.isOpen())).toEqual([false, true, true, true]);
    for (const sse of [...opened, fifth]) sse.destroy();
  });

  it('revocar el aparato borra su permiso (y por el dominio ya no entra)', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    await t.services.auth.revokeDevice(deviceId);
    await t.remote.flush();
    const file = JSON.parse(
      readFileSync(path.join(t.core.config.dataDir, V2_FILES.remoteAccess), 'utf8'),
    ) as { devices: Record<string, unknown> };
    expect(file.devices[deviceId]).toBeUndefined();
    const response = await t.edge({ path: BOOT, token });
    expectHidden(response, 401, 'device_revoked');
  });

  it('volver a la 1.1.2: devices.json no cambia de forma; lo nuevo va en ficheros aparte (0600)', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId);
    await t.edge({ path: BOOT, token });
    await t.remote.flush();
    const devices = JSON.parse(readFileSync(t.core.config.paths.devicesFile, 'utf8')) as unknown;
    /* El esquema estricto de devices.json (el de la 1.1.2) sigue leyéndolo. */
    expect(DevicesFileSchema.safeParse(devices).success).toBe(true);
    expect(JSON.stringify(devices)).not.toMatch(/remote|lastAccess|knownIps/);
    for (const relative of [V2_FILES.remoteAccess, V2_FILES.remoteEvents]) {
      expect(existsSync(path.join(t.core.config.dataDir, relative)), relative).toBe(true);
    }
  });

  it('la web ve los aparatos (sin revocados), los bloqueos y los sucesos; el iPhone no', async () => {
    const t = await createEdgeTest();
    const { token } = await t.pair();
    const fromWeb = await t.app.inject({ method: 'GET', url: '/api/v1/remote', headers: web() });
    expect(fromWeb.statusCode).toBe(200);
    expect(fromWeb.json()).toMatchObject({
      enabled: true,
      domain: { configured: false, url: null },
      edge: { listening: true, peerResolved: true },
    });
    const fromPhone = await t.app.inject({
      method: 'GET',
      url: '/native/api/v1/remote',
      headers: native(token),
    });
    expect(fromPhone.statusCode).toBe(403);
  });

  it('NATIVE_PUBLIC_URL: el QR de emparejar lleva https://tv… como última dirección', async () => {
    const t = await createEdgeTest({ env: { NATIVE_PUBLIC_URL: 'https://tv.example.org' } });
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/pairing',
      headers: web({ host: 'umbrel.local:7792', 'content-type': 'application/json' }),
      payload: { alternateBaseUrls: ['http://umbrel.tail1234.ts.net:7792'] },
    });
    expect(created.statusCode).toBe(201);
    const uri = created.json<{ pairUri: string }>().pairUri;
    const addresses = [...new URL(uri.replace('aceneo://', 'http://x/')).searchParams.getAll('u')];
    expect(addresses).toEqual([
      'http://umbrel.local:7792',
      'http://umbrel.tail1234.ts.net:7792',
      'https://tv.example.org',
    ]);
    expect(t.remote.view().domain).toEqual({ configured: true, url: 'https://tv.example.org' });
  });

  it('el permiso caducado del dueño no bloquea su IP: sigue viendo remote_forbidden, no remote_blocked', async () => {
    const t = await createEdgeTest();
    const { token, deviceId } = await t.pair();
    await t.allow(deviceId, '24h');
    t.core.clock.set(t.core.clock.now() + REMOTE_EXPIRES_IN_MS['24h']! + 1000);
    for (let index = 0; index < REMOTE_LIMITS.lockout.threshold * 3; index += 1) {
      expectError(await t.edge({ path: BOOT, token }), 403, 'remote_forbidden');
    }
    expect(t.remote.lockState(PUBLIC_IP)).toBeNull();
  });

  it('un aparato emparejado sin permiso no nota el bloqueo de su IP (le dice remote_forbidden)', async () => {
    const t = await createEdgeTest();
    const { token } = await t.pair();
    for (let index = 0; index < REMOTE_LIMITS.lockout.threshold; index += 1) {
      t.remote.recordFailure(PUBLIC_IP, PUBLIC_IP);
    }
    expect(t.remote.blockedForMs(PUBLIC_IP)).toBeGreaterThan(0);
    expectError(await t.edge({ path: BOOT, token }), 403, 'remote_forbidden');
  });
});
