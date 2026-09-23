/* Rutas del módulo `football`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.8-4.13):
   - GET /api/football → `{ success: true, ...agenda }` o 502 `football_unavailable`
   - GET /api/football/resolve → `{ success: true, ...resolución }` o 400 `channel_required`
   - GET /api/football/preheat?match= → `{ success: true, preheat }`
   - POST /api/football/bind → `{ success: true, binding, channelBindings }` o 400 `bad_binding`
   - GET /api/scores → sus tres formas, `success: false` con 200 si no hay agenda

   v1 (tabla de @ace/shared/routes.ts; acceso y validación en app.ts):
   - footballSchedule: GET /api/v1/football
   - footballResolve: GET /api/v1/football/resolve (el trabajo del comprobador
     apunta a /api/v1/football/scans/:id)
   - footballPreheat: GET /api/v1/football/preheat/:matchId
   - footballBind: POST /api/v1/football/bindings
   - scores: GET /api/v1/scores
   La de `GET /api/v1/football/scans/:id` es del comprobador. */

import type { ScanRef } from '@ace/shared';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/football/bind',
  'GET /api/football/preheat',
  'GET /api/football/resolve',
  'GET /api/scores',
  'GET /api/football',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'footballSchedule',
  'footballResolve',
  'footballPreheat',
  'footballBind',
  'scores',
];

/** La query antigua tal cual la leía server.js:4770-4808 (`channel` repetible). */
export function legacyResolveQuery(query: URLSearchParams): Record<string, unknown> {
  return {
    match: query.get('match'),
    channel: query.getAll('channel'),
    research: query.get('research'),
    current: query.get('current'),
    current_ih: query.get('current_ih'),
    client: query.get('client'),
  };
}

/** La referencia del comprobador con la URL de /api/v1 (`GET /api/v1/football/scans/:id`). */
export function v1ScanRef(ref: ScanRef | null): ScanRef | null {
  return ref ? { ...ref, statusUrl: `/api/v1/football/scans/${ref.id}` } : null;
}

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('GET', '/api/football', async () => ({
    success: true,
    ...(await services.football.schedule()),
  }));
  router.handle('GET', '/api/football/resolve', async (req, ctx) => ({
    success: true,
    ...(await services.football.resolve(legacyResolveQuery(req.query), { signal: ctx.signal })),
  }));
  router.handle('GET', '/api/football/preheat', (req) => ({
    success: true,
    preheat: services.football.preheat(req.query.get('match') ?? ''),
  }));
  router.handle('POST', '/api/football/bind', (req) =>
    services.football.bind((req.body ?? {}) as Record<string, unknown>),
  );
  router.handle('GET', '/api/scores', () => services.football.legacyScores());
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('footballSchedule', () => services.football.schedule());
  router.handle('footballResolve', async (input, ctx) => {
    const result = await services.football.resolve(input.query, { signal: ctx.signal });
    return { ...result, scan: v1ScanRef(result.scan) };
  });
  router.handle('footballPreheat', (input) => ({
    preheat: services.football.preheat(input.params.matchId),
  }));
  router.handle('footballBind', async (input) => {
    const { binding, channelBindings } = await services.football.bind(input.body);
    return { binding, channelBindings };
  });
  router.handle('scores', () => services.football.scores());
}
