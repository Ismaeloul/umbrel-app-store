/* Rutas de /api/v1 para el navegador.

   La tabla viene de V1_ROUTES (@ace/shared) a través del módulo virtual
   `virtual:ace-routes`, que guarda solo método, ruta, tipo de contenido y si
   tiene efectos. Así el JS inicial no carga zod ni los esquemas; la validación
   de respuestas con zod se hace solo en desarrollo y en los tests (client.ts).

   Los tipos de entrada y salida salen de los esquemas de @ace/shared, sin
   importar zod: se leen de la marca `_zod` que llevan los tipos de zod 4. */

import type { V1ResponseOutput, V1RouteId, V1Routes } from '@ace/shared';
import { ROUTES, type LightRoute } from 'virtual:ace-routes';

export type ApiRouteId = V1RouteId;

type InputOf<S> = S extends { readonly _zod: { readonly input: infer I } } ? I : undefined;
type FieldInput<
  Id extends ApiRouteId,
  K extends 'params' | 'query' | 'body',
> = V1Routes[Id] extends {
  readonly [P in K]: infer S;
}
  ? InputOf<S>
  : undefined;

/** Parámetros de ruta (`:id`) tal y como los manda el cliente. */
export type ApiParams<Id extends ApiRouteId> = FieldInput<Id, 'params'>;
/** Query tal y como la manda el cliente (antes de los valores por defecto). */
export type ApiQuery<Id extends ApiRouteId> = FieldInput<Id, 'query'>;
/** Cuerpo tal y como lo manda el cliente. */
export type ApiBody<Id extends ApiRouteId> = FieldInput<Id, 'body'>;
/** Respuesta JSON de éxito. */
export type ApiResponse<Id extends ApiRouteId> = V1ResponseOutput<Id>;

/** Rutas que devuelven JSON (las demás son SSE o ficheros de vídeo). */
export type JsonRouteId = {
  [K in ApiRouteId]: V1Routes[K]['content'] extends 'json' ? K : never;
}[ApiRouteId];

export function routeOf(id: ApiRouteId): LightRoute {
  const route = ROUTES[id];
  if (!route) throw new Error(`La ruta «${id}» no existe en la tabla de /api/v1.`);
  return route;
}

/** `/api/v1/channels/:id/stream` + { id } → `/api/v1/channels/abc/stream`. */
export function buildPath(path: string, params?: Record<string, unknown> | null): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Falta el parámetro «${name}» para ${path}.`);
    }
    return encodeURIComponent(String(value));
  });
}

/** Query con los valores repetidos como la 0.6.59 (`channel=a&channel=b`); sin los vacíos. */
export function buildQuery(query?: Record<string, unknown> | null): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value)
        if (item !== undefined && item !== null) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function routeUrl(
  id: ApiRouteId,
  params?: Record<string, unknown> | null,
  query?: Record<string, unknown> | null,
): string {
  return buildPath(routeOf(id).path, params) + buildQuery(query);
}

export { ROUTES };
