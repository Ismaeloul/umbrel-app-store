/* Rutas del módulo `auth`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   (ninguna: server.js no tenía emparejamiento ni dispositivos)

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - pairingCreate: POST /api/v1/pairing (web o iPhone emparejado)
   - pairingClaim: POST /api/v1/pairing/claim (sin token)
   - devicesList: GET /api/v1/devices (web o iPhone)
   - deviceRevoke: DELETE /api/v1/devices/:id (web o iPhone, también el propio)

   La comprobación del Bearer y de la URL de vídeo firmada la llama app.ts
   (services.auth.authenticateBearer / verifyVideoToken) antes del manejador. */

import type { IncomingHttpHeaders } from 'node:http';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'pairingCreate',
  'pairingClaim',
  'devicesList',
  'deviceRevoke',
];

const HOST_RE = /^(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  /* `X-Forwarded-*` puede traer una lista si hay varios saltos: vale el primero. */
  return raw?.split(',')[0]?.trim() || undefined;
}

/**
 * URL base para el QR cuando no llega `baseUrl` (arquitectura §5.12):
 * `X-Forwarded-Proto`/`X-Forwarded-Host` si llegan con forma válida, si no
 * `Host`. Desde /native es el `Host` con el que el iPhone llegó (nginx lo
 * reenvía tal cual); la app nueva manda siempre `baseUrl`. Estas cabeceras
 * las controla quien llama, pero quien llama ya está autenticado y podría
 * mandar `baseUrl` a su gusto: el QR solo lo ve él.
 */
export function baseUrlFromHeaders(headers: IncomingHttpHeaders): string {
  const proto = firstHeader(headers['x-forwarded-proto'])?.toLowerCase();
  const scheme = proto === 'https' || proto === 'http' ? proto : 'http';
  const forwarded = firstHeader(headers['x-forwarded-host']);
  const host = [forwarded, firstHeader(headers.host)].find(
    (candidate): candidate is string => candidate !== undefined && HOST_RE.test(candidate),
  );
  return `${scheme}://${host ?? 'localhost'}`;
}

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('pairingCreate', (input, ctx) =>
    services.auth.createPairing(
      input.body,
      baseUrlFromHeaders(ctx.request.headers),
      ctx.device?.deviceId ?? null,
    ),
  );
  router.handle('pairingClaim', (input) => services.auth.claimPairing(input.body));
  router.handle('devicesList', () => services.auth.listDevices());
  router.handle('deviceRevoke', (input) => services.auth.revokeDevice(input.params.id));
}
