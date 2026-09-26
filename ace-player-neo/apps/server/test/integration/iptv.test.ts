/* Integración de la IPTV (docs/iptv.md §9.2): el backend entero (arnés de
   harness.ts) contra el proveedor IPTV falso (test/fake-iptv) con el filtro
   SSRF real (el host del proveedor resuelve a una IP pública y el transporte
   lo reenvía al servidor local) y un ffmpeg falso que LEE DE VERDAD su `-i`
   (el relé). Casos:

   1. Guardar Xtream → sincroniza → la resolución del partido de la demo trae
      primero «M+ LaLiga TV 2» (guía), luego «DAZN LaLiga» (un cartel, la FHD)
      y luego AceStream; ni Champions, ni Hypermotion, ni UK; ni una petición
      de stream al proveedor durante la resolución.
   2. `channelStream` web de la IPTV → `hls` en /api/v1/video sin token;
      dos visores → una sola conexión con el proveedor.
   3. Cambiar a AceStream → la conexión con el proveedor se suelta antes.
   4. Dos aperturas a la vez (IPTV y AceStream) → una sola sesión viva.
   5. Corte del proveedor → el relé reconecta sin cerrar ffmpeg; con otra base
      de PTS → reinicio del remux (`stream.reopened remux_restart`); caído →
      `stream.closed remux_failed` + `iptv_dropped`.
   8. Fugas: usuario y contraseña ausentes de respuestas, SSE, registros,
      diagnóstico, iptv.json y argumentos de ffmpeg.
   9. Motor caído → la IPTV se resuelve (canal suelto) y se reproduce.
   10. Eliminar → ids de antes con 410 `iptv_removed` sin tocar el motor. */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IptvViewSchema,
  ResolutionSchema,
  StreamGrantSchema,
  type Resolution,
  type StreamGrant,
} from '@ace/shared';
import { FakeClock } from '../../src/core/clock.js';
import { createLogger } from '../../src/core/logger.js';
import { FakeFfmpeg, type FakeLauncher } from '../../src/modules/remux/test-support.js';
import type { ProcessLauncher } from '../../src/modules/remux/types.js';
import type { FakeSink } from '../../src/modules/events/test-support.js';
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

/* Fuentes AceStream del partido «DAZN LaLiga» y un canal cualquiera. */
const ACE_LALIGA = e2eId(21);
const ACE_OTRO = e2eId(41);
const CATALOG = [
  { id: ACE_LALIGA, title: 'DAZN LaLiga --> ELCANO', bitrateKbps: 2500, peers: 12 },
  { id: e2eId(22), title: 'DAZN LaLiga --> NEW ERA', bitrateKbps: 2500, peers: 12 },
  { id: ACE_OTRO, title: 'Canal Lista E2E Uno', bitrateKbps: 2500, peers: 12 },
];

/** ffmpeg falso que lee su `-i` (el relé) y cuenta bytes; escribe segmentos al lanzarse. */
interface ReadingFfmpeg extends FakeFfmpeg {
  bytesRead: number;
  readError: string | null;
}

function readingLauncher(
  fallback: FakeLauncher,
): ProcessLauncher & { readonly all: ReadingFfmpeg[] } {
  const all: ReadingFfmpeg[] = [];
  return {
    all,
    spawn(args) {
      const proc = new FakeFfmpeg(args) as ReadingFfmpeg;
      fallback.spawned.push(proc);
      all.push(proc);
      proc.bytesRead = 0;
      proc.readError = null;
      proc.writeSegments([2, 2, 2]);
      if (args.includes('-protocol_whitelist')) {
        const input = proc.input;
        const readOnce = (url: string): http.ClientRequest => {
          const req = http.get(url, { agent: false }, (res) => {
            res.on('data', (chunk: Buffer) => {
              proc.bytesRead += chunk.length;
            });
            res.on('error', () => undefined);
          });
          req.on('error', (error) => {
            proc.readError = error.message;
          });
          return req;
        };
        const req = readOnce(input);
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
  readonly launcher: ReturnType<typeof readingLauncher>;
  readonly logs: string[];
  readonly sink: FakeSink;
}

let rig: Rig | null = null;

afterEach(async () => {
  if (!rig) return;
  const current = rig;
  rig = null;
  await current.h.close();
  await current.provider.close();
});

async function setup(options: { readonly retenerPlazaMs?: number } = {}): Promise<Rig> {
  const clock = new FakeClock();
  const host = await loopbackHost();
  const provider = await createFakeIptv({
    host,
    publicHost: FAKE_IPTV_HOST,
    now: () => clock.now(),
    matchStart: demoMatchStart(clock.now()),
    retenerPlazaMs: options.retenerPlazaMs ?? 0,
  });
  const logs: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    }),
  });
  let launcher: ReturnType<typeof readingLauncher> | null = null;
  const h = await createHarness({
    clock,
    logger,
    catalog: CATALOG,
    net: {
      resolver: fakeIptvResolver(),
      transport: fakeIptvTransport({ host, port: provider.port }),
    },
    launcher: (fallback) => {
      launcher = readingLauncher(fallback);
      return launcher;
    },
  });
  const sink = h.sse({ origin: 'web' });
  rig = {
    h,
    provider,
    launcher: launcher as unknown as ReturnType<typeof readingLauncher>,
    logs,
    sink,
  };
  return rig;
}

