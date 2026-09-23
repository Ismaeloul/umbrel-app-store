/* Integración (paso 1.3): el backend entero con createServices y el motor
   AceStream falso por HTTP. Flujos de reproducción de punta a punta, por la
   API de verdad (app.inject), con el hub SSE real escuchando:

   - abrir un canal → sesión única → latidos → soltar → stop (sin zombis);
   - dos visores del mismo canal: se comparte, pasa a HLS, stream.modeChanged;
   - canal distinto en otro dispositivo: traspaso con aviso y stop antes de abrir;
   - al apagar no queda nada: ni sesiones en el motor ni temporizadores.

   B-002, B-003, B-005, B-006, B-008, D5 (arquitectura §5.6, §6.3, §7.4). */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HeartbeatResponseSchema,
  SessionsFileSchema,
  StreamGrantSchema,
  TIMEOUTS,
  type StreamGrant,
} from '@ace/shared';
import { contentIdToInfohash, demoContentId } from '../fake-engine/catalog.js';
import { createHarness, WEB, type Harness } from './harness.js';

const X = demoContentId(1);
const Y = demoContentId(2);

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function harness(): Promise<Harness> {
  current = await createHarness();
  return current;
}

function streamUrl(hash: string, viewer: string, device: string): string {
  return `/api/v1/channels/${hash}/stream?client=web&viewer=${viewer}&device=${device}`;
}

async function open(
  h: Harness,
  hash: string,
  viewer: string,
  device: string,
): Promise<StreamGrant> {
  const res = await h.app.inject({
    method: 'GET',
    url: streamUrl(hash, viewer, device),
    headers: WEB,
  });
  expect(res.statusCode, res.body).toBe(200);
  return StreamGrantSchema.parse(res.json());
}

function beat(h: Harness, sid: string, viewer: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sid}/heartbeat`,
    headers: { ...WEB, 'content-type': 'application/json' },
    payload: { viewer, playing: true },
  });
}

function release(h: Harness, sid: string, viewer: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sid}/release`,
    /* Como sendBeacon: text/plain. */
    headers: { ...WEB, 'content-type': 'text/plain' },
    payload: JSON.stringify({ viewer, reason: 'user' }),
  });
}

function sessionsOnDisk(h: Harness): unknown[] {
  const text = readFileSync(h.core.config.paths.sessionsFile, 'utf8');
  return SessionsFileSchema.parse(JSON.parse(text)).sessions;
}

describe('integración · una reproducción de punta a punta (B-002, B-003, B-008)', () => {
  it('abrir → sesión única → latidos 2 min → soltar → stop, con el SSE y el disco al día', async () => {
    const h = await harness();
    const pc = h.sse({ deviceId: 'pc-salon' });

    const grant = await open(h, X, 'visor-pc-1', 'pc-salon');
    expect(grant).toMatchObject({ protocol: 'mpegts', remux: false, handoff: false });
    expect(grant.url).toMatch(new RegExp(`^/ace/r/${contentIdToInfohash(X)}/`));
    expect(h.fake.control.metrics()).toMatchObject({ sessionsOpened: 1, sessionsOpen: 1 });
    expect(sessionsOnDisk(h)).toHaveLength(1);

    /* Reengancharse (recargar la página): la misma sesión, sin otra meta. */
    const again = await open(h, X, 'visor-pc-1', 'pc-salon');
    expect(again.session.id).toBe(grant.session.id);
    expect(h.fake.control.metrics().sessionsOpened).toBe(1);

    /* Dos minutos con latido cada 15 s: sigue viva y el motor ve las estadísticas. */
    for (let index = 0; index < 8; index += 1) {
      await h.advance(TIMEOUTS.viewerHeartbeatMs);
      const res = await beat(h, grant.session.id, 'visor-pc-1');
      expect(res.statusCode).toBe(200);
      expect(HeartbeatResponseSchema.parse(res.json())).toMatchObject({
        url: grant.url,
        protocol: 'mpegts',
        viewers: 1,
      });
    }
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);
    expect(h.fake.control.metrics().requestsByRoute.stat).toBeGreaterThan(20);
    expect(h.services.engine.status().status).toBe('online');

    const released = await release(h, grant.session.id, 'visor-pc-1');
    expect([released.statusCode, released.json()]).toEqual([
      200,
      { released: true, sessionClosed: true },
    ]);
    await h.settle();
    const metrics = h.fake.control.metrics();
    expect(metrics).toMatchObject({ sessionsOpen: 0, sessionsExpired: 0, stopsUnknown: 0 });
    expect(metrics.stopsReceived).toBe(metrics.sessionsOpened);
    expect(h.playback.inspect()).toMatchObject({ sessions: [], viewers: [], ticking: false });
    await h.services.state.flush();
    expect(sessionsOnDisk(h)).toEqual([]);

    /* El SSE de la web recibe el ciclo entero, en orden. */
    const seen = pc.events().map((event) => event.event);
    expect(seen).toContain('stream.ready');
    expect(seen).toContain('playback.nowPlaying');
    expect(seen).toContain('state.changed');
    const states = pc
      .events()
      .filter((event) => event.event === 'state.changed')
      .map((event) => (event.data as { scopes: string[] }).scopes);
    expect(states.flat()).toContain('nowPlaying');
    /* La ruta antigua ve lo mismo: ya no hay nadie con el mando. */
    const legacy = await h.app.inject({ method: 'GET', url: '/api/playback', headers: WEB });
    expect(legacy.json().nowPlaying).toBeNull();
  });

  it('sin latido en 45 s el visor se da por ido: stop en el motor y 410 al volver', async () => {
    const h = await harness();
    const grant = await open(h, X, 'visor-pc-1', 'pc-salon');
    await h.advance(TIMEOUTS.viewerExpiryMs + 5000);
    expect(h.fake.control.metrics()).toMatchObject({ sessionsOpen: 0, stopsReceived: 1 });
    const late = await beat(h, grant.session.id, 'visor-pc-1');
    expect(late.statusCode).toBe(410);
    expect(late.json().error.code).toBe('session_expired');
  });
});

