/* Copia de seguridad de tus ajustes (0.8.4, decisiones.md D25). Rutas solo
   web: GET /api/v1/backup, POST /api/v1/backup/export y POST
   /api/v1/backup/import.

   El fichero sirve para llevarse los ajustes a una instalación NUEVA del
   Umbrel, que tiene otro APP_SEED: nada de lo que va dentro puede depender de
   las claves de este Umbrel.

   Qué lleva:
   - biblioteca: favoritos y recientes (los ids IPTV, marcados con `iptv`);
   - listas (directorios) con sus canales, renombres y ocultos, y la activa;
   - «Tu fútbol» (preferencias), vínculos partido-canal hechos a mano y
     correcciones de canal (lo aprendido);
   - ajustes v2 (política de mismo canal);
   - los idiomas de Películas y series (`vod`, 0.9.0, si ya se eligieron);
   - la IPTV: tipo, nombre, si está en pausa, host y, en Xtream, servidor y
     usuario. La contraseña (Xtream) o la URL entera (M3U, que la lleva
     dentro) SOLO si Isma lo pide, cifrada con una clave que escribe él
     (scrypt + AES-256-GCM). Nunca en claro;
   - opcional, `browser`: lo que la web guarda en el navegador (tema,
     transparencia, modo de reproducción). Lo añade la web al descargar y lo
     aplica ella al restaurar; el servidor solo lo valida y lo devuelve.

   Qué NO lleva nunca: dispositivos emparejados (sus tokens no valdrían y
   son secretos), sesiones, «quién tiene el mando», el token de control del
   motor, la semilla, los informes de fuentes ni las estadísticas (caducan
   solas), el catálogo ni la guía de la IPTV (se vuelven a descargar). */

import { z } from 'zod';
import {
  BACKUP_FORMAT,
  BACKUP_PASSPHRASE_MAX,
  BACKUP_PASSPHRASE_MIN,
  BACKUP_SCHEMA_VERSION,
} from '../../constants/limits.js';
import { IPTV_NAME_MAX } from '../../constants/iptv.js';
import { PLAYBACK_MODES } from '../../constants/playback.js';
import { IsoDateTimeSchema } from '../../primitives.js';
import {
  ChannelBindingSchema,
  ChannelFeedbackSchema,
  ItemSchema,
  MAX_CHANNEL_BINDINGS,
  MAX_CHANNEL_FEEDBACK,
  MAX_HISTORY,
  MAX_WEB_SOURCES,
  PreferencesSchema,
  WebSourceSchema,
} from '../../state/v1.js';
import { IptvKindSchema, SameChannelPolicySchema } from '../../state/v2.js';
import { VOD_LANGS, VodLangSchema } from './vod.js';

/** Favorito o reciente de la copia: el de state.json y, si era de la IPTV, `iptv: true`. */
export const BackupItemSchema = ItemSchema.extend({
  /**
   * El id era un canal de la IPTV del Umbrel de origen (docs/iptv.md §4.1).
   * En otra instalación ese id no se reconoce: al restaurar se vuelve a
   * etiquetar con las claves de aquí para que el re-emparejado por nombre
   * (§14.6) lo lleve a su canal tras la primera sincronización.
   */
  iptv: z.literal(true).optional(),
});
export type BackupItem = z.infer<typeof BackupItemSchema>;

/**
 * Contraseña de la IPTV protegida con la clave de Isma: scrypt (N, r, p y
 * sal de 16 bytes) → AES-256-GCM con AAD `ace-copia|<versión>|<tipo>`. En
 * claro: M3U `{ url }`; Xtream `{ server, username, password }`.
 */
export const BackupSealedSchema = z.strictObject({
  kdf: z.literal('scrypt'),
  /** Solo valores razonables: un N enorme en un fichero ajeno sería un ataque de memoria. */
  n: z.union([z.literal(16384), z.literal(32768), z.literal(65536), z.literal(131072)]),
  r: z.literal(8),
  p: z.literal(1),
  /** 16 bytes en base64url sin relleno. */
  salt: z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'base64url de 16 bytes'),
  alg: z.literal('A256GCM'),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/, 'base64url de 12 bytes'),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'base64url de 16 bytes'),
  data: z
    .string()
    .max(16 * 1024)
    .regex(/^[A-Za-z0-9_-]+$/, 'base64url'),
});
export type BackupSealed = z.infer<typeof BackupSealedSchema>;

