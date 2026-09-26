/* Piezas de respuesta que comparten las rutas antiguas y las /api/v1
   (api.md §3). Las antiguas les añaden `success: true` y sus rarezas en
   legacy.ts; las v1 las usan tal cual en api/v1/*. */

import { z } from 'zod';
import {
  DateOnlySchema,
  EpochMsSchema,
  HashSchema,
  HexColorSchema,
  IsoDateTimeSchema,
  SafeIdSchema,
  ScanJobIdSchema,
} from '../primitives.js';
import {
  ItemSchema,
  SourceReportReasonSchema,
  SourceReportStateSchema,
  WebSourceTypeSchema,
} from '../state/v1.js';
import { IPTV_NAME_MAX } from '../constants/iptv.js';

/** Resumen público de un directorio (`sourceSummaries`, server.js:948-952): sin streams, renombres ni ocultos. */
export const WebSourceSummarySchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  name: z.string().min(1).max(60),
  url: z.string(),
  type: WebSourceTypeSchema,
  /** Canales visibles (tras ocultos). */
  count: z.number().int().nonnegative(),
  syncedAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  /** Solo si hay `lastErrorAt`. */
  lastError: z.string().nullable(),
});
export type WebSourceSummary = z.infer<typeof WebSourceSummarySchema>;

// --- Agenda (api.md §3.12) ---

export const FootballChannelRefSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
});

export const FootballSourceSchema = z.enum(['futbolenlatv', 'movistarplus', 'thesportsdb', 'demo']);

/**
 * Escudo y colores de un equipo, resueltos por el módulo `teams` desde
 * TheSportsDB y cacheados en el volumen de datos. Solo aparece en
 * `GET /api/v1/football` (nunca en la ruta antigua) y solo cuando el índice
 * sabe algo del equipo: si falta, el cliente pinta un escudo generado y un
 * color derivado del nombre. Los clientes nunca enlazan imágenes de terceros.
 */
export const TeamBadgeSchema = z.strictObject({
  /** `idTeam` de TheSportsDB, o `k-<clave>` si solo hay colores fijados a mano. */
  id: SafeIdSchema,
  /** Nombre según TheSportsDB (para depurar y para el `alt`). */
  name: z.string(),
  /** Abreviatura de hasta 4 letras (`RMA`), si la hay. */
  short: z.string().max(4).nullable(),
  /** `/api/v1/football/teams/<id>/crest?v=<etag>` (mismo origen; iOS le antepone su base y `/native`). */
  crest: z.string().startsWith('/').nullable(),
  colors: z
    .strictObject({ primary: HexColorSchema, secondary: HexColorSchema.nullable() })
    .nullable(),
});
export type TeamBadge = z.infer<typeof TeamBadgeSchema>;

/** Logo de la competición, mismo circuito que los escudos. */
export const CompetitionBadgeSchema = z.strictObject({
  /** `idLeague` de TheSportsDB. */
  id: SafeIdSchema,
  name: z.string(),
  /** `/api/v1/football/competitions/<id>/logo?v=<etag>`. */
  logo: z.string().startsWith('/').nullable(),
});
export type CompetitionBadge = z.infer<typeof CompetitionBadgeSchema>;

export const FootballMatchSchema = z.strictObject({
  /** `fltv-<fecha>-<posición>`, `epg-…`, id de TheSportsDB o `demo-N`. En la 0.7.0, estable (arquitectura §5.10). */
  id: z.string().min(1),
  date: DateOnlySchema,
  /** "HH:MM" en hora de Madrid, o "Por confirmar" (TheSportsDB). */
  time: z.string(),
  /** Hoy solo lo trae futbolenlatv; en la 0.7.0, todas las fuentes que puedan (backend-modulos §9.6). */
  start: EpochMsSchema.optional(),
  title: z.string(),
  home: z.string(),
  /** "" si no se pudo separar. */
  away: z.string(),
  /** "Fútbol" si no se sabe. */
  competition: z.string(),
  country: z.string(),
  channels: z.array(FootballChannelRefSchema),
  /** Escudos y colores (módulo `teams`): solo en /api/v1 y solo si se conocen. `home`/`away` siguen siendo texto. */
  homeTeam: TeamBadgeSchema.optional(),
  awayTeam: TeamBadgeSchema.optional(),
  /** Logo de la competición, si se conoce. `competition` sigue siendo texto. */
  competitionBadge: CompetitionBadgeSchema.optional(),
});
export type FootballMatch = z.infer<typeof FootballMatchSchema>;

