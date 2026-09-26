/* Biblioteca, directorios y preferencias en /api/v1. Mismo comportamiento
   que POST /api/library, /api/streams/* y /api/preferences, con dos cambios
   de forma: sin `success` (lo dice el HTTP) y sin el `streams` duplicado de
   `directoryResponse`. */

import { z } from 'zod';
import { ItemSchema, PreferencesSchema, WebSourceTypeSchema } from '../../state/v1.js';
import { IPTV_ID_STATES } from '../../constants/iptv.js';
import { HashSchema } from '../../primitives.js';
import { WebSourceSummarySchema } from '../common.js';

/** Directorios: los canales del activo y el resumen de todos. */
export const DirectoryViewSchema = z.strictObject({
  web: z.array(ItemSchema),
  webSyncedAt: z.string().nullable(),
  webSources: z.array(WebSourceSummarySchema),
  activeWebSourceId: z.string(),
});
export type DirectoryView = z.infer<typeof DirectoryViewSchema>;

/** Estado ahora de un id IPTV de favoritos o recientes (docs/iptv.md §14.6). */
export const IptvIdStateSchema = z.enum(IPTV_ID_STATES);

/** Biblioteca completa: favoritos, recientes y directorios. */
export const LibraryViewSchema = DirectoryViewSchema.extend({
  favorites: z.array(ItemSchema),
  history: z.array(ItemSchema),
  /**
   * Solo si hay ids IPTV en favoritos o recientes: el estado de cada uno ahora
   * (docs/iptv.md §14.6). `ItemSchema` no cambia (lo lee la app 0.8.0).
   */
  iptvIds: z.record(HashSchema, IptvIdStateSchema).optional(),
});
export type LibraryView = z.infer<typeof LibraryViewSchema>;

/**
 * Elemento que llega del cliente. `id` acepta lo mismo que `normalizeHash`
 * (40 hex, `acestream://…` o una URL con `?id=`); si no sale un hash, 400
 * `bad_request`, como hoy.
 */
export const ItemInputSchema = z.strictObject({
  id: z.string().min(1).max(2048),
  title: z.string().max(500).optional(),
  category: z.string().max(200).optional(),
  alias: z.string().max(500).optional(),
  date: z.string().max(64).optional(),
  fromWebSync: z.boolean().optional(),
  ih: z.boolean().optional(),
});
export type ItemInput = z.infer<typeof ItemInputSchema>;

export const LibraryCollectionSchema = z.enum(['favorites', 'history', 'web']);
export type LibraryCollection = z.infer<typeof LibraryCollectionSchema>;

/** Mutaciones por acción (B-186): no se pisan colecciones de otros dispositivos. */
export const LibraryMutationBodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('favorite-upsert'), item: ItemInputSchema }),
  z.strictObject({ action: z.literal('history-upsert'), item: ItemInputSchema }),
  z.strictObject({
    action: z.literal('rename'),
    collection: LibraryCollectionSchema,
    id: z.string().min(1).max(2048),
    title: z.string().max(500),
    /** Solo con `web`; por defecto, el directorio activo. */
    sourceId: z.string().max(64).optional(),
  }),
  z.strictObject({
    action: z.literal('delete'),
    collection: LibraryCollectionSchema,
    id: z.string().min(1).max(2048),
    sourceId: z.string().max(64).optional(),
  }),
]);
export type LibraryMutationBody = z.infer<typeof LibraryMutationBodySchema>;

/** Preferencias de fútbol. PUT SUSTITUYE, como POST /api/preferences (api.md §6.7). */
export const PreferencesResponseSchema = z.strictObject({ preferences: PreferencesSchema });
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

export const PreferencesInputSchema = z.strictObject({
  onboardingComplete: z.boolean().optional(),
  country: z.string().max(200).optional(),
  leagues: z.array(z.string().max(200)).max(100).optional(),
  teams: z.array(z.string().max(200)).max(100).optional(),
  nationalities: z.array(z.string().max(200)).max(100).optional(),
});
export type PreferencesInput = z.infer<typeof PreferencesInputSchema>;

// --- Directorios ---

export const DirectorySyncBodySchema = z.strictObject({
  url: z.string().min(1).max(2048),
  /** `html` o, por defecto, `m3u`. */
  type: WebSourceTypeSchema.optional(),
  /** Refrescar ese directorio (puede cambiarle la URL y el tipo). */
  sourceId: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
});
export type DirectorySyncBody = z.infer<typeof DirectorySyncBodySchema>;

export const DirectoryIdParamsSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
});
