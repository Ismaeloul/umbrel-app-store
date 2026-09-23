/* Petición HTTP al motor (o a engine_control) con plazo y tope de cuerpo.

   Sustituye a `aceRequest` (server.js:2814-2830), que tenía un plazo de
   INACTIVIDAD del socket (un motor que manda un byte cada 4 s no vencía
   nunca), no ponía tope al cuerpo y no se podía cancelar. Aquí:

   - plazo TOTAL (cabeceras + cuerpo) medido con el reloj inyectado, así los
     tests lo vencen con `FakeClock.advance()`;
   - tope de bytes: pasado, se corta la conexión (512 KiB para el motor,
     arquitectura §5.5);
   - cancelable con la señal de quien llama (el cliente que cuelga).

   Se usa `fetch` y no `http.get` a pelo: el comentario de server.js:2867-2872
   cuenta que el motor no crea igual la sesión con el `http.get` desnudo de
   Node (URLs válidas pero sin bytes). El temporizador del plazo se programa
   ANTES del primer `await`, para que un test que avanza el reloj justo
   después de llamar lo encuentre ya puesto. */

import type { Clock } from '../../core/clock.js';

export type EngineHttpFailure = 'timeout' | 'network' | 'too_large';

/** Fallo de transporte (no de protocolo): lo traduce a un código cada llamada. */
export class EngineHttpError extends Error {
  override readonly name = 'EngineHttpError';
  readonly kind: EngineHttpFailure;

  constructor(kind: EngineHttpFailure, options?: { readonly cause?: unknown }) {
    super(
      `engine_http_${kind}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.kind = kind;
  }
}

export interface EngineHttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Señal de quien llama: si se aborta, se rechaza con SU motivo (no es un fallo del motor). */
  readonly signal?: AbortSignal;
}

export interface EngineHttpResponse {
  readonly status: number;
  readonly body: string;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

export async function engineHttp(
  clock: Clock,
  request: EngineHttpRequest,
): Promise<EngineHttpResponse> {
  const external = request.signal;
  if (external?.aborted) throw abortReason(external);
  const controller = new AbortController();
  let timedOut = false;
  const timer = clock.setTimeout(
    () => {
      timedOut = true;
      controller.abort(new EngineHttpError('timeout'));
    },
    request.timeoutMs,
    { unref: true },
  );
  const onAbort = (): void => controller.abort(external ? abortReason(external) : undefined);
  external?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      signal: controller.signal,
      /* El motor no redirige las llamadas del backend; si lo hiciera, el 3xx
         cuenta como respuesta fuera de 2xx y no se sigue ningún host ajeno. */
      redirect: 'manual',
    });
    const body = await readCapped(response, request.maxBytes, controller);
    return { status: response.status, body };
  } catch (error) {
    if (timedOut) throw new EngineHttpError('timeout', { cause: error });
    if (external?.aborted) throw abortReason(external);
    if (error instanceof EngineHttpError) throw error;
    throw new EngineHttpError('network', { cause: error });
  } finally {
    clock.clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

/* Lee el cuerpo como texto UTF-8 sin pasar de `maxBytes`. */
async function readCapped(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      const error = new EngineHttpError('too_large');
      controller.abort(error);
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