export const FootballDaySchema = z.strictObject({
  date: DateOnlySchema,
  matches: z.array(FootballMatchSchema),
});

/** Agenda sin el `success` de la ruta antigua. */
export const FootballScheduleSchema = z.strictObject({
  generatedAt: IsoDateTimeSchema,
  timezone: z.literal('Europe/Madrid'),
  country: z.string(),
  source: FootballSourceSchema,
  /** "futbolenlatv.com", "EPG de Movistar Plus+", "TheSportsDB" o "Datos de muestra". */
  attribution: z.string(),
  demo: z.boolean(),
  /** Solo true con TheSportsDB y la clave pública "123". */
  limited: z.boolean(),
  partial: z.boolean(),
  days: z.array(FootballDaySchema),
  /** Solo si falló el refresco y se sirve la última agenda buena. */
  stale: z.literal(true).optional(),
});
export type FootballSchedule = z.infer<typeof FootballScheduleSchema>;

/** Marcador de un partido (api.md §4.13). */
export const LiveScoreSchema = z.strictObject({
  home: z.number(),
  away: z.number(),
  /** "pre" | "in" | "post" | "" */
  state: z.string(),
  clock: z.string(),
  detail: z.string(),
  /** 0..1 con dos decimales. */
  confidence: z.number().min(0).max(1),
});
export type LiveScore = z.infer<typeof LiveScoreSchema>;

// --- Resolución (api.md §3.13-3.14) ---

/** `iptv`: canal de la IPTV de Isma, con id sintético de 40 hex (docs/iptv.md §4.1 y §5.1). */
export const CandidateSourceSchema = z.enum([
  'saved',
  'm3u',
  'favorites',
  'history',
  'acestream',
  'iptv',
]);
export type CandidateSource = z.infer<typeof CandidateSourceSchema>;

/** Calidad que declara el nombre del canal IPTV (FHD, HD, 4K, SD); `null` si no lleva marca. */
export const IptvQualitySchema = z.enum(['uhd', 'fhd', 'hd', 'sd']);
export type IptvQuality = z.infer<typeof IptvQualitySchema>;

/**
 * Lo propio de una candidata `source: 'iptv'` (docs/iptv.md §5.1). Sale una
 * por canal: las demás variantes (HD, reserva) se quedan en el servidor como
 * respaldo del relé. Nunca lleva URLs ni credenciales.
 */
export const CandidateIptvInfoSchema = z.strictObject({
  /** Nombre que puso Isma al proveedor («Casa»). */
  provider: z.string().max(IPTV_NAME_MAX),
  quality: IptvQualitySchema.nullable(),
  /** La mejor variante es una reserva («Backup», «Alt»…). */
  backup: z.boolean(),
  /** Confirmada por la guía (no se enseña; diagnóstico y tests). */
  guide: z.boolean(),
});
export type CandidateIptvInfo = z.infer<typeof CandidateIptvInfoSchema>;

export const ResolutionCandidateSchema = z.strictObject({
  id: HashSchema,
  title: z.string(),
  alias: z.string().nullable(),
  ih: z.boolean(),
  source: CandidateSourceSchema,
  /** 0..100 (98 si hay corrección "correct"; la IA sube hasta 94). */
  score: z.number(),
  matchedChannel: z.string(),
  soloFamilia: z.boolean(),
  familyFallbackAllowed: z.boolean(),
  listaId: z.string().nullable(),
  availability: z.number().nullable(),
  bitrate: z.number().nullable(),
  learned: z.enum(['correct', 'incorrect']).nullable(),
  /** Siempre null en la práctica: lo que tiene cuarentena se descarta (api.md §6.3). */
  reported: z
    .strictObject({
      reason: SourceReportReasonSchema,
      state: SourceReportStateSchema,
      quarantineUntil: z.string().nullable(),
    })
    .nullable(),
  rejectedByLearning: z.boolean(),
  quarantined: z.boolean(),
  semantic: z.literal(true).optional(),
  semanticSimilarity: z.number().optional(),
  /** Solo con `source: 'iptv'` (docs/iptv.md §5.1). */
  iptv: CandidateIptvInfoSchema.optional(),
});
export type ResolutionCandidate = z.infer<typeof ResolutionCandidateSchema>;

