/* Exportaciones de server.js (0.6.59) que corresponden al módulo `state`,
   con los mismos nombres, entradas y salidas (comportamientos-tests.md
   §3.1-3.2). Las usan los tests portados y el contraste con la 0.6.59.

   Los normalizadores son los de normalize.ts con el contexto del servicio
   enlazado (legacy-binding.ts) o, si no hay, los defectos de la 0.6.59.
   `readState`, `writeState` y `mutateLibrary` necesitan un servicio
   enlazado con `bindLegacyState()`: en la 0.6.59 salían del `DATA_DIR` del
   entorno y la v2 no lee el entorno al importar. */

import type {
  ChannelBinding,
  ChannelFeedback,
  Item,
  Preferences,
  SourceReport,
  SourceStats,
  StateV1,
  WebSource,
} from '@ace/shared';
import { applyLibraryMutation } from './library.js';
import { boundStateService, boundSyncAccess, legacyContext } from './legacy-binding.js';
import * as normalize from './normalize.js';
import { libraryResponse, type LegacyLibraryResponse } from './projections.js';

export { normalizeHash } from '@ace/shared';

/**
 * `STATE_BACKUP_FILE` (server.js:15). En la 0.6.59 es una ruta absoluta que
 * depende de DATA_DIR; aquí, relativa a DATA_DIR, porque la v2 no lee el
 * entorno al importar (la absoluta está en `config.paths.stateBackupFile`). T-109.
 */
export const STATE_BACKUP_FILE = 'state.json.bak';

/** `readState` (server.js:1017): estado normalizado (una copia que se puede tocar, como entonces). */
export function readState(): StateV1 {
  return structuredClone(boundStateService('readState').get()) as StateV1;
}

/** `writeState` (server.js:1068): normaliza, persiste (state.json + .bak) y devuelve el estado. */
export function writeState(nextState: Partial<StateV1> | Record<string, unknown>): StateV1 {
  return structuredClone(boundSyncAccess('writeState').writeStateSync(nextState)) as StateV1;
}

/** `normalizeItem` (server.js:436): elemento de biblioteca o null si no hay hash. */
export function normalizeItem(item: unknown, fallbackType: Item['type'] = 'recent'): Item | null {
  return normalize.normalizeItem(item, fallbackType, legacyContext());
}

/** `normalizePreferences` (server.js:486). T-025. */
export function normalizePreferences(value: unknown): Preferences {
  return normalize.normalizePreferences(value, legacyContext());
}

/** `normalizeChannelBinding` (server.js:839). T-114. */
export function normalizeChannelBinding(value: unknown): ChannelBinding | null {
  return normalize.normalizeChannelBinding(value, legacyContext());
}

/** `normalizeSourceReport` (server.js:2588): motivo desconocido → `not_starting`. T-076, T-077, T-114. */
export function normalizeSourceReport(value: unknown): SourceReport | null {
  return normalize.normalizeSourceReport(value, legacyContext());
}

/** `normalizeChannelFeedback` (server.js:2632). T-076, T-077. */
export function normalizeChannelFeedback(value: unknown): ChannelFeedback | null {
  return normalize.normalizeChannelFeedback(value, legacyContext());
}

/** `normalizeWebSource` (server.js:913). */
export function normalizeWebSource(
  source: unknown,
  index = 0,
  fallbackStreams: unknown[] = [],
  fallbackSyncedAt: string | null = null,
): WebSource | null {
  return normalize.normalizeWebSource(
    source,
    index,
    fallbackStreams,
    fallbackSyncedAt,
    legacyContext(),
  );
}

/** `normalizeSourceStats` (server.js:3868): `{hashes: {}, proveedores: {}}` si no hay nada. T-092, T-093. */
export function normalizeSourceStats(value: unknown): SourceStats {
  return normalize.normalizeSourceStats(value);
}

/**
 * `mutateLibrary` (server.js:1123): aplica la acción sobre `current`, lo
 * escribe y devuelve `libraryResponse` (`{success, favorites}`,
 * `{success, history}` o `directoryResponse`). T-031, T-036, T-110.
 */
export function mutateLibrary(current: StateV1, body: unknown): LegacyLibraryResponse {
  const access = boundSyncAccess('mutateLibrary');
  const draft = structuredClone(current) as StateV1;
  const collection = applyLibraryMutation(draft, body, access.ctx);
  return libraryResponse(access.writeStateSync(draft), collection);
}
