/* Hub SSE (arquitectura §5.13 y §7.4). Módulo nuevo en la 0.7.0: la 0.6.59
   no tenía tiempo real y los clientes sondeaban /api/playback cada 5 s
   (B-005: el traspaso tardaba hasta 5 s en verse).

   - Cable: `retry: 3000` al conectar; cada evento `id: <n>` creciente,
     `event: <tipo>` y `data: <JSON>` validado con SseEventSchema; latido
     `: ping` cada 15 s mientras haya alguna conexión (un solo temporizador).
   - Ids: empiezan en `clock.now()` al crear el hub. Así los de un proceso
     nuevo siempre son mayores que los del anterior y un `Last-Event-ID` de
     antes de un reinicio se reconoce (`resync` con `server_restart`) en vez
     de confundirse con uno de este proceso.
   - Reanudación: búfer circular de 200 eventos. Con `Last-Event-ID` se
     reenvía lo que falte (con el mismo filtro que en vivo) o, si ya no está,
     un `resync` (`buffer_miss`, `unknown_event_id` o `server_restart`) con el
     id del último evento, para que el cliente recargue y siga desde ahí.
   - Filtro: `devices.changed` solo al origen web; un evento con destino
     (`deviceIds`) solo a las conexiones de esos dispositivos; lo demás, a
     todos. Los eventos de visor (`stream.*`, `playback.handoff`) llegan del
     bus sin dispositivo: van a todos y cada cliente se queda con sus
     `viewerIds` (lo dice el esquema). Si el bus trae `targetDeviceIds`, se
     usa como destino y se quita antes de validar.
   - Contrapresión: si tras escribir el búfer de salida de una conexión pasa
     de 256 KiB, se cierra (destroy) y el cliente reconecta con su
     `Last-Event-ID`.
   - `devices.changed` con `revoked` cierra las conexiones de ese dispositivo. */

import type { FastifyReply } from 'fastify';
import {
  SSE_BUFFER_EVENTS,
  SSE_HEARTBEAT_FRAME,
  SSE_MAX_BUFFERED_BYTES,
  SSE_TIMINGS,
  SseEventSchema,
  WEB_ONLY_EVENT_TYPES,
  encodeSseEvent,
  type Origin,
  type SseEvent,
  type SseEventType,
} from '@ace/shared';
import type { DomainEventType, Unsubscribe } from '../../core/bus.js';
import type { TimerHandle } from '../../core/clock.js';
import type { EventsDeps, EventsHub, SseConnectOptions } from './types.js';

/** Lo mínimo de `http.ServerResponse` que usa el hub (los tests pasan uno falso). */
export interface SseSink {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): unknown;
  destroy(error?: Error): unknown;
  readonly writableLength: number;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
  once(event: 'close', listener: () => void): unknown;
}

/** Por qué se cierra una conexión (va al log). */
export type CloseReason = 'client' | 'backpressure' | 'error' | 'revoked' | 'shutdown';

/** Eventos del bus que se reenvían tal cual a los clientes (tienen esquema SSE). */
export const FORWARDED_EVENTS = [
  'playback.nowPlaying',
  'playback.handoff',
  'playback.sessions',
  'stream.ready',
  'stream.reopened',
  'stream.modeChanged',
  'stream.closed',
  'stream.stats',
  'engine.status',
  'scan.progress',
  'scan.verdict',
  'state.changed',
  'diagnostics.new',
  'devices.changed',
] as const satisfies readonly (DomainEventType & SseEventType)[];

/** Cabeceras de la respuesta SSE (el hijack se salta onSend: se ponen aquí las de siempre). */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  /* nginx no debe acumular la respuesta: cada evento sale al momento. */
  'x-accel-buffering': 'no',
};

interface BufferedEvent {
  readonly id: number;
  readonly frame: string;
  readonly webOnly: boolean;
  readonly deviceIds: ReadonlySet<string> | null;
}

interface Connection {
  readonly id: number;
  readonly origin: Origin;
  readonly deviceId: string | null;
  readonly sink: SseSink;
  closed: boolean;
  detach: () => void;
  done: () => void;
}

