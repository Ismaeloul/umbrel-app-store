/* Cliente del motor principal contra el motor falso (test/fake-engine) y
   contra servidores que se portan mal (arquitectura §5.5; B-001 a B-003,
   B-216). El motor falso comparte el FakeClock del backend: los plazos se
   vencen avanzando el reloj, sin esperar de verdad. */

import { describe, expect, it, vi } from 'vitest';
import { ENGINE_MAX_BODY_BYTES, TIMEOUTS } from '@ace/shared';
import { demoContentId, contentIdToInfohash } from '../../../test/fake-engine/catalog.js';
import { createTestCore, FakeClock } from '../../../test/helpers/index.js';
import type { DiagnosticReport } from '../../core/bus.js';
import { createEngineClient } from './client.js';
import { sendJson, startFakeEngine, startHttpServer } from './test-support.js';
import type { ServerResponse, IncomingMessage } from 'node:http';

const CHANNEL = demoContentId(1);
const CHANNEL_IH = contentIdToInfohash(CHANNEL);

function clientFor(baseUrl: string, clock = new FakeClock()) {
  const core = createTestCore({ clock });
  const reports: DiagnosticReport[] = [];
  core.bus.on('diagnostics.report', (report) => reports.push(report));
  const observer = { onStat: vi.fn(), onStatTimeout: vi.fn() };
  const client = createEngineClient({
    clock,
    logger: core.logger,
    bus: core.bus,
    baseUrl,
    observer,
  });
  return { clock, core, client, reports, observer };
}

async function withEngine(options: Parameters<typeof startFakeEngine>[1] = {}) {
  const clock = new FakeClock();
  const engine = await startFakeEngine(clock, options);
  return { engine, ...clientFor(engine.url, clock) };
}

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = await startHttpServer(handler);
  return { server, ...clientFor(server.url) };
}

