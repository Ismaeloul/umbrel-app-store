/* El transporte HTTP del comprobador: peticiones de control con tope y
   plazo, muestra con redirecciones solo al motor, y ffprobe con lanzador
   inyectado (server.js:2862-3134). */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../core/clock.js';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { createFakeEngine, type FakeEngine } from '../../../test/fake-engine/engine.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import { scannerEnginePath } from './evidence.js';
import { flushIo, pumpUntil, tickUntil } from './test-support.js';
import {
  createHttpScannerTransport,
  mediaFromFfprobe,
  type ProbeProcess,
  type ProbeSpawner,
} from './transport.js';

let clock: FakeClock;
let engine: FakeEngine;

beforeAll(async () => {
  clock = new FakeClock();
  engine = await createFakeEngine({ clock, host: await loopbackHost() });
});

afterAll(async () => {
  await engine.close();
});

function http(extra: Partial<Parameters<typeof createHttpScannerTransport>[0]> = {}) {
  return createHttpScannerTransport({ host: engine.host, port: engine.port, clock, ...extra });
}

async function openSession(id: string): Promise<{ playback: string; command: string }> {
  const meta = await http().request(`/ace/getstream?id=${id}&format=json`, 5000);
  const response = (JSON.parse(meta.body) as { response: Record<string, string> }).response;
  return {
    playback: scannerEnginePath(response.playback_url),
    command: `${scannerEnginePath(response.command_url)}&method=stop`,
  };
}

/** Proceso hijo de mentira para ffprobe. */
function child(behaviour: { stdout?: (string | Buffer)[]; error?: string; hang?: boolean } = {}): {
  spawn: ProbeSpawner;
  killed: () => number;
} {
  let kills = 0;
  const spawn: ProbeSpawner = () => {
    const events = new EventEmitter();
    const stdout = new EventEmitter();
    const proc = {
      stdout,
      exitCode: null as number | null,
      on(event: string, listener: (...args: unknown[]) => void) {
        events.on(event, listener);
        return proc;
      },
      kill() {
        kills += 1;
        return true;
      },
    };
    queueMicrotask(() => {
      if (behaviour.error) {
        events.emit('error', Object.assign(new Error('fallo'), { code: behaviour.error }));
        return;
      }
      for (const chunk of behaviour.stdout ?? []) stdout.emit('data', chunk);
      if (behaviour.hang) return;
      proc.exitCode = 0;
      events.emit('close');
    });
    return proc as unknown as ProbeProcess;
  };
  return { spawn, killed: () => kills };
}

describe('peticiones de control (scannerRequest, B-017)', () => {
  it('lee la respuesta del motor con fetch', async () => {
    const result = await http().request('/webui/api/service?method=get_version', 3000);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).result.version).toBe('3.2.3');
    expect(result.headers?.['content-type']).toContain('application/json');
  });

  it('más de 512 KiB: scanner_response_too_large', async () => {
    const big = new Uint8Array(600 * 1024);
    const transport = http({ fetch: async () => new Response(big) });
    await expect(transport.request('/x', 1000)).rejects.toMatchObject({
      code: 'scanner_response_too_large',
    });
  });

  it('sin cuerpo, cuerpo vacío; un error de red sale tal cual', async () => {
    const empty = http({ fetch: async () => new Response(null, { status: 204 }) });
    await expect(empty.request('/x', 1000)).resolves.toMatchObject({ statusCode: 204, body: '' });
    const broken = http({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(broken.request('/x', 1000)).rejects.toThrow('fetch failed');
  });

  it('el plazo (reloj falso) y la señal de corte dan scanner_timeout', async () => {
    const hanging = http({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new Error('AbortError'));
          init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        }),
    });
    await expect(tickUntil(clock, hanging.request('/x', 1500), 3000)).rejects.toMatchObject({
      code: 'scanner_timeout',
    });
    const controller = new AbortController();
    const pending = hanging.request('/x', 60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'scanner_timeout' });
    const already = new AbortController();
    already.abort();
    await expect(hanging.request('/x', 60_000, already.signal)).rejects.toMatchObject({
      code: 'scanner_timeout',
    });
  });
});

