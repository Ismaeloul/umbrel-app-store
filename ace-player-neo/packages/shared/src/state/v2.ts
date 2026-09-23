/* Ficheros nuevos de la 0.7.0 bajo `data/v2/` (arquitectura §5.4). La
   0.6.59 no los mira, así que una vuelta atrás no los pisa ni los necesita.
   state.json sigue en forma v1 más `schemaVersion: 2`. */

import { z } from 'zod';
import { DeviceIdSchema, HashSchema, IsoDateTimeSchema, SessionIdSchema } from '../primitives.js';
import { StateV1Schema } from './v1.js';

/** Versión de esquema que escribe la 0.7.0. Ausente = 1 (arquitectura §5.4). */
export const SCHEMA_VERSION = 2;

/** Rutas relativas a `DATA_DIR`. */
export const V2_FILES = {
  dir: 'v2',
  devices: 'v2/devices.json',
  settings: 'v2/settings.json',
  sessions: 'v2/sessions.json',
  diagnostics: 'v2/diagnostics.jsonl',
} as const;

/** state.json tal y como lo escribe la 0.7.0: las 12 claves v1 más la versión. */
export const StateFileV2Schema = StateV1Schema.extend({
  schemaVersion: z.literal(SCHEMA_VERSION),
});
export type StateFileV2 = z.infer<typeof StateFileV2Schema>;

// --- v2/settings.json ---

/**
 * Qué pasa cuando un segundo dispositivo abre el MISMO canal (D5):
 * - `share`: se comparte la sesión (pasa a HLS). Por defecto.
 * - `handoff`: el último que da al play se queda el mando, como la 0.6.59.
 * Con canales distintos siempre hay traspaso, sea cual sea la política.
 */
export const SameChannelPolicySchema = z.enum(['share', 'handoff']);
export type SameChannelPolicy = z.infer<typeof SameChannelPolicySchema>;
export const DEFAULT_SAME_CHANNEL_POLICY: SameChannelPolicy = 'share';

/** Ajustes v2 que ve y cambia la interfaz. */
export const SettingsSchema = z.strictObject({
  sameChannelPolicy: SameChannelPolicySchema.default(DEFAULT_SAME_CHANNEL_POLICY),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  settings: SettingsSchema,
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

// --- v2/devices.json ---

export const DevicePlatformSchema = z.enum(['ios', 'ipados', 'macos', 'other']);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

/**
 * Dispositivo emparejado. Del token (`<deviceId>.<secreto de 256 bits>`)
 * solo se guarda `sha256(secreto)` en hex: el token en claro solo existe en
 * la respuesta del emparejamiento y en el Llavero del iPhone (arquitectura §5.12).
 */
export const DeviceRecordSchema = z.strictObject({
  id: DeviceIdSchema,
  name: z.string().min(1).max(60),
  platform: DevicePlatformSchema,
  secretSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateTimeSchema,
  /** Se actualiza como mucho una vez por minuto. */
  lastSeenAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

export const DevicesFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  devices: z.array(DeviceRecordSchema),
});
export type DevicesFile = z.infer<typeof DevicesFileSchema>;

// --- v2/sessions.json ---

export const EngineSessionKindSchema = z.enum(['id', 'infohash']);
export type EngineSessionKind = z.infer<typeof EngineSessionKindSchema>;

/** progresivo = `getstream` (un solo consumidor); hls = `manifest.m3u8` (compartible). */
export const EngineSessionModeSchema = z.enum(['progressive', 'hls']);
export type EngineSessionMode = z.infer<typeof EngineSessionModeSchema>;

/**
 * Sesión abierta en el motor principal. Se guarda para poder pararla con
 * `command_url` si el proceso muere: al arrancar, se paran las que queden
 * de un proceso anterior (sin zombis, arquitectura §5.6).
 */
export const PersistedSessionSchema = z.strictObject({
  id: SessionIdSchema,
  hash: HashSchema,
  kind: EngineSessionKindSchema,
  mode: EngineSessionModeSchema,
  /** Ruta relativa `/ace/cmd/…` del motor. */
  commandUrl: z.string().min(1),
  openedAt: IsoDateTimeSchema,
});
export type PersistedSession = z.infer<typeof PersistedSessionSchema>;

export const SessionsFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sessions: z.array(PersistedSessionSchema),
});
export type SessionsFile = z.infer<typeof SessionsFileSchema>;
