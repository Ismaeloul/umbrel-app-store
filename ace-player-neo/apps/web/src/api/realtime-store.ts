/* Estado del tiempo real (SSE), aparte de sse.ts para que query.ts pueda
   leerlo sin arrastrar el cliente SSE entero. */

import { createStore, useStore } from '../lib/store.ts';

/**
 * - idle: aún no ha arrancado.
 * - connecting: abriendo o reconectando el EventSource.
 * - open: conectado; nada se sondea.
 * - fallback: el SSE no conectó en 10 s: se sondea /api/v1/playback cada 5 s
 *   (y el motor cada 20 s) hasta que vuelva.
 * - demo: modo demo, sin tiempo real.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'fallback' | 'demo';

export interface RealtimeState {
  status: RealtimeStatus;
  /** Último id recibido (para reanudar con Last-Event-ID). */
  lastEventId: string | null;
  /** Reintentos seguidos sin conectar. */
  attempts: number;
}

export const realtimeStore = createStore<RealtimeState>({
  status: 'idle',
  lastEventId: null,
  attempts: 0,
});

export function useRealtimeStatus(): RealtimeStatus {
  return useStore(realtimeStore, (state) => state.status);
}
