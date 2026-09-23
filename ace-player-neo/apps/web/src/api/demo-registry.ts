/* Registro de respuestas del modo demo.

   El modo demo contesta cada ruta sin red, con los ejemplos de
   packages/shared/fixtures y un estado que se guarda en localStorage
   (src/api/demo/index.ts, que solo se descarga si hay demo). Las vistas
   pueden afinar la respuesta de una o varias rutas (por ejemplo, una
   resolución de partido con escaneo simulado):

     registerDemoHandlers({
       footballResolve: ({ query }) => miResolucionDeMuestra(query),
       scores: () => marcadoresDeMuestra(),
     });

   Con un objeto, TypeScript comprueba cada respuesta contra el contrato de su
   ruta. Este fichero es diminuto a propósito: va en el JS inicial. */

import type { ApiBody, ApiParams, ApiQuery, ApiResponse, JsonRouteId } from './routes.ts';

export interface DemoRequest<Id extends JsonRouteId> {
  params: ApiParams<Id>;
  query: ApiQuery<Id>;
  body: ApiBody<Id>;
}

export type DemoHandler<Id extends JsonRouteId> = (
  request: DemoRequest<Id>,
) => ApiResponse<Id> | Promise<ApiResponse<Id>>;

export type DemoHandlers = { [Id in JsonRouteId]?: DemoHandler<Id> };

const handlers = new Map<JsonRouteId, DemoHandler<JsonRouteId>>();

/** Registra respuestas de demo. Devuelve la función para quitarlas. */
export function registerDemoHandlers(map: DemoHandlers): () => void {
  const added = Object.entries(map) as Array<[JsonRouteId, DemoHandler<JsonRouteId>]>;
  for (const [id, handler] of added) handlers.set(id, handler);
  return () => {
    for (const [id, handler] of added) if (handlers.get(id) === handler) handlers.delete(id);
  };
}

/** Una sola ruta: `registerDemoHandler('scores', (request) => …)`. */
export function registerDemoHandler<Id extends JsonRouteId>(
  id: Id,
  handler: DemoHandler<Id>,
): () => void {
  return registerDemoHandlers({ [id]: handler } as DemoHandlers);
}

export function registeredDemoHandler<Id extends JsonRouteId>(id: Id): DemoHandler<Id> | null {
  return (handlers.get(id) as DemoHandler<Id> | undefined) ?? null;
}