async function inject(
  h: Harness,
  method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return h.app.inject({
    method,
    url,
    headers: WEB,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function saveXtream(r: Rig): Promise<void> {
  const res = await inject(r.h, 'PUT', '/api/v1/iptv', {
    kind: 'xtream',
    name: 'Casa',
    server: SERVER,
    username: FAKE_IPTV_USER,
    password: FAKE_IPTV_PASSWORD,
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(IptvViewSchema.parse(res.json()).provider?.status).toBe('syncing');
  await r.h.iptv.idle();
  await until('IPTV activa', () => r.h.iptv.active(), 10_000);
}

async function withGuide(r: Rig): Promise<void> {
  /* La guía se pide 1 s después de sincronizar (reloj falso) y se descarga de verdad. */
  await r.h.advance(2_000);
  await until('guía cargada', () => (r.h.iptv.guideForTests()?.programmes ?? 0) > 0, 10_000);
  await r.h.iptv.idle();
}

async function resolve(h: Harness, query: string): Promise<Resolution> {
  await h.services.football.schedule();
  const res = await inject(h, 'GET', `/api/v1/football/resolve?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return ResolutionSchema.parse(res.json());
}

async function open(
  h: Harness,
  id: string,
  viewer: string,
  client: 'web' | 'ios' = 'web',
): Promise<StreamGrant> {
  const res = await inject(
    h,
    'GET',
    `/api/v1/channels/${id}/stream?client=${client}&viewer=${viewer}&device=dev_${viewer}`,
  );
  expect(res.statusCode, res.body).toBe(200);
  return StreamGrantSchema.parse(res.json());
}

/**
 * Abre moviendo el reloj falso mientras espera: si el panel aún cuenta la
 * conexión recién cerrada (plaza retenida), el relé reintenta a los 2, 4 y 8 s.
 */
async function openDriven(h: Harness, id: string, viewer: string): Promise<StreamGrant> {
  let done = false;
  const pending = open(h, id, viewer).finally(() => {
    done = true;
  });
  for (let step = 0; step < 30 && !done; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!done) await h.clock.advanceAsync(1_000);
  }
  return pending;
}

async function iptvIdFor(h: Harness, channel: string): Promise<string> {
  const result = await resolve(
    h,
    `channel=${encodeURIComponent(channel)}&scope=channel&client=web_x`,
  );
  const candidate = result.candidates.find((item) => item.source === 'iptv');
  expect(candidate, JSON.stringify(result)).toBeDefined();
  return (candidate as { id: string }).id;
}

describe('IPTV de punta a punta (docs/iptv.md §9.2)', () => {
  it('1 · guardar Xtream y resolver el partido: la guía primero, un cartel por canal, sin trampas ni sondas', async () => {
    const r = await setup();
    await saveXtream(r);
    await withGuide(r);
    r.provider.limpiarPeticiones();
    const result = await resolve(r.h, 'match=demo-4&client=web_1');
    expect(result.checked[0]).toBe('iptv');
    expect(result.status).toBe('found');
    const titles = result.candidates.map((c) => `${c.source}:${c.title}`);
    expect(titles.slice(0, 2)).toEqual([
      'iptv:M+ LaLiga TV 2 --> Casa',
      'iptv:DAZN LaLiga --> Casa',
    ]);
    expect(result.candidates[0]?.iptv?.guide).toBe(true);
    expect(result.candidates[1]?.iptv).toEqual({
      provider: 'Casa',
      quality: 'fhd',
      backup: false,
      guide: false,
    });
    expect(result.candidate?.source).toBe('iptv');
    expect(titles.filter((title) => title.startsWith('iptv:'))).toHaveLength(2);
    expect(titles.some((title) => title.startsWith('acestream:DAZN LaLiga'))).toBe(true);
    const text = JSON.stringify(result);
    for (const trap of ['Liga de Campeones', 'Hypermotion', 'UK', 'Previa', 'Resumen']) {
      expect(text).not.toContain(trap);
    }
    expect(r.provider.peticionesDeStream()).toEqual([]);
    expect(text).not.toContain(FAKE_IPTV_PASSWORD);
    /* bootstrap anuncia la IPTV. */
    const boot = await inject(r.h, 'GET', '/api/v1/bootstrap');
    expect(boot.json().features.iptv).toBe(true);
  });

  it('2 y 3 · web por hls.js en /api/v1/video sin token; dos visores, una conexión; cambiar a AceStream la suelta antes', async () => {
    const r = await setup();
    await saveXtream(r);
    const id = await iptvIdFor(r.h, 'Antena 3');
    const first = await open(r.h, id, 'visor_web_1');
    expect(first.protocol).toBe('hls');
    expect(first.source).toBe('iptv');
    expect(first.remux).toBe(true);
    expect(first.url).toBe(`/api/v1/video/${first.session.id}/index.m3u8`);
    const playlist = await inject(r.h, 'GET', first.url);
    expect(playlist.statusCode).toBe(200);
    expect(playlist.body).toContain('#EXTM3U');
    expect(playlist.body).not.toContain('?t=');
    const second = await open(r.h, id, 'visor_web_2');
    expect(second.session.id).toBe(first.session.id);
    await until('bytes por el relé', () => r.launcher.all.some((proc) => proc.bytesRead > 20_000));
    expect(r.provider.conexiones()).toBe(1);
    expect(r.h.iptv.connections()).toBe(1);
    const status = await inject(r.h, 'GET', '/api/v1/playback');
    expect(status.json().sessions[0].source).toBe('iptv');
    /* Otro canal (AceStream) en el mismo visor: se suelta la IPTV antes de abrir el motor. */
    const ace = await open(r.h, ACE_OTRO, 'visor_web_1');
    expect(ace.source).toBeUndefined();
    await until('plaza suelta', () => r.provider.conexiones() === 0);
    expect(r.h.iptv.connections()).toBe(0);
    expect(r.h.bus.of('playback.handoff').length).toBeGreaterThanOrEqual(1);
  });

  it('4 · dos aperturas a la vez (IPTV y AceStream en dos dispositivos): una sola sesión viva y como mucho una conexión', async () => {
    const r = await setup();
    await saveXtream(r);
    const id = await iptvIdFor(r.h, 'La 1');
    const results = await Promise.allSettled([
      open(r.h, id, 'visor_web_a'),
      open(r.h, ACE_OTRO, 'visor_web_b'),
    ]);
    /* Una gana; la otra, o recibe el traspaso, o se queda sin sesión si la sustituyen al abrir. */
    expect(results.filter((item) => item.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    await r.h.settle();
    expect(r.h.playback.inspect().sessions).toHaveLength(1);
    expect(r.provider.conexiones()).toBeLessThanOrEqual(1);
    expect(r.h.bus.of('playback.handoff').length).toBeLessThanOrEqual(1);
  });

  it('5 · corte del proveedor: el relé reconecta sin cerrar ffmpeg; con otra base de PTS reinicia el remux; caído del todo → iptv_dropped', async () => {
    const r = await setup();
    await saveXtream(r);
    const id = await iptvIdFor(r.h, 'La 1');
    r.provider.modo('*', 'corta-a-los:0.3');
    const grant = await open(r.h, id, 'visor_corte');
    await until(
      'primer corte',
      () => r.provider.peticionesDeStream().length >= 1 && r.provider.conexiones() === 0,
      5_000,
    );
    const spawnedBefore = r.launcher.all.length;
    /* Espera de 1 s (reloj falso) y reconexión desde la URL original. */
    await r.h.advance(1_500, 500);
    await until('reconectado', () => r.provider.conexiones() === 1, 5_000);
    expect(r.launcher.all.length).toBe(spawnedBefore);
    expect(r.h.bus.of('stream.closed')).toEqual([]);
    /* Otra base de tiempos tras reconectar → reinicio del remux en la misma sesión. */
    r.provider.modo('*', 'corta-a-los:0.3:pts');
    await until('corte pts', () => r.provider.conexiones() === 0, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    /* Segundo intento en la ventana de 60 s: espera de 2 s. */
    await r.h.advance(3_000, 500);
    await until(
      'remux reiniciado',
      () => r.h.bus.of('stream.reopened').some((event) => event.reason === 'remux_restart'),
      5_000,
    );
    expect(r.h.bus.of('stream.reopened').at(-1)?.sessionId).toBe(grant.session.id);
    /* Caído del todo (todas las variantes) → cierre con iptv_dropped, nunca remux_died. */
    r.provider.modo('*', 'down');
    await until('upstream suelto', () => r.provider.conexiones() === 0, 5_000);
    for (let step = 0; step < 20 && !r.h.bus.of('stream.closed').length; step += 1) {
      await r.h.advance(5_000, 1_000);
    }
    const closed = r.h.bus.of('stream.closed');
    expect(closed.at(-1)?.reason).toBe('remux_failed');
    expect(closed.at(-1)?.code).toBe('iptv_dropped');
    expect(closed.some((event) => event.code === 'remux_died')).toBe(false);
  });

  it('8 y 10 · fugas (Xtream y get.php) y eliminar: nada secreto sale; los ids de antes dan 410 sin tocar el motor', async () => {
    const r = await setup();
    await saveXtream(r);
    const id = await iptvIdFor(r.h, 'Antena 3');
    const grant = await open(r.h, id, 'visor_fuga');
    await until('bytes', () => r.launcher.all.some((proc) => proc.bytesRead > 10_000));
    /* Errores provocados: bad_url, 404 de stream. */
    await inject(r.h, 'PUT', '/api/v1/iptv', { kind: 'm3u', url: 'ftp://x' });
    r.provider.modo('*', '404');
    await inject(
      r.h,
      'GET',
      `/api/v1/channels/${id}/stream?client=web&viewer=visor_otro&device=dev_otro`,
    );
    r.provider.modo('*', 'ok');
    /* M3U get.php con URLs cortas. */
    const m3u = await inject(r.h, 'PUT', '/api/v1/iptv', {
      kind: 'm3u',
      url: `${SERVER}/get.php?username=${FAKE_IPTV_USER}&password=${FAKE_IPTV_PASSWORD}&type=m3u_plus`,
    });
    expect(m3u.statusCode, m3u.body).toBe(200);
    await r.h.iptv.idle();
    await until('m3u activa', () => r.h.iptv.active());
    const shortId = await iptvIdFor(r.h, 'La 1');
    await openDriven(r.h, shortId, 'visor_corto');
    await r.h.settle();
    const view = await inject(r.h, 'GET', '/api/v1/iptv');
    const everything = [
      JSON.stringify(grant),
      m3u.body,
      view.body,
      r.sink.text(),
      r.logs.join(''),
      readFileSync(r.h.core.config.paths.iptvFile, 'utf8'),
      r.launcher.all.map((proc) => proc.args.join(' ')).join('\n'),
    ];
    let diagnostics = '';
    try {
      diagnostics = readFileSync(r.h.core.config.paths.diagnosticsFile, 'utf8');
    } catch {}
    everything.push(diagnostics);
    for (const text of everything) {
      expect(text).not.toContain(FAKE_IPTV_PASSWORD);
      expect(text).not.toContain(FAKE_IPTV_USER);
    }
    /* Eliminar: 410 iptv_removed sin tocar el motor. */
    const del = await inject(r.h, 'DELETE', '/api/v1/iptv');
    expect(del.json()).toEqual({ provider: null, refreshHours: 6 });
    const engineRequests = (): number =>
      Object.values(r.h.fake.control.metrics().requestsByRoute).reduce((sum, n) => sum + n, 0);
    const before = engineRequests();
    const gone = await inject(
      r.h,
      'GET',
      `/api/v1/channels/${shortId}/stream?client=web&viewer=visor_x&device=dev_x`,
    );
    expect(gone.statusCode).toBe(410);
    expect(gone.json().error.code).toBe('iptv_removed');
    expect(engineRequests()).toBe(before);
    expect(r.h.bus.of('iptv.status').at(-1)?.status).toBe('disabled');
  });

  it('9 · con el motor caído, el canal suelto se resuelve por la IPTV y se reproduce', async () => {
    const r = await setup();
    await saveXtream(r);
    await r.h.fake.close();
    const result = await resolve(r.h, 'channel=Antena%203&scope=channel&client=web_m');
    expect(result.status).toBe('found');
    expect(result.candidate?.source).toBe('iptv');
    const grant = await open(r.h, result.candidate?.id as string, 'visor_motor');
    expect(grant.source).toBe('iptv');
    /* Canal suelto sin IPTV: not_found sin trabajo del comprobador. */
    const none = await resolve(r.h, 'channel=Canal%20Inexistente&scope=channel&client=web_m');
    expect(none.status).toBe('not_found');
    expect(none.candidates).toEqual([]);
    expect(none.scan).toBe(null);
  });
});
