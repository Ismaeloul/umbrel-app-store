/* Rutas del motor por HTTP (app.inject): la forma exacta de la 0.6.59
   (api.md §4.18-4.19) y sus gemelas v1. */

import { describe, expect, it } from 'vitest';
import { EngineStatusSchema } from '@ace/shared';
import { createTestApp, createTestCore, FakeClock, web } from '../../../test/helpers/index.js';
import { createEngineRuntime } from './service.js';
import { engineConfig, sendJson, startFakeEngine, startHttpServer } from './test-support.js';

async function appWithEngine(options: { controlStatus?: number; versionBody?: string } = {}) {
  const clock = new FakeClock();
  const core = createTestCore({ clock });
  const engine = options.versionBody
    ? await startHttpServer((_req, res) => res.end(options.versionBody))
    : await startFakeEngine(clock);
  const control = await startHttpServer((req, res) => {
    req.resume();
    sendJson(res, options.controlStatus ?? 200, { restarted: true });
  });
  const runtime = createEngineRuntime({
    ...core,
    config: engineConfig(core.config, {
      engine: { host: engine.host, port: engine.port },
      control: { host: control.host, port: control.port },
      token: 'secreto',
    }),
  });
  const { app } = await createTestApp({ services: { engine: runtime.service } });
  return { app, runtime, control, clock };
}

describe('GET /api/engine/status (api.md §4.18, B-011)', () => {
  it('antes de la primera pregunta: { online: false, raw: "" } (y no 500)', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/engine/status', headers: web() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ online: false, raw: '' });
  });

  it('con el motor en marcha: online y los 300 primeros caracteres de get_version', async () => {
    const { app, runtime } = await appWithEngine();
    await runtime.service.start();
    await runtime.watchdog.idle();
    const res = await app.inject({ method: 'GET', url: '/api/engine/status', headers: web() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { online: boolean; raw: string };
    expect(body.online).toBe(true);
    expect(JSON.parse(body.raw)).toMatchObject({ result: { version: '3.2.3' } });
    await runtime.service.stop();
  });

  it('raw se corta a 300 caracteres', async () => {
    const long = JSON.stringify({ result: { version: '3.2.3', relleno: 'x'.repeat(500) } });
    const { app, runtime } = await appWithEngine({ versionBody: long });
    await runtime.service.start();
    await runtime.watchdog.idle();
    const res = await app.inject({ method: 'GET', url: '/api/engine/status', headers: web() });
    expect(res.json()).toEqual({ online: true, raw: long.slice(0, 300) });
    await runtime.service.stop();
  });

  it('v1: el estado con histéresis y el cupo de reinicios', async () => {
    const { app, runtime } = await appWithEngine();
    await runtime.service.start();
    await runtime.watchdog.idle();
    const res = await app.inject({ method: 'GET', url: '/api/v1/engine/status', headers: web() });
    expect(res.statusCode).toBe(200);
    const status = EngineStatusSchema.parse(res.json());
    expect(status).toMatchObject({
      status: 'online',
      online: true,
      engineVersion: '3.2.3',
      autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
    });
    await runtime.service.stop();
  });
});

describe('POST /api/restart-engine (api.md §4.19, B-012)', () => {
  it('200 { restarted: true } y 429 restart_cooldown durante 15 s', async () => {
    const { app, control, clock } = await appWithEngine();
    const first = await app.inject({ method: 'POST', url: '/api/restart-engine', headers: web() });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ restarted: true });
    expect(control.requests[0]?.headers['x-engine-token']).toBe('secreto');
    const again = await app.inject({ method: 'POST', url: '/api/restart-engine', headers: web() });
    expect(again.statusCode).toBe(429);
    expect(again.json()).toEqual({ error: 'restart_cooldown' });
    clock.advance(15_000);
    const v1 = await app.inject({ method: 'POST', url: '/api/v1/engine/restart', headers: web() });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toEqual({ restarted: true });
    const v1Again = await app.inject({
      method: 'POST',
      url: '/api/v1/engine/restart',
      headers: web({ 'x-request-id': 'req-1' }),
    });
    expect(v1Again.statusCode).toBe(429);
    expect(v1Again.json()).toEqual({
      error: {
        code: 'restart_cooldown',
        message: expect.stringContaining('reiniciar') as unknown as string,
        requestId: 'req-1',
      },
    });
  });

  it('engine_control que falla → 502 restart_failed (antigua y v1)', async () => {
    const { app, clock } = await appWithEngine({ controlStatus: 500 });
    const legacy = await app.inject({ method: 'POST', url: '/api/restart-engine', headers: web() });
    expect(legacy.statusCode).toBe(502);
    expect(legacy.json()).toEqual({ error: 'restart_failed' });
    clock.advance(15_000);
    const v1 = await app.inject({ method: 'POST', url: '/api/v1/engine/restart', headers: web() });
    expect(v1.statusCode).toBe(502);
    expect(v1.json().error.code).toBe('restart_failed');
  });
});
