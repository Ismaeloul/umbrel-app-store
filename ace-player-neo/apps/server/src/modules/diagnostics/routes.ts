/* Rutas del módulo `diagnostics`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   (ninguna: la 0.6.59 solo escribía en la consola)

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - diagnosticsList: GET /api/v1/diagnostics?cause=&since=&limit=
   - diagnosticsReport: POST /api/v1/diagnostics (con límite, 429 `rate_limited`)
   - diagnosticsExport: POST /api/v1/diagnostics/export, solo web («Descargar
     fallos» de Salud, export.ts): el fichero redactado, como descarga.
   - diagnosticsLogInfo: GET /api/v1/diagnostics/log, solo web («Descargar
     logs» de Ajustes → Registro, logs.ts): cuánto registro hay en el disco.
   - diagnosticsLogDownload: POST /api/v1/diagnostics/log/download, solo web:
     el zip del registro del periodo, como descarga.
   - diagnosticsWebLog: POST /api/v1/diagnostics/web-log, solo web: los
     errores de la web, al registro. */

import { finished } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { logStoreOf } from '../../core/logger.js';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import { buildDiagnosticsExport, exportFileName } from './export.js';
import { buildLogsZip, disabledLogInfo, intakeOf } from './logs.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'diagnosticsList',
  'diagnosticsReport',
  'diagnosticsExport',
  'diagnosticsLogInfo',
  'diagnosticsLogDownload',
  'diagnosticsWebLog',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

/* Espera a que la respuesta binaria termine de salir (o a que el cliente cuelgue). */
function settle(reply: FastifyReply): Promise<void> {
  return new Promise((resolve) => {
    finished(reply.raw, () => {
      if (!reply.sent) reply.hijack();
      resolve();
    });
  });
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('diagnosticsList', (input) => services.diagnostics.list(input.query));
  router.handle('diagnosticsReport', (input, ctx) =>
    services.diagnostics.report(input.body, { requestId: ctx.requestId, device: ctx.device }),
  );
  router.handle('diagnosticsExport', async ({ body }, ctx) => {
    const file = await buildDiagnosticsExport(services, body);
    // Sale como descarga, como la copia de seguridad; nunca se guarda en el NAS.
    ctx.reply.header(
      'content-disposition',
      `attachment; filename="${exportFileName(Date.parse(file.createdAt))}"`,
    );
    ctx.reply.header('cache-control', 'no-store');
    return file;
  });
  router.handle('diagnosticsLogInfo', async () => {
    const store = logStoreOf(services.logger);
    return store ? store.info() : disabledLogInfo();
  });
  router.handle('diagnosticsLogDownload', async ({ body }, ctx) => {
    const { name, zip } = await buildLogsZip(services, body);
    void ctx.reply
      .code(200)
      .headers({
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${name}"`,
        'content-length': String(zip.length),
        'cache-control': 'no-store',
      })
      .send(zip);
    await settle(ctx.reply);
  });
  router.handle('diagnosticsWebLog', ({ body }) => {
    const store = logStoreOf(services.logger);
    if (!store) return { accepted: 0, dropped: body.entries.length };
    return intakeOf(store, services.clock).accept(body);
  });
}
