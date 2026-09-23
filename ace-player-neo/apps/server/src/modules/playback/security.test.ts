/* Revisión de seguridad (docs/seguridad.md, S-02): un dispositivo emparejado
   no puede tocar el visor de OTRO.

   Los ids de visor los elige el cliente y viajan en claro en los eventos SSE
   `stream.*`, que van a todas las conexiones (decisiones D13). Latido y
   soltar ya comprobaban el dispositivo, pero solo si el visor tenía uno:
   un visor web sin `device` o uno de un iPhone 0.6.x sin `dev` quedaba a
   merced de cualquier iPhone emparejado. Y el canje del canal no comprobaba
   nada: pedir otro canal con el id de visor ajeno soltaba al dueño.

   Regla (solo para el origen native; la web es la administradora y puede con
   todo, como en la 0.6.59): un iPhone solo actúa sobre visores de SU
   dispositivo. */

import { describe, expect, it } from 'vitest';
import { PlaybackStatusSchema, StreamGrantSchema } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { createTestApp, createTestCore, native, web } from '../../../test/helpers/index.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { AppError } from '../../core/errors.js';
import type { AuthService } from '../auth/types.js';
import { createStateService } from '../state/index.js';
import { setupPlayback } from './test-support.js';

const X = demoContentId(1);
const Y = demoContentId(2);
const TOKENS: Record<string, string> = {
  'token-iphone-1': 'iphone-1',
  'token-iphone-2': 'iphone-2',
};

/* Dos dispositivos emparejados: cada token es el suyo. */
function fakeAuth(): AuthService {
  return {
    authenticateBearer: async (token: string) => {
      const deviceId = TOKENS[token];
      if (!deviceId) throw new AppError('unauthorized');
      return {
        deviceId,
        device: { id: deviceId },
        via: 'bearer',
      } as unknown as AuthenticatedDevice;
    },
    signVideoToken: ({ sessionId, deviceId }: { sessionId: string; deviceId: string }) =>
      `firma.${sessionId}.${deviceId}`,
  } as unknown as AuthService;
}

async function appWith() {
  const core = createTestCore();
  const state = createStateService(core);
  await state.load();
  const setup = await setupPlayback({ state });
  const { app } = await createTestApp({
    services: {
      state: setup.state,
      engine: setup.engine,
      remux: setup.remux.service,
      playback: setup.runtime.service,
      scanner: setup.scanner,
      auth: fakeAuth(),
    },
  });
  return { ...setup, app };
}

type App = Awaited<ReturnType<typeof appWith>>['app'];

async function viewersOf(app: App) {
  const status = PlaybackStatusSchema.parse(
    (await app.inject({ method: 'GET', url: '/api/v1/playback', headers: web() })).json(),
  );
  return status.sessions.flatMap((session) => session.viewers);
}

/* Un visor web SIN `device` (la query lo permite): su deviceId es null. */
async function webViewerWithoutDevice(app: App) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/channels/${X}/stream?client=web&viewer=visor-web-1`,
    headers: web(),
  });
  expect(res.statusCode).toBe(200);
  return StreamGrantSchema.parse(res.json()).session.id;
}

describe('S-02 · un iPhone no toca el visor de otro dispositivo', () => {
  it('pedir otro canal con el id de visor de la web: 409 handoff_denied y la web sigue', async () => {
    const { app } = await appWith();
    await webViewerWithoutDevice(app);
    const res = await app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${Y}/stream?client=ios&viewer=visor-web-1`,
      headers: native('token-iphone-2'),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('handoff_denied');
    expect(await viewersOf(app)).toEqual([expect.objectContaining({ client: 'web' })]);
  });

  it('pedir un canal con el id de visor de OTRO iPhone: 409 y el otro sigue', async () => {
    const { app } = await appWith();
    const first = await app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${X}/stream?client=ios&viewer=visor-ios-1`,
      headers: native('token-iphone-1'),
    });
    expect(first.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${Y}/stream?client=ios&viewer=visor-ios-1`,
      headers: native('token-iphone-2'),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('handoff_denied');
    expect(await viewersOf(app)).toEqual([expect.objectContaining({ deviceId: 'iphone-1' })]);
  });

  it('el mismo iPhone sí cambia de canal con su propio visor', async () => {
    const { app } = await appWith();
    for (const id of [X, Y]) {
      const res = await app.inject({
        method: 'GET',
        url: `/native/api/v1/channels/${id}/stream?client=ios&viewer=visor-ios-1`,
        headers: native('token-iphone-1'),
      });
      expect(res.statusCode).toBe(200);
    }
    const viewers = await viewersOf(app);
    expect(viewers).toEqual([expect.objectContaining({ deviceId: 'iphone-1' })]);
  });

  it('soltar o latir el visor web sin device desde un iPhone: no se suelta y 404', async () => {
    const { app } = await appWith();
    const sid = await webViewerWithoutDevice(app);
    const release = await app.inject({
      method: 'POST',
      url: `/native/api/v1/sessions/${sid}/release`,
      headers: native('token-iphone-2'),
      payload: { viewer: 'visor-web-1' },
    });
    expect(release.json()).toEqual({ released: false, sessionClosed: false });
    const beat = await app.inject({
      method: 'POST',
      url: `/native/api/v1/sessions/${sid}/heartbeat`,
      headers: native('token-iphone-2'),
      payload: { viewer: 'visor-web-1' },
    });
    expect(beat.statusCode).toBe(404);
    expect(beat.json().error.code).toBe('session_not_found');
    expect(await viewersOf(app)).toEqual([expect.objectContaining({ client: 'web' })]);
  });

  it('la web (administradora) sí puede soltar el visor de un iPhone, como en la 0.6.59', async () => {
    const { app } = await appWith();
    const res = await app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${X}/stream?client=ios&viewer=visor-ios-1`,
      headers: native('token-iphone-1'),
    });
    const sid = StreamGrantSchema.parse(res.json()).session.id;
    const release = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sid}/release`,
      headers: web(),
      payload: { viewer: 'visor-ios-1' },
    });
    expect(release.json()).toMatchObject({ released: true });
  });
});
