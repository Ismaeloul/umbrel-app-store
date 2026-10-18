/* Módulo `party`: «Ver juntos» (docs/ver-juntos.md, D36).

   - Salas en memoria (un reinicio las cierra): título, audio, personas,
     estado de la reproducción y los últimos mensajes del chat.
   - El vídeo es UNA sesión VOD de playback compartida por todos
     (`acquireVod` con `partyKey`): una sola plaza del proveedor.
   - El servidor manda en la posición: cada orden (reproducir, pausar,
     saltar, idioma) cambia el estado para todos y cada cliente se ajusta.
     Si alguien carga, la sala le espera (hasta `PARTY.holdMaxMs`).
   - Tiempo real por un SSE propio de cada sala (no el de la casa: en la
     fase 2 entrarán invitados que no deben ver los eventos de casa). */

import type { FastifyReply } from 'fastify';
import type {
  PartyChatBody,
  PartyControlBody,
  PartyCreateBody,
  PartyJoinResponse,
  PartyPreview,
  PartyStatusBody,
  PartyStatusResponse,
  PartyStreamQuery,
  VodGrant,
} from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { PlaybackService, ViewerIdentity } from '../playback/types.js';

export interface PartyDeps extends CoreDeps {
  readonly playback: Pick<PlaybackService, 'acquireVod'>;
}

/** Lo mínimo de `http.ServerResponse` que usa el SSE de la sala (los tests pasan uno falso). */
export interface PartySink {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): unknown;
  destroy(error?: Error): unknown;
  readonly writableLength: number;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
  once(event: 'close', listener: () => void): unknown;
}

export interface PartyHealth {
  readonly rooms: number;
  readonly members: number;
  readonly connections: number;
}

export interface PartyService extends Lifecycle {
  create(body: PartyCreateBody): PartyJoinResponse;
  preview(code: string): PartyPreview;
  join(code: string, name: string): PartyJoinResponse;
  /** Toma la respuesta (hijack) y la mantiene abierta hasta que el cliente cierre. */
  connect(code: string, token: string, reply: FastifyReply, signal: AbortSignal): Promise<void>;
  /** Engancha una salida ya preparada (lo que hace `connect` tras el hijack; los tests la usan). */
  attach(code: string, token: string, sink: PartySink, signal: AbortSignal): Promise<void>;
  stream(
    code: string,
    query: PartyStreamQuery,
    viewer: ViewerIdentity,
    signal: AbortSignal,
  ): Promise<VodGrant>;
  control(code: string, body: PartyControlBody): PartyStatusResponse;
  status(code: string, body: PartyStatusBody): PartyStatusResponse;
  chat(code: string, body: PartyChatBody): void;
  leave(code: string, token: string): void;
  close(code: string, token: string): void;
  health(): PartyHealth;
}