describe('muestra del vídeo (sampleScannerStream, B-020, B-021)', () => {
  it('sigue la redirección del motor a /content y lee el TS', async () => {
    const session = await openSession(demoContentId(1));
    const result = await pumpUntil(clock, http().sample(session.playback, 13_500, 131_072, 4000));
    expect(result).toMatchObject({ statusCode: 200, reason: 'enough_data', videoCodec: 'h264' });
    expect(result.contentType).toBe('video/mp2t');
    expect(result.bytes).toBeGreaterThan(64 * 1024);
    expect(result.audioCodecs).toEqual(['aac']);
    await http().request(session.command, 2500);
  });

  it('con redirecciones absolutas en http:// (el motor real) también llega', async () => {
    await engine.control.setMode(demoContentId(3), 'redirectHttp');
    const session = await openSession(demoContentId(3));
    const result = await pumpUntil(clock, http().sample(session.playback, 13_500, 131_072, 4000));
    expect(result).toMatchObject({ statusCode: 200, videoCodec: 'h264', audioCodecs: ['mp2'] });
    await engine.control.clearMode(demoContentId(3));
    await http().request(session.command, 2500);
  });

  it('una redirección fuera de /ace/ o /content/ no se sigue', async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.end('HTTP/1.1 302 Found\r\nLocation: http://otro/fuera\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>((resolve) => server.listen(0, engine.host, resolve));
    const { port } = server.address() as net.AddressInfo;
    const result = await pumpUntil(
      clock,
      createHttpScannerTransport({ host: engine.host, port, clock }).sample(
        '/ace/r/x',
        2000,
        1,
        1000,
      ),
    );
    expect(result).toMatchObject({ statusCode: 302, bytes: 0 });
    expect(['ended', 'timeout']).toContain(result.reason);
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it('nadie escuchando: request_error; corte desde fuera: timeout', async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, engine.host, resolve));
    const { port } = probe.address() as net.AddressInfo;
    await new Promise((resolve) => probe.close(resolve));
    const refused = createHttpScannerTransport({ host: engine.host, port, clock });
    const result = await pumpUntil(clock, refused.sample('/ace/r/x', 5000, 1, 1000));
    expect(result).toMatchObject({ reason: 'request_error', bytes: 0, statusCode: 0 });

    await engine.control.setMode(demoContentId(2), 'noPeers');
    const session = await openSession(demoContentId(2));
    const controller = new AbortController();
    const pending = http().sample(session.playback, 60_000, 1, 1000, controller.signal);
    await flushIo();
    controller.abort();
    await expect(pending).resolves.toMatchObject({ reason: 'timeout', bytes: 0 });
    const aborted = new AbortController();
    aborted.abort();
    await expect(http().sample('/ace/r/x', 1000, 1, 1000, aborted.signal)).resolves.toMatchObject({
      reason: 'timeout',
    });
    await engine.control.clearMode(demoContentId(2));
    await http().request(session.command, 2500);
  });

  it('una conexión que se corta a mitad termina la muestra con lo que llegó', async () => {
    await engine.control.setMode(demoContentId(5), { kind: 'cut', afterBytes: 40_000 });
    const session = await openSession(demoContentId(5));
    const result = await pumpUntil(clock, http().sample(session.playback, 13_500, 131_072, 4000));
    expect(['stream_error', 'ended']).toContain(result.reason);
    expect(result.bytes).toBeLessThanOrEqual(40_000);
    await engine.control.clearMode(demoContentId(5));
    await http().request(session.command, 2500);
  });
});

describe('ffprobe (inspectScannerMedia)', () => {
  const streams = (...list: [string, string][]) =>
    JSON.stringify({
      streams: list.map(([type, name]) => ({ codec_type: type, codec_name: name })),
    });

  it('H.264 se ve en el navegador; HEVC no; sin vídeo, no_video', async () => {
    const h264 = child({
      stdout: [streams(['video', 'H264'], ['audio', 'aac'], ['audio', 'aac'])],
    });
    await expect(http({ spawn: h264.spawn }).inspect('/ace/r/x', 5000)).resolves.toEqual({
      mediaValid: true,
      browserCompatible: true,
      videoCodec: 'h264',
      audioCodecs: ['aac'],
      mediaReason: 'playable_media',
    });
    const hevc = child({ stdout: [Buffer.from(streams(['video', 'hevc']))] });
    await expect(http({ spawn: hevc.spawn }).inspect('/ace/r/x', 5000)).resolves.toMatchObject({
      mediaReason: 'unsupported_codec',
      browserCompatible: false,
    });
    const audio = child({ stdout: ['{"streams":[{"codec_type":"audio","codec_name":"mp2"}]}'] });
    await expect(http({ spawn: audio.spawn }).inspect('/ace/r/x', 5000)).resolves.toMatchObject({
      mediaValid: false,
      mediaReason: 'no_video',
    });
  });

  it('sin ffprobe, error, colgado o cortado: probe_unavailable, probe_error y probe_timeout', async () => {
    const missing = child({ error: 'ENOENT' });
    await expect(http({ spawn: missing.spawn }).inspect('/ace/r/x', 5000)).resolves.toMatchObject({
      mediaReason: 'probe_unavailable',
    });
    const failing = child({ error: 'EACCES' });
    await expect(http({ spawn: failing.spawn }).inspect('/ace/r/x', 5000)).resolves.toMatchObject({
      mediaReason: 'probe_error',
    });
    const throwing: ProbeSpawner = () => {
      throw new Error('spawn');
    };
    await expect(http({ spawn: throwing }).inspect('/ace/r/x', 5000)).resolves.toMatchObject({
      mediaReason: 'probe_unavailable',
    });
    await expect(http().inspect('/fuera', 5000)).resolves.toMatchObject({
      mediaReason: 'probe_unavailable',
    });
    const hanging = child({ stdout: ['{"streams":'], hang: true });
    const result = await tickUntil(
      clock,
      http({ spawn: hanging.spawn }).inspect('/ace/r/x', 10),
      5000,
    );
    expect(result.mediaReason).toBe('probe_timeout');
    expect(hanging.killed()).toBe(1);
    const cut = child({ hang: true });
    const controller = new AbortController();
    const pending = http({ spawn: cut.spawn }).inspect('/ace/r/x', 5000, controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ mediaReason: 'probe_timeout' });
  });

  it('la salida se lee como la 0.6.59: JSON roto, 8 audios como máximo', () => {
    expect(mediaFromFfprobe('no es json').mediaReason).toBe('no_video');
    expect(mediaFromFfprobe('').mediaReason).toBe('no_video');
    const many = Array.from({ length: 12 }, (_, n) => ({
      codec_type: 'audio',
      codec_name: `a${n}`,
    }));
    const result = mediaFromFfprobe(
      JSON.stringify({ streams: [null, { codec_type: 'video', codec_name: 'h264' }, ...many] }),
    );
    expect(result.audioCodecs).toHaveLength(8);
  });
});