export interface EventsHubInternal extends EventsHub {
  /** Engancha una salida ya preparada (lo que hace `connect` tras el hijack). */
  attach(
    sink: SseSink,
    options: SseConnectOptions,
    extraHeaders?: Record<string, unknown>,
  ): Promise<void>;
  /** Id del último evento publicado (`firstId - 1` si aún no hay ninguno). */
  lastEventId(): number;
  /** Id que llevará el primer evento de este proceso. */
  firstEventId(): number;
  /** Eventos que quedan en el búfer de reanudación. */
  bufferedEvents(): number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function createHub(deps: EventsDeps): EventsHubInternal {
  const { clock, logger, bus } = deps;
  const firstId = Math.max(1, Math.floor(clock.now()));
  let nextId = firstId;
  let nextConnectionId = 1;
  const buffer: BufferedEvent[] = [];
  const connections = new Set<Connection>();
  let heartbeat: TimerHandle | null = null;
  let subscriptions: Unsubscribe[] = [];

  function matches(connection: Connection, event: BufferedEvent): boolean {
    if (event.webOnly && connection.origin !== 'web') return false;
    if (event.deviceIds) {
      return connection.deviceId !== null && event.deviceIds.has(connection.deviceId);
    }
    return true;
  }

  function stopHeartbeat(): void {
    clock.clearInterval(heartbeat);
    heartbeat = null;
  }

  function ensureHeartbeat(): void {
    if (heartbeat || connections.size === 0) return;
    heartbeat = clock.setInterval(
      () => {
        for (const connection of [...connections]) write(connection, SSE_HEARTBEAT_FRAME);
      },
      SSE_TIMINGS.heartbeatMs,
      { unref: true },
    );
  }

  function close(connection: Connection, reason: CloseReason): void {
    if (connection.closed) return;
    connection.closed = true;
    connections.delete(connection);
    connection.detach();
    const { sink } = connection;
    if (!sink.destroyed) {
      if (reason === 'backpressure' || reason === 'error' || reason === 'client') sink.destroy();
      else if (!sink.writableEnded) sink.end();
    }
    if (connections.size === 0) stopHeartbeat();
    logger.debug(
      { connection: connection.id, deviceId: connection.deviceId, reason },
      'SSE: conexión cerrada',
    );
    connection.done();
  }

  function write(connection: Connection, frame: string): void {
    if (connection.closed) return;
    try {
      connection.sink.write(frame);
    } catch (error) {
      logger.debug({ err: error, connection: connection.id }, 'SSE: no se pudo escribir');
      close(connection, 'error');
      return;
    }
    const buffered = connection.sink.writableLength;
    if (buffered > SSE_MAX_BUFFERED_BYTES) {
      logger.warn(
        { connection: connection.id, deviceId: connection.deviceId, buffered },
        'SSE: cliente demasiado lento, se cierra la conexión',
      );
      close(connection, 'backpressure');
    }
  }

  function lastIssued(): number {
    return nextId - 1;
  }

  function replay(connection: Connection, lastEventId: number): void {
    const last = lastIssued();
    const oldest = buffer[0]?.id ?? nextId;
    let reason: 'buffer_miss' | 'unknown_event_id' | 'server_restart' | null = null;
    if (lastEventId > last) reason = 'unknown_event_id';
    else if (lastEventId < firstId - 1) reason = 'server_restart';
    else if (lastEventId < oldest - 1) reason = 'buffer_miss';
    if (reason) {
      write(connection, encodeSseEvent(last, { type: 'resync', data: { reason } }));
      return;
    }
    for (const event of buffer) {
      if (event.id > lastEventId && matches(connection, event)) write(connection, event.frame);
    }
  }

  function publish(event: SseEvent, target?: { readonly deviceIds?: readonly string[] }): void {
    const parsed = SseEventSchema.safeParse(event);
    if (!parsed.success) {
      logger.error(
        {
          event: (event as { type?: unknown } | null)?.type,
          issues: parsed.error.issues.slice(0, 5),
        },
        'SSE: evento que no cumple su esquema, no se envía',
      );
      return;
    }
    const valid = parsed.data;
    const id = nextId;
    nextId += 1;
    const entry: BufferedEvent = {
      id,
      frame: encodeSseEvent(id, valid),
      webOnly: WEB_ONLY_EVENT_TYPES.has(valid.type),
      deviceIds: target?.deviceIds ? new Set(target.deviceIds) : null,
    };
    buffer.push(entry);
    if (buffer.length > SSE_BUFFER_EVENTS) buffer.shift();
    for (const connection of [...connections]) {
      if (matches(connection, entry)) write(connection, entry.frame);
    }
  }

  function closeDevice(deviceId: string): void {
    for (const connection of [...connections]) {
      if (connection.deviceId === deviceId) close(connection, 'revoked');
    }
  }

  /** Del bus al cable: quita `targetDeviceIds` (si viene) y lo usa como destino. */
  function forward(type: (typeof FORWARDED_EVENTS)[number], payload: unknown): void {
    let data = payload;
    let target: { deviceIds: readonly string[] } | undefined;
    if (payload && typeof payload === 'object' && 'targetDeviceIds' in payload) {
      const { targetDeviceIds, ...rest } = payload as Record<string, unknown>;
      data = rest;
      if (isStringArray(targetDeviceIds)) target = { deviceIds: targetDeviceIds };
    }
    publish({ type, data } as SseEvent, target);
    if (type === 'devices.changed') {
      const change = payload as { reason?: unknown; deviceId?: unknown };
      if (change.reason === 'revoked' && typeof change.deviceId === 'string') {
        closeDevice(change.deviceId);
      }
    }
  }

  function subscribe(): void {
    if (subscriptions.length > 0) return;
    subscriptions = FORWARDED_EVENTS.map((type) =>
      bus.on(type, (payload: unknown) => forward(type, payload)),
    );
  }

  function closeAll(): void {
    for (const connection of [...connections]) close(connection, 'shutdown');
    stopHeartbeat();
  }

  function attach(
    sink: SseSink,
    options: SseConnectOptions,
    extraHeaders: Record<string, unknown> = {},
  ): Promise<void> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(extraHeaders)) {
      if (typeof value === 'string' || typeof value === 'number') headers[name] = String(value);
    }
    sink.writeHead(200, { ...headers, ...SSE_HEADERS });

