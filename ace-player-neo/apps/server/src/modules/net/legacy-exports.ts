/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `net`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';

export { motivoDeFallo } from '@ace/shared';

/** `isPrivateAddress` (server.js:1280). T-004. */
export function isPrivateAddress(_ip: string): boolean {
  throw notImplemented('isPrivateAddress');
}

/** `isPrivateHostname` (server.js:1303). T-004. */
export function isPrivateHostname(_hostname: string): boolean {
  throw notImplemented('isPrivateHostname');
}

/** `fetchText` (server.js:1342): URL, saltos, visitadas, plazo, tope y opciones. T-005, T-116. */
export async function fetchText(
  _url: string,
  _redirects?: number,
  _visited?: Set<string>,
  _deadline?: number,
  _maxBytes?: number,
  _options?: { binary?: boolean; accept?: string },
): Promise<string | Buffer> {
  throw notImplemented('fetchText');
}
