/* Módulo `events`: el hub SSE (arquitectura §5.13 y §7.4).

   - `GET /api/v1/events` (web) y `GET /native/api/v1/events` (iOS, Bearer).
   - Formato estándar: `id` creciente, `event`, `data` JSON validado con el
     esquema de @ace/shared/events, latido `: ping` cada 15 s y `retry: 3000`.
   - Reanudación: búfer circular de 200 eventos; con `Last-Event-ID` se
     reenvía lo que falte o, si ya no está, un `resync`.
   - Filtro: cada conexión recibe lo general y lo de su dispositivo. Filtro
     por origen: `WEB_ONLY_EVENT_TYPES` (vacío desde la 0.8.1:
     `devices.changed` va a todos).
   - Contrapresión: si el búfer de escritura de una conexión pasa de 256 KiB,
     se cierra y el cliente reconecta.
   - Se suscribe al bus (playback, stream, engine, scan, state, diagnostics,
     devices) y al revocar un dispositivo cierra sus conexiones.

   Tests previstos: plan E1.7 (reanudación, filtro, contrapresión y latido
   con FakeClock). */

import type { Origin, SseEvent } from '@ace/shared';
import type { FastifyReply } from 'fastify';
import type { CoreDeps, Lifecycle } from '../../core/module.js';

export type EventsDeps = CoreDeps;

export interface SseConnectOptions {
  readonly origin: Origin;
  /** El de la web (query `device`) o el del dispositivo emparejado. */
  readonly deviceId: string | null;
  /** `Last-Event-ID` o `lastEventId`. */
  readonly lastEventId: number | null;
  /** Se aborta cuando el cliente cierra. */
  readonly signal: AbortSignal;
}

export interface EventsHub extends Lifecycle {
  /** Toma la respuesta (hijack), manda la cabecera SSE y la mantiene abierta hasta que el cliente cierre. */
  connect(reply: FastifyReply, options: SseConnectOptions): Promise<void>;
  /** Publica un evento (lo validan con su esquema antes de ponerlo en el búfer). */
  publish(event: SseEvent, target?: { readonly deviceIds?: readonly string[] }): void;
  connections(): number;
  /** Cierra las conexiones de un dispositivo (revocación). */
  closeDevice(deviceId: string): void;
  /** Cierra todas (apagado, arquitectura §5.16). */
  closeAll(): void;
}
