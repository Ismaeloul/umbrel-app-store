/* Rutas del módulo `sources`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.14-4.16; cuerpo sin
   validar, normalizado como hoy):
   - POST /api/sources/report   → { success, report, scan }      (400 bad_request)
   - POST /api/sources/outcome  → { success, hash, proveedor }    (400 bad_outcome)
   - POST /api/sources/feedback → { success, feedback, learningCount } (400 bad_feedback)

   v1 (tabla de @ace/shared/routes.ts), las mismas sin `success`; la
   referencia al trabajo del comprobador apunta a /api/v1/football/scans/:id:
   - sourcesReport, sourcesOutcome, sourcesFeedback. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import { v1ScanRef } from '../scanner/jobs.js';
import type { ReportOptions } from './types.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/sources/report',
  'POST /api/sources/outcome',
  'POST /api/sources/feedback',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'sourcesReport',
  'sourcesOutcome',
  'sourcesFeedback',
];

type LooseBody = Record<string, unknown>;

/**
 * Respaldo del canal del informe con la agenda (api.md §4.14). FootballService
 * no expone todavía `programChannels(matchId)` (pedido en
 * docs/cobertura/sources.md): se usa si existe y, si no o si falla, el informe
 * se queda sin canal, como un partido que ya no está en la agenda.
 */
export function reportOptions(services: Services): ReportOptions {
  return {
    programChannels: (matchId) => {
      const football = services.football as unknown as {
        readonly programChannels?: (id: string) => unknown;
      };
      try {
        const channels =
          typeof football.programChannels === 'function' ? football.programChannels(matchId) : null;
        return Array.isArray(channels)
          ? channels.filter((channel): channel is string => typeof channel === 'string')
          : [];
      } catch {
        return [];
      }
    },
  };
}

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('POST', '/api/sources/report', async (req) => ({
    success: true,
    ...(await services.sources.report(req.body as LooseBody, reportOptions(services))),
  }));
  router.handle('POST', '/api/sources/outcome', async (req) => ({
    success: true,
    ...(await services.sources.outcome(req.body as LooseBody)),
  }));
  router.handle('POST', '/api/sources/feedback', async (req) => ({
    success: true,
    ...(await services.sources.feedback(req.body as LooseBody)),
  }));
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('sourcesReport', async (input) => {
    const result = await services.sources.report(input.body, reportOptions(services));
    return { report: result.report, scan: result.scan ? v1ScanRef(result.scan) : null };
  });
  router.handle('sourcesOutcome', (input) => services.sources.outcome(input.body));
  router.handle('sourcesFeedback', (input) => services.sources.feedback(input.body));
}