    return new Promise<void>((resolve) => {
      const onAbort = (): void => close(connection, 'client');
      const connection: Connection = {
        id: nextConnectionId++,
        origin: options.origin,
        deviceId: options.deviceId,
        sink,
        closed: false,
        detach: () => options.signal.removeEventListener('abort', onAbort),
        done: resolve,
      };
      connections.add(connection);
      if (options.signal.aborted) {
        close(connection, 'client');
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
      sink.once('close', () => close(connection, 'client'));
      logger.debug(
        { connection: connection.id, origin: connection.origin, deviceId: connection.deviceId },
        'SSE: conexión abierta',
      );
      write(connection, `retry: ${SSE_TIMINGS.retryMs}\n\n`);
      if (options.lastEventId !== null) replay(connection, options.lastEventId);
      ensureHeartbeat();
    });
  }

  /* Suscrito desde que existe: los eventos anteriores al arranque (por
     ejemplo, el primer estado del motor) quedan en el búfer de reanudación. */
  subscribe();

  return {
    async start() {
      subscribe();
    },
    async stop() {
      for (const off of subscriptions) off();
      subscriptions = [];
      closeAll();
    },
    connect(reply: FastifyReply, options: SseConnectOptions) {
      reply.hijack();
      return attach(reply.raw as unknown as SseSink, options, reply.getHeaders());
    },
    attach,
    publish,
    connections: () => connections.size,
    closeDevice,
    closeAll,
    lastEventId: lastIssued,
    firstEventId: () => firstId,
    bufferedEvents: () => buffer.length,
  };
}
