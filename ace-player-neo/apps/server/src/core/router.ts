/* Cómo registra un módulo sus rutas (arquitectura §5.15: "cada módulo
   registra sus rutas; http solo las compone").

   Los módulos NO escriben rutas ni validan a mano:
   - v1: aportan el manejador de un id de la tabla de @ace/shared
     (`V1_ROUTES`). app.ts lo registra en `/api/v1/...` y `/native/api/v1/...`,
     comprueba el acceso, valida params/query/cuerpo con zod y valida también
     la respuesta antes de mandarla.
   - antiguas: aportan el manejador de una operación de `LEGACY_OPERATIONS`
     (método + ruta tal cual la escribe la tabla). El enrutado exacto, el 405
     y el anti-CSRF ya están hechos antes de llegar aquí.

   Si un id o una operación no tiene manejador, app.ts pone uno que responde
   501 `not_implemented`: el esqueleto arranca entero desde el primer día. */

import {
  LEGACY_OPERATIONS,
  V1_ROUTES,
  type LegacyMethod,
  type V1Body,
  type V1Params,
  type V1Query,
  type V1ResponseInput,
  type V1RouteId,
  type V1Routes,
} from '@ace/shared';
import { legacyOperationKey } from './legacy-routing.js';
import type { RequestContext } from './module.js';

export interface V1HandlerInput<Id extends V1RouteId> {
  readonly params: V1Params<Id>;
  readonly query: V1Query<Id>;
  readonly body: V1Body<Id>;
}

/**
 * Lo que devuelve un manejador v1: el JSON de la respuesta (se valida con el
 * esquema de la ruta) o, en las rutas sin JSON (SSE y vídeo), nada: el
 * manejador responde él mismo con `ctx.reply`.
 */
export type V1HandlerResult<Id extends V1RouteId> = V1Routes[Id]['response'] extends null
  ? void
  : V1ResponseInput<Id>;

export type V1Handler<Id extends V1RouteId> = (
  input: V1HandlerInput<Id>,
  ctx: RequestContext,
) => V1HandlerResult<Id> | Promise<V1HandlerResult<Id>>;

export interface V1Router {
  /** Aporta el manejador de una ruta de la tabla. Dos veces el mismo id es un error. */
  handle<Id extends V1RouteId>(id: Id, handler: V1Handler<Id>): void;
}

/** Petición antigua tal y como la veía `handleRequest`. */
export interface LegacyRequest {
  readonly method: LegacyMethod;
  /** URL cruda, query incluida (`req.url`). */
  readonly url: string;
  readonly query: URLSearchParams;
  /**
   * Cuerpo ya parseado como JSON (cualquier JSON; vacío = `{}`) en las
   * operaciones que leen cuerpo; `undefined` en las demás. Sin validar: cada
   * módulo lo normaliza como la 0.6.59 (api.md §2.4).
   */
  readonly body: unknown;
}

/**
 * Devuelve el JSON de la respuesta (200) o `undefined` si ya respondió con
 * `ctx.reply` (ficheros del remux, `/api/remux` con 502/504 enviados
 * directamente, api.md §4.21).
 */
export type LegacyHandler = (req: LegacyRequest, ctx: RequestContext) => unknown;

export interface LegacyRouter {
  /** `method` y `path` exactamente como en LEGACY_OPERATIONS (`/remux/` para los ficheros). */
  handle(method: LegacyMethod, path: string, handler: LegacyHandler): void;
}

type AnyV1Handler = (input: V1HandlerInput<V1RouteId>, ctx: RequestContext) => unknown;

export interface RouteCollector {
  readonly v1: V1Router;
  readonly legacy: LegacyRouter;
  readonly v1Handlers: ReadonlyMap<V1RouteId, AnyV1Handler>;
  readonly legacyHandlers: ReadonlyMap<string, LegacyHandler>;
}

/** Recoge los manejadores que aportan los módulos; app.ts los registra después. */
export function createRouteCollector(): RouteCollector {
  const v1Handlers = new Map<V1RouteId, AnyV1Handler>();
  const legacyHandlers = new Map<string, LegacyHandler>();
  const legacyKeys = new Set(LEGACY_OPERATIONS.map(legacyOperationKey));

  return {
    v1: {
      handle(id, handler) {
        if (!Object.hasOwn(V1_ROUTES, id)) throw new Error(`ruta v1 desconocida: ${String(id)}`);
        if (v1Handlers.has(id)) throw new Error(`la ruta v1 ${id} ya tiene manejador`);
        v1Handlers.set(id, handler as unknown as AnyV1Handler);
      },
    },
    legacy: {
      handle(method, path, handler) {
        const key = legacyOperationKey({ method, path });
        if (!legacyKeys.has(key)) throw new Error(`operación antigua desconocida: ${key}`);
        if (legacyHandlers.has(key)) throw new Error(`la operación ${key} ya tiene manejador`);
        legacyHandlers.set(key, handler);
      },
    },
    v1Handlers,
    legacyHandlers,
  };
}
