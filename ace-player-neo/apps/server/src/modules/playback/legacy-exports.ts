/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `playback`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';
import type { NowPlaying, StateV1 } from '@ace/shared';

/** `claimPlayback` (server.js:1177): marca monótona y lápidas. T-037, T-038. */
export function claimPlayback(
  _state: StateV1,
  _body: Record<string, unknown>,
): { success: true; nowPlaying: NowPlaying | null; ignored?: true } {
  throw notImplemented('claimPlayback');
}

/** `releasePlayback` (server.js:1200). T-037, T-038. */
export function releasePlayback(
  _state: StateV1,
  _body: Record<string, unknown>,
): { success: true; released: boolean } {
  throw notImplemented('releasePlayback');
}
