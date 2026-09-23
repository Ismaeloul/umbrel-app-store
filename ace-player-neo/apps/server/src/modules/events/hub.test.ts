/* Tests del hub SSE (plan E1.7; arquitectura §5.13 y §7.4). Módulo nuevo en
   la 0.7.0: no hay T-xxx de la 0.6.59. Conexiones simuladas (FakeSink) y
   reloj falso. B-005: el traspaso se avisa al momento (antes, sondeo de 5 s). */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  SSE_BUFFER_EVENTS,
  SSE_MAX_BUFFERED_BYTES,
  SSE_TIMINGS,
  type SseEvent,
  type SseEventData,
} from '@ace/shared';
import { createTestCore } from '../../../test/helpers/index.js';
import { createLogger } from '../../core/logger.js';
import { FORWARDED_EVENTS, SSE_HEADERS, createHub } from './hub.js';
import { FakeSink, fakeReply } from './test-support.js';
import type { SseConnectOptions } from './types.js';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SID = 's_SesionDePrueba01';

function setup(options: { logger?: ReturnType<typeof createLogger> } = {}) {
  const core = createTestCore(options.logger ? { logger: options.logger } : {});
  const hub = createHub(core);
  return { core, hub };
}

type Setup = ReturnType<typeof setup>;

function open(
  ctx: Setup,
  options: Partial<Omit<SseConnectOptions, 'signal'>> & { signal?: AbortSignal } = {},
) {
  const sink = new FakeSink();
  const controller = new AbortController();
  const closed = ctx.hub.connect(fakeReply(sink), {
    origin: options.origin ?? 'web',
    deviceId: options.deviceId ?? null,
    lastEventId: options.lastEventId ?? null,
    signal: options.signal ?? controller.signal,
  });
  return { sink, controller, closed };
}

function stateChanged(ctx: Setup): SseEventData<'state.changed'> {
  return { scopes: ['library'], at: ctx.core.clock.date().toISOString() };
}

function handoff(): SseEventData<'playback.handoff'> {
  return {
    sessionId: SID,
    viewerIds: ['viewer_1'],
    byDeviceId: 'dev_otro',
    byClient: 'ios',
    hash: HASH,
    title: 'DAZN 1',
    reason: 'other_channel',
  };
}

describe('events · conexión y formato (arquitectura §5.13)', () => {
  it('hijack, cabeceras SSE con el X-Request-Id y retry: 3000 al empezar', () => {
    const ctx = setup();
    const sink = new FakeSink();
    const reply = fakeReply(sink);
    void ctx.hub.connect(reply, {
      origin: 'web',
      deviceId: null,
      lastEventId: null,
      signal: new AbortController().signal,
    });
    expect(reply.hijacked).toBe(true);
    expect(sink.status).toBe(200);
    expect(sink.headers).toEqual({ 'x-request-id': 'req-sse', ...SSE_HEADERS });
    expect(sink.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(sink.chunks[0]).toBe(`retry: ${SSE_TIMINGS.retryMs}\n\n`);
    expect(ctx.hub.connections()).toBe(1);
  });

  it('cada evento del bus sale con id creciente, event y data JSON', () => {
    const ctx = setup();
    const { sink } = open(ctx);
    ctx.core.bus.emit('state.changed', stateChanged(ctx));
    ctx.core.bus.emit('devices.changed', { reason: 'paired', deviceId: 'dev_x' });
    const events = sink.events();
    expect(events.map((event) => event.event)).toEqual(['state.changed', 'devices.changed']);
    const first = ctx.hub.firstEventId();
    expect(events.map((event) => event.id)).toEqual([first, first + 1]);
    expect(events[1]?.data).toEqual({ reason: 'paired', deviceId: 'dev_x' });
    expect(sink.text()).toContain(
      `id: ${first}\nevent: state.changed\ndata: ${JSON.stringify(stateChanged(ctx))}\n\n`,
    );
    expect(ctx.hub.lastEventId()).toBe(first + 1);
  });

  it('los ids empiezan en la hora de creación: un proceso nuevo siempre da ids mayores', () => {
    const ctx = setup();
    expect(ctx.hub.firstEventId()).toBe(ctx.core.clock.now());
    expect(ctx.hub.lastEventId()).toBe(ctx.core.clock.now() - 1);
  });

  it('reenvía todos los eventos del bus que tienen esquema SSE', () => {
    const ctx = setup();
    for (const type of FORWARDED_EVENTS) {
      expect(ctx.core.bus.listenerCount(type)).toBeGreaterThanOrEqual(1);
    }
    expect(ctx.core.bus.listenerCount('scan.jobDone')).toBe(0);
    expect(ctx.core.bus.listenerCount('playback.activity')).toBe(0);
  });

  it('un evento que no cumple su esquema no se envía, no gasta id y queda en el log', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'trace',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    });
    const ctx = setup({ logger });
    const { sink } = open(ctx);
    ctx.core.bus.emit('state.changed', { scopes: [], at: 'ayer' });
    ctx.hub.publish({ type: 'no.existe', data: {} } as unknown as SseEvent);
    expect(sink.events()).toEqual([]);
    expect(ctx.hub.lastEventId()).toBe(ctx.hub.firstEventId() - 1);
    expect(lines.join('')).toContain('no cumple su esquema');
  });

  it('B-005 · el traspaso (playback.handoff) llega al momento a todas las conexiones', () => {
    const ctx = setup();
    const web = open(ctx, { origin: 'web', deviceId: 'web_tab_1' });
    const ios = open(ctx, { origin: 'native', deviceId: 'dev_iphone01' });
    ctx.core.bus.emit('playback.handoff', handoff());
    /* Síncrono: al volver de emit ya está escrito, sin esperar a ningún sondeo. */
    expect(web.sink.events()).toEqual([
      expect.objectContaining({ event: 'playback.handoff', data: handoff() }),
    ]);
    expect(ios.sink.events()).toHaveLength(1);
  });
});

