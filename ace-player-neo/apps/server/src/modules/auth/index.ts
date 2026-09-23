/* Fábrica del módulo `auth` (emparejamiento, tokens de dispositivo y URLs de
   vídeo firmadas; arquitectura §5.12). La implementación está en
   service.ts; `createAuth(deps, { random })` permite a los tests fijar el
   azar sin cambiar la firma de esta fábrica. */

import { createAuth } from './service.js';
import type { AuthDeps, AuthService } from './types.js';

export type * from './types.js';
export { LAST_SEEN_THROTTLE_MS, PAIRING_WINDOW_MS, createAuth, publicDevice } from './service.js';

export function createAuthService(deps: AuthDeps): AuthService {
  return createAuth(deps);
}
