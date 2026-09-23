/* Tests del motor AceStream falso: cada endpoint, cada regla medida en el
   motor real (docs/analisis/motor-real.md §2, §3 y §7), cada modo de fallo,
   las métricas, la API HTTP de control, el reloj (2 h simuladas en segundos)
   y que close() no deje nada abierto. */

import { createHash } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CATALOG, contentIdToInfohash, demoContentId } from './catalog.js';
import { FakeClock, realClock } from './clock.js';
import { createFakeEngine, type FakeEngine, type FakeEngineOptions } from './engine.js';
import {
  delay,
  getJson,
  loadLegacyAnalyzer,
  loopbackHost,
  netErrorCode,
  openStream,
  pending,
  request,
  waitFor,
} from './test-utils.js';

const legacy = loadLegacyAnalyzer();
afterAll(() => legacy.cleanup());

const CH1 = demoContentId(1); // H.264 + AAC, 3500 kbit/s, 14 pares
const CH1_IH = contentIdToInfohash(CH1);
const CH4 = demoContentId(4); // HEVC + AAC, 6000 kbit/s
const CH8 = demoContentId(8); // sin pares
const CH8_IH = contentIdToInfohash(CH8);

interface Meta {
  infohash: string;
  playback_session_id: string;
  playback_url: string;
  stat_url: string;
  command_url: string;
  is_live: number;
  is_encrypted: number;
  client_session_id: number;
}
interface MetaReply {
  response: Meta | null;
  error: string | null;
}
interface StatReply {
  response: {
    status: string;
    speed_down: number;
    speed_up: number;
    peers: number;
    downloaded: number;
    playback_session_id: string;
    infohash: string;
  } | null;
  error: string | null;
}

/* Los tests sin opciones comparten un motor (con reloj falso) que se deja a
   cero entre test y test; los que necesitan opciones levantan el suyo. No es
   por velocidad: cada motor nuevo son conexiones nuevas, y en el PC de Isma
   abrir muchas tumba a veces el proceso de Node (ver test-utils.ts). */
interface Started {
  engine: FakeEngine;
  clock: FakeClock;
  url: string;
  control: FakeEngine['control'];
}

const engines: FakeEngine[] = [];
let shared: Started | null = null;

async function start(options?: FakeEngineOptions): Promise<Started> {
  if (!options && shared) return shared;
  const clock = options?.clock ?? new FakeClock();
  const engine = await createFakeEngine({ host: await loopbackHost(), ...options, clock });
  const started = { engine, clock: clock as FakeClock, url: engine.url, control: engine.control };
  if (options) engines.push(engine);
  else shared = started;
  return started;
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()));
  if (shared) {
    await shared.control.reset({ sessions: true, metrics: true });
    shared.control.setCatalog(DEFAULT_CATALOG);
  }
});

afterAll(async () => {
  await shared?.engine.close();
});

async function meta(url: string, query: string): Promise<Meta> {
  const reply = await getJson<MetaReply>(`${url}/ace/manifest.m3u8?${query}&format=json`);
  if (!reply.response) throw new Error(`meta sin respuesta: ${String(reply.error)}`);
  return reply.response;
}

async function progressiveUrl(
  url: string,
  id: string,
): Promise<{ meta: Meta; contentUrl: string }> {
  const reply = await getJson<MetaReply>(`${url}/ace/getstream?id=${id}&format=json`);
  if (!reply.response) throw new Error(String(reply.error));
  const hop = await request(reply.response.playback_url);
  expect(hop.status).toBe(302);
  return { meta: reply.response, contentUrl: String(hop.headers.location) };
}

function playlistSegments(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('http'));
}

function mediaSequence(text: string): number {
  return Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1] ?? NaN);
}

/* Espera a que el puerto deje de aceptar conexiones (el cierre es asíncrono). */
async function waitRefused(url: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    const code = await netErrorCode(url, { timeoutMs: 3000 });
    if (code === 'ECONNREFUSED') return;
    if (Date.now() - started > 10_000) throw new Error(`el puerto sigue aceptando: ${code}`);
    await delay(20);
  }
}

// la URL con IPv6 lleva corchetes: hay que escaparla antes de meterla en una RegExp
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const md5 = (data: Buffer) => createHash('md5').update(data).digest('hex');

// ---------------------------------------------------------------------------