describe('events · latido', () => {
  it('": ping" cada 15 s mientras haya conexiones; sin conexiones no queda temporizador', () => {
    const ctx = setup();
    expect(ctx.core.clock.pendingTimers()).toBe(0);
    const { sink, controller } = open(ctx);
    const other = open(ctx);
    expect(ctx.core.clock.pendingTimers()).toBe(1);
    ctx.core.clock.advance(SSE_TIMINGS.heartbeatMs - 1);
    expect(sink.heartbeats()).toBe(0);
    ctx.core.clock.advance(1);
    expect(sink.heartbeats()).toBe(1);
    expect(other.sink.heartbeats()).toBe(1);
    ctx.core.clock.advance(SSE_TIMINGS.heartbeatMs * 2);
    expect(sink.heartbeats()).toBe(3);
    controller.abort();
    other.controller.abort();
    expect(ctx.hub.connections()).toBe(0);
    expect(ctx.core.clock.pendingTimers()).toBe(0);
  });
});

describe('events · reanudación con Last-Event-ID (búfer de 200)', () => {
  it('reenvía solo lo que falta', () => {
    const ctx = setup();
    for (let index = 0; index < 3; index += 1)
      ctx.core.bus.emit('state.changed', stateChanged(ctx));
    const first = ctx.hub.firstEventId();
    const { sink } = open(ctx, { lastEventId: first });
    expect(sink.events().map((event) => event.id)).toEqual([first + 1, first + 2]);
    const upToDate = open(ctx, { lastEventId: first + 2 });
    expect(upToDate.sink.events()).toEqual([]);
  });

  it('"nada visto de este proceso" (primer id - 1) recibe todo el búfer', () => {
    const ctx = setup();
    ctx.core.bus.emit('state.changed', stateChanged(ctx));
    const { sink } = open(ctx, { lastEventId: ctx.hub.firstEventId() - 1 });
    expect(sink.events()).toHaveLength(1);
    const empty = setup();
    const none = open(empty, { lastEventId: empty.hub.firstEventId() - 1 });
    expect(none.sink.events()).toEqual([]);
  });

  it('solo guarda 200: si lo que falta ya no está, resync buffer_miss con el último id', () => {
    const ctx = setup();
    for (let index = 0; index < SSE_BUFFER_EVENTS + 50; index += 1) {
      ctx.core.bus.emit('state.changed', stateChanged(ctx));
    }
    expect(ctx.hub.bufferedEvents()).toBe(SSE_BUFFER_EVENTS);
    const first = ctx.hub.firstEventId();
    const late = open(ctx, { lastEventId: first + 10 });
    expect(late.sink.events()).toEqual([
      { id: ctx.hub.lastEventId(), event: 'resync', data: { reason: 'buffer_miss' } },
    ]);
    const justInTime = open(ctx, { lastEventId: first + 49 });
    expect(justInTime.sink.events()).toHaveLength(SSE_BUFFER_EVENTS);
  });

  it('un id del futuro da resync unknown_event_id; uno de antes de arrancar, server_restart', () => {
    const ctx = setup();
    ctx.core.bus.emit('state.changed', stateChanged(ctx));
    const future = open(ctx, { lastEventId: ctx.hub.lastEventId() + 5 });
    expect(future.sink.events()).toEqual([
      { id: ctx.hub.lastEventId(), event: 'resync', data: { reason: 'unknown_event_id' } },
    ]);
    const previous = open(ctx, { lastEventId: 42 });
    expect(previous.sink.events()).toEqual([
      { id: ctx.hub.lastEventId(), event: 'resync', data: { reason: 'server_restart' } },
    ]);
  });

  it('la reanudación respeta el mismo filtro que en vivo', () => {
    const ctx = setup();
    ctx.core.bus.emit('devices.changed', { reason: 'paired', deviceId: 'dev_x' });
    ctx.hub.publish({ type: 'state.changed', data: stateChanged(ctx) }, { deviceIds: ['dev_b'] });
    ctx.core.bus.emit('state.changed', stateChanged(ctx));
    const since = ctx.hub.firstEventId() - 1;
    const ios = open(ctx, { origin: 'native', deviceId: 'dev_a', lastEventId: since });
    expect(ios.sink.events().map((event) => event.id)).toEqual([ctx.hub.firstEventId() + 2]);
    const iosB = open(ctx, { origin: 'native', deviceId: 'dev_b', lastEventId: since });
    expect(iosB.sink.events()).toHaveLength(2);
    const web = open(ctx, { origin: 'web', lastEventId: since });
    expect(web.sink.events().map((event) => event.event)).toEqual([
      'devices.changed',
      'state.changed',
    ]);
  });
});

