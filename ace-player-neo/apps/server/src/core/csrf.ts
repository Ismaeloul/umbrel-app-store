/* Regla anti-CSRF de la 0.6.59, portada tal cual (`isAllowedMutation`,
   server.js:1257-1274; api.md §2.3; T-033, B-230).

   Se evalúa ANTES que nada, también antes de enrutar: un POST cross-site a
   una ruta que no existe recibe 403 `cross_origin` y no 404. Solo se aplica
   al origen `web` (la app iOS no tiene cookies que robar: se identifica con
   su token, arquitectura §5.12).

   1. GET, HEAD y OPTIONS pasan, SALVO los GET con efectos: los dos de la
      0.6.59 (`/api/remux` y `/api/football/resolve`, con la URL exacta o con
      `?` detrás) y los de /api/v1 marcados `sideEffects` en la tabla de rutas.
   2. Para el resto: `Sec-Fetch-Site: cross-site` → no; `same-origin` → sí;
      sin `Origin` → sí (clientes nativos, curl, tests) salvo con
      `Sec-Fetch-Site: same-site` (0.7.0, S-03 en docs/seguridad.md); con
      `Origin`, solo si su host coincide con `Host` o con el primer
      `X-Forwarded-Host`. */

import type { IncomingHttpHeaders } from 'node:http';

export interface MutationRequest {
  readonly method: string;
  /** La URL cruda de la petición, query incluida (`req.url`). */
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

/** Los dos GET con efectos de la 0.6.59, con la misma comparación exacta (server.js:1258-1261). */
export function isLegacySideEffectGet(method: string, url: string): boolean {
  return (
    method === 'GET' &&
    (url === '/api/remux' ||
      url.startsWith('/api/remux?') ||
      url === '/api/football/resolve' ||
      url.startsWith('/api/football/resolve?'))
  );
}

export interface MutationOptions {
  /** La ruta v1 que atiende la petición es un GET con efectos (tabla de rutas). */
  readonly sideEffectGet?: boolean;
}

export function isAllowedMutation(req: MutationRequest, options: MutationOptions = {}): boolean {
  const sideEffectGet =
    isLegacySideEffectGet(req.method, req.url) ||
    (req.method === 'GET' && options.sideEffectGet === true);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sideEffectGet) return true;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  if (fetchSite === 'same-origin') return true;
  const origin = String(req.headers.origin || '');
  /* S-03 (docs/seguridad.md, cambio 0.7.0): sin Origin se acepta (clientes
     nativos, curl y navegadores sin Sec-Fetch-*), SALVO si el navegador dice
     `same-site`: es otra app del mismo Umbrel (mismo host, otro puerto) que
     pide un GET con efectos con <img>/<video>, lleva la cookie del login y
     el navegador no pone Origin en esos GET. Nunca es la propia web
     (`same-origin`) ni una URL escrita a mano (`none`). */
  if (!origin) return fetchSite !== 'same-site';
  const hosts = new Set(
    [
      String(req.headers.host || ''),
      String(req.headers['x-forwarded-host'] || '')
        .split(',')[0]
        ?.trim() ?? '',
    ].filter(Boolean),
  );
  try {
    return hosts.has(new URL(origin).host);
  } catch {
    return false;
  }
}
