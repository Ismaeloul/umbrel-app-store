/* Integración (paso 1.3): motor caído con alguien viendo. El vigilante real
   (get_version cada 10 s por HTTP) pone el motor offline con histéresis, pide
   el reinicio a engine_control (falso, por HTTP) pasados 60 s con el visor
   esperando, espera a que vuelva (2 respuestas buenas cada 2 s) y playback
   reabre el canal en el motor que ha vuelto sin sesiones. El cliente se
   entera por SSE (stream.reopened) y por el latido. Arquitectura §5.5 y
   §5.6; B-001, B-009, B-011, B-012, B-013. */

import { afterEach, describe, expect, it } from 'vitest';
import { ENGINE_WATCHDOG, TIMEOUTS, type StreamGrant } from '@ace/shared';
import { demoContentId } from '../fake-engine/catalog.js';
import { createHarness, WEB, type Harness } from './harness.js';

const X = demoContentId(1);
const TICK = ENGINE_WATCHDOG.intervalMs;

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function watchX(h: Harness): Promise<StreamGrant> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/channels/${X}/stream?client=web&viewer=visor-pc-1&device=pc-salon`,
    headers: WEB,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as StreamGrant;
}

/** El cliente sigue latiendo mientras espera (es lo que hace el reproductor). */
async function waitWithHeartbeats(h: Harness, sid: string, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(TICK, left);
    await h.advance(step);
    left -= step;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sid}/heartbeat`,
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { viewer: 'visor-pc-1', playing: false },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
}

const states = (h: Harness): string[] => h.bus.of('engine.status').map((status) => status.status);

