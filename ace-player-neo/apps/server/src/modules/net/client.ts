/* El bucle de descarga de `fetchText` (server.js:1342-1423), sin globales.

   Cada salto: plazo vencido → `fetch_timeout`; URL solo http/https y sin
   credenciales → si no, `bad_url`; URL ya visitada → `redirect_loop`;
   resolución y filtro anti-SSRF (ssrf.ts) → `private_url`/`dns_failed`;
   petición con la IP fijada; 3xx con Location → siguiente salto (como mucho
   5, `redirect_limit`); no 2xx → `http_NNN`; `Content-Encoding` distinto de
   `identity` → `unsupported_encoding`; más de `maxBytes` →
   `response_too_large`.

   Cambios respecto a la 0.6.59 (docs/compat.md):
   - redirecciones en un bucle en vez de recursión, con el mismo plazo total;
   - la inactividad (12 s) se mide con el reloj inyectado (petición, cabeceras
     y cada trozo del cuerpo), no con el `timeout` del socket;
   - un `Content-Length` mayor que el tope se rechaza sin leer el cuerpo;
   - `signal` permite cancelar desde fuera. */

import { FETCH_MAX_BYTES, MAX_REDIRECTS, TIMEOUTS } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Clock, TimerHandle } from '../../core/clock.js';
import { resolveFetchAddresses } from './ssrf.js';
import type {
  FetchedResponse,
  NetResolver,
  NetTransport,
  ResolvedAddress,
  TransportResponse,
} from './types.js';

/** Accept por defecto (server.js:1374). */
export const DEFAULT_ACCEPT =
  'application/json,text/plain,text/html,application/x-mpegURL,*/*;q=0.2';

export interface FetcherDeps {
  readonly clock: Clock;
  readonly resolver: NetResolver;
  readonly transport: NetTransport;
  /** ALLOW_PRIVATE_SYNC_URLS: sin filtro anti-SSRF. */
  readonly allowPrivateUrls: boolean;
  readonly userAgent: string;
}

export interface FetchBytesOptions {
  /** Plazo absoluto en milisegundos del reloj (la 0.6.59 lo recibía así). */
  readonly deadline: number;
  readonly maxBytes?: number;
  readonly idleTimeoutMs?: number;
  readonly accept?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Saltos ya dados y URLs ya visitadas (la firma posicional de la 0.6.59). */
  readonly redirects?: number;
  readonly visited?: Set<string>;
}

export type Fetcher = (url: string, options: FetchBytesOptions) => Promise<FetchedResponse<Buffer>>;

/** JSON inválido en `fetchJson`: el llamante decide su código. */
export class NetBadResponseError extends Error {
  override readonly name = 'NetBadResponseError';
  constructor(cause: unknown) {
    super('bad_response', { cause });
  }
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function reasonOf(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new AppError('fetch_timeout');
}

/* Promesa que rechaza cuando la señal se aborta (para no depender de que el
   transporte la respete). */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(reasonOf(signal));
    else signal.addEventListener('abort', () => reject(reasonOf(signal)), { once: true });
  });
}

function parseTarget(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('bad_url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AppError('bad_url');
  }
  return parsed;
}

