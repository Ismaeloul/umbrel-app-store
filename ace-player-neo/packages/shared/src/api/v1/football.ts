/* Agenda, resolución, comprobador, precalentado, vínculos y marcadores en
   /api/v1. Mismo comportamiento que las rutas antiguas de fútbol (api.md
   §4.8-4.13), sin `success` y con los ids en la ruta en vez de en la query. */

import { z } from 'zod';
import { HashSchema, ScanJobIdSchema, IsoDateTimeSchema, SafeIdSchema } from '../../primitives.js';
import { ChannelBindingSchema } from '../../state/v1.js';
import {
  FootballScheduleSchema,
  LiveScoreSchema,
  PreheatPublicSchema,
  ResolutionSchema,
  ScanJobSchema,
} from '../common.js';

export const FootballScheduleResponseSchema = FootballScheduleSchema;

/**
 * GET /api/v1/football/resolve. `channel` se repite; se ignora si `match` es
 * un partido de la agenda con canales. `research=1` es "Rebuscar": pasada
 * nueva sin vínculos ni precalentado, con `current` (y `currentIh=1`) para
 * seguir comprobando la fuente que se ve. `client` cancela el trabajo
 * anterior del mismo cliente.
 *
 * `scope=channel` (docs/iptv.md §5.2): canal suelto, sin `match`. Solo
 * vínculos guardados, biblioteca e IPTV; ni buscador del motor ni IA. Sin
 * ninguna IPTV responde `not_found` sin trabajo del comprobador. Ausente es
 * `match`, lo de siempre.
 */
export const ResolveScopeSchema = z.enum(['match', 'channel']);
export type ResolveScope = z.infer<typeof ResolveScopeSchema>;

export const ResolveQuerySchema = z.strictObject({
  match: z.string().max(100).optional(),
  channel: z.union([z.string().max(200), z.array(z.string().max(200)).max(32)]).optional(),
  research: z.enum(['0', '1']).optional(),
  current: z.string().max(2048).optional(),
  currentIh: z.enum(['0', '1']).optional(),
  client: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,40}$/)
    .optional(),
  scope: ResolveScopeSchema.optional(),
  /**
   * Solo con `scope=channel` (docs/iptv.md §14.4): el canal IPTV tocado, o el
   * hash tocado si no se sabe. Si es del catálogo vigente, sale primero con su
   * mejor variante; si no, se ignora y manda el emparejado por nombre.
   */
  iptv: HashSchema.optional(),
  /** Solo con `scope=channel`: '1' busca también en el motor AceStream (búsqueda inversa, 2 consultas, ≥ 92). */
  engine: z.enum(['0', '1']).optional(),
});
export type ResolveQuery = z.infer<typeof ResolveQuerySchema>;

export const ResolveResponseSchema = ResolutionSchema;

export const ScanParamsSchema = z.strictObject({ id: ScanJobIdSchema });
export const ScanResponseSchema = ScanJobSchema;

export const PreheatParamsSchema = z.strictObject({ matchId: z.string().min(1).max(100) });
export const PreheatResponseSchema = z.strictObject({ preheat: PreheatPublicSchema.nullable() });

/** POST /api/v1/football/bindings: vincular a mano un canal con un hash (B-149). */
export const BindBodySchema = z.strictObject({
  channel: z.string().min(1).max(200),
  id: z.string().min(1).max(2048),
  title: z.string().max(200).optional(),
  ih: z.boolean().optional(),
});
export type BindBody = z.infer<typeof BindBodySchema>;

export const BindResponseSchema = z.strictObject({
  binding: ChannelBindingSchema,
  channelBindings: z.array(ChannelBindingSchema),
});
export type BindResponse = z.infer<typeof BindResponseSchema>;

/**
 * Marcadores en vivo (ESPN). Una sola forma: sin agenda, `available: false`
 * con 200 (la ruta antigua devuelve `success: false` con 200, api.md §6.10).
 */
export const ScoresResponseSchema = z.strictObject({
  available: z.boolean(),
  generatedAt: IsoDateTimeSchema.nullable(),
  source: z.literal('espn'),
  attribution: z.string().nullable(),
  leagues: z.number().int().nonnegative(),
  scores: z.record(z.string(), LiveScoreSchema),
});
export type ScoresResponse = z.infer<typeof ScoresResponseSchema>;

// --- Escudos y logos (módulo `teams`) ---

/** GET /api/v1/football/teams/:teamId/crest (PNG). */
export const TeamCrestParamsSchema = z.strictObject({ teamId: SafeIdSchema });
/** GET /api/v1/football/competitions/:competitionId/logo (PNG). */
export const CompetitionLogoParamsSchema = z.strictObject({ competitionId: SafeIdSchema });
/**
 * `?v=<etag>`: la versión del fichero que lleva la URL de la agenda. Con
 * ella la respuesta es inmutable un año; sin ella, caché privada de un día.
 */
export const BadgeVersionQuerySchema = z.strictObject({
  v: z
    .string()
    .regex(/^[a-f0-9]{8,16}$/)
    .optional(),
});
