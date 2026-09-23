/* Apoyo de los tests del hub SSE: una conexión simulada (sin sockets) con
   lo que el hub usa de `http.ServerResponse`. `stall()` hace que lo escrito
   se quede en el búfer de salida, como un cliente que no lee. */

import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import type { SseSink } from './hub.js';

export class FakeSink extends EventEmitter implements SseSink {
  status: number | null = null;
  headers: Record<string, string> = {};
  readonly chunks: string[] = [];
  writableLength = 0;
  writableEnded = false;
  destroyed = false;
  private stalled = false;
  failWrites = false;

  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  write(chunk: string): boolean {
    if (this.failWrites) throw new Error('EPIPE');
    this.chunks.push(chunk);
    if (this.stalled) this.writableLength += Buffer.byteLength(chunk);
    return !this.stalled;
  }

  end(): this {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }

  /** El cliente deja de leer: lo escrito se acumula. */
  stall(): void {
    this.stalled = true;
  }

  /** El cliente cuelga (como el `close` del socket). */
  hangUp(): void {
    this.destroyed = true;
    this.emit('close');
  }

  text(): string {
    return this.chunks.join('');
  }

  /** Tramas de evento (sin `retry:` ni latidos). */
  events(): { id: number; event: string; data: unknown }[] {
    return this.text()
      .split('\n\n')
      .filter((frame) => frame.startsWith('id: '))
      .map((frame) => {
        const [idLine, eventLine, dataLine] = frame.split('\n') as [string, string, string];
        return {
          id: Number(idLine.slice(4)),
          event: eventLine.slice(7),
          data: JSON.parse(dataLine.slice(6)) as unknown,
        };
      });
  }

  heartbeats(): number {
    return this.chunks.filter((chunk) => chunk === ': ping\n\n').length;
  }
}

/** Un FastifyReply lo justo para `connect`: `hijack`, `getHeaders` y `raw`. */
export function fakeReply(
  sink: FakeSink,
  headers: Record<string, unknown> = { 'x-request-id': 'req-sse' },
): FastifyReply & { hijacked: boolean } {
  const reply = {
    hijacked: false,
    raw: sink,
    hijack() {
      reply.hijacked = true;
      return reply;
    },
    getHeaders: () => headers,
  };
  return reply as unknown as FastifyReply & { hijacked: boolean };
}
