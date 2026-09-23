/* Origen de cada petición y qué credencial le hace falta (arquitectura §5.12
   y §8, D4).

   nginx pone SIEMPRE `X-Ace-Origin` (sobrescribiendo lo que mande el
   cliente): `web` si la petición pasó por el login de Umbrel, `native` si
   entró por /native/* (la app iOS). El backend no se fía de nada más:

   - Sin cabecera: `web`. Solo pasa con peticiones que llegan a Node sin nginx
     (healthcheck de Docker, tests), y es lo que hacía la 0.6.59, que no
     autenticaba nada.
   - Con un valor que no es `web` ni `native`: `native`, el más restrictivo.
   - Una ruta que empieza por /native es SIEMPRE `native`, diga lo que diga la
     cabecera: si alguna vez nginx no la pusiera, la puerta de la app iOS no
     se puede convertir en una entrada sin login.

   Con origen `native`:
   - Solo existe /api/v1 (con o sin el prefijo /native). Las rutas antiguas
     /api/* y /remux/* dan 403 `origin_forbidden`, con o sin token: la app iOS
     solo usa v1.
   - Hace falta credencial en todas las rutas salvo `GET /api/v1/ping` y
     `POST /api/v1/pairing/claim` (tabla de rutas, `credential: 'none'`). */

import type { Origin } from '@ace/shared';
import { NATIVE_PREFIX, V1_PREFIX } from '@ace/shared';

export const ORIGIN_HEADER = 'x-ace-origin';

/** Parte de ruta de una URL cruda (sin query). */
export function pathOf(url: string): string {
  const mark = url.indexOf('?');
  return mark < 0 ? url : url.slice(0, mark);
}

export function isNativePath(url: string): boolean {
  const path = pathOf(url);
  return path === NATIVE_PREFIX || path.startsWith(`${NATIVE_PREFIX}/`);
}

/** `/native/api/v1/x` → `/api/v1/x`; el resto, igual. */
export function stripNativePrefix(url: string): string {
  return isNativePath(url) ? url.slice(NATIVE_PREFIX.length) || '/' : url;
}

/** ¿Es una ruta de /api/v1 (con o sin /native)? Decide el formato de error. */
export function isV1Path(url: string): boolean {
  const path = pathOf(stripNativePrefix(url));
  return path === V1_PREFIX || path.startsWith(`${V1_PREFIX}/`);
}

export function resolveOrigin(header: string | string[] | undefined, url: string): Origin {
  if (isNativePath(url)) return 'native';
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value === '') return 'web';
  const normalized = value.trim().toLowerCase();
  return normalized === 'web' ? 'web' : 'native';
}

/**
 * Token de `Authorization: Bearer <token>`. Devuelve null si no hay o no
 * tiene esa forma (el valor en sí lo comprueba auth).
 */
export function extractBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(\S{1,512})\s*$/i.exec(value);
  return match?.[1] ?? null;
}
