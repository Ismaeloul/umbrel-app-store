/* Motor AceStream en /api/v1: estado con histéresis del vigilante del
   backend (arquitectura §5.5, A17) y reinicio. Gemelas de
   /api/engine/status y /api/restart-engine. */

import { z } from 'zod';
import { IsoDateTimeSchema } from '../../primitives.js';

/**
 * - `online` / `offline`: con histéresis (2 fallos seguidos con alguien
 *   viendo, 3 sin nadie; 2 aciertos para volver).
 * - `restarting`: se ha pedido un reinicio y aún no ha dado 2 respuestas buenas.
 * - `unknown`: todavía no se ha preguntado (recién arrancado).
 */
export const EngineStateSchema = z.enum(['online', 'offline', 'restarting', 'unknown']);
export type EngineState = z.infer<typeof EngineStateSchema>;

export const EngineStatusSchema = z.strictObject({
  status: EngineStateSchema,
  online: z.boolean(),
  /** Desde cuándo está en este estado. */
  since: IsoDateTimeSchema.nullable(),
  /** Última vez que se preguntó al motor. */
  checkedAt: IsoDateTimeSchema.nullable(),
  /** Versión que da `get_version` ("3.2.3"), si respondió alguna vez. */
  engineVersion: z.string().nullable(),
  /** Cupo de reinicios automáticos: como mucho 3 por hora (arquitectura §5.5). */
  autoRestarts: z.strictObject({
    lastHour: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    nextAllowedAt: IsoDateTimeSchema.nullable(),
    exhausted: z.boolean(),
  }),
});
export type EngineStatus = z.infer<typeof EngineStatusSchema>;

export const EngineRestartResponseSchema = z.strictObject({ restarted: z.literal(true) });
export type EngineRestartResponse = z.infer<typeof EngineRestartResponseSchema>;
