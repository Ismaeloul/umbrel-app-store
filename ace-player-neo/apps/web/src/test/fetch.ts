/* fetch simulado para los tests (MSW no está instalado y no hace falta).

     const net = mockFetch({
       'GET /api/v1/engine/status': fixture('engineStatus'),
       'POST /api/v1/library': (request) => json(fixture('libraryMutate')),
       'GET /api/v1/football': () => json({ error: { code: 'engine_unavailable', message: '…', requestId: 'r1' } }, 503),
     });
     ...
     expect(net.calls[0]?.url).toBe('/api/v1/engine/status');

   Las claves son «MÉTODO ruta» sin la query; el valor es la respuesta (se
   manda como JSON 200) o una función que recibe la petición. Lo que no está
   en la tabla responde 404 con el error v1 de `not_found`. */

import { setFetch } from '../api/client.ts';

export interface MockCall {
  method: string;
  url: string;
  body: unknown;
  headers: Headers;
  signal: AbortSignal | null;
}

type Handler = (call: MockCall) => Response | Promise<Response>;
/** Una función que contesta, o el cuerpo JSON que se manda con 200. */
type Responder = Handler | Record<string, unknown> | unknown[] | string | number | boolean | null;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Ejemplo de packages/shared/fixtures/v1/<ruta>.json. */
const FIXTURES = import.meta.glob<unknown>('@fixtures/v1/*.json', {
  eager: true,
  import: 'default',
});
export function fixture<T = unknown>(route: string): T {
  const entry = Object.entries(FIXTURES).find(([file]) => file.endsWith(`/${route}.json`));
  if (!entry) throw new Error(`No hay ejemplo para «${route}»`);
  return structuredClone(entry[1]) as T;
}

export function mockFetch(routes: Record<string, Responder> = {}) {
  const calls: MockCall[] = [];
  const impl: typeof fetch = async (input, init = {}) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call: MockCall = {
      method,
      url,
      body,
      headers: new Headers(init.headers),
      signal: init.signal ?? null,
    };
    calls.push(call);
    if (init.signal?.aborted)
      throw init.signal.reason ?? new DOMException('Cancelado', 'AbortError');
    const path = url.split('?')[0] ?? url;
    const responder = routes[`${method} ${path}`];
    if (responder === undefined) {
      return json(
        { error: { code: 'not_found', message: 'Esa dirección no existe.', requestId: 'test' } },
        404,
      );
    }
    if (typeof responder === 'function') return responder(call);
    return json(responder);
  };
  setFetch(impl);
  return {
    calls,
    restore: () => setFetch(null),
  };
}
