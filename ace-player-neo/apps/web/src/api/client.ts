/* Cliente tipado de /api/v1 (arquitectura §6.2).

     const agenda = await api('footballSchedule');
     await api('libraryMutate', { body: { action: 'favorite-upsert', item } });
     await api('deviceRevoke', { params: { id } });

   - Los tipos de params, query, body y respuesta salen de V1_ROUTES
     (@ace/shared): si una ruta cambia en shared, esto deja de compilar.
   - En desarrollo y en los tests, cada respuesta se valida con su esquema
     zod; en producción no (y zod no entra en el JS inicial). Se devuelve
     siempre el JSON tal cual llega, para que desarrollo y producción se
     comporten igual.
   - Errores: ApiError con mensaje en español (errors.ts).
   - Cancelación: `signal` (TanStack Query pasa el suyo; las vistas, el de
     useViewSignal) + un plazo por ruta. Un aborto del usuario sale como
     AbortError; un plazo agotado, como ApiError `timeout`.
   - GET con `cache: 'no-cache'`: el navegador revalida con el ETag que da el
     backend (un 304 no trae cuerpo) en vez de pedir todo cada vez.
   - Modo demo: espera a que se decida (mode.ts) y, si es demo, contesta el
     módulo diferido demo/ sin red. */

import { ApiError, errorFromResponse, isAbortError } from './errors.ts';
import { isDemo, whenModeReady } from './mode.ts';
import {
  buildPath,
  buildQuery,
  routeOf,
  type ApiBody,
  type ApiParams,
  type ApiQuery,
  type ApiResponse,
  type JsonRouteId,
} from './routes.ts';

/** Sin ningún campo obligatorio (se puede omitir entero). */
type AllOptional<T> = Partial<T> extends T ? true : false;

type RequiredIfNeeded<K extends string, T> = [T] extends [undefined]
  ? { [P in K]?: undefined }
  : AllOptional<T> extends true
    ? { [P in K]?: T }
    : { [P in K]: T };

export interface RequestOptions {
  signal?: AbortSignal;
  /** Plazo en ms (por defecto, el de la ruta). 0 = sin plazo. */
  timeoutMs?: number;
  /** Para soltar cosas al cerrar la página (pagehide). */
  keepalive?: boolean;
}

export type ApiInput<Id extends JsonRouteId> = RequestOptions &
  RequiredIfNeeded<'params', ApiParams<Id>> &
  RequiredIfNeeded<'query', ApiQuery<Id>> &
  RequiredIfNeeded<'body', ApiBody<Id>>;

/** ¿Hace falta pasar algo a api(id, …)? */
export type ApiArgs<Id extends JsonRouteId> =
  AllOptional<ApiInput<Id>> extends true ? [input?: ApiInput<Id>] : [input: ApiInput<Id>];

/** Plazos de la 0.6.59 (inventario §24.2) y de arquitectura §5.15. */
const TIMEOUTS: Partial<Record<JsonRouteId, number>> = {
  footballSchedule: 14_000,
  footballResolve: 30_000,
  footballScan: 5_000,
  // La apertura espera a que el vídeo sea reproducible (en iOS, el remux: 55 s).
  channelStream: 60_000,
  search: 15_000,
  directoriesSync: 50_000,
  engineRestart: 20_000,
  healthLive: 4_000,
};
const DEFAULT_GET_TIMEOUT = 12_000;
const DEFAULT_MUTATION_TIMEOUT = 12_000;

export function timeoutFor(id: JsonRouteId): number {
  return (
    TIMEOUTS[id] ?? (routeOf(id).method === 'GET' ? DEFAULT_GET_TIMEOUT : DEFAULT_MUTATION_TIMEOUT)
  );
}

