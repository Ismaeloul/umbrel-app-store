/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `playback`, con los mismos nombres, entradas y salidas
   (comportamientos-tests.md §3.1-3.2).

   Como en la 0.6.59, escriben el estado con `writeState` (el servicio que se
   haya enlazado con `bindLegacyState`; sin enlazar, solo calculan) y las
   lápidas viven en un mapa del módulo, el equivalente de `releasedClaims`
   (server.js:157). Es solo la fachada de los tests y del contraste: el
   servicio tiene sus lápidas por instancia y persiste por la cola de state. */

import { randomBytes } from 'node:crypto';
import type { NowPlaying, StateV1 } from '@ace/shared';
import { createSystemClock } from '../../core/clock.js';
import { isAppError } from '../../core/errors.js';
import { writeState } from '../state/legacy-exports.js';
import { decideClaim, decideRelease, type Tombstones } from './mando.js';

const clock = createSystemClock();
const releasedClaims: Tombstones = new Map();

/* Escribe como `writeState` si hay un servicio enlazado; si no, lo deja estar. */
function persist(next: StateV1): StateV1 {
  try {
    return writeState(next);
  } catch (error) {
    if (isAppError(error) && error.code === 'not_implemented') return next;
    throw error;
  }
}

/** `claimPlayback` (server.js:1177): marca monótona y lápidas. T-037, T-038. */
export function claimPlayback(
  state: StateV1,
  body: Record<string, unknown>,
): { success: true; nowPlaying: NowPlaying | null; ignored?: true } {
  const decision = decideClaim(state.nowPlaying, body, {
    now: clock.now(),
    tombstones: releasedClaims,
    random: () => randomBytes(4).toString('hex').slice(0, 6),
  });
  if (decision.kind === 'ignored') return { success: true, nowPlaying: null, ignored: true };
  const written = persist({ ...state, nowPlaying: decision.nowPlaying });
  return { success: true, nowPlaying: written.nowPlaying };
}

/** `releasePlayback` (server.js:1200). T-037, T-038. */
export function releasePlayback(
  state: StateV1,
  body: Record<string, unknown>,
): { success: true; released: boolean } {
  const decision = decideRelease(state.nowPlaying, body, {
    now: clock.now(),
    tombstones: releasedClaims,
  });
  if (!decision.release) return { success: true, released: false };
  persist({ ...state, nowPlaying: null });
  return { success: true, released: true };
}
