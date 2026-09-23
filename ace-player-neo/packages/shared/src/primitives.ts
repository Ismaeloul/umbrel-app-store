/* Tipos básicos que se repiten en todos los esquemas. */

import { z } from 'zod';

/** Hash AceStream tal y como sale siempre en el JSON: 40 hex en minúsculas. */
export const HashSchema = z.string().regex(/^[a-f0-9]{40}$/, 'hash AceStream de 40 hex');
export type Hash = z.infer<typeof HashSchema>;

/** Fecha de `new Date().toISOString()` (con Z y milisegundos). */
export const IsoDateTimeSchema = z.iso.datetime();

/** Día en formato `YYYY-MM-DD` (hora de Madrid en la agenda). */
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha YYYY-MM-DD');

/** Milisegundos desde epoch. */
export const EpochMsSchema = z.number().int().nonnegative();

/** Id de un trabajo del comprobador: 24 hex (server.js:3591-3597). */
export const ScanJobIdSchema = z.string().regex(/^[a-f0-9]{24}$/, 'id de comprobación de 24 hex');

/** Código de motivo corto (`http_429`, `fetch_timeout`…): `[a-z0-9_]`, hasta 40. */
export const ShortCodeSchema = z.string().regex(/^[a-z0-9_]{1,40}$/, 'código corto');

/** Ids que elige el servidor o el cliente: letras, números, `_` y `-`. */
export const SafeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'identificador');

/** Id de sesión del motor que da el backend (arquitectura §5.6): `s_` + base64url. */
export const SessionIdSchema = z.string().regex(/^s_[A-Za-z0-9_-]{8,64}$/, 'id de sesión');

/** Id de un visor: uno por pestaña o por reproductor (arquitectura §5.6). */
export const ViewerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'id de visor');

/** Id persistente de un dispositivo (localStorage en la web, emparejado en iOS). Sin puntos: el token es `<deviceId>.<secreto>`. */
export const DeviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'id de dispositivo');

/** Origen de una petición según nginx (`X-Ace-Origin`, arquitectura §8.2). */
export const OriginSchema = z.enum(['web', 'native']);
export type Origin = z.infer<typeof OriginSchema>;

/** Cliente que reproduce: la web nueva, la app iOS o una pestaña 0.6.x abierta. */
export const ClientKindSchema = z.enum(['web', 'ios', 'legacy']);
export type ClientKind = z.infer<typeof ClientKindSchema>;
