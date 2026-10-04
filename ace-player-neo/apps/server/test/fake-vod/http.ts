/* Peticiones HTTP sueltas de las pruebas VOD: cada una en su propia
   conexión (`agent: false`), como las de ffmpeg y el lector del índice. */

import http from 'node:http';

export interface RawResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Buffer;
  /** false si la conexión se cortó antes de acabar el cuerpo. */
  readonly complete: boolean;
}

export function rawGet(
  url: string,
  init: { range?: string; method?: string; timeoutMs?: number } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: init.method ?? 'GET',
      agent: false,
      headers: init.range ? { range: init.range } : {},
    });
    const timer = setTimeout(
      () => req.destroy(new Error('tiempo agotado')),
      init.timeoutMs ?? 10_000,
    );
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      const done = (): void => {
        clearTimeout(timer);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
          complete: res.complete,
        });
      };
      res.on('end', done);
      res.on('error', done);
      res.on('close', done);
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

/**
 * Abre una petición y devuelve la respuesta SIN leerla (se queda parada,
 * como ffmpeg en pausa). `close()` corta la conexión.
 */
export function openGet(
  url: string,
  range?: string,
): Promise<{ res: http.IncomingMessage; close(): void }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false, headers: range ? { range } : {} }, (res) => {
      res.pause();
      resolve({ res, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

/** Espera real hasta que `check` se cumpla (o falla tras `maxMs`). */
export async function until(
  check: () => boolean,
  maxMs = 5_000,
  what = 'la condición',
): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > maxMs) throw new Error(`tiempo agotado esperando ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
