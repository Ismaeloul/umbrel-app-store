/* state.json v1: la forma YA normalizada que escribe y lee la 0.6.59
   (backend-modulos §2). La v2 la conserva exactamente para que una vuelta
   atrás a la 0.6.59 lea el fichero sin perder nada (arquitectura §5.4,
   R-DATOS).

   Estos esquemas describen el resultado de normalizar; la lectura tolerante
   (aceptar `web` sin `webSources`, fechas raras en `syncedAt`, items sin
   hash que se descartan, recortes a los topes…) la hace el módulo `state`
   del servidor, igual que `readState`/`writeState` de la 0.6.59. Si algo
   normalizado no valida aquí, el fallo está en el normalizador. */

import { z } from 'zod';
import { HashSchema, IsoDateTimeSchema } from '../primitives.js';

// --- Topes (server.js:30-38 y 3833): en ./limits.ts, sin zod ---

import {
  MAX_HISTORY,
  MAX_WEB_STREAMS,
  MAX_WEB_SOURCES,
  MAX_FOOTBALL_LEAGUES,
  MAX_FOOTBALL_TEAMS,
  MAX_FOOTBALL_NATIONALITIES,
  MAX_CHANNEL_BINDINGS,
  MAX_SOURCE_REPORTS,
  MAX_CHANNEL_FEEDBACK,
  TEXT_LIMITS,
} from './limits.js';

export {
  MAX_HISTORY,
  MAX_WEB_STREAMS,
  MAX_WEB_SOURCES,
  MAX_FOOTBALL_LEAGUES,
  MAX_FOOTBALL_TEAMS,
  MAX_FOOTBALL_NATIONALITIES,
  MAX_CHANNEL_BINDINGS,
  MAX_SOURCE_REPORTS,
  MAX_CHANNEL_FEEDBACK,
  STATS_MAX_KEYS,
  TEXT_LIMITS,
  DEFAULT_WEB_SOURCE_ID,
} from './limits.js';

// --- Subesquemas ---

export const ItemTypeSchema = z.enum(['fav', 'recent', 'web']);

/** Elemento de favoritos, recientes o de un directorio (`normalizeItem`, server.js:436-457). */
export const ItemSchema = z.strictObject({
  id: HashSchema,
  /** Espacios colapsados, hasta 120. NO quita HTML. Puede quedar vacío si llegó solo con espacios. */
  title: z.string().max(TEXT_LIMITS.itemTitle),
  /** `tvg-id` del M3U; solo si existe y es distinto de `title`. */
  alias: z.string().min(1).max(TEXT_LIMITS.itemAlias).optional(),
  type: ItemTypeSchema,
  category: z.string().max(TEXT_LIMITS.itemCategory),
  /** La del elemento si era válida; si no, la hora de normalizar. */
  date: IsoDateTimeSchema,
  fromWebSync: z.boolean(),
  /** true si el id es un infohash (se reproduce con `?infohash=`). */
  ih: z.boolean(),
});
export type Item = z.infer<typeof ItemSchema>;

export const WebSourceTypeSchema = z.enum(['m3u', 'html']);

/** Directorio guardado (`normalizeWebSource`, server.js:913-946). */
export const WebSourceSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  name: z.string().min(1).max(TEXT_LIMITS.webSourceName),
  /** http o https y sin usuario ni contraseña (`normalizeWebUrl`). */
  url: z.string().regex(/^https?:\/\//i),
  type: WebSourceTypeSchema,
  /** Canales con renombres y ocultos ya aplicados. */
  streams: z.array(ItemSchema).max(MAX_WEB_STREAMS),
  /** `{ <hash>: título }`: sobreviven a la siguiente sincronización (T-036). */
  renames: z.record(HashSchema, z.string().min(1).max(TEXT_LIMITS.itemTitle)),
  hidden: z.array(HashSchema).max(MAX_WEB_STREAMS),
  /** Cualquier texto: la 0.6.59 no valida que sea una fecha. */
  syncedAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastError: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .nullable(),
});
export type WebSource = z.infer<typeof WebSourceSchema>;

