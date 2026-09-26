/* Emparejamiento y dispositivos de la app iOS (arquitectura §5.12 y §7.3).
   La web no usa tokens: la protege el login de Umbrel. Desde la 0.8.1 un
   iPhone emparejado también crea códigos, lista y revoca (con su Bearer). */

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

/**
 * Origen http(s) sin ruta ni credenciales (lo que va en cada `u=` del QR):
 * nombre ASCII (`[A-Za-z0-9.-]`, el de un DNS o una IPv4; IDN en punycode) o
 * IPv6 entre corchetes, con puerto opcional. Así no pasa `usuario:clave@`,
 * ni `%`, `\`, espacios o unicode que `encodeURIComponent` multiplica: cada
 * dirección queda por debajo de ~280 caracteres codificada y las 3 caben en
 * un QR de nivel M. El servidor aplica la misma expresión a la reserva de
 * las cabeceras.
 */
export const PAIRING_BASE_URL_RE =
  /^https?:\/\/(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/i;

const PairingBaseUrlSchema = z
  .string()
  .max(512)
  .regex(PAIRING_BASE_URL_RE, 'origen http(s) sin ruta ni credenciales');

/** POST /api/v1/pairing (web o iPhone emparejado). */
export const PairingCreateBodySchema = z.strictObject({
  /**
   * Dirección base que irá la primera en el QR: `location.origin` en la web;
   * en el iPhone, la dirección que está usando ahora. Si falta, el servidor
   * la deduce de las cabeceras.
   */
  baseUrl: PairingBaseUrlSchema.optional(),
  /**
   * Otras direcciones del MISMO servidor (0.8.1): el iPhone manda la que no
   * está usando (Tailscale o la de casa). Van detrás en el QR, en el mismo
   * orden y sin repetidas. Como mucho 2.
   */
  alternateBaseUrls: z.array(PairingBaseUrlSchema).max(2).optional(),
});
export type PairingCreateBody = z.infer<typeof PairingCreateBodySchema>;

export const PairingCreateResponseSchema = z.strictObject({
  /** 6 dígitos, válido 5 minutos y de un solo uso. Solo hay uno vivo. */
  code: z.string().regex(/^\d{6}$/),
  expiresAt: IsoDateTimeSchema,
  ttlMs: z.number().int().positive(),
  /**
   * `aceneo://pair?u=<URL base>[&u=<otra>…]&c=<código>`: una `u` por
   * dirección, la primera es `baseUrl`.
   */
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

/**
 * DELETE /api/v1/devices/:id: cierra su SSE, suelta sus visores y sus URLs de
 * vídeo dejan de valer al instante. Web o iPhone emparejado, también el propio.
 */
export const DeviceRevokeResponseSchema = z.strictObject({ device: DeviceSchema });
export type DeviceRevokeResponse = z.infer<typeof DeviceRevokeResponseSchema>;
