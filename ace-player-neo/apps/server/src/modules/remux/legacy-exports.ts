/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `remux`, con los mismos nombres, entradas y salidas
   (comportamientos-tests.md §3.1-3.2). Son las funciones puras portadas tal
   cual; el servicio usa las mismas. */

import { elegirSesionRemuxADesalojar as elegir } from './eviction.js';
import { parseByteRange as parse, remuxPlaylistStatsSync } from './files.js';

/** `parseByteRange` (server.js:346): `{start,end}`, false (416) o null (sin Range). T-003. */
export function parseByteRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | false | null {
  return parse(value, size);
}

/** `elegirSesionRemuxADesalojar` (server.js:201): nunca una con espectadores. T-112. */
export function elegirSesionRemuxADesalojar(
  sessions: Map<string, { lastAccess: number; clients: { size: number }; exited: boolean }>,
): string | null {
  return elegir(sessions);
}

/** `remuxPlaylistStats` (server.js:212). T-125. */
export function remuxPlaylistStats(file: string): { segments: number; seconds: number } | null {
  return remuxPlaylistStatsSync(file);
}
