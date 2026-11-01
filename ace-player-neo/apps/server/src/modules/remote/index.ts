/* Fábrica del módulo `remote` (el dominio de fuera, tv.ismaeloul.es; types.ts). */

import { createRemote } from './service.js';
import type { RemoteDeps, RemoteService } from './types.js';

export type * from './types.js';
export { REMOTE_EVENT_DEDUPE_MS, REMOTE_EXPIRY_CHECK_MS, createRemote } from './service.js';

export function createRemoteService(deps: RemoteDeps): RemoteService {
  return createRemote(deps);
}
