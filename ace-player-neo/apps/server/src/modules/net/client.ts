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
   - `signal` permite cancelar desde fuera;
   - el `detail` de `bad_url` y `redirect_loop` lleva la URL ya tapada
     (`redactUrl`), nunca la cruda (docs/iptv.md §2.4).

   IPTV (docs/iptv.md §3.1), con `iptv` en las opciones:
   - filtro más duro (`resolveIptvAddresses`) en CADA salto;
   - `gzip` se acepta (por cabecera o por los bytes `1f 8b`) y se
     descomprime con tope de bytes descomprimidos contra bombas;
   - el `detail` de cualquier error lleva solo el host.
   `openStream` es el mismo bucle sin leer el cuerpo: lo usan la lista M3U,
   la guía y el relé de vídeo. */

import { createGunzip, gunzipSync, type Gunzip } from 'node:zlib';
import { PassThrough, type Readable } from 'node:stream';
import { FETCH_MAX_BYTES, MAX_REDIRECTS, TIMEOUTS } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Clock, TimerHandle } from '../../core/clock.js';
import { redactUrl } from '../../core/logger.js';
import { resolveFetchAddresses, resolveIptvAddresses } from './ssrf.js';
import type {
  FetchedResponse,
  IptvFetchPolicy,
  NetResolver,
  NetTransport,
  OpenStreamOptions,
  OpenedStream,
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
  /** ALLOW_PRIVATE_SYNC_URLS: sin filtro anti-SSRF (salvo el de la IPTV). */
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
  /** Petición de la IPTV (docs/iptv.md §3.1). */
  readonly iptv?: IptvFetchPolicy;
  /** Saltos ya dados y URLs ya visitadas (la firma posicional de la 0.6.59). */
  readonly redirects?: number;
  readonly visited?: Set<string>;
}

export type Fetcher = (url: string, options: FetchBytesOptions) => Promise<FetchedResponse<Buffer>>;

export interface NetFetcher {
  readonly fetchBytes: Fetcher;
  readonly openStream: (url: string, options: OpenStreamOptions) => Promise<OpenedStream>;
}

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

/* Lo que se puede escribir de una URL en un `detail`: con la IPTV, solo el
   host; si no, la URL tapada. */
function describeUrl(url: string, iptv: IptvFetchPolicy | undefined): string {
  if (!iptv) return redactUrl(url);
  try {
    return new URL(url).hostname;
  } catch {
    return 'url';
  }
}

function parseTarget(url: string, iptv?: IptvFetchPolicy): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('bad_url', iptv ? {} : { detail: redactUrl(url) });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AppError('bad_url', { detail: describeUrl(url, iptv) });
  }
  return parsed;
}

function isGzipMagic(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function encodingOf(response: TransportResponse): string {
  return String(headerValue(response.headers['content-encoding']) || 'identity')
    .trim()
    .toLowerCase();
}

/* `gunzip` en bloque con tope de salida (bombas gzip). */
function gunzipCapped(buffer: Buffer, max: number): Buffer {
  try {
    return gunzipSync(buffer, { maxOutputLength: max });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError) {
      throw new AppError('response_too_large', { detail: 'gzip descomprimido' });
    }
    throw new AppError('unsupported_encoding', { detail: 'gzip roto' });
  }
}

interface BodyGuard {
  readonly clock: Clock;
  readonly controller: AbortController;
  readonly idleMs: number;
  /** Plazo absoluto (reloj) o null. */
  readonly deadline: number | null;
  readonly maxBytes: number | null;
  readonly maxDecompressed: number | null;
  /** `header`: gzip por Content-Encoding; `sniff`: mirar los bytes; `none`: tal cual. */
  readonly gzip: 'header' | 'sniff' | 'none';
  readonly onClose: () => void;
}

/**
 * Envuelve el cuerpo crudo de una respuesta: plazos (inactividad solo
 * mientras NO está parado por el consumidor, para que un lector lento no
 * cuente como corte), topes de bytes crudos y descomprimidos, gzip y corte de
 * la conexión al destruir la salida.
 */
