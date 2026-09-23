/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `remux`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';

/** `parseByteRange` (server.js:346): `{start,end}`, false (416) o null (sin Range). T-003. */
export function parseByteRange(
  _value: string | undefined,
  _size: number,
): { start: number; end: number } | false | null {
  throw notImplemented('parseByteRange');
}

/** `elegirSesionRemuxADesalojar` (server.js:201): nunca una con espectadores. T-112. */
export function elegirSesionRemuxADesalojar(
  _sessions: Map<string, { lastAccess: number; clients: { size: number }; exited: boolean }>,
): string | null {
  throw notImplemented('elegirSesionRemuxADesalojar');
}

/** `remuxPlaylistStats` (server.js:212). T-125. */
export function remuxPlaylistStats(_file: string): { segments: number; seconds: number } | null {
  throw notImplemented('remuxPlaylistStats');
}
