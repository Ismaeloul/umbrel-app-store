/* Fábrica del módulo `playback` (sesiones del motor, visores y mando;
   arquitectura §5.6). La implementación está en service.ts (SessionManager),
   mando.ts (claim/release de la 0.6.59) y grant.ts (latencia, códec y URL de
   la respuesta de §6.3). No abre nada ni programa temporizadores hasta que
   alguien pide un canal; las suscripciones (motor, remux, dispositivos)
   empiezan con `start()`. */

import { createPlaybackRuntime } from './service.js';
import type { PlaybackDeps, PlaybackService } from './types.js';

export type * from './types.js';

export function createPlaybackService(deps: PlaybackDeps): PlaybackService {
  return createPlaybackRuntime(deps).service;
}
