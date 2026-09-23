/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `state`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';
import type {
  Item,
  Preferences,
  StateV1,
  WebSource,
  ChannelBinding,
  SourceReport,
  ChannelFeedback,
  SourceStats,
} from '@ace/shared';

export { normalizeHash } from '@ace/shared';

/**
 * `STATE_BACKUP_FILE` (server.js:15). En la 0.6.59 es una ruta absoluta que
 * depende de DATA_DIR; aquí, relativa a DATA_DIR, porque la v2 no lee el
 * entorno al importar (la absoluta está en `config.paths.stateBackupFile`). T-109.
 */
export const STATE_BACKUP_FILE = 'state.json.bak';

/** `readState` (server.js:1017): estado normalizado. T-031, T-034, T-036 a T-038, T-079, T-080, T-094, T-099, T-108, T-109, T-116, T-119, T-123. */
export function readState(): StateV1 {
  throw notImplemented('readState');
}

/** `writeState` (server.js:1068): normaliza, persiste (state.json + .bak) y devuelve el estado. */
export function writeState(_partial: Partial<StateV1>): StateV1 {
  throw notImplemented('writeState');
}

/** `normalizeItem` (server.js:436): elemento de biblioteca o null si no hay hash. */
export function normalizeItem(_item: unknown, _fallbackType?: Item['type']): Item | null {
  throw notImplemented('normalizeItem');
}

/** `normalizePreferences` (server.js:486). T-025. */
export function normalizePreferences(_value: unknown): Preferences {
  throw notImplemented('normalizePreferences');
}

/** `normalizeChannelBinding` (server.js:839). T-114. */
export function normalizeChannelBinding(_value: unknown): ChannelBinding | null {
  throw notImplemented('normalizeChannelBinding');
}

/** `normalizeSourceReport` (server.js:2588): motivo desconocido → `not_starting`. T-076, T-077, T-114. */
export function normalizeSourceReport(_value: unknown): SourceReport | null {
  throw notImplemented('normalizeSourceReport');
}

/** `normalizeChannelFeedback` (server.js:2632). T-076, T-077. */
export function normalizeChannelFeedback(_value: unknown): ChannelFeedback | null {
  throw notImplemented('normalizeChannelFeedback');
}

/** `normalizeWebSource` (server.js:913). */
export function normalizeWebSource(
  _source: unknown,
  _index?: number,
  _fallbackStreams?: unknown[],
  _fallbackSyncedAt?: string | null,
): WebSource | null {
  throw notImplemented('normalizeWebSource');
}

/** `normalizeSourceStats` (server.js:3868): `{hashes: {}, proveedores: {}}` si no hay nada. T-092, T-093. */
export function normalizeSourceStats(_value: unknown): SourceStats {
  throw notImplemented('normalizeSourceStats');
}

/** `mutateLibrary` (server.js:1123). T-031, T-036, T-110. */
export function mutateLibrary(_state: StateV1, _body: unknown): StateV1 {
  throw notImplemented('mutateLibrary');
}