describe('meta de sesión con format=json (B-001, B-002)', () => {
  it('progresivo por Content ID: getstream?id=…&format=json y URL relativas', async () => {
    const { engine, client } = await withEngine();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'progressive' });
    expect(meta.playbackUrl).toMatch(new RegExp(`^/ace/r/${CHANNEL_IH}/[0-9a-f]+$`));
    expect(meta.statUrl).toMatch(new RegExp(`^/ace/stat/${CHANNEL_IH}/`));
    expect(meta.commandUrl).toMatch(new RegExp(`^/ace/cmd/${CHANNEL_IH}/`));
    expect(meta).toMatchObject({ infohash: CHANNEL_IH, isLive: true });
    const [session] = engine.control.sessions();
    expect(session).toMatchObject({ requestedAs: 'id', kind: 'progressive', state: 'active' });
    expect(engine.control.metrics().requestsByRoute.getstream).toBe(1);
  });

  it('HLS por infohash (lo que viene del buscador): manifest.m3u8?infohash=…', async () => {
    const { engine, client } = await withEngine();
    const meta = await client.openSession({
      hash: CHANNEL_IH.toUpperCase(),
      kind: 'infohash',
      mode: 'hls',
    });
    expect(meta.playbackUrl).toMatch(new RegExp(`^/ace/m/${CHANNEL_IH}/[0-9a-f]+\\.m3u8$`));
    expect(engine.control.sessions()[0]).toMatchObject({ requestedAs: 'infohash', kind: 'hls' });
    expect(engine.control.metrics().requestsByRoute.manifest).toBe(1);
  });

  it('contenido que no carga → source_no_peers (no es culpa del motor)', async () => {
    const { engine, client } = await withEngine({ unknownContent: 'fail' });
    await expect(
      client.openSession({ hash: 'e'.repeat(40), kind: 'id', mode: 'hls' }),
    ).rejects.toMatchObject({ code: 'source_no_peers' });
    await engine.control.setMode(CHANNEL, 'failedContent');
    await expect(
      client.openSession({ hash: CHANNEL, kind: 'id', mode: 'progressive' }),
    ).rejects.toMatchObject({ code: 'source_no_peers' });
  });

  it('un hash mal formado ni llega al motor', async () => {
    const { engine, client } = await withEngine();
    await expect(
      client.openSession({ hash: 'nada', kind: 'id', mode: 'hls' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(engine.control.metrics().requestsByRoute.manifest ?? 0).toBe(0);
  });

  it('motor colgado: engine_timeout a los 12 s', async () => {
    const { engine, client, clock } = await withEngine();
    await engine.control.setMode('*', 'stall');
    const pending = client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    const outcome = expect(pending).rejects.toMatchObject({ code: 'engine_timeout' });
    clock.advance(TIMEOUTS.engineSessionMetaMs - 1);
    await Promise.resolve();
    clock.advance(1);
    await outcome;
  });

  it('motor caído (conexión rechazada o 503) → engine_unavailable', async () => {
    const { engine, client } = await withEngine();
    await engine.control.setMode(CHANNEL, { kind: 'down', how: '503' });
    await expect(
      client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' }),
    ).rejects.toMatchObject({ code: 'engine_unavailable' });
    await engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await expect(
      client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' }),
    ).rejects.toMatchObject({ code: 'engine_unavailable' });
  });

  it('si quien pide cuelga, se rechaza con SU motivo', async () => {
    const { engine, client } = await withEngine();
    await engine.control.setMode('*', 'stall');
    const controller = new AbortController();
    const pending = client.openSession({
      hash: CHANNEL,
      kind: 'id',
      mode: 'hls',
      signal: controller.signal,
    });
    controller.abort(new Error('client_closed'));
    await expect(pending).rejects.toThrow('client_closed');
    await expect(
      client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls', signal: controller.signal }),
    ).rejects.toThrow('client_closed');
  });

  it.each([
    ['sin JSON', 'no es json', 'engine_bad_response'],
    ['sin response ni error', { response: null }, 'engine_bad_response'],
    ['id inválido', { response: null, error: 'invalid content id' }, 'bad_request'],
    ['sin URL del motor', { response: { playback_url: 'http://x/otra' } }, 'engine_bad_response'],
    ['una lista en vez de objeto', [1, 2], 'engine_bad_response'],
  ])('meta rara (%s) → %s', async (_name, payload, code) => {
    const { client } = await withServer((_req, res) => {
      if (typeof payload === 'string') res.end(payload);
      else sendJson(res, 200, payload);
    });
    await expect(
      client.openSession({ hash: CHANNEL, kind: 'id', mode: 'progressive' }),
    ).rejects.toMatchObject({ code });
  });

  it('is_live ausente o 0, e infohash raro, se toleran', async () => {
    const base = {
      playback_url: '/ace/r/a/b',
      stat_url: '/ace/stat/a/b',
      command_url: '/ace/cmd/a/b',
    };
    const answers = [
      { ...base, is_live: 0, infohash: 'x' },
      { ...base, is_live: true },
      { ...base, is_live: 'quizá' },
    ];
    const { client } = await withServer((_req, res) =>
      sendJson(res, 200, { response: answers.shift(), error: null }),
    );
    const open = () => client.openSession({ hash: CHANNEL, kind: 'id', mode: 'progressive' });
    await expect(open()).resolves.toMatchObject({ isLive: false, infohash: null });
    await expect(open()).resolves.toMatchObject({ isLive: true });
    await expect(open()).resolves.toMatchObject({ isLive: null });
  });
});

describe('estadísticas y parada de la sesión (B-003)', () => {
  it('stat_url se lee y se cuenta al vigilante', async () => {
    const { client, observer } = await withEngine();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    const stat = await client.getStat(meta.statUrl);
    expect(stat).toMatchObject({ peers: 14, speedUp: 0 });
    expect(['dl', 'prebuf']).toContain(stat.status);
    expect(typeof stat.downloaded).toBe('number');
    expect(observer.onStat).toHaveBeenCalledWith(meta.statUrl, stat);
  });

  it('stat de una sesión que ya no existe → session_expired; de fuera del motor → bad_request', async () => {
    const { client } = await withEngine();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    await client.stop(meta.commandUrl);
    await expect(client.getStat(meta.statUrl)).rejects.toMatchObject({ code: 'session_expired' });
    await expect(client.getStat('http://ajeno/nada')).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('stat que no contesta en 3 s → engine_timeout y aviso al vigilante', async () => {
    const { engine, client, clock, observer } = await withEngine();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    await engine.control.setMode('*', 'stall');
    const pending = client.getStat(meta.statUrl);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'engine_timeout' });
    clock.advance(TIMEOUTS.engineStatMs);
    await outcome;
    expect(observer.onStatTimeout).toHaveBeenCalledWith(meta.statUrl);
  });

  it('stat con campos raros: números negativos o ausentes quedan a 0 / null', async () => {
    const { client } = await withServer((_req, res) =>
      sendJson(res, 200, { response: { status: 7, peers: -1, speed_down: 'x', downloaded: -5 } }),
    );
    await expect(client.getStat('/ace/stat/a/b')).resolves.toEqual({
      status: '',
      peers: 0,
      speedDown: 0,
      speedUp: 0,
      downloaded: null,
    });
  });

  it('stop cierra la sesión con command_url&method=stop; una ya cerrada no es un fallo', async () => {
    const { engine, client, reports } = await withEngine();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    await client.stop(`http://motor:6878${meta.commandUrl}`);
    expect(engine.control.metrics()).toMatchObject({ sessionsStopped: 1, sessionsOpen: 0 });
    await client.stop(meta.commandUrl);
    expect(engine.control.metrics().stopsUnknown).toBe(1);
    expect(reports).toEqual([]);
  });

  it('stop nunca lanza: lo que no se deja parar se anota en diagnóstico', async () => {
    const { engine, client, clock, reports } = await withEngine();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    await client.stop('http://ajeno/otra');
    await engine.control.setMode('*', 'stall');
    const stalled = client.stop(meta.commandUrl);
    clock.advance(TIMEOUTS.engineStopMs);
    await expect(stalled).resolves.toBeUndefined();
    await engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await expect(client.stop(meta.commandUrl)).resolves.toBeUndefined();
    expect(reports.map((report) => [report.cause, report.code])).toEqual([
      ['engine', 'engine_stop_failed'],
      ['engine', 'engine_stop_failed'],
      ['engine', 'engine_stop_failed'],
    ]);
    expect(reports[1]?.message).toMatch(/sin respuesta a tiempo/);
  });

  it('stop con respuesta inesperada o fuera de 2xx también se anota', async () => {
    const answers: Array<[number, unknown]> = [
      [500, { response: null }],
      [200, { response: 'no' }],
    ];
    const { client, reports } = await withServer((_req, res) => {
      const [status, payload] = answers.shift() ?? [200, {}];
      sendJson(res, status, payload);
    });
    await client.stop('/ace/cmd/a/b');
    await client.stop('/ace/cmd/a/b');
    expect(reports).toHaveLength(2);
    expect(reports[0]?.message).toMatch(/HTTP 500/);
  });
});

describe('get_version', () => {
  it('da la versión del motor', async () => {
    const { client } = await withEngine();
    await expect(client.version()).resolves.toBe('3.2.3');
    const probe = await client.probeVersion();
    expect(probe).toMatchObject({ ok: true, version: '3.2.3', failure: null });
    expect(JSON.parse(probe.raw)).toMatchObject({ result: { version: '3.2.3' } });
  });

  it('motor caído → engine_unavailable; fuera de 2xx → ok false con su cuerpo', async () => {
    const { engine, client } = await withEngine();
    await engine.control.setMode('*', { kind: 'down', how: '503' });
    const probe = await client.probeVersion();
    expect(probe).toMatchObject({ ok: false, failure: 'http' });
    await expect(client.version()).rejects.toMatchObject({ code: 'engine_unavailable' });
    await engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await expect(client.probeVersion()).resolves.toEqual({
      ok: false,
      raw: '',
      version: null,
      failure: 'network',
    });
  });

  it('3 s de plazo; respuesta sin versión o enorme → engine_bad_response', async () => {
    let mode: 'hang' | 'raro' | 'enorme' = 'hang';
    const { client, clock } = await withServer((_req, res) => {
      if (mode === 'raro') sendJson(res, 200, { result: null });
      else if (mode === 'enorme') res.end('x'.repeat(ENGINE_MAX_BODY_BYTES + 1));
    });
    const pending = client.version();
    const outcome = expect(pending).rejects.toMatchObject({ code: 'engine_timeout' });
    clock.advance(TIMEOUTS.engineVersionMs);
    await outcome;
    mode = 'raro';
    await expect(client.version()).rejects.toMatchObject({ code: 'engine_bad_response' });
    mode = 'enorme';
    await expect(client.version()).rejects.toMatchObject({ code: 'engine_bad_response' });
  });
});

describe('/search del motor (B-216)', () => {
  it('pide /search?query=…&page_size=60 y devuelve el cuerpo tal cual', async () => {
    const { client, engine } = await withEngine();
    const body = await client.searchRaw('Deportes 1');
    const parsed = JSON.parse(body) as { result: { results: unknown[] } };
    expect(parsed.result.results.length).toBeGreaterThan(0);
    expect(engine.control.metrics().requestsByRoute.search).toBe(1);
  });

  it('manda la consulta codificada y page_size=60', async () => {
    const { client, server } = await withServer((_req, res) => sendJson(res, 200, { result: [] }));
    await client.searchRaw('M+ Liga & Campeones');
    expect(server.requests[0]?.url).toBe(
      '/search?query=M%2B%20Liga%20%26%20Campeones&page_size=60',
    );
  });

  it('motor colgado → ace_timeout a los 12 s (el código de siempre, no engine_timeout)', async () => {
    const { engine, client, clock } = await withEngine();
    await engine.control.setMode('*', 'stall');
    const pending = client.searchRaw('Deportes');
    const outcome = expect(pending).rejects.toMatchObject({ code: 'ace_timeout' });
    clock.advance(TIMEOUTS.engineSearchMs);
    await outcome;
  });

  it('sin conexión o fuera de 2xx → engine_unavailable; más de 512 KiB → engine_bad_response', async () => {
    const { engine, client } = await withEngine();
    await engine.control.setMode('*', { kind: 'down', how: '503' });
    await expect(client.searchRaw('Deportes')).rejects.toMatchObject({
      code: 'engine_unavailable',
    });
    await engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await expect(client.searchRaw('Deportes')).rejects.toMatchObject({
      code: 'engine_unavailable',
    });
    const big = await withServer((_req, res) => res.end('x'.repeat(ENGINE_MAX_BODY_BYTES + 10)));
    await expect(big.client.searchRaw('Deportes')).rejects.toMatchObject({
      code: 'engine_bad_response',
    });
  });
});
