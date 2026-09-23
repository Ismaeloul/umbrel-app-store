/* Registro de fallos por causa (arquitectura §5.14). Lo llenan el backend
   (motor, fuentes, red, códecs) y los clientes con POST /api/v1/diagnostics;
   lo consulta el panel de salud. Se guarda en memoria (500) y en
   v2/diagnostics.jsonl rotado a 1 MiB. */

import { z } from 'zod';
import {
  DeviceIdSchema,
  HashSchema,
  IsoDateTimeSchema,
  SessionIdSchema,
  ShortCodeSchema,
} from '../../primitives.js';

/**
 * - `engine`: motor caído, apertura fallida, reinicio.
 * - `source`: sin pares, entrada insuficiente, fuente caída.
 * - `network`: plazos, DNS, 5xx de terceros.
 * - `codec`: `unsupported_codec`, audio que no decodifica, ffmpeg que muere por códec.
 * - `client`: errores del reproductor, autoplay bloqueado, latido perdido.
 * - `state`: lo guardado en disco (state.json, v2/*.json) no se pudo leer y
 *   se apartó ("estado ilegible", arquitectura §5.4). Añadida en el paso 1.3.
 */
export const DIAGNOSTIC_CAUSES = [
  'engine',
  'source',
  'network',
  'codec',
  'client',
  'state',
] as const;
export const DiagnosticCauseSchema = z.enum(DIAGNOSTIC_CAUSES);
export type DiagnosticCause = z.infer<typeof DiagnosticCauseSchema>;

/** Métricas del reproductor que hoy no existen (reproductor §10). */
export const PlayerMetricsSchema = z.strictObject({
  /** Tiempo hasta la primera imagen. */
  timeToFirstFrameMs: z.number().nonnegative().optional(),
  /** Arranque del remux, visto desde el cliente. */
  remuxStartMs: z.number().nonnegative().optional(),
  rebuffers: z.number().int().nonnegative().optional(),
  rebufferMs: z.number().nonnegative().optional(),
  reconnects: z.number().int().nonnegative().optional(),
  /** Retraso respecto al directo, en segundos. */
  liveLatencyS: z.number().nonnegative().optional(),
});
export type PlayerMetrics = z.infer<typeof PlayerMetricsSchema>;

export const DiagnosticEntrySchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  at: IsoDateTimeSchema,
  cause: DiagnosticCauseSchema,
  code: ShortCodeSchema,
  message: z.string().max(500),
  hash: HashSchema.optional(),
  channel: z.string().max(120).optional(),
  deviceId: DeviceIdSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  requestId: z.string().max(128).optional(),
  metrics: PlayerMetricsSchema.optional(),
});
export type DiagnosticEntry = z.infer<typeof DiagnosticEntrySchema>;

export const DiagnosticsQuerySchema = z.strictObject({
  cause: DiagnosticCauseSchema.optional(),
  /** Solo lo posterior a esta fecha. */
  since: IsoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type DiagnosticsQuery = z.infer<typeof DiagnosticsQuerySchema>;

export const DiagnosticCountsSchema = z.strictObject({
  engine: z.number().int().nonnegative(),
  source: z.number().int().nonnegative(),
  network: z.number().int().nonnegative(),
  codec: z.number().int().nonnegative(),
  client: z.number().int().nonnegative(),
  state: z.number().int().nonnegative(),
});

export const DiagnosticsListResponseSchema = z.strictObject({
  /** Del más reciente al más antiguo. */
  entries: z.array(DiagnosticEntrySchema),
  /** Recuento por causa de las últimas 24 h. */
  counts24h: DiagnosticCountsSchema,
  total: z.number().int().nonnegative(),
});
export type DiagnosticsListResponse = z.infer<typeof DiagnosticsListResponseSchema>;

/** Lo que manda un cliente. El servidor pone `id`, `at`, `deviceId` y `requestId`. */
export const DiagnosticReportBodySchema = z.strictObject({
  cause: DiagnosticCauseSchema.default('client'),
  code: ShortCodeSchema,
  message: z.string().max(500).default(''),
  hash: HashSchema.optional(),
  channel: z.string().max(120).optional(),
  sessionId: SessionIdSchema.optional(),
  metrics: PlayerMetricsSchema.optional(),
});
export type DiagnosticReportBody = z.infer<typeof DiagnosticReportBodySchema>;

export const DiagnosticReportResponseSchema = z.strictObject({
  accepted: z.literal(true),
  id: z.string(),
});
export type DiagnosticReportResponse = z.infer<typeof DiagnosticReportResponseSchema>;