describe('events · filtro por origen y dispositivo', () => {
  it('devices.changed (administración) solo va al origen web', () => {
    const ctx = setup();
    const web = open(ctx, { origin: 'web' });
    const ios = open(ctx, { origin: 'native', deviceId: 'dev_a' });
    ctx.core.bus.emit('devices.changed', { reason: 'paired', deviceId: 'dev_z' });
    expect(web.sink.events()).toHaveLength(1);
    expect(ios.sink.events()).toEqual([]);
  });

  it('un evento con destino solo llega a las conexiones de esos dispositivos', () => {
    const ctx = setup();
    const a = open(ctx, { origin: 'native', deviceId: 'dev_a' });
    const b = open(ctx, { origin: 'native', deviceId: 'dev_b' });
    const anonymous = open(ctx, { origin: 'web', deviceId: null });
    ctx.hub.publish({ type: 'playback.handoff', data: handoff() }, { deviceIds: ['dev_b'] });
    expect(a.sink.events()).toEqual([]);
    expect(b.sink.events()).toHaveLength(1);
    expect(anonymous.sink.events()).toEqual([]);
  });

  it('del bus: targetDeviceIds se usa como destino y no llega al cliente', () => {
    const ctx = setup();
    const a = open(ctx, { origin: 'native', deviceId: 'dev_a' });
    const b = open(ctx, { origin: 'web', deviceId: 'tab_b' });
    const payload = {
      sessionId: SID,
      viewerIds: ['viewer_1'],
      reason: 'released',
      targetDeviceIds: ['tab_b'],
    } as unknown as SseEventData<'stream.closed'>;
    ctx.core.bus.emit('stream.closed', payload);
    expect(a.sink.events()).toEqual([]);
    expect(b.sink.events()).toEqual([
      expect.objectContaining({
        event: 'stream.closed',
        data: { sessionId: SID, viewerIds: ['viewer_1'], reason: 'released' },
      }),
    ]);
    /* Un targetDeviceIds sin forma se ignora (va a todos). */
    ctx.core.bus.emit('stream.closed', {
      ...payload,
      targetDeviceIds: 'tab_b',
    } as unknown as SseEventData<'stream.closed'>);
    expect(a.sink.events()).toHaveLength(1);
  });
});

