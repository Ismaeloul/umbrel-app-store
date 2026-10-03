/* «Descargar logs» en la demo: lo que hay guardado (y el envío de errores
   de la web, que en la demo no va a ninguna parte). El zip de muestra está
   en demo-zip.ts y solo se descarga al pulsar «Descargar logs». */

import { LOG_STORE_MAX_BYTES, LOG_STORE_MAX_DAYS, type DiagnosticsLogInfo } from '@ace/shared';
import { registerDemoHandlers } from '../../api/demo-registry.ts';

const DAY = 24 * 60 * 60 * 1000;

/** Lo guardado en la demo: 12 días, 1,4 MB. */
export function demoLogInfo(now = Date.now()): DiagnosticsLogInfo {
  return {
    enabled: true,
    since: new Date(now - 12 * DAY).toISOString(),
    days: 12,
    bytes: 1_468_006,
    maxBytes: LOG_STORE_MAX_BYTES,
    maxDays: LOG_STORE_MAX_DAYS,
  };
}

let registered = false;

/** Registra lo que contesta la demo (una sola vez). */
export function registerLogsDemo(): void {
  if (registered) return;
  registered = true;
  registerDemoHandlers({
    diagnosticsLogInfo: () => demoLogInfo(),
    diagnosticsWebLog: ({ body }) => ({ accepted: body.entries.length, dropped: 0 }),
  });
}