describe('endpoints del motor', () => {
  it('get_version con la forma del motor 3.2.3', async () => {
    const { url } = await start();
    const version = await getJson(`${url}/webui/api/service?method=get_version&format=json`);
    expect(version).toEqual({
      result: { platform: 'linux', version: '3.2.3', code: 3020300, websocket_port: 43879 },
      error: null,
    });
    const other = await getJson(`${url}/webui/api/service?method=otro`);
    expect(other).toEqual({ result: null, error: 'unknown method' });
  });

  it('manifest.m3u8?format=json: sesión con URL absolutas en http con el Host de la petición', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH1}&pid=aaa`);
    expect(m.infohash).toBe(CH1_IH);
    expect(m.playback_session_id).toMatch(/^[0-9a-f]{40}$/);
    expect(m.playback_url).toBe(`${url}/ace/m/${CH1_IH}/${m.playback_session_id}.m3u8`);
    expect(m.stat_url).toBe(`${url}/ace/stat/${CH1_IH}/${m.playback_session_id}`);
    expect(m.command_url).toBe(`${url}/ace/cmd/${CH1_IH}/${m.playback_session_id}`);
    expect(m).toMatchObject({ is_live: 1, is_encrypted: 0, client_session_id: -1 });
    expect(control.session(m.playback_session_id)).toMatchObject({
      kind: 'hls',
      pid: 'aaa',
      requestedAs: 'id',
    });

    // con otro Host (el nombre del servicio en docker) las URL lo llevan
    const viaHost = await getJson<MetaReply>(`${url}/ace/manifest.m3u8?id=${CH4}&format=json`, {
      headers: { Host: 'acestream:6878' },
    });
    expect(viaHost.response?.playback_url.startsWith('http://acestream:6878/ace/m/')).toBe(true);
    // los alias de docker compose de la app llevan guion bajo
    const viaAlias = await getJson<MetaReply>(`${url}/ace/manifest.m3u8?id=${CH4}&format=json`, {
      headers: { Host: 'ismaeloul-ace-player-neo_acestream_1:6878' },
    });
    expect(viaAlias.response?.playback_url).toBe(
      `http://ismaeloul-ace-player-neo_acestream_1:6878/ace/m/${contentIdToInfohash(CH4)}/${viaAlias.response?.playback_session_id}.m3u8`,
    );
    // un Host raro no se copia en las URL: se usa la dirección del motor
    const odd = await getJson<MetaReply>(`${url}/ace/manifest.m3u8?id=${CH4}&format=json`, {
      headers: { Host: 'mal host/<x>' },
    });
    expect(odd.response?.playback_url.startsWith(`${url}/ace/m/`)).toBe(true);

    // por infohash también
    const byHash = await meta(url, `infohash=${CH8_IH}`);
    expect(byHash.infohash).toBe(CH8_IH);
    expect(control.session(byHash.playback_session_id)?.requestedAs).toBe('infohash');
  });

  it('manifest.m3u8 sin format=json responde 302 a la lista de la sesión', async () => {
    const { url } = await start();
    const res = await request(`${url}/ace/manifest.m3u8?id=${CH1}`);
    expect(res.status).toBe(302);
    const location = String(res.headers.location);
    expect(location).toMatch(new RegExp(`^${esc(url)}/ace/m/${CH1_IH}/[0-9a-f]{40}\\.m3u8$`));
    const list = await request(location);
    expect(list.status).toBe(200);
    expect(list.headers['content-type']).toBe('application/vnd.apple.mpegurl');
  });

  it('errores de la meta: sin id, id inválido y contenido desconocido con unknownContent=fail', async () => {
    const { url, control } = await start({ unknownContent: 'fail' });
    expect(await getJson(`${url}/ace/manifest.m3u8?format=json`)).toEqual({
      response: null,
      error: 'missing content id',
    });
    expect(await getJson(`${url}/ace/manifest.m3u8?id=xyz&format=json`)).toEqual({
      response: null,
      error: 'invalid content id',
    });
    expect(await getJson(`${url}/ace/manifest.m3u8?id=${'e'.repeat(40)}&format=json`)).toEqual({
      response: null,
      error: 'failed to load content',
    });
    const plain = await request(`${url}/ace/manifest.m3u8?id=${'e'.repeat(40)}`);
    expect(plain.status).toBe(500);
    expect(control.metrics().sessionsOpened).toBe(0);
  });

  it('un id fuera del catálogo se reproduce con los valores por defecto (unknownContent=play)', async () => {
    const { url } = await start();
    const m = await meta(url, `id=${'d'.repeat(40)}`);
    expect(m.infohash).toBe(contentIdToInfohash('d'.repeat(40)));
    expect((await request(m.playback_url)).status).toBe(200);
  });

  it('publicUrl manda sobre el Host de la petición', async () => {
    const { url } = await start({ publicUrl: 'http://acestream:6878/' });
    const m = await meta(url, `id=${CH1}`);
    expect(m.playback_url.startsWith('http://acestream:6878/ace/m/')).toBe(true);
    await expect(createFakeEngine({ publicUrl: 'https://x' })).rejects.toThrow(/publicUrl/);
  });

  it('getstream: 302 a /ace/r/… y de ahí 302 a /content/…, con y sin format=json', async () => {
    const { url } = await start();
    const json = await getJson<MetaReply>(`${url}/ace/getstream?id=${CH1}&format=json`);
    const m = json.response;
    expect(m?.playback_url).toBe(`${url}/ace/r/${CH1_IH}/${m?.playback_session_id}`);

    const plain = await request(`${url}/ace/getstream?id=${CH1}`);
    expect(plain.status).toBe(302);
    const r = String(plain.headers.location);
    expect(r).toMatch(new RegExp(`^${esc(url)}/ace/r/${CH1_IH}/[0-9a-f]{40}$`));
    const hop = await request(r);
    expect(hop.status).toBe(302);
    const content = String(hop.headers.location);
    expect(content).toMatch(new RegExp(`^${esc(url)}/content/${CH1_IH}/[0-9a-f]{32}$`));

    const reader = await openStream(content);
    expect(reader.status).toBe(200);
    expect(reader.headers['content-type']).toBe('video/mp2t');
    // la ráfaga inicial (2 s de caché) llega de golpe y es TS que la 0.6.59 entiende
    await waitFor(() => reader.bytes() >= 800_000, 5000, 'la ráfaga inicial');
    const analysis = legacy.analyze(reader.data());
    expect(analysis.videoCodec).toBe('h264');
    expect(analysis.audioCodecs).toEqual(['aac']);
    expect(analysis.streamKbps).toBe(3500);
    reader.close();
  });

  it('lista HLS viva: versión 3, URL absolutas /ace/c/<ih>/<n>.ts y ventana deslizante de 17', async () => {
    const { url, clock, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    const first = await request(m.playback_url);
    const text = first.body.toString('utf8');
    expect(text.startsWith('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n')).toBe(true);
    expect(text).not.toContain('ENDLIST');
    const segs = playlistSegments(text);
    expect(segs).toHaveLength(3); // lo que el motor ya tenía en caché
    const seq0 = mediaSequence(text);
    expect(segs[0]).toBe(`${url}/ace/c/${CH1_IH}/${seq0}.ts`);
    expect(seq0 + 3).toBe(control.liveSequence());

    // 200 s leyendo la lista cada 10 s: crece hasta 17 y luego se desliza
    let previous = seq0;
    let listText = text;
    for (let i = 0; i < 20; i += 1) {
      clock.advance(10_000);
      listText = (await request(m.playback_url)).body.toString('utf8');
      const seq = mediaSequence(listText);
      expect(seq).toBeGreaterThanOrEqual(previous);
      previous = seq;
      expect(playlistSegments(listText).length).toBeLessThanOrEqual(17);
    }
    expect(playlistSegments(listText)).toHaveLength(17);
    expect(mediaSequence(listText)).toBeGreaterThan(seq0);
    const lastUrl = playlistSegments(listText).at(-1);
    expect(lastUrl).toBe(`${url}/ace/c/${CH1_IH}/${control.liveSequence() - 1}.ts`);
  });

  it('segmentos: TS válido para la 0.6.59, 404 fuera de la ventana y sin sesión', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH4}`);
    const list = (await request(m.playback_url)).body.toString('utf8');
    const segUrl = playlistSegments(list)[0] ?? '';
    const seg = await request(segUrl);
    expect(seg.status).toBe(200);
    expect(seg.headers['content-type']).toBe('video/mp2t');
    expect(Number(seg.headers['content-length'])).toBe(seg.body.length);
    const analysis = legacy.analyze(seg.body);
    expect(analysis.videoCodec).toBe('hevc');
    expect(analysis.audioCodecs).toEqual(['aac']);
    expect(analysis.streamKbps).toBe(6000);

    const ih = contentIdToInfohash(CH4);
    const live = control.liveSequence();
    expect((await request(`${url}/ace/c/${ih}/${live}.ts`)).status).toBe(404); // aún no existe
    expect((await request(`${url}/ace/c/${ih}/${live - 100}.ts`)).status).toBe(404); // ya salió de la ventana
    expect((await request(`${url}/ace/c/${CH1_IH}/${live - 1}.ts`)).status).toBe(404); // contenido sin sesión
  });

  it('/ace/stat: forma real, KB/s y "downloaded" que crece con el reloj', async () => {
    const { url, clock } = await start();
    const m = await meta(url, `id=${CH1}`);
    const a = await getJson<StatReply>(m.stat_url);
    expect(a.error).toBeNull();
    expect(a.response).toMatchObject({
      status: 'dl',
      speed_down: Math.round((3500 * 1.15) / 8),
      speed_up: 0,
      peers: 14,
      playback_session_id: m.playback_session_id,
      infohash: CH1_IH,
    });
    clock.advance(10_000);
    const b = await getJson<StatReply>(m.stat_url);
    const grown = (b.response?.downloaded ?? 0) - (a.response?.downloaded ?? 0);
    expect(grown).toBeGreaterThan(503 * 1024 * 10 - 32768);
    expect(grown).toBeLessThan(503 * 1024 * 10 + 32768);
    expect((b.response?.downloaded ?? 0) % 16384).toBe(0);
    expect(await getJson(`${url}/ace/stat/${CH1_IH}/${'0'.repeat(40)}`)).toEqual({
      response: null,
      error: 'unknown playback session id',
    });
  });

  it('/ace/cmd?method=stop: ok, luego 500 en la lista y "unknown playback session id"', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    expect(await getJson(`${m.command_url}?method=stop`)).toEqual({ response: 'ok', error: null });
    expect((await request(m.playback_url)).status).toBe(500);
    expect(await getJson(m.stat_url)).toEqual({
      response: null,
      error: 'unknown playback session id',
    });
    expect(await getJson(`${m.command_url}?method=stop`)).toEqual({
      response: null,
      error: 'unknown playback session id',
    });
    expect(await getJson(`${m.command_url}?method=pause`)).toEqual({
      response: null,
      error: 'unknown method',
    });
    expect(control.metrics()).toMatchObject({
      stopsReceived: 2,
      stopsUnknown: 1,
      sessionsStopped: 1,
      sessionsOpen: 0,
    });
    expect(control.session(m.playback_session_id)?.state).toBe('stopped');
  });

  it('/search: forma real, agrupa por nombre, devuelve INFOHASHES y no distingue acentos', async () => {
    const { url } = await start();
    const reply = await getJson<{
      result: {
        total: number;
        results: Array<{ name: string; items: Array<Record<string, unknown>> }>;
      };
      error: null;
    }>(`${url}/search?query=deportes&page_size=5`);
    expect(reply.error).toBeNull();
    expect(reply.result.total).toBe(3);
    expect(reply.result.results.map((g) => [g.name, g.items.length])).toEqual([
      ['Canal Deportes 1 HD', 2],
      ['Canal Deportes 2 HD', 1],
    ]);
    const item = reply.result.results[0]?.items[0] ?? {};
    expect(Object.keys(item).sort()).toEqual(
      [
        'availability',
        'availability_updated_at',
        'bitrate',
        'categories',
        'countries',
        'infohash',
        'languages',
        'name',
        'status',
      ].sort(),
    );
    expect(item.infohash).toBe(CH1_IH);
    expect(item.infohash).not.toBe(CH1);

    const futbol = await getJson<{ result: { total: number } }>(`${url}/search?query=futbol`);
    expect(futbol.result.total).toBe(1);
    const paged = await getJson<{ result: { total: number; results: unknown[] } }>(
      `${url}/search?query=canal&page_size=2&page=1`,
    );
    expect(paged.result.total).toBe(8);
    expect(paged.result.results.length).toBeGreaterThan(0);
    expect(await getJson(`${url}/search?query=`)).toEqual({ result: null, error: 'missing query' });
  });

  it('rutas desconocidas y métodos que no son GET', async () => {
    const { url } = await start();
    expect((await request(`${url}/nada`)).status).toBe(404);
    expect((await request(`${url}/ace/m/xyz.m3u8`)).status).toBe(404);
    expect((await request(`${url}/ace/manifest.m3u8?id=${CH1}`, { method: 'POST' })).status).toBe(
      405,
    );
  });
});

// ---------------------------------------------------------------------------

describe('reglas del motor real', () => {
  it('una sesión por contenido: la nueva deja la lista de la vieja en 403 (motor-real §3)', async () => {
    const { url, control } = await start();
    const a = await meta(url, `id=${CH1}&pid=uno`);
    const other = await meta(url, `id=${CH4}&pid=uno`);
    const b = await meta(url, `id=${CH1}&pid=dos`);
    expect(b.playback_session_id).not.toBe(a.playback_session_id);
    expect((await request(a.playback_url)).status).toBe(403);
    expect((await request(b.playback_url)).status).toBe(200);
    // otro contenido no se toca
    expect((await request(other.playback_url)).status).toBe(200);
    expect(control.metrics()).toMatchObject({
      sessionsOpened: 3,
      sessionsOpen: 2,
      sessionsSuperseded: 1,
    });
    expect(control.metrics().sessionsOpenedByContent[CH1_IH]).toBe(2);
    expect(control.activeSession(CH1)?.id).toBe(b.playback_session_id);
    // también pisa si la nueva es progresiva, y al revés
    await getJson(`${url}/ace/getstream?id=${CH1}&format=json`);
    expect((await request(b.playback_url)).status).toBe(403);
  });

  it('una sesión nueva corta el progresivo de la anterior', async () => {
    const { url } = await start();
    const { contentUrl } = await progressiveUrl(url, CH1);
    const reader = await openStream(contentUrl);
    await waitFor(() => reader.bytes() > 100_000, 5000, 'los primeros bytes');
    await meta(url, `id=${CH1}`);
    const end = await reader.ended;
    expect(end.complete).toBe(false);
  });

  it('HLS compartible: varios clientes, la misma lista y segmentos idénticos byte a byte (motor-real §2)', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    const lists = await Promise.all([1, 2, 3].map(() => request(m.playback_url)));
    const texts = lists.map((l) => l.body.toString('utf8'));
    expect(new Set(texts).size).toBe(1);
    const segUrl = playlistSegments(texts[0] ?? '').at(-1) ?? '';
    const segs = await Promise.all([1, 2].map(() => request(segUrl)));
    expect(segs[0]?.status).toBe(200);
    expect(md5(segs[0]?.body ?? Buffer.alloc(0))).toBe(md5(segs[1]?.body ?? Buffer.alloc(1)));
    expect(control.metrics().sessionsOpened).toBe(1);
  });

  it('progresivo de UN consumidor: el segundo recibe una respuesta HTTP rota y el primero sigue (motor-real §7)', async () => {
    const { url, control } = await start();
    const { meta: m, contentUrl } = await progressiveUrl(url, CH1);
    const first = await openStream(contentUrl);
    await waitFor(() => first.bytes() > 100_000, 5000, 'los primeros bytes');
    expect(control.metrics().readersBySession[m.playback_session_id]).toBe(1);

    // el segundo entra por la misma sesión (otro salto por /ace/r)
    const hop = await request(m.playback_url);
    const code = await netErrorCode(String(hop.headers.location));
    expect(code).toBe('HPE_INVALID_HEADER_TOKEN');
    expect(control.metrics().corruptResponses).toBe(1);

    const before = first.bytes();
    await waitFor(() => first.bytes() > before + 50_000, 5000, 'que el primero siga recibiendo');
    first.close();
  });

  it('stop cierra el progresivo limpio (fin de respuesta, no corte)', async () => {
    const { url } = await start();
    const { meta: m, contentUrl } = await progressiveUrl(url, CH1);
    const reader = await openStream(contentUrl);
    await waitFor(() => reader.bytes() > 50_000, 5000, 'los primeros bytes');
    expect(await getJson(`${m.command_url}?method=stop`)).toEqual({ response: 'ok', error: null });
    const end = await reader.ended;
    expect(end.complete).toBe(true);
    expect((await request(m.playback_url)).status).toBe(500);
  });

  it('caducidad sin lectores: 60 s sin leer y la sesión se cierra; las estadísticas no cuentan', async () => {
    const { url, clock, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    for (let i = 0; i < 5; i += 1) {
      clock.advance(10_000);
      await getJson(m.stat_url); // mirar las estadísticas no es leer
    }
    clock.advance(9_000);
    expect(control.session(m.playback_session_id)?.state).toBe('active');
    clock.advance(2_000);
    expect(control.session(m.playback_session_id)?.state).toBe('expired');
    expect((await request(m.playback_url)).status).toBe(500);
    expect(control.metrics()).toMatchObject({ sessionsExpired: 1, sessionsOpen: 0 });
  });

  it('leer la lista, un progresivo abierto o una petición en espera mantienen viva la sesión', async () => {
    const { url, clock, control } = await start();
    const hls = await meta(url, `id=${CH1}`);
    const { meta: prog, contentUrl } = await progressiveUrl(url, CH4);
    const reader = await openStream(contentUrl);
    await waitFor(() => reader.bytes() > 0, 5000, 'el progresivo');
    const quiet = await meta(url, `id=${CH8}`); // sin pares: la lista se queda esperando
    const waiting = pending(quiet.playback_url);
    await waitFor(() => control.metrics().heldRequests === 1, 5000, 'la petición en espera');
    for (let i = 0; i < 30; i += 1) {
      clock.advance(10_000);
      expect((await request(hls.playback_url)).status).toBe(200);
    }
    expect(control.session(hls.playback_session_id)?.state).toBe('active');
    expect(control.session(prog.playback_session_id)?.state).toBe('active');
    expect(control.session(quiet.playback_session_id)?.state).toBe('active');
    expect(waiting.settled()).toBe(false);
    reader.close();
  });

  it('restart(): corta todo, deja de escuchar un rato y vuelve sin sesiones (404 a las viejas)', async () => {
    const { url, clock, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    const restarting = control.restart({ downMs: 5000 });
    await waitFor(() => control.metrics().restarts === 1);
    await waitRefused(`${url}/webui/api/service?method=get_version`);
    clock.advance(5000);
    await restarting;
    expect((await request(`${url}/webui/api/service?method=get_version`)).status).toBe(200);
    expect((await request(m.playback_url)).status).toBe(404);
    expect(control.metrics()).toMatchObject({
      restarts: 1,
      sessionsLostInRestart: 1,
      sessionsOpen: 0,
    });
    const again = await meta(url, `id=${CH1}`);
    expect((await request(again.playback_url)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe('modos de fallo', () => {
  it('slowStart: la meta tarda `ms` (la sesión ya existe) y el primer dato `firstByteMs` más', async () => {
    const { url, clock, control } = await start();
    await control.setMode(CH1, { kind: 'slowStart', ms: 3000, firstByteMs: 2000 });
    const call = pending(`${url}/ace/manifest.m3u8?id=${CH1}&format=json`);
    await waitFor(() => control.metrics().requestsByRoute.manifest === 1);
    await delay(50);
    expect(call.settled()).toBe(false);
    expect(control.activeSession(CH1)).toBeDefined(); // la "fuga" si el cliente corta ahora
    clock.advance(3000);
    const m = (JSON.parse((await call.promise).body.toString('utf8')) as MetaReply).response;
    expect(m).not.toBeNull();
    const stat = await getJson<StatReply>(m?.stat_url ?? '');
    expect(stat.response?.status).toBe('prebuf');
    const list = pending(m?.playback_url ?? '');
    await delay(50);
    expect(list.settled()).toBe(false);
    clock.advance(2000);
    expect((await list.promise).status).toBe(200);
  });

  it('silence: meta y estadísticas bien, pero lista, segmentos y progresivo no mandan nada', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    const segUrl = playlistSegments((await request(m.playback_url)).body.toString('utf8'))[0] ?? '';
    await control.setMode(CH1, 'silence');
    const list = pending(m.playback_url);
    const seg = pending(segUrl);
    await waitFor(() => control.metrics().heldRequests === 2);
    expect((await getJson<StatReply>(m.stat_url)).response?.status).toBe('dl');
    await delay(50);
    expect(list.settled() || seg.settled()).toBe(false);
    await control.clearMode(CH1);
    expect((await list.promise).status).toBe(200);
    expect((await seg.promise).status).toBe(200);
  });

  it('cut: el progresivo se corta tras afterBytes y el segmento llega a medias', async () => {
    const { url, control } = await start();
    await control.setMode(CH1, { kind: 'cut', afterBytes: 100_000 });
    const { contentUrl } = await progressiveUrl(url, CH1);
    const reader = await openStream(contentUrl);
    const end = await reader.ended;
    expect(end.complete).toBe(false);
    expect(reader.bytes()).toBe(100_000);

    const m = await meta(url, `id=${CH1}`);
    const segUrl = playlistSegments((await request(m.playback_url)).body.toString('utf8'))[0] ?? '';
    await control.setMode(CH1, { kind: 'cut', afterBytes: 5000 });
    const seg = await request(segUrl);
    expect(seg.complete).toBe(false);
    expect(seg.body.length).toBe(5000);
  });

  it('cut con afterMs: el progresivo se corta cuando el reloj del motor pasa ese tiempo', async () => {
    const { url, clock, control } = await start();
    const { contentUrl } = await progressiveUrl(url, CH1);
    const reader = await openStream(contentUrl);
    await waitFor(() => reader.bytes() > 0, 5000, 'los primeros bytes');
    await control.setMode(CH1, { kind: 'cut', afterMs: 30_000 });
    await delay(100);
    expect(control.metrics().progressiveStreams).toBe(1);
    clock.advance(30_000);
    const end = await reader.ended;
    expect(end.complete).toBe(false);
  });

  it('noPeers: por catálogo (peers 0) o por modo, estadísticas a cero y ningún dato', async () => {
    const { url, control } = await start();
    const quiet = await meta(url, `id=${CH8}`);
    expect((await getJson<StatReply>(quiet.stat_url)).response).toMatchObject({
      status: 'prebuf',
      peers: 0,
      speed_down: 0,
      downloaded: 0,
    });
    const list = pending(quiet.playback_url);
    await waitFor(() => control.metrics().heldRequests === 1);
    await control.setMode(CH1, 'noPeers');
    const m = await meta(url, `id=${CH1}`);
    expect((await getJson<StatReply>(m.stat_url)).response).toMatchObject({
      status: 'prebuf',
      peers: 0,
      speed_down: 0,
    });
    await delay(50);
    expect(list.settled()).toBe(false);
    expect(control.metrics().heldRequests).toBe(1);
  });

  it('stall global: /webui responde; meta y /search se cuelgan hasta quitar el modo', async () => {
    const { url, control } = await start();
    await control.setMode('*', 'stall');
    expect((await request(`${url}/webui/api/service?method=get_version`)).status).toBe(200);
    const m = pending(`${url}/ace/manifest.m3u8?id=${CH1}&format=json`);
    const search = pending(`${url}/search?query=canal`);
    await waitFor(() => control.metrics().heldRequests === 2);
    await delay(50);
    expect(m.settled() || search.settled()).toBe(false);
    expect(control.metrics().sessionsOpened).toBe(0);
    await control.clearMode('*');
    expect((await m.promise).status).toBe(200);
    expect((await search.promise).status).toBe(200);
  });

  it('stall de un contenido: estadísticas y stop se quedan esperando; al descolgarse el stop se aplica', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    await control.setMode(CH1, 'stall');
    const stat = pending(m.stat_url);
    const stop = pending(`${m.command_url}?method=stop`);
    await waitFor(() => control.metrics().heldRequests === 2);
    expect(control.session(m.playback_session_id)?.state).toBe('active');
    // otro contenido sigue funcionando
    expect((await request(`${url}/ace/manifest.m3u8?id=${CH4}&format=json`)).status).toBe(200);
    await control.clearMode(CH1);
    expect(JSON.parse((await stop.promise).body.toString('utf8'))).toEqual({
      response: 'ok',
      error: null,
    });
    expect((await stat.promise).status).toBe(200);
    expect(control.session(m.playback_session_id)?.state).toBe('stopped');
  });

  it('down global: rechaza conexiones (refuse), las corta (reset) o da 503', async () => {
    const { url, control } = await start();
    const version = `${url}/webui/api/service?method=get_version`;
    await control.setMode('*', 'down');
    expect(await netErrorCode(version)).toBe('ECONNREFUSED');
    await control.clearMode('*');
    expect((await request(version)).status).toBe(200);
    await control.setMode('*', { kind: 'down', how: 'reset' });
    expect(await netErrorCode(version)).toBe('ECONNRESET');
    await control.setMode('*', { kind: 'down', how: '503' });
    expect(await netErrorCode(version)).toBe('HTTP_503');
    await control.clearMode('*');
    expect((await request(version)).status).toBe(200);
  });

  it('down de un contenido: 503 en su meta y en su lista; el resto funciona', async () => {
    const { url, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    await control.setMode(CH1_IH, 'down');
    expect((await request(`${url}/ace/manifest.m3u8?id=${CH1}&format=json`)).status).toBe(503);
    expect((await request(m.playback_url)).status).toBe(503);
    expect((await request(`${url}/ace/manifest.m3u8?id=${CH4}&format=json`)).status).toBe(200);
  });

  it('failedContent: "failed to load content" y ninguna sesión abierta', async () => {
    const { url, control } = await start();
    await control.setMode(CH1, 'failedContent');
    expect(await getJson(`${url}/ace/manifest.m3u8?id=${CH1}&format=json`)).toEqual({
      response: null,
      error: 'failed to load content',
    });
    expect((await request(`${url}/ace/getstream?id=${CH1}`)).status).toBe(500);
    expect(control.metrics().sessionsOpened).toBe(0);
  });

  it('redirectHttp: lista, segmento y progresivo pasan antes por un 302 absoluto en http a sí mismos', async () => {
    const { url, control } = await start();
    await control.setMode('*', 'redirectHttp');
    const m = await meta(url, `id=${CH1}`); // la meta no se redirige
    const hop = await request(m.playback_url);
    expect(hop.status).toBe(302);
    const location = String(hop.headers.location);
    expect(location.startsWith(`${url}/ace/m/${CH1_IH}/`)).toBe(true);
    expect(location).toContain('_fake_redir=1');
    const list = await request(location);
    expect(list.status).toBe(200);
    const segUrl = playlistSegments(list.body.toString('utf8'))[0] ?? '';
    const segHop = await request(segUrl);
    expect(segHop.status).toBe(302);
    expect((await request(String(segHop.headers.location))).status).toBe(200);

    const { contentUrl } = await progressiveUrl(url, CH4);
    // /ace/r ya pasó su propio 302 a sí mismo; lo que llega es la redirección de vuelta
    expect(contentUrl).toContain(`/ace/r/`);
    const second = await request(contentUrl);
    expect(second.status).toBe(302);
    expect(String(second.headers.location)).toContain('/content/');
  });

  it('forMs: el modo se quita solo pasado ese tiempo del reloj del motor', async () => {
    const { url, clock, control } = await start();
    await control.setMode('*', 'stall', { forMs: 10_000 });
    const m = pending(`${url}/ace/manifest.m3u8?id=${CH1}&format=json`);
    await waitFor(() => control.metrics().heldRequests === 1);
    clock.advance(9_999);
    await delay(30);
    expect(m.settled()).toBe(false);
    clock.advance(1);
    expect((await m.promise).status).toBe(200);
  });

  it('rechaza destinos y modos no válidos', async () => {
    const { control } = await start();
    expect(() => control.setMode('canal', 'stall')).toThrow(/destino/);
    expect(() => control.setMode('*', 'explota' as never)).toThrow(/modo/);
  });
});

// ---------------------------------------------------------------------------

describe('métricas', () => {
  it('sesiones abiertas y por contenido, lectores, stops y peticiones por ruta', async () => {
    const { url, control } = await start();
    await request(`${url}/webui/api/service?method=get_version`);
    const m = await meta(url, `id=${CH1}`);
    const list = (await request(m.playback_url)).body.toString('utf8');
    await request(playlistSegments(list)[0] ?? '');
    await getJson(m.stat_url);
    await getJson(`${url}/search?query=canal`);
    const { meta: prog, contentUrl } = await progressiveUrl(url, CH4);
    const reader = await openStream(contentUrl);
    await waitFor(() => control.metrics().readersBySession[prog.playback_session_id] === 1);
    await getJson(`${m.command_url}?method=stop`);

    const metrics = control.metrics();
    expect(metrics.requestsByRoute).toMatchObject({
      webui: 1,
      manifest: 1,
      playlist: 1,
      segment: 1,
      stat: 1,
      search: 1,
      getstream: 1,
      progressive: 1,
      content: 1,
      cmd: 1,
    });
    expect(metrics).toMatchObject({
      sessionsOpened: 2,
      sessionsOpen: 1,
      stopsReceived: 1,
      progressiveStreams: 1,
    });
    expect(metrics.sessionsOpenByContent).toEqual({ [contentIdToInfohash(CH4)]: 1 });
    expect(metrics.bytesSent).toBeGreaterThan(0);
    reader.close();
    await reader.ended;

    await control.reset({ metrics: true, sessions: true });
    expect(control.metrics()).toMatchObject({
      sessionsOpened: 0,
      sessionsOpen: 0,
      requestsByRoute: {},
    });
    expect(control.sessions()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('API HTTP de control (/__fake/*)', () => {
  it('estado, métricas, sesiones, catálogo, modos, barrido, reinicio de contadores y reloj', async () => {
    const { url, control } = await start();
    const status = await getJson(`${url}/__fake/status`);
    expect(status).toMatchObject({
      ok: true,
      listening: true,
      restarting: false,
      liveSequence: control.liveSequence(),
    });

    const m = await meta(url, `id=${CH1}`);
    const sessions = await getJson<{ sessions: Array<{ id: string }> }>(
      `${url}/__fake/sessions?state=active`,
    );
    expect(sessions.sessions.map((s) => s.id)).toEqual([m.playback_session_id]);
    expect((await getJson(`${url}/__fake/metrics`)).sessionsOpen).toBe(1);

    // modo por HTTP
    const setMode = await request(`${url}/__fake/mode`, {
      method: 'POST',
      body: { target: '*', mode: 'stall' },
    });
    expect(setMode.status).toBe(200);
    const held = pending(`${url}/search?query=canal`);
    await waitFor(() => control.metrics().heldRequests === 1);
    expect((await request(`${url}/__fake/mode?target=*`, { method: 'DELETE' })).status).toBe(200);
    expect((await held.promise).status).toBe(200);
    expect(
      (await request(`${url}/__fake/mode`, { method: 'POST', body: { mode: 'explota' } })).status,
    ).toBe(400);
    expect(
      (
        await request(`${url}/__fake/mode`, {
          method: 'POST',
          body: { target: 'x', mode: 'stall' },
        })
      ).status,
    ).toBe(400);

    // catálogo
    const catalog = await getJson<{ contents: unknown[] }>(`${url}/__fake/catalog`);
    expect(catalog.contents).toHaveLength(8);
    const put = await request(`${url}/__fake/catalog`, {
      method: 'PUT',
      body: { contents: [{ id: 'c'.repeat(40), title: 'Canal Prueba --> X' }] },
    });
    expect(put.status).toBe(200);
    expect(
      (await getJson<{ result: { total: number } }>(`${url}/search?query=canal`)).result.total,
    ).toBe(1);
    expect(
      (await request(`${url}/__fake/catalog`, { method: 'PUT', body: [{ id: 'malo' }] })).status,
    ).toBe(400);
    expect((await request(`${url}/__fake/catalog`, { method: 'PUT', body: '{roto' })).status).toBe(
      400,
    );

    // reloj falso por HTTP, barrido y reinicio de contadores
    const advanced = await getJson<{ now: number }>(`${url}/__fake/clock/advance`, {
      method: 'POST',
      body: { ms: 61_000 },
    });
    expect(advanced.now).toBe(control.clock.now());
    expect(control.session(m.playback_session_id)?.state).toBe('expired');
    expect((await request(`${url}/__fake/sweep`, { method: 'POST' })).status).toBe(200);
    expect(
      (await request(`${url}/__fake/reset`, { method: 'POST', body: { metrics: true } })).status,
    ).toBe(200);
    expect(control.metrics().sessionsOpened).toBe(0);

    expect((await request(`${url}/__fake/nada`)).status).toBe(404);
    expect((await request(`${url}/__fake/metrics`, { method: 'POST' })).status).toBe(405);
  });

  it('sin reloj falso, /__fake/clock/advance responde 409; controlApi=false esconde las rutas', async () => {
    const { url } = await start({ clock: realClock });
    expect(
      (await request(`${url}/__fake/clock/advance`, { method: 'POST', body: { ms: 1 } })).status,
    ).toBe(409);
    const hidden = await start({ controlApi: false });
    expect((await request(`${hidden.url}/__fake/status`)).status).toBe(404);
  });

  it('restart por el puerto del motor: responde 202 antes de cerrar y vuelve pasado downMs', async () => {
    const { url, control } = await start({ clock: realClock });
    const m = await meta(url, `id=${CH1}`);
    const res = await request(`${url}/__fake/restart`, { method: 'POST', body: { downMs: 400 } });
    expect(res.status).toBe(202);
    expect(JSON.parse(res.body.toString('utf8'))).toMatchObject({ ok: true, deferred: true });
    await waitFor(() => control.metrics().restarts === 1);
    await waitFor(() => control.metrics().sessionsOpen === 0);
    let back = false;
    const started = Date.now();
    while (!back && Date.now() - started < 15_000) {
      back = (await netErrorCode(`${url}/webui/api/service?method=get_version`)) === 'HTTP_200';
      if (!back) await delay(50);
    }
    expect(back).toBe(true);
    expect((await request(m.playback_url)).status).toBe(404);
  });

  it('puerto de control aparte: sigue vivo con el motor caído y lo levanta', async () => {
    const { url, engine } = await start({ controlPort: 0 });
    const control = engine.controlUrl ?? '';
    expect(control).toMatch(/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+$/);
    expect(control).not.toBe(url);
    const down = await request(`${control}/__fake/mode`, {
      method: 'POST',
      body: { mode: 'down' },
    });
    expect(down.status).toBe(200);
    expect(await getJson(`${control}/__fake/status`)).toMatchObject({ listening: false });
    expect(await netErrorCode(`${url}/webui/api/service?method=get_version`)).toBe('ECONNREFUSED');
    expect((await request(`${control}/__fake/mode?target=*`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(await getJson(`${control}/__fake/status`)).toMatchObject({ listening: true });
    expect((await request(`${url}/webui/api/service?method=get_version`)).status).toBe(200);
    expect((await request(`${control}/ace/getstream?id=${CH1}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('reloj y cierre', () => {
  it('2 h de directo simuladas en segundos: una sola sesión, lista deslizándose y segmentos válidos', async () => {
    const { url, clock, control } = await start();
    const m = await meta(url, `id=${CH1}`);
    const firstSeq = mediaSequence((await request(m.playback_url)).body.toString('utf8'));
    const stat0 = (await getJson<StatReply>(m.stat_url)).response?.downloaded ?? 0;
    let lastSeq = firstSeq;
    for (let i = 1; i <= 720; i += 1) {
      clock.advance(10_000);
      const list = await request(m.playback_url);
      expect(list.status).toBe(200);
      const text = list.body.toString('utf8');
      const seq = mediaSequence(text);
      expect(seq).toBeGreaterThanOrEqual(lastSeq);
      lastSeq = seq;
      if (i % 120 === 0) {
        const seg = await request(playlistSegments(text).at(-1) ?? '');
        expect(seg.status).toBe(200);
        expect(legacy.analyze(seg.body)).toMatchObject({
          videoCodec: 'h264',
          audioCodecs: ['aac'],
          streamKbps: 3500,
        });
      }
    }
    // 7200 s con segmentos de 5 s de media: ~1440 segmentos más
    expect(lastSeq - firstSeq).toBeGreaterThan(1400);
    expect(lastSeq - firstSeq).toBeLessThan(1460);
    const downloaded = (await getJson<StatReply>(m.stat_url)).response?.downloaded ?? 0;
    const expected = 503 * 1024 * 7200;
    expect(Math.abs(downloaded - stat0 - expected) / expected).toBeLessThan(0.001);
    expect(control.metrics()).toMatchObject({
      sessionsOpened: 1,
      sessionsExpired: 0,
      sessionsOpen: 1,
    });

    // y en cuanto se deja de leer, caduca
    clock.advance(61_000);
    expect(control.metrics().sessionsExpired).toBe(1);
  });

  it('close() no deja servidores, sockets ni temporizadores abiertos', async () => {
    const count = () => {
      const resources = process.getActiveResourcesInfo();
      return {
        servers: resources.filter((r) => r === 'TCPServerWrap').length,
        sockets: resources.filter((r) => r === 'TCPSocketWrap').length,
        timers: resources.filter((r) => r === 'Timeout').length,
      };
    };
    await delay(20);
    const before = count();

    // con el reloj real: el barrido va por setTimeout y el progresivo por setInterval
    const host = await loopbackHost();
    const engine = await createFakeEngine({ host, clock: realClock, controlPort: 0 });
    const { contentUrl } = await progressiveUrl(engine.url, CH1);
    const reader = await openStream(contentUrl);
    await waitFor(() => reader.bytes() > 0, 5000, 'el progresivo');
    const held = pending(`${engine.url}/ace/manifest.m3u8?id=${CH8}&format=json`);
    await engine.control.setMode('*', 'stall', { forMs: 60_000 });
    const heldSearch = pending(`${engine.url}/search?query=canal`);
    await waitFor(() => engine.control.metrics().heldRequests >= 1);
    await engine.close();
    await engine.close(); // idempotente
    await reader.ended;
    await Promise.allSettled([held.promise, heldSearch.promise]);
    await delay(50);
    const after = count();
    expect(after.servers).toBe(before.servers);
    expect(after.sockets).toBeLessThanOrEqual(before.sockets);
    expect(after.timers).toBeLessThanOrEqual(before.timers);

    // con el reloj falso no queda ningún temporizador programado
    const clock = new FakeClock();
    const fake = await createFakeEngine({ host, clock });
    await fake.control.setMode('*', 'slowStart', { forMs: 1000 });
    const slow = pending(`${fake.url}/ace/manifest.m3u8?id=${CH1}&format=json`);
    await waitFor(() => fake.control.metrics().requestsByRoute.manifest === 1);
    expect(clock.pendingTimers()).toBeGreaterThan(2); // barrido, forMs, respuesta y primer dato
    await fake.close();
    await slow.promise.catch(() => undefined);
    expect(clock.pendingTimers()).toBe(0);
  });
});
