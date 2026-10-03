/* Relé de la IPTV (docs/iptv.md §6.1) contra un origen de pega local: el
   relé sigue él mismo las redirecciones, aplana la maestra, cachea la lista
   1 s, normaliza extensiones, solo escucha en loopback, reconecta con las
   esperas de §6.1 (403/458 cuentan como plaza ocupada y no gastan
   variantes) y prueba otra variante antes de dar la IPTV por caída. Con el
   proveedor falso y el ffmpeg del sistema: lo que sale de la puerta TS tras
   un empalme a mitad de GOP se decodifica sin un solo error. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock, createSystemClock } from '../../core/clock.js';
import { createSilentLogger } from '../../core/logger.js';
import { createNetClient } from '../net/index.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import { TsMuxer, colorFromSeed, generateSegment } from '../../../test/fake-engine/mpegts.js';
import {
  FAKE_IPTV_HOST,
  fakeIptvResolver,
  fakeIptvTransport,
} from '../../../test/fake-iptv/net.js';
import {
  FAKE_IPTV_PASSWORD,
  FAKE_IPTV_USER,
  createFakeIptv,
  type FakeIptvMode,
} from '../../../test/fake-iptv/provider.js';
import { createIptvRelay, type IptvRelayImpl, type RelayDeps } from './relay.js';
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

async function rig(extra: Partial<RelayDeps> = {}): Promise<Rig> {
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
    ...extra,
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

/* TS al paso del reloj falso: el PCR sigue al reloj, así una reconexión que
   sigue la misma línea de tiempo (`startSec`) empalma sin saltos. */
function clockStream(res: http.ServerResponse, clock: FakeClock, startSec: number): () => void {
  const muxer = new TsMuxer({
    video: 'h264',
    audio: ['aac'],
    bitrateKbps: 1500,
    startSec,
    color: colorFromSeed('ab'),
  });
  const packetsPerSec = 1_500_000 / (188 * 8);
  const t0 = clock.now();
  let sent = 200;
  if (!res.headersSent) res.writeHead(200, { 'content-type': 'video/mp2t' });
  res.write(muxer.nextPackets(sent));
  const timer = setInterval(() => {
    if (res.destroyed) return;
    const want = 200 + Math.floor(((clock.now() - t0) / 1000) * packetsPerSec);
    if (want > sent) res.write(muxer.nextPackets(want - sent));
    sent = Math.max(sent, want);
  }, 10);
  res.once('close', () => clearInterval(timer));
  return () => {
    clearInterval(timer);
    res.destroy();
  };
}

const NULL_PACKET = (() => {
  const packet = Buffer.alloc(188, 0xff);
  packet.set([0x47, 0x1f, 0xff, 0x10]);
  return packet;
})();

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const variant = (path: string, entryId = 'a'.repeat(40)) => ({
  entryId,
  url: `http://${HOST}${path}`,
  headers: { 'User-Agent': 'VLC/3.0.21 LibVLC/3.0.21' },
});

