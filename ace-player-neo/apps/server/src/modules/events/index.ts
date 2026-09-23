/* Fábrica del módulo `events` (hub SSE, arquitectura §5.13). La
   implementación está en hub.ts; `createHub` devuelve además lo que miran
   los tests (`attach`, ids y búfer). */

import { createHub } from './hub.js';
import type { EventsDeps, EventsHub } from './types.js';

export type * from './types.js';
export { FORWARDED_EVENTS, SSE_HEADERS, createHub } from './hub.js';

export function createEventsHub(deps: EventsDeps): EventsHub {
  return createHub(deps);
}
