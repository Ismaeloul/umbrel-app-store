/* Fachada con los nombres de `module.exports` de server.js de la 0.6.59
   (server.js:5181-5287; comportamientos-tests.md §3.1-3.2).

   La usan los tests portados (que siguen llamando `app.channelMatchScore`,
   `app.readState`…) y el contraste automático con la 0.6.59 (plan E1.4), que
   ejecuta las mismas entradas contra las dos y compara. Cada nombre vive en
   el `legacy-exports.ts` de su módulo; aquí solo se juntan. El test
   test/legacy-exports.test.ts comprueba que no falta ni sobra ninguno.

   No es API de producto: el código nuevo usa los servicios. */

import { notImplemented } from '../core/errors.js';

export * from '../modules/state/legacy-exports.js';
export * from '../modules/net/legacy-exports.js';
export * from '../modules/directories/legacy-exports.js';
export * from '../modules/engine/legacy-exports.js';
export * from '../modules/scanner/legacy-exports.js';
export * from '../modules/search/legacy-exports.js';
export * from '../modules/sources/legacy-exports.js';
export * from '../modules/remux/legacy-exports.js';
export * from '../modules/playback/legacy-exports.js';
export * from '../modules/football/legacy-exports.js';
export * from '../modules/auth/legacy-exports.js';
export * from '../modules/events/legacy-exports.js';
export * from '../modules/diagnostics/legacy-exports.js';
export * from '../modules/health/legacy-exports.js';

/**
 * `createServer` (server.js:5128): en la 0.6.59, `http.createServer(handleRequest)`.
 * En la v2 el equivalente es `buildApp()` de app.ts; esto queda para los tests
 * portados que hacían `listen(0)` sobre él.
 */
export function createServer(): never {
  throw notImplemented('createServer');
}

/** `startServer` (server.js:5132): en la v2, `main()` de main.ts. */
export function startServer(): never {
  throw notImplemented('startServer');
}