/** Une la señal del que llama con un plazo; distingue quién abortó. */
function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let expired = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer =
    ms > 0
      ? setTimeout(() => {
          expired = true;
          controller.abort(new DOMException('Plazo agotado', 'TimeoutError'));
        }, ms)
      : null;
  return {
    signal: controller.signal,
    timedOut: () => expired,
    done: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/** Peticiones GET que index.html lanza antes de que llegue el JS
    (`window.__acePrefetch`, por ruta: hoy la agenda de la portada). Cada una
    se usa UNA vez, la primera vez que se pide esa URL. */
function takeEarly(url: string): Promise<Response> | null {
  const holder = globalThis as { __acePrefetch?: Record<string, Promise<Response> | undefined> };
  const early = holder.__acePrefetch?.[url] ?? null;
  if (early && holder.__acePrefetch) delete holder.__acePrefetch[url];
  return early;
}

/** Espera la petición adelantada con el mismo plazo y cancelación que una
    normal; si falló por la red, la repite (`again`). */
async function awaitEarly(
  early: Promise<Response>,
  signal: AbortSignal,
  again: () => Promise<Response>,
): Promise<Response> {
  try {
    return await new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new DOMException('Cancelado', 'AbortError'));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      early.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return again();
  }
}

let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);

/** Solo para los tests: un fetch simulado (src/test/fetch.ts). */
export function setFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? ((...args) => globalThis.fetch(...args));
}

/** Valida con zod en desarrollo. En producción esta rama desaparece del build. */
async function validateInDev(id: JsonRouteId, data: unknown): Promise<void> {
  if (!import.meta.env.DEV) return;
  const { V1_ROUTES } = await import('@ace/shared');
  const schema = V1_ROUTES[id].response;
  if (!schema) return;
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[api] La respuesta de «${id}» no cumple su esquema`, result.error.issues);
    throw new ApiError({ code: 'invalid_response', route: id, status: 200 });
  }
}

export async function api<Id extends JsonRouteId>(
  id: Id,
  ...[input]: ApiArgs<Id>
): Promise<ApiResponse<Id>> {
  const options = (input ?? {}) as RequestOptions & {
    params?: unknown;
    query?: unknown;
    body?: unknown;
  };
  const route = routeOf(id);
  if (route.content !== 'json')
    throw new Error(`«${id}» no es una ruta JSON; usa su URL directamente.`);

  if (options.signal?.aborted)
    throw options.signal.reason ?? new DOMException('Cancelado', 'AbortError');
  await whenModeReady();
  if (isDemo()) {
    const { handleDemo } = await import('./demo/index.ts');
    return handleDemo(id, {
      params: options.params,
      query: options.query,
      body: options.body,
    } as Parameters<typeof handleDemo<Id>>[1]);
  }

  const url =
    buildPath(route.path, options.params as Record<string, unknown> | undefined) +
    buildQuery(options.query as Record<string, unknown> | undefined);
  const hasBody = options.body !== undefined;
  const timeout = withTimeout(options.signal, options.timeoutMs ?? timeoutFor(id));
  let response: Response;
  const request = () =>
    fetchImpl(url, {
      method: route.method,
      headers: hasBody
        ? { Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Accept: 'application/json' },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: timeout.signal,
      cache: route.method === 'GET' ? 'no-cache' : 'no-store',
      credentials: 'same-origin',
      keepalive: options.keepalive,
    });
  // Si index.html ya la pidió (revisión de rendimiento de la Fase 2), se usa esa.
  const early = route.method === 'GET' && !hasBody ? takeEarly(url) : null;
  try {
    response = early ? await awaitEarly(early, timeout.signal, request) : await request();
  } catch (error) {
    timeout.done();
    if (timeout.timedOut()) throw new ApiError({ code: 'timeout', route: id, cause: error });
    if (isAbortError(error) || options.signal?.aborted) throw error;
    throw new ApiError({ code: 'network', route: id, cause: error });
  }
  try {
    if (!response.ok) throw await errorFromResponse(response, id);
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (timeout.timedOut()) throw new ApiError({ code: 'timeout', route: id, cause: error });
      if (isAbortError(error)) throw error;
      throw new ApiError({
        code: 'bad_response',
        status: response.status,
        route: id,
        cause: error,
      });
    }
    await validateInDev(id, data);
    return data as ApiResponse<Id>;
  } finally {
    timeout.done();
  }
}
