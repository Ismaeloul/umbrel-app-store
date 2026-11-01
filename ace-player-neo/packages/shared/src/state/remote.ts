/* Ficheros del dominio de fuera (tv.ismaeloul.es, docs/acceso-remoto.md «Por el dominio»), cada
   uno con su `schemaVersion` y aparte de `devices.json` (V2_FILES.remote*): la 1.1.2 no los lee y
   volver atrás no rompe nada. Si uno no se puede leer, el backend arranca con el de por defecto:
   sin permisos (falla cerrado, no abierto). */

import { z } from 'zod';
import { DeviceIdSchema, IsoDateTimeSchema } from '../primitives.js';
import {
  RemoteBlockKeySchema,
  RemoteEventSchema,
  RemoteIpSchema,
  RemoteLastAccessSchema,
} from '../api/v1/remote.js';
import { REMOTE_LIMITS } from '../constants/limits.js';

export const REMOTE_SCHEMA_VERSION = 1;

/** El permiso de un aparato. Por defecto no hay entrada (= sin permiso). */
export const RemoteDeviceRecordSchema = z.strictObject({
  enabled: z.boolean(),
  enabledAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  /**
   * Fase 2 (sin usar todavía): «Datos móviles: original / ligera / automática» por aparato,
   * solo para Películas y series (docs/acceso-remoto.md).
   */
  quality: z.enum(['original', 'lite', 'auto']).optional(),
  lastAccess: RemoteLastAccessSchema.nullable(),
  knownIps: z.array(RemoteIpSchema).max(REMOTE_LIMITS.knownIpsPerDevice),
});
export type RemoteDeviceRecord = z.infer<typeof RemoteDeviceRecordSchema>;

/** `v2/remote-access.json`. El interruptor general nace encendido: sin aparatos con permiso no abre nada. */
export const RemoteAccessFileSchema = z.strictObject({
  schemaVersion: z.literal(REMOTE_SCHEMA_VERSION),
  enabled: z.boolean(),
  devices: z.record(DeviceIdSchema, RemoteDeviceRecordSchema),
});
export type RemoteAccessFile = z.infer<typeof RemoteAccessFileSchema>;

/** `v2/remote-events.json`: anillo de 500 sucesos y 30 días, el más viejo primero. */
export const RemoteEventsFileSchema = z.strictObject({
  schemaVersion: z.literal(REMOTE_SCHEMA_VERSION),
  events: z.array(RemoteEventSchema).max(REMOTE_LIMITS.events.max),
});
export type RemoteEventsFile = z.infer<typeof RemoteEventsFileSchema>;

/**
 * Un bloqueo (o el nivel de reincidencia que queda tras él). Se guarda para que reiniciar el
 * contenedor no quite un bloqueo vivo ni olvide el nivel. Los fallos sueltos solo van en memoria.
 */
export const RemoteBlockRecordSchema = z.strictObject({
  key: RemoteBlockKeySchema,
  /** Fin del último bloqueo (puede estar ya en el pasado: queda el nivel). */
  until: IsoDateTimeSchema,
  level: z.number().int().min(1).max(32),
  failures: z.number().int().nonnegative(),
  firstAt: IsoDateTimeSchema,
  lastAt: IsoDateTimeSchema,
});
export type RemoteBlockRecord = z.infer<typeof RemoteBlockRecordSchema>;

/** `v2/remote-blocks.json`. */
export const RemoteBlocksFileSchema = z.strictObject({
  schemaVersion: z.literal(REMOTE_SCHEMA_VERSION),
  blocks: z.array(RemoteBlockRecordSchema).max(REMOTE_LIMITS.lockout.maxKeys),
});
export type RemoteBlocksFile = z.infer<typeof RemoteBlocksFileSchema>;
