/* Módulo `diagnostics`: registro de fallos por causa (arquitectura §5.14).

   Causas: `engine` (motor caído, apertura fallida, reinicio), `source` (sin
   pares, entrada insuficiente), `network` (plazos, DNS, 5xx de terceros),
   `codec` (`unsupported_codec`, ffmpeg que muere por códec) y `client`
   (errores que manda el propio reproductor). En memoria (500 entradas) y en
   v2/diagnostics.jsonl rotado a 1 MiB.

   Los demás módulos NO dependen de este: emiten `diagnostics.report` en el
   bus y este lo anota y emite `diagnostics.new` (así el motor o el
   comprobador no crean ciclos con la salud).

   Tests previstos: plan E1.7 (rotación, recuento de 24 h, límite de
   informes de clientes). */

import type {
  DiagnosticCause,
  DiagnosticEntry,
  DiagnosticReportBody,
  DiagnosticReportResponse,
  DiagnosticsListResponse,
  DiagnosticsQuery,
} from '@ace/shared';
import type { DiagnosticReport } from '../../core/bus.js';
import type { AuthenticatedDevice, CoreDeps, Lifecycle } from '../../core/module.js';

export type DiagnosticsDeps = CoreDeps;

export interface DiagnosticsService extends Lifecycle {
  /** Anota un fallo del backend (también llega por `diagnostics.report`). */
  record(report: DiagnosticReport): DiagnosticEntry;
  /** POST /api/v1/diagnostics: lo manda un cliente (con límite, `rate_limited`). */
  report(
    body: DiagnosticReportBody,
    context: { readonly requestId: string; readonly device: AuthenticatedDevice | null },
  ): Promise<DiagnosticReportResponse>;
  /** GET /api/v1/diagnostics. */
  list(query: DiagnosticsQuery): DiagnosticsListResponse;
  /** Recuento por causa de las últimas 24 h (salud). */
  counts24h(): Readonly<Record<DiagnosticCause, number>>;
}