/** La IPTV en la copia: nunca la contraseña ni la URL de la lista en claro. */
export const BackupIptvSchema = z.strictObject({
  kind: IptvKindSchema,
  name: z.string().min(1).max(IPTV_NAME_MAX),
  enabled: z.boolean(),
  /** `nombre[:puerto]`, para enseñarlo (sin credenciales). */
  host: z.string().max(260),
  /** Solo Xtream: `esquema://host[:puerto][/ruta]`, sin usuario ni contraseña. */
  server: z.string().max(2048).nullable(),
  /** Solo Xtream. */
  username: z.string().min(1).max(200).nullable(),
  /** Con «Incluir la contraseña de la IPTV»: los secretos, cifrados con la clave de Isma. */
  secret: BackupSealedSchema.nullable(),
});
export type BackupIptv = z.infer<typeof BackupIptvSchema>;

export const BACKUP_THEMES = ['sistema', 'claro', 'oscuro'] as const;
export const BACKUP_TRANSPARENCIES = ['normal', 'reducida'] as const;

/** Lo que la web guarda en el navegador (por visor). Todo opcional. */
export const BackupBrowserSchema = z.strictObject({
  theme: z.enum(BACKUP_THEMES).optional(),
  transparency: z.enum(BACKUP_TRANSPARENCIES).optional(),
  playbackMode: z.enum(PLAYBACK_MODES).optional(),
});
export type BackupBrowser = z.infer<typeof BackupBrowserSchema>;

/** El fichero `ace-player-neo-copia-AAAA-MM-DD.json`. */
export const BackupFileSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  /** Versión de la app que la hizo (informativa). */
  appVersion: z.string().min(1).max(40),
  createdAt: IsoDateTimeSchema,
  library: z.strictObject({
    favorites: z.array(BackupItemSchema).max(MAX_HISTORY),
    history: z.array(BackupItemSchema).max(MAX_HISTORY),
  }),
  directories: z.strictObject({
    sources: z.array(WebSourceSchema).min(1).max(MAX_WEB_SOURCES),
    activeId: z.string().min(1).max(48),
  }),
  preferences: PreferencesSchema,
  channelBindings: z.array(ChannelBindingSchema).max(MAX_CHANNEL_BINDINGS),
  channelFeedback: z.array(ChannelFeedbackSchema).max(MAX_CHANNEL_FEEDBACK),
  settings: z.strictObject({ sameChannelPolicy: SameChannelPolicySchema }),
  iptv: BackupIptvSchema.nullable(),
  browser: BackupBrowserSchema.optional(),
  /**
   * Los idiomas elegidos para Películas y series (docs/vod.md §4.10). Solo
   * si ya se eligieron (0.9.0): las copias de antes no lo traen.
   */
  vod: z
    .strictObject({
      langs: z.array(VodLangSchema).max(VOD_LANGS.length),
      unknown: z.boolean(),
    })
    .optional(),
});
export type BackupFile = z.infer<typeof BackupFileSchema>;

const PassphraseSchema = z.string().min(BACKUP_PASSPHRASE_MIN).max(BACKUP_PASSPHRASE_MAX);

/** POST /api/v1/backup/export: la copia CON la contraseña de la IPTV, protegida con esta clave. */
export const BackupExportBodySchema = z.strictObject({
  passphrase: PassphraseSchema,
});
export type BackupExportBody = z.infer<typeof BackupExportBodySchema>;

/** `replace`: lo de la copia sustituye a lo de ahora. `merge`: añade lo que falte. */
export const BackupImportModeSchema = z.enum(['replace', 'merge']);
export type BackupImportMode = z.infer<typeof BackupImportModeSchema>;

