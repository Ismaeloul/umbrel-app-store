/* El banco de pruebas VOD se prueba a sí mismo: el proveedor falso cumple
   Range, una sola conexión y sus rarezas; el relé de prueba nunca abre dos
   conexiones arriba; y (con ffmpeg) las muestras salen como dice
   samples.ts y un ffmpeg de verdad, leyendo por el relé con
   `-noaccurate_seek -ss K+0,2`, empieza justo en el fotograma clave K
   (docs/vod.md §9.2, hallazgo 3). */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loopbackHost } from '../fake-engine/test-utils.js';
import { fragmentStartS, readFmp4 } from './boxes.js';
import { openGet, rawGet, until } from './http.js';
import { createFakeVodOrigin, parseRange, type FakeVodOrigin } from './origin.js';
import { createTestVodRelay, type TestVodRelay } from './relay.js';
import { HAS_FFMPEG, ensureVodSample, probeKeyframes, probeStreams, runFfmpeg } from './samples.js';

const SIZE = 1024 * 1024;
let dir: string;
let file: string;
let data: Buffer;
let host: string;

beforeAll(async () => {
  host = await loopbackHost();
  dir = mkdtempSync(path.join(os.tmpdir(), 'ace-fake-vod-'));
  file = path.join(dir, 'peli.bin');
  data = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i += 1) data[i] = (i * 7 + (i >> 8)) & 0xff;
  writeFileSync(file, data);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function origin(
  options: Parameters<typeof createFakeVodOrigin>[2] = {},
): Promise<FakeVodOrigin> {
  const created = await createFakeVodOrigin(host, { '123.mkv': file }, options);
  closers.push(() => created.close());
  return created;
}

describe('parseRange', () => {
  it('rangos simples, abiertos, de cola, varios y fuera del fichero', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange('bytes=0-1,5-9', 1000)).toBe('multi');
    expect(parseRange('bytes=1000-', 1000)).toBe('bad');
    expect(parseRange(undefined, 1000)).toBeNull();
  });
});