function guardBody(raw: Readable, guard: BodyGuard): Readable {
  const { clock, controller } = guard;
  const out = new PassThrough();
  let gunzip: Gunzip | null = null;
  let decided = guard.gzip !== 'sniff';
  let head: Buffer[] = [];
  let headBytes = 0;
  let rawBytes = 0;
  let outBytes = 0;
  let idle: TimerHandle | null = null;
  let total: TimerHandle | null = null;
  let finished = false;
  let paused = false;

  const cleanup = (): void => {
    if (finished) return;
    finished = true;
    clock.clearTimeout(idle);
    clock.clearTimeout(total);
    idle = null;
    total = null;
    guard.onClose();
  };
  const fail = (error: unknown): void => {
    if (finished) return;
    cleanup();
    if (!controller.signal.aborted) controller.abort(error);
    gunzip?.destroy();
    raw.destroy();
    out.destroy(error instanceof Error ? error : new AppError('fetch_timeout'));
  };
  const armIdle = (): void => {
    clock.clearTimeout(idle);
    idle =
      paused || finished
        ? null
        : clock.setTimeout(() => fail(new AppError('fetch_timeout')), guard.idleMs);
  };
  const pause = (): void => {
    paused = true;
    raw.pause();
    clock.clearTimeout(idle);
    idle = null;
  };
  const resume = (): void => {
    if (finished) return;
    paused = false;
    raw.resume();
    armIdle();
  };
  const push = (chunk: Buffer): void => {
    if (finished) return;
    outBytes += chunk.length;
    if (guard.maxDecompressed !== null && outBytes > guard.maxDecompressed) {
      fail(new AppError('response_too_large', { detail: 'descomprimido' }));
      return;
    }
    if (!out.write(chunk)) {
      gunzip?.pause();
      pause();
    }
  };
  const wireGunzip = (): void => {
    gunzip = createGunzip();
    gunzip.on('data', (chunk: Buffer) => push(chunk));
    gunzip.on('end', () => {
      cleanup();
      out.end();
    });
    gunzip.on('error', () => fail(new AppError('unsupported_encoding', { detail: 'gzip roto' })));
    gunzip.on('drain', () => {
      if (!out.writableNeedDrain) resume();
    });
  };
  const feed = (chunk: Buffer): void => {
    if (gunzip) {
      if (!gunzip.write(chunk)) pause();
    } else push(chunk);
  };
  const decide = (): void => {
    decided = true;
    const first = Buffer.concat(head, headBytes);
    head = [];
    if (isGzipMagic(first)) wireGunzip();
    if (first.length) feed(first);
  };

  if (guard.gzip === 'header') wireGunzip();
  out.on('drain', () => {
    gunzip?.resume();
    if (!gunzip || !gunzip.writableNeedDrain) resume();
  });
  out.on('close', () => {
    if (!finished) {
      cleanup();
      if (!controller.signal.aborted) controller.abort(new Error('consumer_closed'));
      gunzip?.destroy();
      raw.destroy();
    }
  });
  raw.on('data', (value: Buffer | string) => {
    if (finished) return;
    const chunk = typeof value === 'string' ? Buffer.from(value) : value;
    armIdle();
    rawBytes += chunk.length;
    if (guard.maxBytes !== null && rawBytes > guard.maxBytes) {
      fail(new AppError('response_too_large'));
      return;
    }
    if (!decided) {
      head.push(chunk);
      headBytes += chunk.length;
      if (headBytes >= 2) decide();
      return;
    }
    feed(chunk);
  });
  raw.on('end', () => {
    if (finished) return;
    if (!decided) decide();
    if (gunzip) gunzip.end();
    else {
      cleanup();
      out.end();
    }
  });
  raw.on('error', (error) => fail(controller.signal.aborted ? reasonOf(controller.signal) : error));
  controller.signal.addEventListener('abort', () => fail(reasonOf(controller.signal)), {
    once: true,
  });
  if (guard.deadline !== null) {
    total = clock.setTimeout(
      () => fail(new AppError('fetch_timeout')),
      Math.max(0, guard.deadline - clock.now()),
    );
  }
  armIdle();
  return out;
}

