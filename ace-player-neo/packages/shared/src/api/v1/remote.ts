/* El dominio de fuera, `https://tv.ismaeloul.es` (docs/acceso-remoto.md, «Por
   el dominio»): la app de iPhone fuera de casa sin VPN.

   Todo lo de aquí es SOLO de la web (detrás del login de Umbrel): encender el
   permiso de un aparato, ver los accesos y los bloqueos y desbloquear una IP.
   Por el dominio no pasa ninguna de estas rutas (`remote: 'deny'`), y por
   `/native` desde casa tampoco (`access: 'web'`): un iPhone no puede darse
   permiso a sí mismo.

   Las IPs solo salen en estas respuestas (web) y en `v2/remote-events.json`:
   ni en el registro del servidor, ni en el SSE (`remote.changed` va sin datos
   y solo a la web), ni en nada que vea un iPhone. */

import { z } from 'zod';
import { DeviceIdSchema, IsoDateTimeSchema } from '../../primitives.js';

/** Caducidad al encender el permiso de un aparato. `30d` es la que propone la web. */
export const REMOTE_EXPIRES_IN = ['24h', '7d', '30d', 'never'] as const;
export const RemoteExpiresInSchema = z.enum(REMOTE_EXPIRES_IN);
export type RemoteExpiresIn = z.infer<typeof RemoteExpiresInSchema>;

/** Milisegundos de cada caducidad (`never` = sin caducidad). */
export const REMOTE_EXPIRES_IN_MS: Readonly<Record<RemoteExpiresIn, number | null>> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  never: null,
};

/** Un octeto de IPv4 (0-255, sin ceros delante). */
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const HEXTET = '[0-9a-f]{1,4}';
/**
 * Clave de un bloqueo: la IPv4 entera (`92.184.12.7`) o el /64 de una IPv6
 * escrito como sus cuatro primeros grupos y `::` (`2a01:e0a:1:2::`, que la web
 * enseña como `2a01:e0a:1:2::/64`). Sin `/`: va en la ruta de
 * `remoteBlockDelete` y nginx tira `%2f`.
 */
export const REMOTE_BLOCK_KEY_RE = new RegExp(
  `^(?:${OCTET}(?:\\.${OCTET}){3}|${HEXTET}(?::${HEXTET}){3}::)$`,
);
export const RemoteBlockKeySchema = z
  .string()
  .max(45)
  .regex(REMOTE_BLOCK_KEY_RE, 'IPv4 o /64 de una IPv6');

/** Lo que se apunta si Caddy no mandó una IP que valga. */
export const REMOTE_UNKNOWN_IP = 'desconocida';

/** Una IP tal cual la vio Caddy (IPv4 o IPv6, sin puerto ni zona), o `desconocida`. */
export const RemoteIpSchema = z
  .string()
  .min(2)
  .max(45)
  .regex(/^(?:[0-9a-f:.]+|desconocida)$/, 'IP');

/** Lo que pasa por el dominio y queda en el registro de accesos. */
export const REMOTE_EVENT_KINDS = [
  /** Un aparato con permiso entró desde una IP que no le conocíamos. */
  'ok-new-ip',
  /** Un aparato emparejado intentó entrar desde fuera y no tiene permiso (o caducó). */
  'denied-device',
  /** Una IP se ha bloqueado por demasiados fallos. */
  'blocked',
  /** Se ha quitado un bloqueo (a mano o al caducar el permiso de fuera). */
  'unblocked',
  /** Alguien que no es Caddy llamó al puerto del dominio (3002) desde la red de Docker. */
  'peer-mismatch',
  /** Se ha encendido el permiso de un aparato o el interruptor general. */
  'enabled',
  /** Se ha apagado el permiso de un aparato o el interruptor general («Cerrar el dominio ya»). */
  'disabled',
  /** El permiso de un aparato ha caducado. */
  'expired',
] as const;
export const RemoteEventKindSchema = z.enum(REMOTE_EVENT_KINDS);
export type RemoteEventKind = z.infer<typeof RemoteEventKindSchema>;

export const RemoteEventSchema = z.strictObject({
  at: IsoDateTimeSchema,
  kind: RemoteEventKindSchema,
  deviceId: DeviceIdSchema.nullable(),
  ip: RemoteIpSchema.nullable(),
  /** Id de la ruta v1 (`bootstrap`, `channelStream`…) o null. */
  route: z.string().max(64).nullable(),
  /**
   * Solo en `blocked`: varias IPs bloqueadas en el mismo minuto, apuntadas juntas (sin IP) para
   * que miles de bloqueos no llenen el registro ni tapen lo demás.
   */
  count: z.number().int().min(1).max(1_000_000_000).optional(),
});
export type RemoteEvent = z.infer<typeof RemoteEventSchema>;

