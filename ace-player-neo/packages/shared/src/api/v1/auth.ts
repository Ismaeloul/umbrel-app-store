/* Emparejamiento y dispositivos de la app iOS (arquitectura §5.12 y §7.3).
   La web no usa tokens: la protege el login de Umbrel. */

import { z } from 'zod';
import { DeviceIdSchema, IsoDateTimeSchema } from '../../primitives.js';
import { DevicePlatformSchema } from '../../state/v2.js';

/** Vista pública de un dispositivo: nunca lleva el hash del secreto. */
export const DeviceSchema = z.strictObject({
  id: DeviceIdSchema,
  name: z.string().min(1).max(60),
  platform: DevicePlatformSchema,
  createdAt: IsoDateTimeSchema,
  lastSeenAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type Device = z.infer<typeof DeviceSchema>;

/** POST /api/v1/pairing (solo web). */
export const PairingCreateBodySchema = z.strictObject({
  /**
   * Dirección base que irá en el QR (`location.origin` de la web). Si falta,
   * el servidor la deduce de las cabeceras.
   */
  baseUrl: z
    .string()
    .max(512)
    .regex(/^https?:\/\/[^/?#]+$/i, 'origen http(s) sin ruta')
    .optional(),
});
export type PairingCreateBody = z.infer<typeof PairingCreateBodySchema>;

export const PairingCreateResponseSchema = z.strictObject({
  /** 6 dígitos, válido 5 minutos y de un solo uso. Solo hay uno vivo. */
  code: z.string().regex(/^\d{6}$/),
  expiresAt: IsoDateTimeSchema,
  ttlMs: z.number().int().positive(),
  /** `aceneo://pair?u=<URL base>&c=<código>`. */
  pairUri: z.string().startsWith('aceneo://pair?'),
  /** El mismo enlace dibujado como QR (SVG en texto). */
  qrSvg: z.string().startsWith('<svg'),
});
export type PairingCreateResponse = z.infer<typeof PairingCreateResponseSchema>;

/** POST /native/api/v1/pairing/claim (sin token). 5 intentos por código y 10 por minuto en total. */
export const PairingClaimBodySchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(60),
  platform: DevicePlatformSchema,
});
export type PairingClaimBody = z.infer<typeof PairingClaimBodySchema>;

/** Respuesta 201: el token en claro SOLO sale aquí; la app lo guarda en el Llavero. */
export const PairingClaimResponseSchema = z.strictObject({
  deviceId: DeviceIdSchema,
  /** `<deviceId>.<secreto de 256 bits en base64url>`. */
  token: z.string().regex(/^[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}$/),
  device: DeviceSchema,
});
export type PairingClaimResponse = z.infer<typeof PairingClaimResponseSchema>;

export const DevicesListResponseSchema = z.strictObject({ devices: z.array(DeviceSchema) });
export type DevicesListResponse = z.infer<typeof DevicesListResponseSchema>;

export const DeviceParamsSchema = z.strictObject({ id: DeviceIdSchema });

/** DELETE /api/v1/devices/:id: cierra su SSE, suelta sus visores y sus URLs de vídeo dejan de valer al instante. */
export const DeviceRevokeResponseSchema = z.strictObject({ device: DeviceSchema });
export type DeviceRevokeResponse = z.infer<typeof DeviceRevokeResponseSchema>;