export function createFetcher(deps: FetcherDeps): Fetcher {
  const { clock } = deps;

  /* Un salto: petición + cabeceras + (si toca) cuerpo, con los dos plazos. */
  async function hop(
    parsed: URL,
    addresses: readonly ResolvedAddress[],
    remaining: number,
    options: FetchBytesOptions,
  ): Promise<{ response: TransportResponse; body: Buffer | null }> {
    const controller = new AbortController();
    const fail = (error: unknown): void => {
      if (!controller.signal.aborted) controller.abort(error);
    };
    const idleMs = Math.min(options.idleTimeoutMs ?? TIMEOUTS.directoryIdleMs, remaining);
    const total = clock.setTimeout(() => fail(new AppError('fetch_timeout')), remaining);
    let idle: TimerHandle | null = null;
    const touch = (): void => {
      clock.clearTimeout(idle);
      idle = clock.setTimeout(() => fail(new AppError('fetch_timeout')), idleMs);
    };
    const external = options.signal;
    const onExternal = (): void => fail(external ? reasonOf(external) : undefined);
    let body: TransportResponse['body'] | null = null;
    controller.signal.addEventListener('abort', () => {
      body?.destroy(controller.signal.reason as Error);
    });
    try {
      if (external?.aborted) onExternal();
      else external?.addEventListener('abort', onExternal, { once: true });
      if (controller.signal.aborted) throw controller.signal.reason;
      touch();
      const pending = deps.transport({
        url: parsed,
        addresses,
        headers: {
          'User-Agent': deps.userAgent,
          Accept: options.accept || DEFAULT_ACCEPT,
          ...options.headers,
          'Accept-Encoding': 'identity',
        },
        signal: controller.signal,
      });
      /* Si el plazo gana, lo que llegue después se cierra sin leerlo. */
      pending.then(
        (late) => {
          if (controller.signal.aborted) late.body.destroy();
        },
        () => {},
      );
      const response = await Promise.race([pending, whenAborted(controller.signal)]);
      body = response.body;
      touch();
      const status = response.status;
      const location = headerValue(response.headers.location);
      if ((status >= 300 && status < 400 && location) || status < 200 || status >= 300) {
        body.destroy();
        return { response, body: null };
      }
      const encoding = String(
        headerValue(response.headers['content-encoding']) || 'identity',
      ).toLowerCase();
      if (encoding !== 'identity') {
        body.destroy();
        throw new AppError('unsupported_encoding', { detail: encoding });
      }
      const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
      const declared = Number(headerValue(response.headers['content-length']));
      if (Number.isFinite(declared) && declared > maxBytes) {
        body.destroy();
        throw new AppError('response_too_large', { detail: `Content-Length ${declared}` });
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of body as AsyncIterable<Buffer | string>) {
        touch();
        const piece = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        bytes += piece.length;
        if (bytes > maxBytes) throw new AppError('response_too_large');
        chunks.push(piece);
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      return { response, body: Buffer.concat(chunks) };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clock.clearTimeout(total);
      clock.clearTimeout(idle);
      external?.removeEventListener('abort', onExternal);
    }
  }

  return async function fetchBytes(url, options) {
    const visited = options.visited ?? new Set<string>();
    let redirects = options.redirects ?? 0;
    let current = url;
    for (;;) {
      if (clock.now() >= options.deadline) throw new AppError('fetch_timeout');
      const parsed = parseTarget(current);
      const canonical = parsed.toString();
      if (visited.has(canonical)) throw new AppError('redirect_loop', { detail: canonical });
      visited.add(canonical);
      const addresses = await resolveFetchAddresses(parsed, deps.resolver, deps.allowPrivateUrls);
      const remaining = options.deadline - clock.now();
      if (remaining <= 0) throw new AppError('fetch_timeout');
      const { response, body } = await hop(parsed, addresses, remaining, options);
      const status = response.status;
      const location = headerValue(response.headers.location);
      if (status >= 300 && status < 400 && location) {
        if (redirects >= MAX_REDIRECTS) throw new AppError('redirect_limit');
        try {
          current = new URL(location, parsed).toString();
        } catch {
          throw new AppError('bad_url', { detail: location });
        }
        redirects += 1;
        continue;
      }
      /* "http_429" en vez de un "fetch_failed" genérico: el motivo llega hasta
         la tarjeta del directorio y decide si probar otra pasarela (server.js:1390-1395). */
      if (status < 200 || status >= 300 || !body) throw new AppError(`http_${status}`);
      return {
        body,
        url: canonical,
        status,
        contentType: headerValue(response.headers['content-type']) ?? null,
      };
    }
  };
}
