/* Relé de la IPTV (docs/iptv.md §6.1) contra un origen de pega local: el
   relé sigue él mismo las redirecciones, aplana la maestra, cachea la lista
   1 s, normaliza extensiones, solo escucha en loopback, reconecta con las
   esperas de §6.1 (403/458 cuentan como plaza ocupada y no gastan
   variantes) y prueba otra variante antes de dar la IPTV por caída. */

import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../core/clock.js';
import { createSilentLogger } from '../../core/logger.js';
import { createNetClient } from '../net/index.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import { TsMuxer, colorFromSeed, generateSegment } from '../../../test/fake-engine/mpegts.js';
import { fakeIptvResolver, fakeIptvTransport } from '../../../test/fake-iptv/net.js';
import { createIptvRelay, type IptvRelayImpl } from './relay.js';
import { relayGet, waitFor } from './test-support.js';

const HOST = 'origen.example';
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

interface Rig {
  readonly relay: IptvRelayImpl;
  readonly clock: FakeClock;
  readonly requests: string[];
  setHandler(handler: Handler): void;
  close(): Promise<void>;
}

const rigs: Rig[] = [];
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.close();
});

async function rig(): Promise<Rig> {
  const host = await loopbackHost();
  const requests: string[] = [];
  let handler: Handler = (_req, res) => res.writeHead(404).end();
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    res.on('error', () => undefined);
    handler(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  const clock = new FakeClock();
  const core = createTestCore({ clock });
  const net = createNetClient({
    ...core,
    resolver: fakeIptvResolver({ hostname: HOST }),
    transport: fakeIptvTransport({ host, port }, { hostname: HOST }),
  });
  const relay = createIptvRelay({
    clock,
    logger: createSilentLogger(),
    net,
    policy: () => ({ lan: false }),
    host: host === '::1' ? '::1' : '127.0.0.1',
  });
  await relay.start();
  const created: Rig = {
    relay,
    clock,
    requests,
    setHandler(next) {
      handler = next;
    },
    async close() {
      await relay.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  rigs.push(created);
  return created;
}

function tsStream(res: http.ServerResponse, startSec = 0): () => void {
  const muxer = new TsMuxer({
    video: 'h264',
    audio: ['aac'],
    bitrateKbps: 1500,
    startSec,
    color: colorFromSeed('ab'),
  });
  res.writeHead(200, { 'content-type': 'video/mp2t' });
  res.write(muxer.nextPackets(200));
  const timer = setInterval(() => {
    if (!res.destroyed) res.write(muxer.nextPackets(40));
  }, 40);
  res.once('close', () => clearInterval(timer));
  return () => {
    clearInterval(timer);
    res.destroy();
  };
}

const variant = (path: string, entryId = 'a'.repeat(40)) => ({
  entryId,
  url: `http://${HOST}${path}`,
  headers: { 'User-Agent': 'VLC/3.0.21 LibVLC/3.0.21' },
});

describe('relé HLS', () => {
  it('aplana la maestra, reescribe con URIs del relé, sigue el 302 de un segmento y cachea la lista 1 s', async () => {
    const r = await rig();
    r.setHandler((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/master.m3u8')) {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        res.end(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nhigh.m3u8?token=t1\n',
        );
      } else if (url.startsWith('/high.m3u8')) {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        res.end(
          '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2,\nseg7.php\n#EXTINF:2,\nseg8.php\n',
        );
      } else if (url === '/seg7.php') {
        res.writeHead(302, { location: `http://${HOST}/cdn/seg7-real` });
        res.end();
      } else if (url === '/cdn/seg7-real') {
        const body = generateSegment({
          video: 'h264',
          audio: ['aac'],
          bitrateKbps: 1500,
          startSec: 0,
          endSec: 2,
          color: colorFromSeed('cd'),
        });
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(body);
      } else res.writeHead(404).end();
    });
    const session = await r.relay.open({ variants: [variant('/master.m3u8')] });
    expect(session.isHls).toBe(true);
    expect(r.requests).toContain('/high.m3u8?token=t1');
    const listed = await relayGet(session.inputUrl);
    const text = listed.body.toString('utf8');
    expect(text).toContain(`/r/${session.ticket}/s/7.ts`);
    expect(text).not.toContain(HOST);
    const again = await relayGet(session.inputUrl);
    expect(again.body.toString('utf8')).toBe(text);
    /* La lista se pidió una vez al abrir; las dos peticiones de ffmpeg salen de la caché (1 s). */
    expect(r.requests.filter((line) => line.startsWith('/high.m3u8'))).toHaveLength(1);
    const base = session.inputUrl.replace('index.m3u8', '');
    const segment = await relayGet(`${base}s/7.ts`, { maxBytes: 5_000_000 });
    expect(segment.status).toBe(200);
    expect(segment.headers.location).toBeUndefined();
    expect(segment.headers['content-type']).toBe('video/mp2t');
    expect(segment.body[0]).toBe(0x47);
    expect(r.requests).toContain('/cdn/seg7-real');
    /* Pasado 1 s de reloj, la lista se vuelve a pedir. */
    r.clock.advance(1_100);
    await relayGet(session.inputUrl);
    expect(r.requests.filter((line) => line.startsWith('/high.m3u8'))).toHaveLength(2);
    await session.close();
  });

  it('ticket inválido → 404; solo escucha en loopback', async () => {
    const r = await rig();
    const port = r.relay.port() as number;
    const host = (await loopbackHost()) === '::1' ? '[::1]' : '127.0.0.1';
    expect((await relayGet(`http://${host}:${port}/r/AAAAAAAAAAAAAAAAAAAAAA/in.ts`)).status).toBe(
      404,
    );
    expect((await relayGet(`http://${host}:${port}/otra/cosa`)).status).toBe(404);
  });
});

describe('relé TS: reconexión (§6.1)', () => {
  it('403/458 al reconectar cuentan como plaza ocupada: se reintenta sin gastar variantes y sin cerrar ffmpeg', async () => {
    const r = await rig();
    let opens = 0;
    let cut: (() => void) | null = null;
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      if (opens === 2) return void res.writeHead(458).end();
      cut = tsStream(res);
    });
    const session = await r.relay.open({
      variants: [variant('/live/1.ts'), variant('/live/2.ts', 'b'.repeat(40))],
    });
    const restarts: number[] = [];
    session.onRestart(() => restarts.push(1));
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    let received = 0;
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => (received += c.length)),
    );
    ffmpeg.on('error', () => undefined);
    await waitFor('bytes', () => received > 10_000);
    (cut as unknown as () => void)();
    await waitFor('corte visto', () => r.relay.connections() === 0);
    /* 1 s → 458 (ocupado); 2 s → abre. */
    for (let step = 0; step < 8 && opens < 3; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await r.clock.advanceAsync(1_000);
    }
    await waitFor('reconectado', () => opens === 3 && r.relay.connections() === 1);
    const before = received;
    await waitFor('siguen llegando bytes al mismo ffmpeg', () => received > before + 10_000);
    expect(r.requests.filter((line) => line === '/live/2.ts')).toEqual([]);
    expect(restarts).toEqual([]);
    expect(dropped).toEqual([]);
    ffmpeg.destroy();
    await session.close();
  });

  it('agotada la variante, prueba la siguiente UNA vez con reinicio del remux; si no, onDropped(iptv_dropped)', async () => {
    const r = await rig();
    let cut: (() => void) | null = null;
    let firstOpen = true;
    r.setHandler((req, res) => {
      if (req.url === '/live/1.ts') {
        if (firstOpen) {
          firstOpen = false;
          cut = tsStream(res);
        } else res.writeHead(503).end();
        return;
      }
      if (req.url === '/live/2.ts') {
        tsStream(res, 500);
        return;
      }
      res.writeHead(404).end();
    });
    const session = await r.relay.open({
      variants: [variant('/live/1.ts'), variant('/live/2.ts', 'b'.repeat(40))],
    });
    const restarts: number[] = [];
    session.onRestart(() => restarts.push(1));
    let received = 0;
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => (received += c.length)),
    );
    ffmpeg.on('error', () => undefined);
    await waitFor('bytes', () => received > 10_000);
    (cut as unknown as () => void)();
    for (let step = 0; step < 20 && !restarts.length; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await r.clock.advanceAsync(1_000);
    }
    expect(restarts).toEqual([1]);
    expect(r.requests.filter((line) => line === '/live/1.ts').length).toBe(4);
    expect(r.requests).toContain('/live/2.ts');
    ffmpeg.destroy();
    await session.close();
  });

  it('firstByteAt es el primer byte ENTREGADO a ffmpeg, no el primero del proveedor', async () => {
    const r = await rig();
    r.setHandler((req, res) =>
      req.url === '/live/1.ts' ? void tsStream(res) : void res.writeHead(404).end(),
    );
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    /* La conexión con el proveedor ya está abierta (y con bytes), pero ffmpeg aún no ha llegado. */
    expect(session.stats().firstByteAt).toBeNull();
    r.clock.advance(7_000);
    const attachedAt = r.clock.now();
    let received = 0;
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => (received += c.length)),
    );
    ffmpeg.on('error', () => undefined);
    await waitFor('bytes', () => received > 0);
    expect(session.stats().firstByteAt).toBe(attachedAt);
    ffmpeg.destroy();
    await session.close();
  });

  it('prepareRestart: la salida de ffmpeg no cierra la conexión; el nuevo recibe antes los últimos bytes, alineados a 188', async () => {
    const r = await rig();
    let opens = 0;
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      tsStream(res);
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    const chunks: Buffer[] = [];
    const first = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => chunks.push(c)),
    );
    first.on('error', () => undefined);
    await waitFor('bytes', () => chunks.reduce((n, c) => n + c.length, 0) > 60_000);
    const seenByFirst = Buffer.concat(chunks);
    const peak: number[] = [];
    const sampler = setInterval(() => peak.push(r.relay.connections()), 5);
    expect(session.prepareRestart()).toBe(true);
    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 80));
    /* Sigue la única conexión con el proveedor. */
    expect(r.relay.connections()).toBe(1);
    const again: Buffer[] = [];
    const second = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => again.push(c)),
    );
    second.on('error', () => undefined);
    await waitFor('bytes al nuevo', () => again.reduce((n, c) => n + c.length, 0) > 20_000);
    clearInterval(sampler);
    const head = Buffer.concat(again);
    /* Empieza en un paquete TS entero... */
    expect(head[0]).toBe(0x47);
    expect(head[188]).toBe(0x47);
    /* ...que ya había recibido el ffmpeg viejo (se vuelve a analizar sin esperar vídeo nuevo). */
    expect(seenByFirst.includes(head.subarray(0, 188 * 4))).toBe(true);
    expect(opens).toBe(1);
    expect(Math.max(...peak)).toBeLessThanOrEqual(1);
    second.destroy();
    await session.close();
    expect(session.prepareRestart()).toBe(false);
  });

  it('alignedTail: los últimos bytes desde el primer paquete TS con sincronía', async () => {
    const { alignedTail } = await import('./relay.js');
    const packet = (n: number) => Buffer.concat([Buffer.from([0x47, n]), Buffer.alloc(186, n)]);
    const stream = Buffer.concat([packet(1), packet(2), packet(3), packet(4), packet(5)]);
    /* Tres trozos arbitrarios; con tope de 3,5 paquetes se queda con los 3 últimos enteros. */
    const tail = alignedTail(
      [stream.subarray(0, 100), stream.subarray(100, 500), stream.subarray(500)],
      188 * 3 + 94,
    );
    expect(tail.length).toBe(188 * 3);
    expect(tail[0]).toBe(0x47);
    expect(tail[1]).toBe(3);
    expect(alignedTail([], 1000).length).toBe(0);
    expect(alignedTail([Buffer.alloc(1000, 1)], 1000).length).toBe(0);
  });

  it('una segunda petición a in.ts → 409 y nunca abre otra conexión', async () => {
    const r = await rig();
    r.setHandler((req, res) =>
      req.url === '/live/1.ts' ? void tsStream(res) : void res.writeHead(404).end(),
    );
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) => res.resume());
    ffmpeg.on('error', () => undefined);
    await waitFor('conectado', () => r.requests.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await relayGet(session.inputUrl)).status).toBe(409);
    expect(r.requests.filter((line) => line === '/live/1.ts')).toHaveLength(1);
    ffmpeg.destroy();
    await session.close();
  });

  it('al abrir: ocupado con plaza recién cerrada → reintentos 2-4-8 s; 401 → iptv_gone sin variantes si es la única', async () => {
    const r = await rig();
    let opens = 0;
    r.setHandler((req, res) => {
      if (req.url === '/live/1.ts') {
        opens += 1;
        if (opens < 3) return void res.writeHead(429).end();
        return void tsStream(res);
      }
      res.writeHead(401).end();
    });
    const opening = r.relay.open({
      variants: [variant('/live/1.ts')],
      busyRetryMs: [2000, 4000, 8000],
    });
    for (let step = 0; step < 10 && opens < 3; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await r.clock.advanceAsync(2_000);
    }
    const session = await opening;
    expect(opens).toBe(3);
    await session.close();
    await expect(r.relay.open({ variants: [variant('/live/9.ts')] })).rejects.toMatchObject({
      code: 'iptv_gone',
    });
  });
});
