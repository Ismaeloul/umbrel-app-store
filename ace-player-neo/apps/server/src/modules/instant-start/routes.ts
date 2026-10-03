/* `instant-start` no tiene rutas propias (D24): el ajuste va por
   /api/v1/settings (state) y su estado, en la salud (health). El fichero
   existe para que cada módulo de SERVICE_ORDER tenga su sitio en
   MODULE_ROUTES. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

export const LEGACY_ROUTES: readonly string[] = [];
export const V1_ROUTE_IDS: readonly string[] = [];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
