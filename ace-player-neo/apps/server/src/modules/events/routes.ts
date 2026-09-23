/* Rutas del módulo `events`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   (ninguna: la 0.6.59 no tenía tiempo real)

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - events: GET /api/v1/events (web, con la cookie de Umbrel) y
     GET /native/api/v1/events (iOS, Bearer: lo comprueba app.ts).

   La respuesta no es JSON: el hub hace `reply.hijack()` y la mantiene
   abierta hasta que el cliente cierre. */

import type { V1Router, LegacyRouter } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['events'];

const EVENT_ID_RE = /^\d{1,16}$/;

/**
 * Último id que vio el cliente: la cabecera `Last-Event-ID` (la pone
 * EventSource al reconectar solo) o, si no viene, la query `lastEventId`
 * (reconexión a mano). Una cabecera con otra forma se ignora: ese id no es
 * nuestro y el cliente empieza de cero.
 */
export function lastEventIdFrom(
  header: string | string[] | undefined,
  query: string | undefined,
): number | null {
  const fromHeader = (Array.isArray(header) ? header[0] : header)?.trim();
  const value = fromHeader || query;
  return value !== undefined && EVENT_ID_RE.test(value) ? Number(value) : null;
}

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('events', async (input, ctx) => {
    /* iOS: el dispositivo es SIEMPRE el del token (no el que diga la query). */
    const deviceId =
      ctx.origin === 'native' ? (ctx.device?.deviceId ?? null) : (input.query.device ?? null);
    await services.events.connect(ctx.reply, {
      origin: ctx.origin,
      deviceId,
      lastEventId: lastEventIdFrom(ctx.request.headers['last-event-id'], input.query.lastEventId),
      signal: ctx.signal,
    });
  });
}