describe('proveedor VOD falso', () => {
  it('Range → 206 con Content-Range; sin Range → 200 entero', async () => {
    const o = await origin();
    const part = await rawGet(o.url('123.mkv'), { range: 'bytes=1000-1999' });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 1000-1999/${SIZE}`);
    expect(part.body.equals(data.subarray(1000, 2000))).toBe(true);
    const whole = await rawGet(o.url('123.mkv'));
    expect(whole.status).toBe(200);
    expect(whole.body.length).toBe(SIZE);
    const head = await rawGet(o.url('123.mkv', 'series'), { method: 'HEAD' });
    expect(head.headers['content-length']).toBe(String(SIZE));
  });

  it('credenciales malas → 401; fichero que no existe → 404; varios rangos → 416', async () => {
    const o = await origin();
    expect((await rawGet(o.url('123.mkv').replace('vodclave', 'otra'))).status).toBe(401);
    expect((await rawGet(o.url('999.mkv'))).status).toBe(404);
    const multi = await rawGet(o.url('123.mkv'), { range: 'bytes=0-1,5-9' });
    expect(multi.status).toBe(416);
    expect(multi.headers['content-range']).toBe(`bytes */${SIZE}`);
  });

  it('una sola conexión: la segunda a la vez recibe 458 y se cuenta', async () => {
    const o = await origin({ rateMbps: 1 });
    const first = await openGet(o.url('123.mkv'), 'bytes=0-');
    const second = await rawGet(o.url('123.mkv'), { range: 'bytes=0-99' });
    expect(second.status).toBe(458);
    expect(o.stats.rejected).toBe(1);
    first.close();
    await until(() => o.stats.open === 0, 5_000, 'el cierre');
    expect((await rawGet(o.url('123.mkv'), { range: 'bytes=0-99' })).status).toBe(206);
    expect(o.stats.maxOpen).toBe(1);
  });

  it('noRange: 200 con el fichero entero aunque se pida un rango', async () => {
    const o = await origin({ noRange: true });
    const res = await rawGet(o.url('123.mkv'), { range: 'bytes=500-' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(SIZE);
  });

  it('redirect: 302 a /lb/<token>/… que sirve con Range', async () => {
    const o = await origin({ redirect: true });
    const res = await rawGet(o.url('123.mkv'), { range: 'bytes=0-9' });
    expect(res.status).toBe(302);
    const location = String(res.headers.location);
    expect(location).toMatch(/^\/lb\/[^/]+\/123\.mkv$/);
    const base = new URL(o.url('123.mkv'));
    const final = await rawGet(`${base.origin}${location}`, { range: 'bytes=0-9' });
    expect(final.status).toBe(206);
    expect(final.body.equals(data.subarray(0, 10))).toBe(true);
  });

  it('dropAtBytes: manda justo esos bytes y corta', async () => {
    const o = await origin({ dropAtBytes: 300_000 });
    const res = await rawGet(o.url('123.mkv'), { range: 'bytes=0-' });
    expect(res.status).toBe(206);
    expect(res.complete).toBe(false);
    expect(res.body.length).toBe(300_000);
    expect(res.body.equals(data.subarray(0, 300_000))).toBe(true);
  });

  it('busyAfterCloseMs: tras cerrar, 458 durante ese rato', async () => {
    const o = await origin({ busyAfterCloseMs: 400 });
    expect((await rawGet(o.url('123.mkv'), { range: 'bytes=0-9' })).status).toBe(206);
    await until(() => o.stats.open === 0);
    expect((await rawGet(o.url('123.mkv'), { range: 'bytes=0-9' })).status).toBe(458);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect((await rawGet(o.url('123.mkv'), { range: 'bytes=0-9' })).status).toBe(206);
  });

  it('cutOpen: corta la conexión parada (el send_timeout de un panel)', async () => {
    const o = await origin({ rateMbps: 1 });
    const stalled = await openGet(o.url('123.mkv'), 'bytes=0-');
    stalled.res.on('error', () => undefined);
    await until(() => o.stats.open === 1);
    o.cutOpen();
    await until(() => o.stats.open === 0);
    /* El cliente parado se entera al volver a leer (en Windows, no antes). */
    const closed = new Promise<void>((resolve) => stalled.res.once('close', () => resolve()));
    stalled.res.resume();
    await closed;
    expect(stalled.res.complete).toBe(false);
    stalled.close();
  });
});

describe('relé de prueba', () => {
  it('peticiones solapadas como las de ffmpeg: nunca 2 conexiones arriba ni un 458', async () => {
    const o = await origin({ rateMbps: 4 });
    const relay = await createTestVodRelay(host, o.url('123.mkv'), 'mkv');
    closers.push(() => relay.close());
    const first = await openGet(relay.inputUrl, 'bytes=0-');
    /* La segunda llega con la primera aún abierta (lo que hace ffmpeg al saltar). */
    const second = await rawGet(relay.inputUrl, { range: 'bytes=500000-500099' });
    expect(second.status).toBe(206);
    expect(second.body.equals(data.subarray(500_000, 500_100))).toBe(true);
    first.close();
    expect(o.stats.maxOpen).toBe(1);
    expect(o.stats.rejected).toBe(0);
    expect(relay.stats.maxUpstream).toBe(1);
  });
});

/* Las cuatro muestras salen con lo que promete samples.ts, y ffmpeg leyendo
   por el relé cae justo en el fotograma clave (hallazgo 3 de docs/vod.md §9.2). */
describe.skipIf(!HAS_FFMPEG)('muestras y ffmpeg de verdad (@ffmpeg)', () => {
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(path.join(os.tmpdir(), 'ace-fake-vod-ffmpeg-'));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('las muestras: pistas y fotogramas clave', () => {
    const mkv = ensureVodSample('mkv-h264-ac3');
    const streams = probeStreams(mkv);
    expect(streams.map((s) => s.codecName)).toEqual(['h264', 'ac3', 'ac3', 'subrip']);
    expect(streams[1]?.channels).toBe(6);
    expect(streams[2]?.title).toBe('Inglés (original)');
    expect(probeKeyframes(mkv).slice(0, 3)).toEqual([0, 2.5, 5]);
    const mp4 = ensureVodSample('mp4-moov-end');
    expect(probeStreams(mp4).map((s) => s.codecName)).toEqual(['h264', 'aac', 'aac']);
    const top = readFmp4(readFileSync(mp4)).topTypes;
    expect(top.indexOf('moov')).toBeGreaterThan(top.indexOf('mdat'));
    expect(probeStreams(ensureVodSample('mkv-hevc')).map((s) => s.codecName)).toEqual([
      'hevc',
      'eac3',
    ]);
    expect(probeKeyframes(ensureVodSample('mkv-bframes')).length).toBeGreaterThan(15);
  });

  for (const name of ['mkv-h264-ac3', 'mp4-moov-end', 'mkv-bframes'] as const) {
    it(`${name}: por el relé y con -ss K+0,2 empieza justo en K, con una sola conexión`, async () => {
      const sample = ensureVodSample(name);
      const keyframes = probeKeyframes(sample);
      const k = keyframes[Math.floor(keyframes.length / 2)] as number;
      const ext = path.extname(sample).slice(1);
      const o = await createFakeVodOrigin(host, { [`5.${ext}`]: sample });
      closers.push(() => o.close());
      const relay: TestVodRelay = await createTestVodRelay(host, o.url(`5.${ext}`), ext);
      closers.push(() => relay.close());
      const out = path.join(work, `${name}.mp4`);
      const result = await runFfmpeg([
        ...['-loglevel', 'error'],
        ...['-noaccurate_seek', '-ss', (k + 0.2).toFixed(3), '-t', '8', '-i', relay.inputUrl],
        ...['-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2'],
        /* Con -copyts, un -t de salida contaría desde 0 y no saldría nada: va en la entrada. */
        '-copyts',
        ...['-movflags', '+frag_keyframe+delay_moov+default_base_moof+frag_discont'],
        ...['-f', 'mp4', '-y', out],
      ]);
      expect(result.code, result.stderr).toBe(0);
      const summary = readFmp4(readFileSync(out));
      const video = summary.tracks.find((t) => t.handler === 'vide');
      expect(video).toBeDefined();
      const first = summary.fragments[0];
      expect(first).toBeDefined();
      const startS = fragmentStartS(first as never, video as never) as number;
      expect(Math.abs(startS - k)).toBeLessThan(0.035);
      expect(o.stats.maxOpen).toBe(1);
      expect(o.stats.rejected).toBe(0);
    });
  }
});
