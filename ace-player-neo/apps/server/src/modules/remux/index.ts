/* Fábrica del módulo `remux` (ffmpeg a HLS fMP4 para iPhone; arquitectura
   §5.7). La implementación está en service.ts (registro, espera, recolector
   y servido), args.ts (línea de ffmpeg), files.ts (rangos y listas),
   eviction.ts (desalojo) y process.ts (lanzador, log y huérfanos). No lanza
   nada ni programa temporizadores hasta `start()`/`ensure()`. */

import { createRemuxRuntime } from './service.js';
import type { RemuxDeps, RemuxService } from './types.js';

export type * from './types.js';

export function createRemuxService(deps: RemuxDeps): RemuxService {
  return createRemuxRuntime(deps).service;
}