describe('refresco de la URL con un 404 (token M3U)', () => {
  it('en el directo se refresca una vez; con Range (VOD) no se toca la lista', async () => {
    const asked: string[] = [];
    const r = await rig({
      refreshRef: async (entryId) => {
        asked.push(entryId);
        return null;
      },
    });
    r.setHandler((_req, res) => res.writeHead(404).end());
    const variant = { entryId: 'e1', url: `http://${HOST}/canal.ts`, headers: {} };
    await expect(r.relay.connect(variant, new AbortController().signal, [])).rejects.toThrow();
    expect(asked).toEqual(['e1']);
    await expect(
      r.relay.connect(variant, new AbortController().signal, [], { range: { start: 0, end: 99 } }),
    ).rejects.toThrow();
    expect(asked).toEqual(['e1']);
  });
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

/* Lista de medios en directo: `count` segmentos desde `seq`. */
function mediaList(
  seq: number,
  options: {
    readonly count?: number;
    readonly td?: number;
    readonly token?: string;
    readonly name?: string;
    readonly discontinuity?: number;
    readonly endList?: boolean;
  } = {},
): string {
  const td = options.td ?? 2;
  const lines = ['#EXTM3U', `#EXT-X-TARGETDURATION:${td}`, `#EXT-X-MEDIA-SEQUENCE:${seq}`];
  if (options.discontinuity !== undefined) {
    lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${options.discontinuity}`);
  }
  for (let i = 0; i < (options.count ?? 5); i += 1) {
    const token = options.token ? `?t=${options.token}` : '';
    lines.push(`#EXTINF:${td},`, `${options.name ?? 'seg'}${seq + i}.ts${token}`);
  }
  if (options.endList) lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

interface HlsRig {
  readonly r: Rig;
  readonly session: Awaited<ReturnType<IptvRelayImpl['open']>>;
  readonly restarts: number[];
  readonly dropped: string[];
  /** Pasa `ms` de reloj y ffmpeg pide la lista (con `text` como lista del proveedor). */
  step(text: string, ms?: number): Promise<string>;
}

async function hlsRig(first: string): Promise<HlsRig> {
  const r = await rig();
  let current = first;
  r.setHandler((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/media.m3u8')) {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end(current);
      return;
    }
    if (/^\/\w+\d+\.ts/.test(url)) {
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.end(
        generateSegment({
          video: 'h264',
          audio: ['aac'],
          bitrateKbps: 1500,
          startSec: 0,
          endSec: 1,
          color: colorFromSeed('cd'),
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  const session = await r.relay.open({ variants: [variant('/media.m3u8')] });
  const restarts: number[] = [];
  const dropped: string[] = [];
  session.onRestart(() => restarts.push(1));
  session.onDropped((code) => dropped.push(code));
  return {
    r,
    session,
    restarts,
    dropped,
    async step(text, ms = 1_100) {
      current = text;
      r.clock.advance(ms);
      const listed = await relayGet(session.inputUrl);
      expect(listed.status).toBe(200);
      return listed.body.toString('utf8');
    },
  };
}

describe('relé HLS: lista que se atrasa, se reinicia o se congela', () => {
  it('un borde del CDN que alterna N y N−2 no reinicia: se sigue sirviendo la lista buena', async () => {
    const h = await hlsRig(mediaList(100));
    let good = '';
    for (let k = 1; k <= 12; k += 1) {
      const lagging = k % 2 === 0;
      const served = await h.step(mediaList(lagging ? 100 + k - 2 : 100 + k));
      if (lagging) expect(served).toBe(good);
      else good = served;
    }
    expect(h.restarts).toEqual([]);
    expect(h.dropped).toEqual([]);
    await h.session.close();
  });

  it('un balanceador al 50 %: tres o cuatro atrasadas seguidas en pocos segundos no reinician', async () => {
    const h = await hlsRig(mediaList(100));
    let seq = 101;
    for (let round = 0; round < 4; round += 1) {
      seq += 1;
      const good = await h.step(mediaList(seq));
      for (let k = 0; k < 4; k += 1) expect(await h.step(mediaList(seq - 2))).toBe(good);
    }
    expect(h.restarts).toEqual([]);
    expect(h.dropped).toEqual([]);
    await h.session.close();
  });

  it('atrasada más de lo que tarda un borde en ponerse al día ((2 + 1) × 2 s) sí es un reinicio (uno)', async () => {
    const h = await hlsRig(mediaList(100));
    await h.step(mediaList(102));
    await h.step(mediaList(100), 2_500);
    await h.step(mediaList(100), 2_500);
    await h.step(mediaList(100), 2_500);
    expect(h.restarts).toEqual([]);
    await h.step(mediaList(100), 2_500);
    expect(h.restarts).toEqual([1]);
    await h.step(mediaList(101));
    expect(h.restarts).toEqual([1]);
    await h.session.close();
  });

  it('el codificador empieza de 0 con otros segmentos: exactamente un reinicio y el segmento 0 se sirve', async () => {
    const h = await hlsRig(mediaList(500));
    await h.step(mediaList(501));
    const served = await h.step(mediaList(0, { name: 'nuevo' }));
    expect(h.restarts).toEqual([1]);
    expect(served).toContain(`/r/${h.session.ticket}/s/0.ts`);
    await h.step(mediaList(1, { name: 'nuevo' }));
    await h.step(mediaList(2, { name: 'nuevo' }));
    expect(h.restarts).toEqual([1]);
    const base = h.session.inputUrl.replace('index.m3u8', '');
    const segment = await relayGet(`${base}s/2.ts`, { maxBytes: 5_000_000 });
    expect(segment.status).toBe(200);
    expect(h.r.requests).toContain('/nuevo2.ts');
    expect(h.dropped).toEqual([]);
    await h.session.close();
  });

  it('DISCONTINUITY-SEQUENCE: hacia delante no es nada; hacia atrás, reinicio', async () => {
    const h = await hlsRig(mediaList(100, { discontinuity: 4 }));
    await h.step(mediaList(101, { discontinuity: 5 }));
    expect(h.restarts).toEqual([]);
    await h.step(mediaList(102, { discontinuity: 0 }));
    expect(h.restarts).toEqual([1]);
    await h.session.close();
  });

  it('lista congelada más de 15 s: un solo onDropped (aunque la lista siga llegando)', async () => {
    const h = await hlsRig(mediaList(100));
    for (let k = 0; k < 13; k += 1) await h.step(mediaList(100));
    expect(h.dropped).toEqual([]);
    for (let k = 0; k < 8; k += 1) await h.step(mediaList(100));
    expect(h.dropped).toEqual(['iptv_dropped']);
    await h.session.close();
  });

  it('con TARGETDURATION 10, el plazo es 3 duraciones (30 s)', async () => {
    const h = await hlsRig(mediaList(100, { td: 10 }));
    for (let k = 0; k < 25; k += 1) await h.step(mediaList(100, { td: 10 }));
    expect(h.dropped).toEqual([]);
    for (let k = 0; k < 5; k += 1) await h.step(mediaList(100, { td: 10 }));
    expect(h.dropped).toEqual(['iptv_dropped']);
    await h.session.close();
  });

  it('tokens que cambian en cada petición con la secuencia avanzando: nada', async () => {
    const h = await hlsRig(mediaList(100, { token: 'x0' }));
    for (let k = 1; k <= 30; k += 1) {
      await h.step(mediaList(100 + Math.floor(k / 3), { token: `x${k}` }));
    }
    expect(h.restarts).toEqual([]);
    expect(h.dropped).toEqual([]);
    await h.session.close();
  });

  it('una lista con ENDLIST que no cambia: nada', async () => {
    const h = await hlsRig(mediaList(0, { endList: true }));
    for (let k = 0; k < 30; k += 1) await h.step(mediaList(0, { endList: true }));
    expect(h.restarts).toEqual([]);
    expect(h.dropped).toEqual([]);
    await h.session.close();
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

  it('el primer trozo de la reconexión sin PCR y el segundo más tarde: la reconexión acaba y ffmpeg vuelve a recibir', async () => {
    const r = await rig();
    let opens = 0;
    let cut: (() => void) | null = null;
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      if (opens === 1) {
        cut = clockStream(res, r.clock, 0);
        return;
      }
      /* Diez paquetes nulos (sin PCR) y, un rato después, el TS normal. */
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.write(Buffer.concat(Array.from({ length: 10 }, () => NULL_PACKET)));
      setTimeout(() => {
        if (!res.destroyed) clockStream(res, r.clock, 1);
      }, 150);
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
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
    await tick(30);
    await r.clock.advanceAsync(1_000);
    await waitFor('reconectado', () => opens === 2);
    const internals = session as unknown as { reconnecting: boolean };
    await waitFor('reconexión terminada', () => !internals.reconnecting, 3_000);
    const before = received;
    for (let step = 0; step < 20 && received < before + 20_000; step += 1) {
      await tick(30);
      await r.clock.advanceAsync(200);
    }
    expect(received).toBeGreaterThan(before + 20_000);
    expect(dropped).toEqual([]);
    ffmpeg.destroy();
    await session.close();
  });

  it('el primer trozo de la reconexión sin PCR y ninguno más: la sonda vence y `reconnecting` vuelve a false', async () => {
    const r = await rig();
    let opens = 0;
    let cut: (() => void) | null = null;
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      if (opens === 1) {
        cut = clockStream(res, r.clock, 0);
        return;
      }
      /* Diez paquetes nulos y silencio con la conexión abierta. */
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.write(Buffer.concat(Array.from({ length: 10 }, () => NULL_PACKET)));
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    /* Sin el plazo de inactividad de `net` (60 s): solo el de la sonda puede desatascarla. */
    const net = r.relay.deps.net as { openStream: typeof r.relay.deps.net.openStream };
    const openStream = net.openStream.bind(net);
    net.openStream = (url, options) => openStream(url, { ...options, idleMs: 60_000 });
    let received = 0;
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => (received += c.length)),
    );
    ffmpeg.on('error', () => undefined);
    await waitFor('bytes', () => received > 10_000);
    const internals = session as unknown as {
      reconnecting: boolean;
      adopt: (opened: unknown, force: boolean) => Promise<void>;
    };
    let adopted = 0;
    const originalAdopt = internals.adopt.bind(session);
    internals.adopt = async (opened, force) => {
      try {
        await originalAdopt(opened, force);
      } finally {
        adopted += 1;
      }
    };
    (cut as unknown as () => void)();
    await waitFor('corte visto', () => r.relay.connections() === 0);
    await tick(30);
    await r.clock.advanceAsync(1_000);
    await waitFor('reconectado', () => opens === 2);
    await tick(50);
    expect(internals.reconnecting).toBe(true);
    /* Sin más bytes: el plazo de la sonda (idleMs) la corta. */
    for (let step = 0; step < 12 && !adopted; step += 1) {
      await tick(20);
      await r.clock.advanceAsync(1_000);
    }
    expect(adopted).toBe(1);
    await waitFor('reconnecting a false', () => !internals.reconnecting, 3_000);
    /* Se adoptó la conexión (tiene bytes y sigue abierta): ni otra apertura ni relé sin proveedor. */
    expect(opens).toBe(2);
    expect(r.relay.connections()).toBe(1);
    ffmpeg.destroy();
    await session.close();
  });

  it('la reconexión manda unos paquetes sin PCR y se cierra: cuenta como intento fallido y se vuelve a reconectar', async () => {
    const r = await rig();
    let opens = 0;
    let cut: (() => void) | null = null;
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      if (opens === 2) {
        res.writeHead(200, { 'content-type': 'video/mp2t' });
        res.end(Buffer.concat(Array.from({ length: 10 }, () => NULL_PACKET)));
        return;
      }
      cut = clockStream(res, r.clock, opens === 1 ? 0 : 3);
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
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
    for (let step = 0; step < 30 && opens < 3; step += 1) {
      await tick(30);
      await r.clock.advanceAsync(1_000);
    }
    expect(opens).toBe(3);
    const internals = session as unknown as { reconnecting: boolean };
    await waitFor('reconexión terminada', () => !internals.reconnecting, 3_000);
    await waitFor('con proveedor', () => r.relay.connections() === 1);
    const before = received;
    for (let step = 0; step < 20 && received < before + 20_000; step += 1) {
      await tick(30);
      await r.clock.advanceAsync(200);
    }
    expect(received).toBeGreaterThan(before + 20_000);
    expect(dropped).toEqual([]);
    ffmpeg.destroy();
    await session.close();
  });

  it('tope largo: 12 reconexiones buenas en 10 min y la decimotercera caída es onDropped', async () => {
    const r = await rig();
    let opens = 0;
    let cut: (() => void) | null = null;
    const t0 = r.clock.now();
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      cut = clockStream(res, r.clock, Math.floor((r.clock.now() - t0) / 1000));
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    let received = 0;
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => (received += c.length)),
    );
    ffmpeg.on('error', () => undefined);
    await waitFor('bytes', () => received > 10_000);
    for (let round = 0; round < 13; round += 1) {
      const opensBefore = opens;
      (cut as unknown as () => void)();
      await waitFor('corte visto', () => r.relay.connections() === 0);
      await tick(20);
      if (round === 12) break;
      await r.clock.advanceAsync(1_000);
      await waitFor(`reconexión ${round + 1}`, () => opens === opensBefore + 1);
      /* 21 s de emisión sana: el presupuesto corto vuelve, el largo no. */
      for (let step = 0; step < 3; step += 1) {
        await tick(20);
        await r.clock.advanceAsync(7_000);
      }
      await tick(20);
      expect(dropped).toEqual([]);
    }
    await waitFor('onDropped', () => dropped.length > 0);
    expect(dropped).toEqual(['iptv_dropped']);
    expect(opens).toBe(13);
    ffmpeg.destroy();
    await session.close();
  });

  it('una espera nueva de la puerta empieza su plazo de 4 s desde cero (el de la espera de antes no vale)', async () => {
    const r = await rig();
    /* PAT y PMT, y luego solo paquetes con PCR (sin vídeo): la puerta no sale de la espera. */
    const psi = new TsMuxer({
      video: 'h264',
      audio: ['aac'],
      bitrateKbps: 1500,
      startSec: 0,
      color: colorFromSeed('ab'),
    }).nextPackets(2);
    const pcrPacket = Buffer.alloc(188, 0xff);
    pcrPacket.set([0x47, 0x01, 0x00, 0x20, 183, 0x10, 0, 0, 0, 0, 0x7e, 0]);
    let opens = 0;
    let cut: (() => void) | null = null;
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.write(Buffer.concat([psi, pcrPacket]));
      const timer = setInterval(() => {
        if (!res.destroyed) res.write(pcrPacket);
      }, 20);
      res.once('close', () => clearInterval(timer));
      cut = () => {
        clearInterval(timer);
        res.destroy();
      };
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) => res.resume());
    ffmpeg.on('error', () => undefined);
    const gate = (session as unknown as { gate: { mode: string; waits: number } }).gate;
    await waitFor('ffmpeg enganchado', () => r.relay.connections() === 1);
    await tick(30);
    /* t0: plazo armado. A los 2 s se corta; a los 3 s reconecta (espera nueva). */
    await r.clock.advanceAsync(2_000);
    (cut as unknown as () => void)();
    await waitFor('corte visto', () => r.relay.connections() === 0);
    await tick(20);
    await r.clock.advanceAsync(1_000);
    await waitFor('reconectado', () => opens === 2 && gate.waits === 2);
    await tick(30);
    /* t0 + 5 s: el plazo viejo (t0 + 4 s) ya no cuenta. */
    await r.clock.advanceAsync(2_000);
    await tick(20);
    expect(gate.mode).toBe('waitRap');
    /* t0 + 7,1 s: vence el de la espera nueva. */
    await r.clock.advanceAsync(2_100);
    await waitFor('se deja pasar todo', () => gate.mode === 'pass');
    ffmpeg.destroy();
    await session.close();
  });

  it('cortes a los 0, 20, 40 y 60 s con emisión sana entre medias: 5 aperturas, siempre 1 s de espera y nunca onDropped', async () => {
    const r = await rig();
    let opens = 0;
    let cut: (() => void) | null = null;
    const t0 = r.clock.now();
    r.setHandler((req, res) => {
      if (req.url !== '/live/1.ts') return void res.writeHead(404).end();
      opens += 1;
      cut = clockStream(res, r.clock, Math.floor((r.clock.now() - t0) / 1000));
    });
    const session = await r.relay.open({ variants: [variant('/live/1.ts')] });
    const dropped: string[] = [];
    session.onDropped((code) => dropped.push(code));
    const restarts: number[] = [];
    session.onRestart(() => restarts.push(1));
    let received = 0;
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => (received += c.length)),
    );
    ffmpeg.on('error', () => undefined);
    await waitFor('bytes', () => received > 10_000);
    for (let round = 0; round < 4; round += 1) {
      if (round > 0) {
        /* 21 s de emisión sana, segundo a segundo. */
        for (let second = 0; second < 21; second += 1) {
          await tick(15);
          await r.clock.advanceAsync(1_000);
        }
        await tick(30);
      }
      const opensBefore = opens;
      (cut as unknown as () => void)();
      await waitFor('corte visto', () => r.relay.connections() === 0);
      await tick(30);
      /* La espera es de 1 s: a los 999 ms todavía no se ha reconectado. */
      await r.clock.advanceAsync(999);
      await tick(50);
      expect(opens).toBe(opensBefore);
      await r.clock.advanceAsync(1);
      await waitFor(`reconexión ${round + 1}`, () => opens === opensBefore + 1);
      const before = received;
      for (let step = 0; step < 20 && received < before + 10_000; step += 1) {
        await tick(20);
        await r.clock.advanceAsync(100);
      }
      expect(received).toBeGreaterThan(before + 10_000);
    }
    expect(opens).toBe(5);
    expect(dropped).toEqual([]);
    expect(restarts).toEqual([]);
    ffmpeg.destroy();
    await session.close();
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

const HAS_FFMPEG =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

/* PTS (o DTS) de los paquetes de un tipo de flujo, según ffprobe. */
function probeTimes(file: string, stream: 'v' | 'a'): number[] {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      stream,
      '-show_entries',
      'packet=pts',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  );
  expect(probe.status).toBe(0);
  return probe.stdout
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
}

/* Lo que el relé manda a ffmpeg durante `ms` con el proveedor falso en `mode` (reloj de verdad). */
async function capture(mode: FakeIptvMode, ms: number): Promise<{ data: Buffer; opens: number }> {
  const host = await loopbackHost();
  const provider = await createFakeIptv({ host, publicHost: FAKE_IPTV_HOST });
  const clock = createSystemClock();
  const net = createNetClient({
    ...createTestCore(),
    clock,
    resolver: fakeIptvResolver(),
    transport: fakeIptvTransport({ host, port: provider.port }),
  });
  const relay = createIptvRelay({
    clock,
    logger: createSilentLogger(),
    net,
    policy: () => ({ lan: false }),
    host: host === '::1' ? '::1' : '127.0.0.1',
  });
  try {
    await relay.start();
    provider.modo(107, mode);
    const session = await relay.open({
      variants: [
        {
          entryId: 'c'.repeat(40),
          url: `http://${FAKE_IPTV_HOST}/live/${FAKE_IPTV_USER}/${FAKE_IPTV_PASSWORD}/107.ts`,
          headers: {},
        },
      ],
    });
    const dropped: string[] = [];
    const restarts: number[] = [];
    session.onDropped((code) => dropped.push(code));
    session.onRestart(() => restarts.push(1));
    const chunks: Buffer[] = [];
    const ffmpeg = http.get(session.inputUrl, { agent: false }, (res) =>
      res.on('data', (c: Buffer) => chunks.push(c)),
    );
    ffmpeg.on('error', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, ms));
    ffmpeg.destroy();
    await session.close();
    expect(dropped).toEqual([]);
    expect(restarts).toEqual([]);
    const opens = provider.peticionesDeStream().length;
    return { data: Buffer.concat(chunks), opens };
  } finally {
    await relay.stop();
    await provider.close();
  }
}

/* Recorta al último inicio de PES de vídeo (lo de detrás está a medias). */
function trimToLastVideoStart(data: Buffer): Buffer {
  let end = data.length - (data.length % 188);
  for (let offset = end - 188; offset >= 0; offset -= 188) {
    const pid = ((data[offset + 1]! & 0x1f) << 8) | data[offset + 2]!;
    if (pid === 0x100 && (data[offset + 1]! & 0x40) !== 0) {
      end = offset;
      break;
    }
  }
  return data.subarray(0, end);
}

describe.skipIf(!HAS_FFMPEG)('relé TS + puerta con ffmpeg de verdad', () => {
  const cases: readonly [FakeIptvMode, string][] = [
    ['empalme:2:prebuffer=1.5', 'reconexión a mitad de GOP que repite 1,5 s'],
    ['cut-mid-packet:2', 'corte a mitad de paquete TS'],
  ];
  for (const [mode, label] of cases) {
    it(`${label}: ffmpeg -xerror lo decodifica entero y el PTS del vídeo y del audio solo avanza`, async () => {
      const { data, opens } = await capture(mode, 5_500);
      expect(opens).toBe(2);
      const dir = mkdtempSync(path.join(os.tmpdir(), 'ace-ts-gate-'));
      try {
        const file = path.join(dir, 'in.ts');
        writeFileSync(file, trimToLastVideoStart(data));
        const decode = spawnSync(
          'ffmpeg',
          ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'],
          { encoding: 'utf8' },
        );
        expect(decode.stderr).toBe('');
        expect(decode.status).toBe(0);
        for (const stream of ['v', 'a'] as const) {
          const times = probeTimes(file, stream);
          expect(times.length).toBeGreaterThan(20);
          for (let i = 1; i < times.length; i += 1) {
            expect(times[i]!).toBeGreaterThan(times[i - 1]!);
          }
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 20_000);
  }
});
