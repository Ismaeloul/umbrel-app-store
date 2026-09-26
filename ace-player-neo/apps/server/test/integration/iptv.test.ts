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
   10. Eliminar → ids de antes con 410 `iptv_removed` sin tocar el motor.

   Buscador (docs/iptv.md §14.9):
   11. `iptvChannels`: «tele» → Telecinco sin biblioteca; «antena» → Antena 3
       con el favorito de AceStream en `library`; desde /native, 403; sin
       IPTV, 200 vacío; ninguna petición al proveedor.
   12. `search?q=la 1` con IPTV → los «La 1 HD --> …» del motor llevan el id
       IPTV de «La 1».
   13. `footballResolve` con `scope=channel&iptv=<id>` → la IPTV sola; con
       `engine=1` y el motor sin Telecinco, la IPTV sola sin error; «La 1»
       con `engine=1`, la IPTV y las dos AceStream.
   14. De Xtream a la M3U del mismo proveedor falso → el favorito y el
       reciente de Telecinco tienen el id nuevo y se reproducen (el 24 h de
       un favorito que se va lo cubre iptv/service.test.ts con reloj falso).
   15. Fugas: `iptvChannels` y `search` con `iptv` no llevan nada del
       proveedor. */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IptvChannelsResponseSchema,
  IptvViewSchema,
  LibraryViewSchema,
  ResolutionSchema,
  SearchResponseSchema,
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
const ACE_ANTENA = e2eId(51);
const CATALOG = [
  { id: ACE_LALIGA, title: 'DAZN LaLiga --> ELCANO', bitrateKbps: 2500, peers: 12 },
  { id: e2eId(22), title: 'DAZN LaLiga --> NEW ERA', bitrateKbps: 2500, peers: 12 },
  { id: ACE_OTRO, title: 'Canal Lista E2E Uno', bitrateKbps: 2500, peers: 12 },
];
/* Las del buscador (§14.9): solo en los casos que las piden, para no cambiar
   las fuentes del partido de «La 1» del caso §7.7. */
const SEARCH_CATALOG = [
  { id: e2eId(31), title: 'La 1 HD --> ELCANO', bitrateKbps: 2500, peers: 12 },
  { id: e2eId(32), title: 'La 1 HD --> NEW ERA', bitrateKbps: 2500, peers: 12 },
  { id: e2eId(33), title: 'LaLiga TV Hypermotion --> ELCANO', bitrateKbps: 2500, peers: 12 },
  { id: ACE_ANTENA, title: 'Antena 3 HD', bitrateKbps: 2500, peers: 12 },
];

/** ffmpeg falso que lee su `-i` (el relé) y cuenta bytes; escribe segmentos al lanzarse. */
interface ReadingFfmpeg extends FakeFfmpeg {
  bytesRead: number;
  readError: string | null;
}

/**
 * El próximo ffmpeg IPTV con el análisis corto (2 MB / 2 s) no encuentra los
 * parámetros: no escribe segmentos y se queja por stderr, como el de verdad
 * (docs/multidispositivo.md §4.5).
 */
let probeFailNext = false;

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
      const shortProbe = args[args.indexOf('-probesize') + 1] === '2000000';
      if (probeFailNext && shortProbe) {
        probeFailNext = false;
        setTimeout(
          () => proc.stderr('[mpegts] Could not find codec parameters for stream 1 (Audio: ac3)'),
          150,
        );
      } else proc.writeSegments([1, 1, 1, 1]);
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