describe('integración · motor caído → offline con histéresis → reinicio → reabre el canal', () => {
  it('el ciclo entero, sin que el cliente haga nada más que latir', async () => {
    const h = (current = await createHarness());
    const pc = h.sse({ deviceId: 'pc-salon' });
    expect(h.services.engine.status().status).toBe('online');
    const grant = await watchX(h);
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);

    /* El contenedor del motor se cae (deja de escuchar). */
    await h.fake.control.setMode('*', 'down');

    /* Un solo silencio no basta, ni con alguien viendo. */
    await waitWithHeartbeats(h, grant.session.id, TICK);
    expect(h.services.engine.status().status).toBe('online');
    /* El segundo seguido, sí (con alguien viendo: 2; sin nadie: 3). */
    await waitWithHeartbeats(h, grant.session.id, TICK);
    expect(h.services.engine.status().status).toBe('offline');
    expect(states(h)).toEqual(['online', 'offline']);
    expect(pc.events().some((event) => event.event === 'engine.status')).toBe(true);
    expect(h.control.restarts()).toBe(0);

    /* 60 s offline con el visor esperando: reinicio automático vía engine_control. */
    await waitWithHeartbeats(h, grant.session.id, ENGINE_WATCHDOG.autoRestartAfterOfflineMs + TICK);
    expect(h.control.restarts()).toBe(1);
    await h.advance(5 * ENGINE_WATCHDOG.readyPollMs, ENGINE_WATCHDOG.readyPollMs);
    expect(h.services.engine.status()).toMatchObject({
      status: 'online',
      autoRestarts: { lastHour: 1, exhausted: false },
    });
    expect(states(h)).toEqual(['online', 'offline', 'restarting', 'online']);

    /* playback reabre en el motor nuevo y se lo dice al visor. */
    const reopened = h.bus.of('stream.reopened');
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ sessionId: grant.session.id, viewerIds: ['visor-pc-1'] });
    /* La reabre quien primero ve que el motor ha vuelto sin ella: el vigilante
       (engine_restart) o la estadística del motor ya en línea (engine_recovered). */
    expect(['engine_restart', 'engine_recovered']).toContain(reopened[0]?.reason);
    expect(reopened[0]?.url).not.toBe(grant.url);
    expect(pc.events().some((event) => event.event === 'stream.reopened')).toBe(true);
    expect(h.fake.control.metrics()).toMatchObject({ sessionsOpen: 1, sessionsLostInRestart: 1 });
    const beat = await h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${grant.session.id}/heartbeat`,
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { viewer: 'visor-pc-1' },
    });
    expect(beat.json()).toMatchObject({ url: reopened[0]?.url });

    /* Queda anotado en el registro de fallos y en la salud. */
    const codes = h.bus.of('diagnostics.new').map((entry) => entry.code);
    expect(codes).toContain('engine_auto_restart');
    const health = await h.app.inject({ method: 'GET', url: '/api/v1/health', headers: WEB });
    expect(health.statusCode).toBe(200);
    expect(health.json().components.engine).toMatchObject({ status: 'online' });
    expect(health.json().diagnostics.counts24h.engine).toBeGreaterThanOrEqual(1);

    /* Y al soltar no queda nada en el motor. */
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${grant.session.id}/release`,
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { viewer: 'visor-pc-1' },
    });
    await h.settle();
    expect(h.fake.control.metrics().sessionsOpen).toBe(0);
  });

  it('un bache corto (un solo get_version perdido) no reinicia nada ni toca la sesión', async () => {
    const h = (current = await createHarness());
    const grant = await watchX(h);
    await h.fake.control.setMode('*', 'down');
    await waitWithHeartbeats(h, grant.session.id, TICK);
    await h.fake.control.clearMode('*');
    await waitWithHeartbeats(h, grant.session.id, 3 * TICK);
    expect(states(h)).toEqual(['online']);
    expect(h.control.restarts()).toBe(0);
    expect(h.bus.of('stream.reopened')).toEqual([]);
    expect(h.fake.control.metrics()).toMatchObject({ sessionsOpened: 1, sessionsOpen: 1 });
  });

  it('el motor se reinicia solo (sin engine_control) y vuelve sin sesiones: se reabre igual', async () => {
    const h = (current = await createHarness());
    const grant = await watchX(h);
    /* Un reinicio de 30 s del contenedor, fuera del backend. */
    const restarted = h.fake.control.restart({ downMs: 30_000 });
    await waitWithHeartbeats(h, grant.session.id, 3 * TICK);
    expect(h.services.engine.status().status).toBe('offline');
    h.engineClock.advance(30_000);
    await restarted;
    await waitWithHeartbeats(h, grant.session.id, 3 * TICK);
    expect(h.services.engine.status().status).toBe('online');
    expect(h.control.restarts()).toBe(0);
    const reopened = h.bus.of('stream.reopened');
    expect(reopened).toHaveLength(1);
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);
    expect(h.fake.control.activeSession(X)).toBeDefined();
    /* Nadie ha tenido que volver a pedir el canal. */
    expect(h.bus.of('stream.closed')).toEqual([]);
  });
  it('el motor contesta pero no abre: 3 aperturas fallidas con alguien esperando → reinicio y el canal abre', async () => {
    const h = (current = await createHarness());
    /* Colgado: get_version contesta, pero la meta de sesión no (se corta a los 12 s). */
    await h.fake.control.setMode('*', 'stall');
    /* Con el motor colgado hay peticiones que solo acaban al avanzar el reloj: espera real corta. */
    const QUICK = { maxRealMs: 25 };
    const url = `/api/v1/channels/${X}/stream?client=web&viewer=visor-pc-1&device=pc-salon`;
    for (let attempt = 1; attempt <= ENGINE_WATCHDOG.autoRestartAfterOpenFailures; attempt += 1) {
      const pending = h.app.inject({ method: 'GET', url, headers: WEB });
      /* Mientras espera a que abra, cuenta como alguien viendo. */
      await h.advance(1000, 1000, QUICK);
      expect(h.bus.of('playback.activity').at(-1)).toMatchObject({ watching: true, hashes: [X] });
      await h.advance(TIMEOUTS.engineSessionMetaMs, 1000, QUICK);
      const res = await pending;
      expect(res.statusCode, res.body).toBe(504);
      expect(res.json().error.code).toBe('engine_timeout');
    }
    await h.settle(QUICK);
    expect(h.control.restarts()).toBe(1);
    expect(h.services.engine.status().status).not.toBe('offline');
    await h.advance(5 * ENGINE_WATCHDOG.readyPollMs, ENGINE_WATCHDOG.readyPollMs);
    expect(h.services.engine.status()).toMatchObject({
      status: 'online',
      autoRestarts: { lastHour: 1 },
    });
    expect(h.bus.of('diagnostics.new').map((entry) => entry.code)).toContain('engine_auto_restart');
    /* Tras el reinicio el canal abre a la primera. */
    const ok = await h.app.inject({ method: 'GET', url, headers: WEB });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);
  });
});