export const RemoteLastAccessSchema = z.strictObject({
  at: IsoDateTimeSchema,
  ip: RemoteIpSchema,
});
export type RemoteLastAccess = z.infer<typeof RemoteLastAccessSchema>;

/** El permiso de un aparato (solo los emparejados y sin revocar). */
export const RemoteDeviceViewSchema = z.strictObject({
  deviceId: DeviceIdSchema,
  enabled: z.boolean(),
  enabledAt: IsoDateTimeSchema.nullable(),
  /** null = sin caducidad (o permiso apagado). */
  expiresAt: IsoDateTimeSchema.nullable(),
  /** Encendido pero ya caducado: por el dominio da 403 `remote_forbidden`. */
  expired: z.boolean(),
  lastAccess: RemoteLastAccessSchema.nullable(),
});
export type RemoteDeviceView = z.infer<typeof RemoteDeviceViewSchema>;

export const RemoteBlockViewSchema = z.strictObject({
  key: RemoteBlockKeySchema,
  /** Para enseñar: la IPv4 o el `/64`. */
  label: z.string().max(48),
  until: IsoDateTimeSchema,
  /** 1 = primer bloqueo (15 min); cada reincidencia ×4 hasta 24 h. */
  level: z.number().int().min(1).max(32),
  firstAt: IsoDateTimeSchema,
  lastAt: IsoDateTimeSchema,
});
export type RemoteBlockView = z.infer<typeof RemoteBlockViewSchema>;

/** GET /api/v1/remote (solo web): todo lo de «Desde fuera de casa» en Ajustes → Dispositivos. */
export const RemoteViewSchema = z.strictObject({
  domain: z.strictObject({
    /** Hay `NATIVE_PUBLIC_URL` en el Compose (el sitio de Caddy existe). */
    configured: z.boolean(),
    url: z.string().max(300).nullable(),
  }),
  /** El interruptor general. Apagado: todo lo que llega por el dominio, 403 `remote_disabled`. */
  enabled: z.boolean(),
  /** El segundo puerto del backend (el de Caddy) escucha y la IP de Caddy se conoce. */
  edge: z.strictObject({ listening: z.boolean(), peerResolved: z.boolean() }),
  devices: z.array(RemoteDeviceViewSchema).max(500),
  blocks: z.array(RemoteBlockViewSchema).max(500),
  /** Los últimos sucesos, el más reciente primero (100 como mucho). */
  events: z.array(RemoteEventSchema).max(100),
  /** Peticiones por el dominio en las últimas 24 h (en memoria: un reinicio lo pone a cero). */
  last24h: z.strictObject({
    ok: z.number().int().nonnegative(),
    /** Respuestas 401 y 403 (token malo, sin permiso, ruta prohibida). */
    denied: z.number().int().nonnegative(),
    /** Respuestas 429 `remote_blocked` (IP bloqueada). */
    blocked: z.number().int().nonnegative(),
    /** Peticiones cuya IP no era de internet (Caddy no ve la IP real: docs/acceso-remoto.md). */
    ipUntrusted: z.number().int().nonnegative(),
  }),
});
export type RemoteView = z.infer<typeof RemoteViewSchema>;

/** PUT /api/v1/remote: el interruptor general (y «Cerrar el dominio ya» con `false`). */
export const RemoteUpdateBodySchema = z.strictObject({ enabled: z.boolean() });
export type RemoteUpdateBody = z.infer<typeof RemoteUpdateBodySchema>;

/** PUT /api/v1/devices/:id/remote: el permiso de un aparato. `expiresIn` solo cuenta al encender. */
export const DeviceRemoteBodySchema = z.strictObject({
  enabled: z.boolean(),
  expiresIn: RemoteExpiresInSchema.default('30d'),
});
export type DeviceRemoteBody = z.infer<typeof DeviceRemoteBodySchema>;

export const RemoteBlockParamsSchema = z.strictObject({ key: RemoteBlockKeySchema });

/** Lo que contesta desbloquear: cuántos bloqueos se han quitado. */
export const RemoteUnblockResponseSchema = z.strictObject({
  removed: z.number().int().nonnegative(),
});
export type RemoteUnblockResponse = z.infer<typeof RemoteUnblockResponseSchema>;

/**
 * En `bootstrap` (opcional, para la app): si esta petición llegó por el dominio
 * y si este aparato tiene permiso. Ausente desde la web y en el ejemplo de
 * `fixtures/v1/bootstrap.json`.
 */
export const BootstrapRemoteSchema = z.strictObject({
  viaDomain: z.boolean(),
  allowed: z.boolean(),
  expiresAt: IsoDateTimeSchema.nullable(),
});
export type BootstrapRemote = z.infer<typeof BootstrapRemoteSchema>;