export const AiInfoSchema = z.strictObject({
  enabled: z.boolean(),
  used: z.boolean(),
  model: z.string().nullable(),
  catalogSize: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

/**
 * Partido del catálogo de programación (`footballProgramMatch`,
 * server.js:2686-2697). En la rama precargada de la resolución llega el
 * partido completo de la agenda con `channels` como texto, así que aquí se
 * admiten campos de más.
 */
export const ProgramMatchSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  home: z.string(),
  away: z.string(),
  competition: z.string(),
  date: z.string(),
  time: z.string(),
  start: z.number().nullable().optional(),
  channels: z.array(z.string()),
});

/** Referencia a un trabajo del comprobador (server.js:3583-3588). */
export const ScanRefSchema = z.strictObject({
  id: ScanJobIdSchema,
  /** `/api/football/scan?id=<id>` en las rutas antiguas; `/api/v1/football/scans/<id>` en v1. */
  statusUrl: z.string(),
  total: z.number().int().nonnegative(),
  initialCount: z.number().int().nonnegative(),
});
export type ScanRef = z.infer<typeof ScanRefSchema>;

export const PreheatStageSchema = z.enum(['discovery', 'scan', 'kickoff', 'live']);
export const PreheatStatusSchema = z.enum([
  'resolving',
  'discovered',
  'no_sources',
  'scanning',
  'scanner_offline',
  'ready',
  'failed',
]);

/** Precalentado de un partido (`publicPreheatRecord`, server.js:4348-4361). */
export const PreheatPublicSchema = z.strictObject({
  matchId: z.string(),
  stage: PreheatStageSchema,
  status: PreheatStatusSchema,
  updatedAt: IsoDateTimeSchema.nullable(),
  candidateCount: z.number().int().nonnegative(),
  checked: z.number().int().nonnegative(),
  playable: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** "" si no hubo error; hasta 80. */
  error: z.string().max(80),
});
export type PreheatPublic = z.infer<typeof PreheatPublicSchema>;

export const ResolutionStatusSchema = z.enum(['found', 'choices', 'not_found']);