async function setup(
  options: { readonly retenerPlazaMs?: number; readonly search?: boolean } = {},
): Promise<Rig> {
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
    catalog: options.search ? [...CATALOG, ...SEARCH_CATALOG] : CATALOG,
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

async function channels(
  h: Harness,
  q: string,
): Promise<ReturnType<typeof IptvChannelsResponseSchema.parse>> {
  const res = await inject(h, 'GET', `/api/v1/iptv/channels?q=${encodeURIComponent(q)}`);
  expect(res.statusCode, res.body).toBe(200);
  return IptvChannelsResponseSchema.parse(res.json());
}

async function libraryMutate(h: Harness, body: unknown) {
  const res = await inject(h, 'POST', '/api/v1/library', body);
  expect(res.statusCode, res.body).toBe(200);
  return LibraryViewSchema.parse(res.json());
}

describe('buscador: IPTV y AceStream juntos (docs/iptv.md §14.9)', () => {
  it('11 · iptvChannels: Telecinco solo en la IPTV, Antena 3 con tu favorito, 403 desde /native, vacío sin IPTV y sin tocar al proveedor', async () => {
    const r = await setup({ search: true });
    const none = await channels(r.h, 'tele');
    expect(none).toEqual({ query: 'tele', total: 0, capped: false, channels: [] });
    await saveXtream(r);
    await libraryMutate(r.h, {
      action: 'favorite-upsert',
      item: { id: ACE_ANTENA, title: 'Antena 3 HD', ih: false },
    });
    r.provider.limpiarPeticiones();
    const tele = await channels(r.h, 'tele');
    expect(tele.channels.map((channel) => channel.title)).toEqual(['Telecinco']);
    expect(tele.channels[0]?.library).toEqual([]);
    const antena = await channels(r.h, 'antena');
    expect(antena.channels[0]).toMatchObject({ title: 'Antena 3', library: [ACE_ANTENA] });
    expect(r.provider.peticiones()).toEqual([]);
    const native = await r.h.app.inject({
      method: 'GET',
      url: '/native/api/v1/iptv/channels?q=tele',
      headers: { 'x-ace-origin': 'native' },
    });
    /* Sin token, 401; con token, 403 origin_forbidden (lo mira test/security.test.ts en todas las rutas web). */
    expect([401, 403]).toContain(native.statusCode);
    expect(native.body).not.toContain('Telecinco');
    const short = await inject(r.h, 'GET', '/api/v1/iptv/channels?q=t');
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('empty_query');
    /* 15 · fugas: nada del proveedor en la respuesta. */
    for (const text of [JSON.stringify(tele), JSON.stringify(antena)]) {
      for (const secret of [FAKE_IPTV_PASSWORD, FAKE_IPTV_USER, 'ES |', 'XXX', '.es', 'http']) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it('12 · search con IPTV activa: los «La 1 HD --> …» del motor llevan el id IPTV de «La 1»; Hypermotion no', async () => {
    const r = await setup({ search: true });
    await saveXtream(r);
    const la1 = (await channels(r.h, 'la 1')).channels[0];
    expect(la1?.title).toBe('La 1');
    const res = await inject(r.h, 'GET', '/api/v1/search?q=la%201');
    expect(res.statusCode, res.body).toBe(200);
    /* El motor falso da un infohash por fuente y el nombre sin proveedor («La 1 HD»). */
    const results = SearchResponseSchema.parse(res.json()).results;
    const la1Results = results.filter((result) => result.title.startsWith('La 1'));
    expect(la1Results).toHaveLength(2);
    for (const result of la1Results) expect(result.iptv).toBe(la1?.id);
    /* «LaLiga TV Hypermotion» del motor es SU canal IPTV, nunca otro. */
    const hyperIptv = (await channels(r.h, 'hypermotion')).channels[0];
    expect(hyperIptv?.title).toBe('LaLiga TV Hypermotion');
    const hyper = await inject(r.h, 'GET', '/api/v1/search?q=hypermotion');
    const hyperResults = SearchResponseSchema.parse(hyper.json()).results;
    expect(hyperResults.length).toBeGreaterThan(0);
    for (const result of hyperResults) expect(result.iptv).toBe(hyperIptv?.id);
    const text = res.body;
    expect(text).not.toContain(FAKE_IPTV_PASSWORD);
    /* La ruta antigua nunca lo lleva. */
    const legacy = await inject(r.h, 'GET', '/api/search?q=la%201');
    expect(legacy.body).not.toContain('"iptv"');
  });

  it('13 · canal tocado del buscador: la IPTV sola; con engine=1 y el motor sin Telecinco, sin error; «La 1» con engine=1, la IPTV y las dos AceStream', async () => {
    const r = await setup({ search: true });
    await saveXtream(r);
    const tele = (await channels(r.h, 'telecinco')).channels[0]?.id as string;
    const first = await resolve(r.h, `channel=Telecinco&scope=channel&iptv=${tele}&client=web_b`);
    expect(first.status).toBe('found');
    expect(first.candidates.map((candidate) => candidate.id)).toEqual([tele]);
    const reverse = await resolve(
      r.h,
      `channel=Telecinco&scope=channel&iptv=${tele}&engine=1&client=web_b`,
    );
    expect(reverse.status).toBe('found');
    expect(reverse.candidates.map((candidate) => candidate.id)).toEqual([tele]);
    expect(reverse.engineAvailable).toBe(true);
    /* Renombrado por Isma («Tele 5»): el id manda igual. */
    const renamed = await resolve(r.h, `channel=Tele%205&scope=channel&iptv=${tele}&client=web_b`);
    expect(renamed.candidate?.id).toBe(tele);
    const la1 = (await channels(r.h, 'la 1')).channels[0]?.id as string;
    const both = await resolve(
      r.h,
      `channel=La%201&scope=channel&iptv=${la1}&engine=1&client=web_b`,
    );
    expect(both.candidates.map((candidate) => candidate.source)).toEqual([
      'iptv',
      'acestream',
      'acestream',
    ]);
    expect(both.candidates[0]?.id).toBe(la1);
    for (const candidate of both.candidates.slice(1)) {
      expect(candidate.title).toMatch(/^La 1 HD/);
      expect(candidate.score).toBeGreaterThanOrEqual(92);
    }
    /* Sin engine=1 el motor no se toca: solo la IPTV. */
    const quick = await resolve(r.h, `channel=La%201&scope=channel&iptv=${la1}&client=web_b`);
    expect(quick.candidates.map((candidate) => candidate.id)).toEqual([la1]);
  });

  it('14 · de Xtream a la M3U del mismo proveedor: favorito y reciente de Telecinco pasan al id nuevo y se reproducen', async () => {
    const r = await setup();
    await saveXtream(r);
    const tele = (await channels(r.h, 'telecinco')).channels[0]?.id as string;
    await libraryMutate(r.h, {
      action: 'favorite-upsert',
      item: { id: tele, title: 'Telecinco', category: 'IPTV', alias: 'Telecinco', ih: false },
    });
    const before = await libraryMutate(r.h, {
      action: 'history-upsert',
      item: { id: tele, title: 'Telecinco', ih: false },
    });
    expect(before.iptvIds).toEqual({ [tele]: 'ok' });
    const m3u = await inject(r.h, 'PUT', '/api/v1/iptv', {
      kind: 'm3u',
      url: `${SERVER}/lista.m3u`,
    });
    expect(m3u.statusCode, m3u.body).toBe(200);
    await r.h.iptv.idle();
    await until('m3u activa', () => r.h.iptv.active());
    await r.h.iptv.relinkIdle();
    const fresh = (await channels(r.h, 'telecinco')).channels[0]?.id as string;
    expect(fresh).not.toBe(tele);
    const view = LibraryViewSchema.parse((await inject(r.h, 'GET', '/api/v1/library')).json());
    expect(view.favorites.map((item) => item.id)).toEqual([fresh]);
    expect(view.history.map((item) => item.id)).toEqual([fresh]);
    expect(view.iptvIds).toEqual({ [fresh]: 'ok' });
    const grant = await openDriven(r.h, fresh, 'visor_relink');
    expect(grant.source).toBe('iptv');
  });
});

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

  it('análisis corto sin parámetros: un reinicio con 5 MB / 5 s sin abrir otra conexión con el proveedor (§4.5)', async () => {
    const r = await setup();
    await saveXtream(r);
    const id = await iptvIdFor(r.h, 'Antena 3');
    probeFailNext = true;
    const peak: number[] = [];
    const sampler = setInterval(() => peak.push(r.provider.conexiones()), 100);
    let grant: StreamGrant;
    try {
      grant = await openDriven(r.h, id, 'visor_probe');
      await until('bytes al ffmpeg nuevo', () => (r.launcher.all.at(-1)?.bytesRead ?? 0) > 20_000);
    } finally {
      clearInterval(sampler);
    }
    expect(grant.source).toBe('iptv');
    expect(grant.iptvInput).toBe('ts');
    const probes = r.launcher.all
      .filter((proc) => proc.args.includes('-protocol_whitelist'))
      .map((proc) => proc.args[proc.args.indexOf('-probesize') + 1]);
    expect(probes).toEqual(['2000000', '5000000']);
    expect(Math.max(0, ...peak)).toBeLessThanOrEqual(1);
    /* La misma conexión de siempre: una sola petición de stream al proveedor. */
    expect(r.provider.peticionesDeStream()).toHaveLength(1);
    expect(r.h.bus.of('stream.closed')).toEqual([]);
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

  it('gracia de 3 s solo al irse sin pedir otra cosa; otro canal la cancela y cierra antes de abrir', async () => {
    const r = await setup();
    await saveXtream(r);
    const antena = await iptvIdFor(r.h, 'Antena 3');
    const la1 = await iptvIdFor(r.h, 'La 1');
    const grant = await open(r.h, antena, 'visor_gracia');
    await until('conectado', () => r.provider.conexiones() === 1);
    r.provider.limpiarPeticiones();
    const release = await inject(r.h, 'POST', `/api/v1/sessions/${grant.session.id}/release`, {
      viewer: 'visor_gracia',
    });
    expect(release.statusCode).toBe(200);
    /* Vuelta enseguida al mismo canal: misma sesión y ni una petición nueva al proveedor. */
    const back = await open(r.h, antena, 'visor_gracia');
    expect(back.session.id).toBe(grant.session.id);
    expect(r.provider.peticionesDeStream()).toEqual([]);
    expect(r.provider.conexiones()).toBe(1);
    /* Se va otra vez y pasan los 3 s: se cierra y se suelta la plaza. */
    await inject(r.h, 'POST', `/api/v1/sessions/${back.session.id}/release`, {
      viewer: 'visor_gracia',
    });
    await r.h.advance(4_000, 1_000);
    await until('cerrada tras la gracia', () => r.provider.conexiones() === 0);
    expect(r.h.playback.inspect().sessions).toEqual([]);
    /* Soltar y abrir OTRO canal IPTV: la gracia no se aplica, se cierra antes de abrir. */
    const third = await open(r.h, antena, 'visor_gracia');
    await until('conectado otra vez', () => r.provider.conexiones() === 1);
    await inject(r.h, 'POST', `/api/v1/sessions/${third.session.id}/release`, {
      viewer: 'visor_gracia',
    });
    const other = await openDriven(r.h, la1, 'visor_gracia');
    expect(other.session.id).not.toBe(third.session.id);
    expect(r.h.playback.inspect().sessions).toHaveLength(1);
    expect(r.provider.conexiones()).toBeLessThanOrEqual(1);
  });

  it('«Un solo dispositivo a la vez» en el mismo canal IPTV: traspaso sin reabrir, aunque el panel retenga la plaza', async () => {
    const r = await setup({ retenerPlazaMs: 30_000 });
    const put = await inject(r.h, 'PUT', '/api/v1/settings', { sameChannelPolicy: 'handoff' });
    expect(put.statusCode, put.body).toBe(200);
    await saveXtream(r);
    const antena = await iptvIdFor(r.h, 'Antena 3');
    const first = await open(r.h, antena, 'visor_web_a');
    await until('conectado', () => r.provider.conexiones() === 1);
    r.provider.limpiarPeticiones();
    const second = await open(r.h, antena, 'visor_ios_b');
    /* El primero recibe el traspaso; la sesión y la conexión con el proveedor siguen. */
    expect(second.source).toBe('iptv');
    expect(second.session.id).toBe(first.session.id);
    expect(r.provider.peticionesDeStream()).toEqual([]);
    expect(r.provider.conexiones()).toBe(1);
    const handoffs = r.h.bus.of('playback.handoff');
    expect(handoffs.at(-1)).toMatchObject({ reason: 'same_channel', viewerIds: ['visor_web_a'] });
    expect(r.h.bus.of('stream.closed')).toEqual([]);
    const sessions = r.h.playback.inspect().sessions;
    expect(sessions).toHaveLength(1);
    await r.h.settle();
    expect(r.h.iptv.connections()).toBe(1);
  });

  it('§7.7 · un partido que solo tiene IPTV queda «discovered» en el precalentamiento, no «no_sources»', async () => {
    const r = await setup();
    await saveXtream(r);
    const schedule = await r.h.services.football.schedule();
    const match = schedule.days.flatMap((day) => day.matches).find((item) => item.id === 'demo-3');
    expect(match?.channels.map((channel) => channel.name)).toEqual(['La 1 HD']);
    const football = r.h.services.football as unknown as {
      preheatMatch(
        match: unknown,
        stage: 'discovery',
        now?: number,
      ): Promise<{ status: string } | null>;
    };
    const record = await football.preheatMatch(match, 'discovery');
    expect(record?.status).toBe('discovered');
    const preheat = await inject(r.h, 'GET', '/api/v1/football/preheat/demo-3');
    expect(preheat.json().preheat.candidateCount).toBe(1);
    expect(preheat.json().preheat.status).toBe('discovered');
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