export function createFetcher(deps: FetcherDeps): NetFetcher {
  const { clock } = deps;

  function addressesFor(parsed: URL, iptv: IptvFetchPolicy | undefined) {
    return iptv
      ? resolveIptvAddresses(parsed, deps.resolver, {
          allowPrivate: deps.allowPrivateUrls,
          lan: iptv.lan,
          ...(iptv.blockedPorts ? { blockedPorts: iptv.blockedPorts } : {}),
        })
      : resolveFetchAddresses(parsed, deps.resolver, deps.allowPrivateUrls);
  }

  function requestHeaders(
    accept: string | undefined,
    headers: Readonly<Record<string, string>> | undefined,
  ): Record<string, string> {
    return {
      'User-Agent': deps.userAgent,
      Accept: accept || DEFAULT_ACCEPT,
      ...headers,
      'Accept-Encoding': 'identity',
    };
  }

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
        headers: requestHeaders(options.accept, options.headers),
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
      const encoding = encodingOf(response);
      const gzipHeader = options.iptv !== undefined && encoding === 'gzip';
      if (encoding !== 'identity' && !gzipHeader) {
        body.destroy();
        throw new AppError('unsupported_encoding', { detail: encoding.slice(0, 40) });
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
      let buffer: Buffer = Buffer.concat(chunks);
      if (options.iptv && (gzipHeader || isGzipMagic(buffer))) {
        buffer = gunzipCapped(buffer, options.iptv.maxDecompressedBytes ?? maxBytes);
      }
      return { response, body: buffer };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clock.clearTimeout(total);
      clock.clearTimeout(idle);
      external?.removeEventListener('abort', onExternal);
    }
  }

  async function fetchBytes(
    url: string,
    options: FetchBytesOptions,
  ): Promise<FetchedResponse<Buffer>> {
    const visited = options.visited ?? new Set<string>();
    let redirects = options.redirects ?? 0;
    let current = url;
    for (;;) {
      if (clock.now() >= options.deadline) throw new AppError('fetch_timeout');
      const parsed = parseTarget(current, options.iptv);
      const canonical = parsed.toString();
      if (visited.has(canonical)) {
        throw new AppError('redirect_loop', { detail: describeUrl(canonical, options.iptv) });
      }
      visited.add(canonical);
      const addresses = await addressesFor(parsed, options.iptv);
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
          throw new AppError('bad_url', options.iptv ? {} : { detail: redactUrl(location) });
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
  }

  async function openStream(url: string, options: OpenStreamOptions): Promise<OpenedStream> {
    const { iptv } = options;
    const deadline = options.totalMs === undefined ? null : clock.now() + options.totalMs;
    const visited = new Set<string>();
    let redirects = 0;
    let current = url;
    for (;;) {
      if (deadline !== null && clock.now() >= deadline) throw new AppError('fetch_timeout');
      if (options.signal?.aborted) throw reasonOf(options.signal);
      const parsed = parseTarget(current, iptv);
      const canonical = parsed.toString();
      if (visited.has(canonical)) {
        throw new AppError('redirect_loop', { detail: describeUrl(canonical, iptv) });
      }
      visited.add(canonical);
      const addresses = await addressesFor(parsed, iptv);
      const controller = new AbortController();
      const external = options.signal;
      const onExternal = (): void => {
        if (!controller.signal.aborted && external) controller.abort(reasonOf(external));
      };
      if (external?.aborted) onExternal();
      else external?.addEventListener('abort', onExternal, { once: true });
      const release = (): void => external?.removeEventListener('abort', onExternal);
      const headersMs = Math.max(
        0,
        Math.min(
          options.headersMs ?? options.idleMs,
          deadline === null ? Number.POSITIVE_INFINITY : deadline - clock.now(),
        ),
      );
      const headersTimer = clock.setTimeout(() => {
        if (!controller.signal.aborted) controller.abort(new AppError('fetch_timeout'));
      }, headersMs);
      let response: TransportResponse;
      try {
        if (controller.signal.aborted) throw reasonOf(controller.signal);
        const pending = deps.transport({
          url: parsed,
          addresses,
          headers: requestHeaders(options.accept, options.headers),
          signal: controller.signal,
        });
        pending.then(
          (late) => {
            if (controller.signal.aborted) late.body.destroy();
          },
          () => {},
        );
        response = await Promise.race([pending, whenAborted(controller.signal)]);
      } catch (error) {
        release();
        if (controller.signal.aborted) throw reasonOf(controller.signal);
        throw error;
      } finally {
        clock.clearTimeout(headersTimer);
      }
      const status = response.status;
      const location = headerValue(response.headers.location);
      if (status >= 300 && status < 400 && location) {
        response.body.destroy();
        release();
        if (redirects >= MAX_REDIRECTS) throw new AppError('redirect_limit');
        try {
          current = new URL(location, parsed).toString();
        } catch {
          throw new AppError('bad_url', iptv ? {} : { detail: redactUrl(location) });
        }
        redirects += 1;
        continue;
      }
      if (status < 200 || status >= 300) {
        response.body.destroy();
        release();
        throw new AppError(`http_${status}`, { data: { status } });
      }
      const encoding = encodingOf(response);
      const gzipHeader = iptv !== undefined && encoding === 'gzip';
      if (encoding !== 'identity' && !gzipHeader) {
        response.body.destroy();
        release();
        throw new AppError('unsupported_encoding', { detail: encoding.slice(0, 40) });
      }
      const declared = Number(headerValue(response.headers['content-length']));
      if (
        options.maxBytes !== undefined &&
        Number.isFinite(declared) &&
        declared > options.maxBytes
      ) {
        response.body.destroy();
        release();
        throw new AppError('response_too_large', { detail: `Content-Length ${declared}` });
      }
      const body = guardBody(response.body, {
        clock,
        controller,
        idleMs: options.idleMs,
        deadline,
        maxBytes: options.maxBytes ?? null,
        maxDecompressed: iptv?.maxDecompressedBytes ?? options.maxBytes ?? null,
        gzip: gzipHeader ? 'header' : iptv ? 'sniff' : 'none',
        onClose: release,
      });
      return {
        status,
        headers: response.headers,
        contentType: headerValue(response.headers['content-type']) ?? null,
        body,
        finalUrl: canonical,
      };
    }
  }

  return { fetchBytes, openStream };
}