/** Resolución de un partido sin el `success` de la ruta antigua (api.md §4.9). */
export const ResolutionSchema = z.strictObject({
  status: ResolutionStatusSchema,
  channels: z.array(z.string()),
  checked: z.array(z.string()),
  /** Solo con "found" (null posible en la rama precargada con "not_found"). */
  candidate: ResolutionCandidateSchema.nullable().optional(),
  candidates: z.array(ResolutionCandidateSchema),
  engineAvailable: z.boolean(),
  ai: AiInfoSchema,
  program: ProgramMatchSchema.nullable(),
  research: z.boolean(),
  preheated: z.literal(true).optional(),
  preheat: PreheatPublicSchema.nullable(),
  scan: ScanRefSchema.nullable(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

// --- Comprobador (api.md §3.15) ---

export const ScanJobKindSchema = z.enum(['interactive', 'research', 'preheat', 'report']);
export type ScanJobKind = z.infer<typeof ScanJobKindSchema>;
export const ScanJobStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'complete',
  'cancelled',
]);
export type ScanJobStatus = z.infer<typeof ScanJobStatusSchema>;
/** `retry_wait` se publica como `failed` con `retryAt`. */
export const ScanCandidateStateSchema = z.enum(['queued', 'checking', 'working', 'weak', 'failed']);
export type ScanCandidateState = z.infer<typeof ScanCandidateStateSchema>;
/** Veredicto de una fuente: floja se puede reproducir con aviso, fallida sale del selector. */
export const VerdictStateSchema = z.enum(['working', 'weak', 'failed']);
export type VerdictState = z.infer<typeof VerdictStateSchema>;

/**
 * Dónde se puede reproducir una fuente (D6): una HEVC es `unsupported_codec`
 * para la web pero reproducible en iOS (el remux la pasa a fMP4 sin
 * transcodificar). Añadido en el paso 1.3.
 */
export const PlayableOnSchema = z.strictObject({
  web: z.boolean(),
  ios: z.boolean(),
});
export type PlayableOn = z.infer<typeof PlayableOnSchema>;

export const ScanCandidateSchema = z.strictObject({
  id: HashSchema,
  state: ScanCandidateStateSchema,
  checkedAt: z.string().nullable(),
  retryAt: IsoDateTimeSchema.nullable(),
  durationMs: z.number().nonnegative(),
  bytes: z.number().nonnegative(),
  peers: z.number().nonnegative(),
  speedDown: z.number().nonnegative(),
  rateKbps: z.number().nullable(),
  intakeKbps: z.number().nullable(),
  streamKbps: z.number().nonnegative(),
  /** playable_media, starved, timeout, unsupported_codec, player_ok… (api.md §3.15). */
  reason: z.string(),
  mediaValid: z.boolean(),
  browserCompatible: z.boolean(),
  videoCodec: z.string(),
  audioCodecs: z.array(z.string()),
  cached: z.boolean(),
  attempts: z.number().int().nonnegative(),
  /**
   * D6. Solo en /api/v1 y solo cuando ya hay veredicto (`working`, `weak` o
   * `failed`); la ruta antigua `/api/football/scan` no lo lleva.
   */
  playableOn: PlayableOnSchema.optional(),
});
export type ScanCandidate = z.infer<typeof ScanCandidateSchema>;

/** Trabajo del comprobador sin el `success` de la ruta antigua (`scannerJobPayload`, server.js:3376-3418). */
export const ScanJobSchema = z.strictObject({
  id: ScanJobIdSchema,
  kind: ScanJobKindSchema,
  status: ScanJobStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  total: z.number().int().nonnegative(),
  checked: z.number().int().nonnegative(),
  playable: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  retryAt: IsoDateTimeSchema.nullable(),
  initialCount: z.number().int().nonnegative(),
  candidates: z.array(ScanCandidateSchema),
});
export type ScanJob = z.infer<typeof ScanJobSchema>;

// --- Fuentes (api.md §3.7) ---

/** Subconjunto público de un informe (`publicSourceReport`, server.js:4471-4485). */
export const PublicSourceReportSchema = z.strictObject({
  reportId: z.string(),
  id: HashSchema,
  channel: z.string(),
  matchId: z.string(),
  reason: SourceReportReasonSchema,
  state: SourceReportStateSchema,
  checkReason: z.string(),
  reportedAt: IsoDateTimeSchema,
  lastCheckedAt: IsoDateTimeSchema.nullable(),
  quarantineUntil: IsoDateTimeSchema.nullable(),
});
export type PublicSourceReport = z.infer<typeof PublicSourceReportSchema>;

/** Resultado real de reproducir una fuente (`POST /api/sources/outcome`). */
export const OutcomeResultSchema = z.enum(['arranco', 'fallo', 'cayo', 'sigue']);
export type OutcomeResult = z.infer<typeof OutcomeResultSchema>;

// --- Búsqueda en el motor (api.md §4.20) ---

export const SearchResultSchema = z.strictObject({
  id: HashSchema,
  title: z.string(),
  /** Por defecto "Busqueda" (sin tilde, como hoy). */
  category: z.string(),
  availability: z.number().nullable(),
  bitrate: z.number().nullable(),
  /** Siempre true: el buscador da infohashes. */
  ih: z.literal(true),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/** Biblioteca: la usa también la vista de directorios. */
export const LibraryItemSchema = ItemSchema;