/**
 * POST /api/v1/backup/import. `backup` va sin validar en la ruta: el servidor
 * lo comprueba él para distinguir `backup_invalid` de
 * `backup_version_unsupported`. `dryRun` (por defecto) solo cuenta lo que
 * haría; con `false` lo aplica.
 */
export const BackupImportBodySchema = z.strictObject({
  backup: z.record(z.string(), z.unknown()),
  mode: BackupImportModeSchema.default('replace'),
  dryRun: z.boolean().default(true),
  /** La clave de «Incluir la contraseña de la IPTV». Sin ella, la IPTV se restaura sin contraseña. */
  passphrase: PassphraseSchema.optional(),
});
export type BackupImportBody = z.infer<typeof BackupImportBodySchema>;

/** Recuentos de lo que hay (ahora, en la copia o después de restaurar). */
export const BackupCountsSchema = z.strictObject({
  favorites: z.number().int().nonnegative(),
  history: z.number().int().nonnegative(),
  directories: z.number().int().nonnegative(),
  /** Canales sumando todas las listas. */
  channels: z.number().int().nonnegative(),
  channelBindings: z.number().int().nonnegative(),
  channelFeedback: z.number().int().nonnegative(),
});
export type BackupCounts = z.infer<typeof BackupCountsSchema>;

/**
 * Qué pasa con la IPTV:
 * - `none`: la copia no trae IPTV (la de ahora, si hay, no se toca);
 * - `restore`: se restaura con su contraseña (venía protegida y la clave vale);
 * - `keep`: se queda la de ahora (Combinar, o la copia no trae la contraseña);
 * - `needs_secret`: no hay IPTV ahora y la copia no trae la contraseña (o no
 *   se dio la clave): se restaura lo demás y la web pide la contraseña (Xtream)
 *   o la URL (M3U) para guardarla con «Guardar IPTV».
 */
export const BackupIptvActionSchema = z.enum(['none', 'restore', 'keep', 'needs_secret']);
export type BackupIptvAction = z.infer<typeof BackupIptvActionSchema>;

export const BackupIptvOutcomeSchema = z.strictObject({
  action: BackupIptvActionSchema,
  /** La copia trae la contraseña protegida con clave. */
  protected: z.boolean(),
  /** Datos sin secretos de la IPTV de la copia (para rellenar el formulario); null sin IPTV. */
  kind: IptvKindSchema.nullable(),
  name: z.string().max(IPTV_NAME_MAX).nullable(),
  host: z.string().max(260).nullable(),
  server: z.string().max(2048).nullable(),
  username: z.string().max(200).nullable(),
  /** Favoritos y recientes de la IPTV que se re-emparejarán por nombre tras sincronizar. */
  relinkItems: z.number().int().nonnegative(),
});
export type BackupIptvOutcome = z.infer<typeof BackupIptvOutcomeSchema>;

export const BackupImportResponseSchema = z.strictObject({
  /** false = vista previa (`dryRun`): no se ha cambiado nada. */
  applied: z.boolean(),
  mode: BackupImportModeSchema,
  source: z.strictObject({
    appVersion: z.string().max(40),
    createdAt: IsoDateTimeSchema,
    schemaVersion: z.number().int().positive(),
  }),
  current: BackupCountsSchema,
  incoming: BackupCountsSchema,
  /** Cómo queda (o quedaría) después. */
  result: BackupCountsSchema,
  /** Cambian «Tu fútbol» y los ajustes de reproducción del servidor. */
  preferences: z.boolean(),
  settings: z.boolean(),
  iptv: BackupIptvOutcomeSchema,
  /** Lo del navegador que trae la copia, para que la web lo aplique (null si no trae). */
  browser: BackupBrowserSchema.nullable(),
});
export type BackupImportResponse = z.infer<typeof BackupImportResponseSchema>;

/** Nombre del fichero que se descarga: `ace-player-neo-copia-AAAA-MM-DD.json`. */
export function backupFileName(date: Date): string {
  return `${BACKUP_FORMAT}-${date.toISOString().slice(0, 10)}.json`;
}