/** Preferencias de fútbol (`normalizePreferences`, server.js:486-494). */
export const PreferencesSchema = z.strictObject({
  onboardingComplete: z.boolean(),
  /** Por defecto, `FOOTBALL_COUNTRY` ("Spain"): depende del entorno. */
  country: z.string().min(1).max(TEXT_LIMITS.preferenceCountry),
  leagues: z.array(z.string().min(1).max(TEXT_LIMITS.preferenceLeague)).max(MAX_FOOTBALL_LEAGUES),
  teams: z.array(z.string().min(1).max(TEXT_LIMITS.preferenceTeam)).max(MAX_FOOTBALL_TEAMS),
  nationalities: z
    .array(z.string().min(1).max(TEXT_LIMITS.preferenceNationality))
    .max(MAX_FOOTBALL_NATIONALITIES),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** Vínculo partido-canal hecho a mano (`normalizeChannelBinding`, server.js:839-853). */
export const ChannelBindingSchema = z.strictObject({
  channel: z.string().min(1).max(120),
  /** `normalizeChannelKey(channel)`: clave única de la lista. */
  channelKey: z.string().min(1),
  id: HashSchema,
  title: z.string().min(1).max(120),
  ih: z.boolean(),
  updatedAt: IsoDateTimeSchema,
});
export type ChannelBinding = z.infer<typeof ChannelBindingSchema>;

/** Motivos de un informe de fuente (server.js:2579-2581). */
export const SOURCE_REPORT_REASONS = [
  'not_starting',
  'stuttering',
  'wrong_channel',
  'bad_quality',
  'audio',
] as const;
export const SourceReportReasonSchema = z.enum(SOURCE_REPORT_REASONS);
export type SourceReportReason = z.infer<typeof SourceReportReasonSchema>;

export const SourceReportStateSchema = z.enum([
  'reported',
  'checking',
  'working',
  'weak',
  'failed',
]);
export type SourceReportState = z.infer<typeof SourceReportStateSchema>;

/** Informe de una fuente (`normalizeSourceReport`, server.js:2588-2615). Uno por `id:channelKey:reason`. */
export const SourceReportSchema = z.strictObject({
  /** `[a-zA-Z0-9_-]`, hasta 40; puede quedar vacío si llegó con otros caracteres. */
  reportId: z.string().regex(/^[a-zA-Z0-9_-]{0,40}$/),
  id: HashSchema,
  title: z.string().min(1).max(120),
  ih: z.boolean(),
  source: z.string().max(TEXT_LIMITS.reportSource),
  channel: z.string().max(120),
  channelKey: z.string(),
  matchId: z.string().regex(/^[a-zA-Z0-9_.:-]{0,100}$/),
  reason: SourceReportReasonSchema,
  state: SourceReportStateSchema,
  checkReason: z.string().regex(/^[a-zA-Z0-9_-]{0,40}$/),
  reportCount: z.number().int().min(1).max(999),
  reportedAt: IsoDateTimeSchema,
  lastCheckedAt: IsoDateTimeSchema.nullable(),
  quarantineUntil: IsoDateTimeSchema.nullable(),
});
export type SourceReport = z.infer<typeof SourceReportSchema>;

/** Corrección de canal (`normalizeChannelFeedback`, server.js:2632-2649). Una por `id:channelKey`. */
export const ChannelFeedbackSchema = z.strictObject({
  id: HashSchema,
  title: z.string().min(1).max(120),
  channel: z.string().min(1).max(120),
  channelKey: z.string().min(1),
  verdict: z.enum(['correct', 'incorrect']),
  reason: SourceReportReasonSchema,
  corrections: z.number().int().min(1).max(999),
  updatedAt: IsoDateTimeSchema,
});
export type ChannelFeedback = z.infer<typeof ChannelFeedbackSchema>;

/**
 * Estadística de una fuente o de un proveedor (`normalizeSourceStatEntry`,
 * server.js:3841-3853). Los números son DECIMALES: se desgastan con una vida
 * media de 14 días al escribir.
 */
export const SourceStatEntrySchema = z.strictObject({
  intentos: z.number().min(0).max(100_000),
  exitos: z.number().min(0).max(100_000),
  caidas: z.number().min(0).max(100_000),
  segundos: z.number().min(0).max(100_000_000),
  /** Milisegundos epoch de la última anotación. */
  ultimo: z.number().min(0),
});
export type SourceStatEntry = z.infer<typeof SourceStatEntrySchema>;

const StatKeySchema = z.string().min(1).max(TEXT_LIMITS.statKey);

/** `{ hashes, proveedores }`, 600 claves como máximo en cada grupo; una entrada con 0 intentos se borra. */
export const SourceStatsSchema = z.strictObject({
  hashes: z.record(StatKeySchema, SourceStatEntrySchema),
  proveedores: z.record(StatKeySchema, SourceStatEntrySchema),
});
export type SourceStats = z.infer<typeof SourceStatsSchema>;

/** Quién tiene el mando (`normalizeNowPlaying`, server.js:975-987). */
export const NowPlayingSchema = z.strictObject({
  id: HashSchema,
  title: z.string().max(120),
  /** Solo recortado a 40: en `claim` no se filtran caracteres (api.md §6.14). */
  dev: z.string().max(TEXT_LIMITS.nowPlayingDev),
  token: z.string().regex(/^[a-zA-Z0-9_-]{0,64}$/),
  /** Milisegundos epoch, distinto de 0; crece siempre (`max(ahora, anterior + 1)`). */
  at: z.number().refine((value) => value !== 0, 'at no puede ser 0'),
});
export type NowPlaying = z.infer<typeof NowPlayingSchema>;

/** Las 12 claves de primer nivel de state.json (backend-modulos §2.2). */
export const STATE_V1_KEYS = [
  'favorites',
  'history',
  'web',
  'webSyncedAt',
  'webSources',
  'activeWebSourceId',
  'preferences',
  'channelBindings',
  'sourceReports',
  'channelFeedback',
  'sourceStats',
  'nowPlaying',
] as const;

/** Estado v1 normalizado, tal y como lo devuelve `readState` (server.js:1042-1055). */
export const StateV1Schema = z.strictObject({
  favorites: z.array(ItemSchema).max(MAX_HISTORY),
  history: z.array(ItemSchema).max(MAX_HISTORY),
  /** DERIVADO: los `streams` del directorio activo. */
  web: z.array(ItemSchema).max(MAX_WEB_STREAMS),
  /** DERIVADO: el `syncedAt` del directorio activo. */
  webSyncedAt: z.string().nullable(),
  webSources: z.array(WebSourceSchema).min(1).max(MAX_WEB_SOURCES),
  /** Existe en `webSources`; si no, el primero. */
  activeWebSourceId: z.string().min(1),
  preferences: PreferencesSchema,
  channelBindings: z.array(ChannelBindingSchema).max(MAX_CHANNEL_BINDINGS),
  sourceReports: z.array(SourceReportSchema).max(MAX_SOURCE_REPORTS),
  channelFeedback: z.array(ChannelFeedbackSchema).max(MAX_CHANNEL_FEEDBACK),
  sourceStats: SourceStatsSchema,
  nowPlaying: NowPlayingSchema.nullable(),
});
export type StateV1 = z.infer<typeof StateV1Schema>;
