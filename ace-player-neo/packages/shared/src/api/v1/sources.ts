/* Informes, resultados de reproducción y correcciones de fuentes en
   /api/v1 (api.md §4.14-4.16), sin `success`. */

import { z } from 'zod';
import {
  ChannelFeedbackSchema,
  SourceReportReasonSchema,
  SourceStatEntrySchema,
} from '../../state/v1.js';
import { OutcomeResultSchema, PublicSourceReportSchema, ScanRefSchema } from '../common.js';

/** Reportar una fuente: cuarentena y recomprobación prioritaria (B-052, B-053). */
export const ReportBodySchema = z.strictObject({
  id: z.string().min(1).max(2048),
  /** Cualquier otro valor pasa a `not_starting`, como hoy. */
  reason: SourceReportReasonSchema.optional(),
  channel: z.string().max(200).optional(),
  matchId: z.string().max(100).optional(),
  title: z.string().max(200).optional(),
  source: z.string().max(60).optional(),
  ih: z.boolean().optional(),
});
export type ReportBody = z.infer<typeof ReportBodySchema>;

export const ReportResponseSchema = z.strictObject({
  report: PublicSourceReportSchema,
  /** null si no hay comprobador. En la 0.7.0 el informe no se queda en `checking` para siempre (api.md §6.8). */
  scan: ScanRefSchema.nullable(),
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

/** Resultado real de reproducir una fuente (B-055, B-056). `sigue` renueva el veredicto sin contar. */
export const OutcomeBodySchema = z.strictObject({
  id: z.string().min(1).max(2048),
  resultado: OutcomeResultSchema,
  /** Recortado a 0..86400. */
  segundos: z.number().optional(),
  title: z.string().max(200).optional(),
  listaId: z.string().max(64).optional(),
  source: z.string().max(60).optional(),
});
export type OutcomeBody = z.infer<typeof OutcomeBodySchema>;

export const OutcomeResponseSchema = z.strictObject({
  hash: SourceStatEntrySchema.nullable(),
  proveedor: SourceStatEntrySchema.nullable(),
});
export type OutcomeResponse = z.infer<typeof OutcomeResponseSchema>;

/** "Es el canal correcto" / "no es este canal" (B-054). Hace falta `channel` o `channelKey`. */
export const FeedbackBodySchema = z.strictObject({
  id: z.string().min(1).max(2048),
  verdict: z.enum(['correct', 'incorrect']),
  channel: z.string().max(200).optional(),
  channelKey: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  reason: SourceReportReasonSchema.optional(),
});
export type FeedbackBody = z.infer<typeof FeedbackBodySchema>;

export const FeedbackResponseSchema = z.strictObject({
  feedback: ChannelFeedbackSchema,
  learningCount: z.number().int().nonnegative(),
});
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
