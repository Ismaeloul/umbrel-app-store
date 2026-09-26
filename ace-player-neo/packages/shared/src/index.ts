/* Punto de entrada de @ace/shared: esquemas zod, tipos, constantes y
   funciones puras que comparten el servidor, la web y los tests. Nada de
   aquí toca Node ni el DOM (arquitectura §4), así que se puede importar desde
   cualquier sitio. La app iOS no lo importa: usa el OpenAPI generado
   (docs/openapi-v2.yaml) y los ejemplos de fixtures/. */

export * from './primitives.js';
export * from './errors.js';
export * from './events.js';
export * from './routes.js';

export * from './constants/iptv.js';
export * from './constants/limits.js';
export * from './constants/playback.js';
export * from './constants/timeouts.js';

export * from './domain/channel-names.js';
export * from './domain/channels.js';
export * from './domain/for-you.js';
export * from './domain/hash.js';
export * from './domain/live.js';
export * from './domain/text.js';

export * from './state/v1.js';
export * from './state/v2.js';

export * from './api/common.js';
export * from './api/legacy.js';
export * from './api/v1/auth.js';
export * from './api/v1/diagnostics.js';
export * from './api/v1/engine.js';
export * from './api/v1/football.js';
export * from './api/v1/iptv.js';
export * from './api/v1/library.js';
export * from './api/v1/playback.js';
export * from './api/v1/search.js';
export * from './api/v1/settings.js';
export * from './api/v1/sources.js';
export * from './api/v1/system.js';
