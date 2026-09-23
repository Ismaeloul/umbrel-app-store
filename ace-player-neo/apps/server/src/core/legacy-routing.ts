/* Enrutado EXACTO de las rutas antiguas, como `handleRequest` de la 0.6.59
   (server.js:4720-5029; api.md §2.1-2.2). Fastify ignora la query al
   enrutar y respondería a `/api/state?x=1`; la 0.6.59 no. Esto se evalúa en
   un hook antes del enrutador de Fastify:

   - Se compara la URL CRUDA completa, query incluida. Solo aceptan `?…` las
     rutas que lo comprobaban con `startsWith("<ruta>?")` (`acceptsQuery` en
     LEGACY_OPERATIONS) y el prefijo `/remux/`.
   - Sin normalizar nada: `/api/state/` o `/api/%73tate` son 404.
   - Ruta conocida con otro método: 405 `method_not_allowed`. HEAD y OPTIONS
     también, salvo HEAD en /remux/. En /remux/ el 405 va SIN cuerpo
     (server.js:4929).
   - Cualquier otra cosa fuera de /api/v1: 404 `not_found`. */

import { LEGACY_OPERATIONS, LEGACY_REMUX_PREFIX, type LegacyOperation } from '@ace/shared';

export type LegacyResolution =
  | { readonly kind: 'route'; readonly operation: LegacyOperation }
  | { readonly kind: 'method_not_allowed'; readonly emptyBody: boolean }
  | { readonly kind: 'not_found' };

function pathMatches(operation: LegacyOperation, url: string): boolean {
  if (operation.path === LEGACY_REMUX_PREFIX) return url.startsWith(LEGACY_REMUX_PREFIX);
  return url === operation.path || (operation.acceptsQuery && url.startsWith(`${operation.path}?`));
}

/** Resuelve una petición antigua con las reglas exactas de la 0.6.59. */
export function resolveLegacyRoute(method: string, url: string): LegacyResolution {
  const candidates = LEGACY_OPERATIONS.filter((operation) => pathMatches(operation, url));
  if (!candidates.length) return { kind: 'not_found' };
  const operation = candidates.find((candidate) => candidate.method === method);
  if (operation) return { kind: 'route', operation };
  return { kind: 'method_not_allowed', emptyBody: url.startsWith(LEGACY_REMUX_PREFIX) };
}

/** Clave única de una operación: `GET /api/state`, `HEAD /remux/`… */
export function legacyOperationKey(operation: Pick<LegacyOperation, 'method' | 'path'>): string {
  return `${operation.method} ${operation.path}`;
}

/** Ruta que se registra en Fastify para una operación (`/remux/` es un prefijo). */
export function fastifyPathForLegacy(operation: LegacyOperation): string {
  return operation.path === LEGACY_REMUX_PREFIX ? `${LEGACY_REMUX_PREFIX}*` : operation.path;
}
