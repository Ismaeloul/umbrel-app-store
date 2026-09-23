/* Fábrica del módulo `health` (salud y versión). La implementación está en
   service.ts: `/api/health` con la forma exacta de la 0.6.59 desde las
   cachés de los servicios, `/api/v1/health` para el panel y
   `/api/v1/health/live` y `/api/v1/ping` sin red ni disco. */

export type * from './types.js';
export { createHealthService } from './service.js';
