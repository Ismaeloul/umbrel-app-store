/* Integración de varios dispositivos a la vez (docs/multidispositivo.md
   §6.2): el backend entero (harness.ts) con el motor falso y el proveedor IPTV
   falso, por HTTP como la web. Dos visores de dos dispositivos:

   1. AceStream: X cambia de canal con `others=move&from`; Y recibe
      `playback.handoff` con `follow` y se une con `join=1`: una sola sesión.
   2. Lo mismo con la IPTV: la conexión con el proveedor nunca pasa de 1
      (muestreada cada 100 ms).
   3. Con `stop`: Y no vuelve y la sesión vieja se cierra.
   4. Carreras con la pila de verdad: zapping H1 → H2 → H3 «en los dos» con el
      `join` de Y a H2 retrasado → 410, H3 sigue, sin `iptv_busy` y con una
      conexión como mucho.
   5. Los dos cambiando a la vez: una sesión al final. */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ResolutionSchema, StreamGrantSchema, type StreamGrant } from '@ace/shared';
import { FakeClock } from '../../src/core/clock.js';
import { FakeFfmpeg, type FakeLauncher } from '../../src/modules/remux/test-support.js';
import type { ProcessLauncher } from '../../src/modules/remux/types.js';
import { loopbackHost } from '../fake-engine/test-utils.js';
import {
  FAKE_IPTV_PASSWORD,
  FAKE_IPTV_USER,
  createFakeIptv,
  demoMatchStart,
  type FakeIptv,
} from '../fake-iptv/provider.js';
import { FAKE_IPTV_HOST, fakeIptvResolver, fakeIptvTransport } from '../fake-iptv/net.js';
import { createHarness, until, WEB, type Harness } from './harness.js';

const SERVER = `http://${FAKE_IPTV_HOST}`;

function e2eId(n: number): string {
  return `e2e0${n.toString(16).padStart(36, '0')}`;
}

/** Dos dispositivos: el PC (X) y el iPhone (Y), cada uno con su visor web. */
const X = 'visor_x';
const Y = 'visor_y';
const PC = 'dev_pc';
const IPHONE = 'dev_iphone';

const ACE_1 = e2eId(41);
const ACE_2 = e2eId(42);
const ACE_3 = e2eId(43);
const CATALOG = [
  { id: ACE_1, title: 'Canal Lista E2E Uno', bitrateKbps: 2500, peers: 12 },
  { id: ACE_2, title: 'Canal Lista E2E Dos', bitrateKbps: 2500, peers: 12 },
  { id: ACE_3, title: 'Canal Lista E2E Tres', bitrateKbps: 2500, peers: 12 },
];

/** ffmpeg falso que lee su `-i` (el relé de la IPTV) y escribe segmentos al lanzarse. */
function readingLauncher(fallback: FakeLauncher): ProcessLauncher {
  return {
    spawn(args) {
      const proc = new FakeFfmpeg(args);
      fallback.spawned.push(proc);
      proc.writeSegments([1, 1, 1, 1]);
      if (args.includes('-protocol_whitelist')) {
        const req = http.get(proc.input, { agent: false }, (res) => {
          res.on('data', () => undefined);
          res.on('error', () => undefined);
        });
        req.on('error', () => undefined);
        const kill = proc.kill.bind(proc);
        proc.kill = () => {
          req.destroy();
          kill();
        };
      }
      return proc;
    },
  };
}

interface Rig {
  readonly h: Harness;
  readonly provider: FakeIptv;
}

let rig: Rig | null = null;
let sampler: ReturnType<typeof setInterval> | null = null;

afterEach(async () => {
  if (sampler) clearInterval(sampler);
  sampler = null;
  if (!rig) return;
  const current = rig;
  rig = null;
  await current.h.close();
  await current.provider.close();
});