describe('events · cierre, revocación y contrapresión', () => {
  it('un cliente lento (más de 256 KiB sin leer) se cierra y el resto sigue', () => {
    const ctx = setup();
    const slow = open(ctx);
    const fast = open(ctx);
    slow.sink.stall();
    let sent = 0;
    while (!slow.sink.destroyed && sent < 10_000) {
      ctx.hub.publish({
        type: 'state.changed',
        data: { scopes: ['library', 'preferences', 'directories'], at: `2026-01-01T00:00:00.000Z` },
      });
      sent += 1;
    }
    expect(slow.sink.destroyed).toBe(true);
    expect(slow.sink.writableLength).toBeGreaterThan(SSE_MAX_BUFFERED_BYTES);
    expect(ctx.hub.connections()).toBe(1);
    expect(fast.sink.events()).toHaveLength(sent);
    return slow.closed;
  });

  it('si escribir falla, la conexión se cierra', async () => {
    const ctx = setup();
    const broken = open(ctx);
    broken.sink.failWrites = true;
    ctx.core.bus.emit('state.changed', stateChanged(ctx));
    await broken.closed;
    expect(ctx.hub.connections()).toBe(0);
  });

  it('devices.changed revoked cierra las conexiones de ese dispositivo', async () => {
    const ctx = setup();
    const revoked = open(ctx, { origin: 'native', deviceId: 'dev_a' });
    const other = open(ctx, { origin: 'native', deviceId: 'dev_b' });
    const web = open(ctx, { origin: 'web' });
    ctx.core.bus.emit('devices.changed', { reason: 'revoked', deviceId: 'dev_a' });
    await revoked.closed;
    expect(revoked.sink.writableEnded).toBe(true);
    expect(ctx.hub.connections()).toBe(2);
    expect(web.sink.events()).toEqual([
      expect.objectContaining({ data: { reason: 'revoked', deviceId: 'dev_a' } }),
    ]);
    expect(other.sink.destroyed).toBe(false);
    ctx.hub.closeDevice('dev_b');
    await other.closed;
  });

  it('el cliente cuelga (close del socket o señal abortada): se suelta', async () => {
    const ctx = setup();
    const hungUp = open(ctx);
    hungUp.sink.hangUp();
    await hungUp.closed;
    const aborted = open(ctx);
    aborted.controller.abort();
    await aborted.closed;
    expect(aborted.sink.destroyed).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const already = open(ctx, { signal: controller.signal });
    await already.closed;
    expect(ctx.hub.connections()).toBe(0);
  });

  it('closeAll (apagado) termina todas las respuestas; stop además se da de baja del bus', async () => {
    const ctx = setup();
    const a = open(ctx);
    const b = open(ctx, { origin: 'native', deviceId: 'dev_a' });
    ctx.hub.closeAll();
    await Promise.all([a.closed, b.closed]);
    expect(a.sink.writableEnded && b.sink.writableEnded).toBe(true);
    await ctx.hub.start();
    await ctx.hub.stop();
    expect(ctx.core.bus.listenerCount('state.changed')).toBe(0);
    await ctx.hub.start();
    await ctx.hub.start();
    expect(ctx.core.bus.listenerCount('state.changed')).toBe(1);
  });

  it('extraHeaders solo copia textos y números', () => {
    const ctx = setup();
    const sink = new FakeSink();
    void ctx.hub.attach(
      sink,
      { origin: 'web', deviceId: null, lastEventId: null, signal: new AbortController().signal },
      { 'x-request-id': 'r1', 'x-numero': 3, raro: ['a'] },
    );
    expect(sink.headers).toEqual({ 'x-request-id': 'r1', 'x-numero': '3', ...SSE_HEADERS });
    void ctx.hub.attach(sink, {
      origin: 'web',
      deviceId: null,
      lastEventId: null,
      signal: new AbortController().signal,
    });
    expect(sink.headers).toEqual(SSE_HEADERS);
  });
});
