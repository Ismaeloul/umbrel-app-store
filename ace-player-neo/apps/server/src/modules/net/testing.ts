/* Piezas de test del módulo `net` (no las importa el código de producto):
   un resolvedor DNS de tabla y un transporte falso que responde lo que diga
   cada test y apunta qué se pidió y a qué IP. Así ningún test toca DNS ni
   red. También las usan los tests de `directories`. */

import { Readable } from 'node:stream';
import type {
  NetResolver,
  NetTransport,
  ResolvedAddress,
  TransportRequest,
  TransportResponse,
} from './types.js';

/** Resolvedor de tabla. Un valor función permite respuestas que cambian (DNS rebinding). */
export function tableResolver(
  table: Record<string, readonly ResolvedAddress[] | (() => readonly ResolvedAddress[])>,
): NetResolver & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async lookup(hostname) {
      calls.push(hostname);
      const entry = table[hostname];
      if (!entry) {
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      }
      return typeof entry === 'function' ? entry() : entry;
    },
  };
}

export interface FakeReply {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** Cuerpo entero, o un Readable propio (para cuerpos que se cuelgan o van por trozos). */
  readonly body?: string | Buffer | Readable;
}

export type FakeHandler = (request: TransportRequest) => FakeReply | Promise<FakeReply>;

/** Transporte falso: `routes` por URL exacta (`href`) o una función para todo. */
export function fakeTransport(
  routes: Record<string, FakeReply | FakeHandler> | FakeHandler,
): NetTransport & { readonly requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const transport = async (request: TransportRequest): Promise<TransportResponse> => {
    requests.push(request);
    const route = typeof routes === 'function' ? routes : routes[request.url.href];
    if (!route) return { status: 404, headers: {}, body: Readable.from([]) };
    const reply = typeof route === 'function' ? await route(request) : route;
    const body =
      reply.body instanceof Readable
        ? reply.body
        : Readable.from(reply.body === undefined ? [] : [Buffer.from(reply.body)]);
    return { status: reply.status ?? 200, headers: reply.headers ?? {}, body };
  };
  return Object.assign(transport, { requests });
}

/** Un cuerpo que nunca llega (para la inactividad y el plazo total). */
export function stalledBody(): Readable {
  return new Readable({ read() {} });
}
