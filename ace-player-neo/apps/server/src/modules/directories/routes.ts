/* Rutas del módulo `directories`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.24-4.26): responden
   `directoryResponse` (con `success` y `web`/`streams` duplicados) y los
   errores como 400 (los `ipfs_*` y los fallos de socket, 500
   `internal_error`, como hoy):
   - POST /api/streams/sync
   - POST /api/streams/activate
   - POST /api/streams/delete

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos). Responden
   `DirectoryView` (sin `success` ni `streams`):
   - directoriesGet: GET /api/v1/directories
   - directoriesSync: POST /api/v1/directories/sync
   - directoriesActivate: POST /api/v1/directories/:id/activate
   - directoriesDelete: DELETE /api/v1/directories/:id */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/streams/sync',
  'POST /api/streams/activate',
  'POST /api/streams/delete',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'directoriesGet',
  'directoriesSync',
  'directoriesActivate',
  'directoriesDelete',
];

/* `body.sourceId` tal cual: la 0.6.59 lo compara con `===` sin normalizar
   (api.md §4.25), así que lo que no es un texto nunca coincide. */
function sourceIdOf(body: unknown): string {
  const value =
    body !== null && typeof body === 'object'
      ? (body as { sourceId?: unknown }).sourceId
      : undefined;
  return typeof value === 'string' ? value : '';
}

export function registerLegacyRoutes(
  router: LegacyRouter,
  services: Pick<Services, 'directories'>,
): void {
  router.handle('POST', '/api/streams/sync', (req) =>
    services.directories.sync(
      req.body !== null && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : {},
    ),
  );
  router.handle('POST', '/api/streams/activate', (req) =>
    services.directories.activate(sourceIdOf(req.body)),
  );
  router.handle('POST', '/api/streams/delete', (req) =>
    services.directories.remove(sourceIdOf(req.body)),
  );
}

export function registerV1Routes(router: V1Router, services: Pick<Services, 'directories'>): void {
  router.handle('directoriesGet', () => services.directories.view());
  router.handle('directoriesSync', async (input) => {
    await services.directories.sync(input.body);
    return services.directories.view();
  });
  router.handle('directoriesActivate', async (input) => {
    await services.directories.activate(input.params.id);
    return services.directories.view();
  });
  router.handle('directoriesDelete', async (input) => {
    await services.directories.remove(input.params.id);
    return services.directories.view();
  });
}