async function setup(): Promise<Rig> {
  const clock = new FakeClock();
  const host = await loopbackHost();
  const provider = await createFakeIptv({
    host,
    publicHost: FAKE_IPTV_HOST,
    now: () => clock.now(),
    matchStart: demoMatchStart(clock.now()),
    retenerPlazaMs: 0,
  });
  const h = await createHarness({
    clock,
    catalog: CATALOG,
    net: {
      resolver: fakeIptvResolver(),
      transport: fakeIptvTransport({ host, port: provider.port }),
    },
    launcher: readingLauncher,
  });
  rig = { h, provider };
  return rig;
}

/** Máximo de conexiones simultáneas con el proveedor, muestreado cada 100 ms. */
function sampleConnections(provider: FakeIptv): () => number {
  let max = provider.conexiones();
  sampler = setInterval(() => {
    max = Math.max(max, provider.conexiones());
  }, 100);
  return () => Math.max(max, provider.conexiones());
}

async function saveXtream(r: Rig): Promise<void> {
  const res = await r.h.app.inject({
    method: 'PUT',
    url: '/api/v1/iptv',
    headers: WEB,
    payload: {
      kind: 'xtream',
      name: 'Casa',
      server: SERVER,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  await r.h.iptv.idle();
  await until('IPTV activa', () => r.h.iptv.active(), 10_000);
}

async function iptvIdFor(h: Harness, channel: string): Promise<string> {
  await h.services.football.schedule();
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/football/resolve?channel=${encodeURIComponent(channel)}&scope=channel&client=web_x`,
    headers: WEB,
  });
  const result = ResolutionSchema.parse(res.json());
  const candidate = result.candidates.find((item) => item.source === 'iptv');
  expect(candidate, JSON.stringify(result)).toBeDefined();
  return (candidate as { id: string }).id;
}

/** Pide un canal como la web del dispositivo `device` (visor `viewer`). */
async function request(
  h: Harness,
  id: string,
  viewer: string,
  device: string,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams({
    client: 'web',
    viewer,
    device,
    follows: '1',
    ...extra,
  });
  /* Mueve el reloj falso mientras espera: cerrar una IPTV espera a que el relé
     suelte la plaza y los reintentos de ocupado van a los 2, 4 y 8 s. */
  let done = false;
  const pending = h.app
    .inject({
      method: 'GET',
      url: `/api/v1/channels/${id}/stream?${params.toString()}`,
      headers: WEB,
    })
    .finally(() => {
      done = true;
    });
  for (let step = 0; step < 60 && !done; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!done) await h.clock.advanceAsync(500);
  }
  return pending;
}

async function open(
  h: Harness,
  id: string,
  viewer: string,
  device: string,
  extra: Record<string, string> = {},
): Promise<StreamGrant> {
  const res = await request(h, id, viewer, device, extra);
  expect(res.statusCode, res.body).toBe(200);
  return StreamGrantSchema.parse(res.json());
}

describe('varios dispositivos de punta a punta (docs/multidispositivo.md §6.2)', () => {
  it('1 · AceStream: «Cambiar en los dos» → Y sigue con join y queda una sola sesión', async () => {
    const r = await setup();
    const x = await open(r.h, ACE_1, X, PC);
    await open(r.h, ACE_1, Y, IPHONE);
    const moved = await open(r.h, ACE_2, X, PC, { others: 'move', from: x.session.id });
    const [event] = r.h.bus.of('playback.handoff');
    expect(event).toMatchObject({ viewerIds: [Y], follow: true, hash: ACE_2 });
    const followed = await open(r.h, ACE_2, Y, IPHONE, { join: '1' });
    expect(followed.session.id).toBe(moved.session.id);
    await r.h.settle();
    expect(r.h.playback.inspect().sessions).toHaveLength(1);
    expect(r.h.fake.control.metrics().sessionsOpen).toBe(1);
    expect([...(r.h.playback.inspect().sessions[0]?.viewers ?? [])].sort()).toEqual([X, Y]);
  });

  it('2 · IPTV: «Cambiar en los dos» con una sola conexión con el proveedor en todo momento', async () => {
    const r = await setup();
    await saveXtream(r);
    const antena3 = await iptvIdFor(r.h, 'Antena 3');
    const la1 = await iptvIdFor(r.h, 'La 1');
    const max = sampleConnections(r.provider);
    const x = await open(r.h, antena3, X, PC);
    await open(r.h, antena3, Y, IPHONE);
    expect(r.provider.conexiones()).toBeLessThanOrEqual(1);
    await open(r.h, la1, X, PC, { others: 'move', from: x.session.id });
    expect(r.h.bus.of('playback.handoff')).toMatchObject([{ viewerIds: [Y], follow: true }]);
    await open(r.h, la1, Y, IPHONE, { join: '1' });
    await r.h.settle();
    expect(r.h.playback.inspect().sessions).toHaveLength(1);
    expect(max()).toBeLessThanOrEqual(1);
  });

  it('3 · «Solo aquí» (stop): Y no vuelve y la sesión vieja se cierra', async () => {
    const r = await setup();
    const x = await open(r.h, ACE_1, X, PC);
    await open(r.h, ACE_1, Y, IPHONE);
    await open(r.h, ACE_2, X, PC, { others: 'stop', from: x.session.id });
    const [event] = r.h.bus.of('playback.handoff');
    expect(event).toMatchObject({ viewerIds: [Y], reason: 'other_channel' });
    expect(event).not.toHaveProperty('follow');
    await r.h.settle();
    const sessions = r.h.playback.inspect().sessions;
    expect(sessions.map((session) => session.hash)).toEqual([ACE_2]);
    expect(sessions[0]?.viewers).toEqual([X]);
  });

  it('4 · zapping H1 → H2 → H3 «en los dos» con el join de Y retrasado: 410, H3 sigue y una conexión como mucho', async () => {
    const r = await setup();
    await saveXtream(r);
    const [h1, h2, h3] = [
      await iptvIdFor(r.h, 'Antena 3'),
      await iptvIdFor(r.h, 'La 1'),
      await iptvIdFor(r.h, 'DAZN LaLiga'),
    ];
    const max = sampleConnections(r.provider);
    const x1 = await open(r.h, h1!, X, PC);
    await open(r.h, h1!, Y, IPHONE);
    const x2 = await open(r.h, h2!, X, PC, { others: 'move', from: x1.session.id });
    const x3 = await open(r.h, h3!, X, PC, { others: 'move', from: x2.session.id });
    const late = await request(r.h, h2!, Y, IPHONE, { join: '1' });
    expect(late.statusCode).toBe(410);
    expect(late.json().error.code).toBe('session_expired');
    await r.h.settle();
    const sessions = r.h.playback.inspect().sessions;
    expect(sessions.map((session) => session.id)).toEqual([x3.session.id]);
    /* Ningún traspaso para X y ningún iptv_busy. */
    expect(r.h.bus.of('playback.handoff').every((event) => !event.viewerIds.includes(X))).toBe(
      true,
    );
    expect(r.h.bus.of('stream.closed').some((event) => event.code === 'iptv_busy')).toBe(false);
    /* Y relee y sigue a H3. */
    const y3 = await open(r.h, h3!, Y, IPHONE, { join: '1' });
    expect(y3.session.id).toBe(x3.session.id);
    expect(max()).toBeLessThanOrEqual(1);
  });

  it('5 · los dos cambian a la vez (AceStream): una sola sesión al final', async () => {
    const r = await setup();
    const x = await open(r.h, ACE_1, X, PC);
    await open(r.h, ACE_1, Y, IPHONE);
    const results = await Promise.all([
      request(r.h, ACE_2, X, PC, { others: 'move', from: x.session.id }),
      request(r.h, ACE_3, Y, IPHONE, { others: 'move', from: x.session.id }),
    ]);
    expect(results.some((res) => res.statusCode === 200)).toBe(true);
    await r.h.settle();
    expect(r.h.playback.inspect().sessions).toHaveLength(1);
    expect(r.h.fake.control.metrics().sessionsOpen).toBe(1);
  });
});
