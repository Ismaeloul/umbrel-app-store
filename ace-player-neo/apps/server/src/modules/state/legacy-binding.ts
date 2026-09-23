/* Qué servicio de estado usa la fachada de la 0.6.59 (legacy-exports.ts).

   En la 0.6.59 `readState`/`writeState` leían `DATA_DIR` del entorno al
   importar; la v2 no tiene globales ni lee el entorno fuera de config/, así
   que el test que quiera usarlas enlaza antes un servicio concreto. Vive
   aparte para no añadir un nombre de más a la fachada (legacy/exports.ts
   tiene exactamente los de server.js). Solo para tests y contraste. */

import { createSystemClock } from '../../core/clock.js';
import { DEFAULTS } from '../../config/index.js';
import { notImplemented } from '../../core/errors.js';
import type { NormalizeContext } from './normalize.js';
import { LEGACY_SYNC, type LegacySyncAccess } from './service.js';
import type { StateService } from './types.js';
import { randomBytes } from 'node:crypto';

let bound: StateService | null = null;

/** Enlaza (o suelta, con null) el servicio que usan `readState`, `writeState` y `mutateLibrary`. */
export function bindLegacyState(service: StateService | null): void {
  bound = service;
}

export function boundStateService(what: string): StateService {
  if (!bound) throw notImplemented(`${what}: falta bindLegacyState(servicio)`);
  return bound;
}

export function boundSyncAccess(what: string): LegacySyncAccess {
  const service = boundStateService(what) as Partial<Record<typeof LEGACY_SYNC, LegacySyncAccess>>;
  const access = service[LEGACY_SYNC];
  if (!access) throw notImplemented(`${what}: el servicio enlazado no admite escritura síncrona`);
  return access;
}

const systemClock = createSystemClock();

/* Sin servicio enlazado, los normalizadores puros usan los defectos de la
   0.6.59 (`FOOTBALL_COUNTRY=Spain`, la lista IPFS por defecto) y la hora real,
   como server.js sin variables de entorno. */
const defaultContext: NormalizeContext = {
  nowIso: () => systemClock.date().toISOString(),
  defaultWebSyncUrl: DEFAULTS.defaultWebSyncUrl,
  footballCountry: DEFAULTS.footballCountry,
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
};

/** Contexto de normalización del servicio enlazado o, si no hay, el de los defectos. */
export function legacyContext(): NormalizeContext {
  if (!bound) return defaultContext;
  const access = (bound as Partial<Record<typeof LEGACY_SYNC, LegacySyncAccess>>)[LEGACY_SYNC];
  return access ? access.ctx : defaultContext;
}