describe('integración · mismo canal en dos dispositivos: se comparte (D5)', () => {
  it('el segundo se une, la sesión pasa a HLS y el primero recibe stream.modeChanged', async () => {
    const h = await harness();
    const pc = h.sse({ deviceId: 'pc-salon' });
    const first = await open(h, X, 'visor-pc-1', 'pc-salon');
    const second = await open(h, X, 'visor-tv-1', 'tele-salon');
    await h.settle();

    expect(second.session.id).toBe(first.session.id);
    expect(second.protocol).toBe('hls');
    expect(second.handoff).toBe(false);
    expect(second.url).toMatch(new RegExp(`^/ace/m/${contentIdToInfohash(X)}/`));
    /* Una sola sesión en el motor: la progresiva se ha parado al pasar a HLS. */
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);

    const changed = h.bus.of('stream.modeChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      sessionId: first.session.id,
      from: 'mpegts',
      to: 'hls',
      url: second.url,
      reason: 'shared',
    });
    expect(changed[0]?.viewerIds).toContain('visor-pc-1');
    expect(pc.events().some((event) => event.event === 'stream.modeChanged')).toBe(true);

    /* El primero se entera también por el latido (por si perdió el SSE). */
    const res = await beat(h, first.session.id, 'visor-pc-1');
    expect(res.json()).toMatchObject({ url: second.url, protocol: 'hls', viewers: 2 });

    expect((await release(h, first.session.id, 'visor-pc-1')).json()).toEqual({
      released: true,
      sessionClosed: false,
    });
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);
    expect((await release(h, first.session.id, 'visor-tv-1')).json()).toEqual({
      released: true,
      sessionClosed: true,
    });
    await h.settle();
    const metrics = h.fake.control.metrics();
    expect(metrics).toMatchObject({ sessionsOpened: 2, sessionsOpen: 0, sessionsSuperseded: 1 });
    /* El stop "por si acaso" de la progresiva ya sustituida es el único que el motor no conoce. */
    expect(metrics.stopsUnknown).toBe(metrics.sessionsSuperseded);
  });
});

describe('integración · canal distinto en otro dispositivo: traspaso (B-005, B-006)', () => {
  it('el nuevo manda, el anterior recibe playback.handoff al momento y el motor nunca tiene dos', async () => {
    const h = await harness();
    const pc = h.sse({ deviceId: 'pc-salon' });
    const first = await open(h, X, 'visor-pc-1', 'pc-salon');
    const opened: number[] = [];
    const second = await open(h, Y, 'visor-tv-1', 'tele-salon');
    opened.push(h.fake.control.metrics().sessionsOpen);
    await h.settle();

    expect(second.handoff).toBe(true);
    expect(second.session.id).not.toBe(first.session.id);
    expect(opened).toEqual([1]);
    const metrics = h.fake.control.metrics();
    expect(metrics).toMatchObject({ sessionsOpened: 2, sessionsOpen: 1, sessionsStopped: 1 });
    expect(h.fake.control.activeSession(Y)).toBeDefined();
    expect(h.fake.control.activeSession(X)).toBeUndefined();

    const handoff = h.bus.of('playback.handoff');
    expect(handoff).toHaveLength(1);
    expect(handoff[0]?.viewerIds).toEqual(['visor-pc-1']);
    expect(pc.events().some((event) => event.event === 'playback.handoff')).toBe(true);

    /* El que perdió el canal: su sesión ya no existe. */
    expect((await beat(h, first.session.id, 'visor-pc-1')).statusCode).toBe(410);
    /* El mando antiguo (0.6.x) lo tiene el nuevo dispositivo. */
    const legacy = await h.app.inject({ method: 'GET', url: '/api/playback', headers: WEB });
    expect(legacy.json().nowPlaying).toMatchObject({ id: Y, dev: 'tele-salon' });
    await release(h, second.session.id, 'visor-tv-1');
  });
});

describe('integración · apagado limpio (arquitectura §5.16, T-111)', () => {
  it('con dos canales abiertos y un SSE: para las sesiones, cierra el SSE y no deja temporizadores', async () => {
    const h = await harness();
    const pc = h.sse({ deviceId: 'pc-salon' });
    await open(h, X, 'visor-pc-1', 'pc-salon');
    await h.advance(20_000);
    expect(h.fake.control.metrics().sessionsOpen).toBe(1);
    expect(h.hub.connections()).toBe(1);

    await h.close();
    expect(h.fake.control.metrics().sessionsOpen).toBe(0);
    expect(pc.writableEnded || pc.destroyed).toBe(true);
    expect(h.clock.pendingTimers()).toBe(0);
    expect(h.engineClock.pendingTimers()).toBe(0);
  });
});
