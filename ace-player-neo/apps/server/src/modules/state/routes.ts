/* Rutas del módulo `state`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.1-4.3 y §4.7):
   - GET /api/state          → publicState (server.js:4825-4826)
   - PUT /api/state          → clientes 0.6.8: solo altas y el mando (server.js:4827-4851)
   - POST /api/library       → mutateLibrary + libraryResponse (server.js:4855-4859)
   - POST /api/preferences   → `{success, preferences}` (server.js:4720-4724)

   v1 (tabla de @ace/shared/routes.ts; acceso, validación y errores ya
   resueltos por app.ts):
   - bootstrap, settingsGet, settingsUpdate, libraryGet, libraryMutate,
     preferencesGet, preferencesUpdate.

   El "cuerpo antes que el estado" de la 0.6.59 (T-108) ya no hace falta:
   Fastify lee el cuerpo antes del manejador y la mutación se aplica dentro
   de la cola única del estado, sobre el estado vigente en ese momento. */

import {
  ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
  type BootstrapResponse,
  type LibraryView,
  type Device,
  type DeviceRecord,
  type EngineStatus,
  type PlaybackStatus,
  type StateV1,
} from '@ace/shared';
import type { RequestContext } from '../../core/module.js';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import { libraryResponse, libraryView } from './projections.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/preferences',
  'GET /api/state',
  'PUT /api/state',
  'POST /api/library',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'bootstrap',
  'settingsGet',
  'settingsUpdate',
  'libraryGet',
  'libraryMutate',
  'preferencesGet',
  'preferencesUpdate',
];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('POST', '/api/preferences', async (req) => ({
    success: true,
    preferences: await services.state.updatePreferences(req.body as Record<string, unknown>),
  }));
  router.handle('GET', '/api/state', () => services.state.publicState());
  router.handle('PUT', '/api/state', (req) =>
    services.state.mergeLegacyState(
      req.body as Parameters<Services['state']['mergeLegacyState']>[0],
    ),
  );
  router.handle('POST', '/api/library', async (req) => {
    const result = await services.state.mutateLibrary(req.body as Record<string, unknown>);
    return libraryResponse(result.state, result.collection);
  });
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('bootstrap', (_input, ctx) => bootstrap(services, ctx));
  router.handle('settingsGet', () => services.state.settings());
  router.handle('settingsUpdate', ({ body }) => services.state.updateSettings(body));
  router.handle('libraryGet', () => withIptvIds(services, services.state.libraryView()));
  router.handle('libraryMutate', async ({ body }) => {
    const result = await services.state.mutateLibrary(body);
    return withIptvIds(services, libraryView(result.state));
  });
  router.handle('preferencesGet', () => ({ preferences: services.state.get().preferences }));
  router.handle('preferencesUpdate', async ({ body }) => ({
    preferences: await services.state.updatePreferences(body),
  }));
}

/**
 * `LibraryView.iptvIds` (docs/iptv.md §14.6): el estado ahora de cada id IPTV
 * de favoritos y recientes. Sin ninguno, la vista de siempre. Si la IPTV no
 * responde, también (no tumba la biblioteca).
 */
export function withIptvIds(services: Services, view: LibraryView): LibraryView {
  const ids = [...view.favorites, ...view.history].map((item) => item.id);
  if (!ids.length || !services.iptv) return view;
  try {
    const states = services.iptv.libraryIdStates(ids);
    return states ? { ...view, iptvIds: states } : view;
  } catch (error) {
    services.logger.warn({ err: error }, 'biblioteca: sin el estado de los ids IPTV');
    return view;
  }
}

// --- bootstrap ---

/** Vista pública de un dispositivo: nunca el hash del secreto (api/v1/auth.ts). */
export function publicDevice(record: DeviceRecord): Device {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    revokedAt: record.revokedAt,
  };
}

/* Lo que no es del estado (mando y motor) sale de sus servicios; si uno
   falla, la primera pantalla se pinta igual con un valor neutro y queda en
   el log: el arranque de la app no debe caerse por el panel del motor. */
function safely<T>(services: Services, what: string, read: () => T, fallback: () => T): T {
  try {
    return read();
  } catch (error) {
    services.logger.warn({ err: error, part: what }, 'bootstrap: parte no disponible');
    return fallback();
  }
}

export function fallbackPlayback(state: Readonly<StateV1>, now: number): PlaybackStatus {
  return {
    nowPlaying: state.nowPlaying,
    learningCount: state.channelFeedback.length,
    serverTime: now,
    sessions: [],
  };
}

export function fallbackEngineStatus(): EngineStatus {
  return {
    status: 'unknown',
    online: false,
    since: null,
    checkedAt: null,
    engineVersion: null,
    autoRestarts: {
      lastHour: 0,
      max: ENGINE_MAX_AUTO_RESTARTS_PER_HOUR,
      nextAllowedAt: null,
      exhausted: false,
    },
  };
}

export function bootstrap(services: Services, ctx: RequestContext): BootstrapResponse {
  const { config, clock, state } = services;
  const now = clock.now();
  const current = state.get();
  return {
    version: config.appVersion,
    serverTime: now,
    origin: ctx.origin,
    device: ctx.device ? publicDevice(ctx.device.device) : null,
    preferences: current.preferences,
    library: withIptvIds(services, libraryView(current)),
    playback: safely(
      services,
      'playback',
      () => services.playback.status(),
      () => fallbackPlayback(current, now),
    ),
    engine: safely(services, 'engine', () => services.engine.status(), fallbackEngineStatus),
    settings: state.settings().settings,
    features: {
      scanner: config.scanner.enabled,
      ai: config.ai.enabled,
      demoSchedule: config.football.demoOnly,
      /* docs/iptv.md §5.1: hay IPTV activa con catálogo cargado (ausente = no). */
      ...(safely(
        services,
        'iptv',
        () => services.iptv.active(),
        () => false,
      )
        ? { iptv: true }
        : {}),
    },
  };
}
