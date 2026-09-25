/* Rutas del módulo `teams`.

   Antiguas: ninguna (módulo nuevo; la 0.6.59 no servía imágenes).

   v1 (tabla de @ace/shared/routes.ts; acceso, validación y errores en app.ts):
   - footballTeamCrest: GET /api/v1/football/teams/:teamId/crest?v= → PNG con
     ETag, Last-Modified y Cache-Control; 304 con If-None-Match; 404 `not_found`
   - footballCompetitionLogo: GET /api/v1/football/competitions/:competitionId/logo?v=
   La agenda decorada (`homeTeam`, `awayTeam`, `competitionBadge`) sale por
   `footballSchedule`, que es de football (football/routes.ts). Un HEAD da 404
   (`exposeHeadRoutes: false`): los navegadores no hacen HEAD a imágenes. */

import type { RequestContext } from '../../core/module.js';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (ninguna). */
export const LEGACY_ROUTES: readonly string[] = [];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['footballTeamCrest', 'footballCompetitionLogo'];

/** `If-None-Match` de la petición (la primera si viniera repetida). */
export function ifNoneMatchOf(ctx: RequestContext): string | undefined {
  const value = ctx.request.headers['if-none-match'];
  return Array.isArray(value) ? value[0] : value;
}

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('footballTeamCrest', (input, ctx) =>
    services.teams.serveCrest(ctx.reply, input.params.teamId, {
      ifNoneMatch: ifNoneMatchOf(ctx),
      version: input.query.v,
    }),
  );
  router.handle('footballCompetitionLogo', (input, ctx) =>
    services.teams.serveCompetitionLogo(ctx.reply, input.params.competitionId, {
      ifNoneMatch: ifNoneMatchOf(ctx),
      version: input.query.v,
    }),
  );
}
