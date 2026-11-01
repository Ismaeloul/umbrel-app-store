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
  PartyList,
  PartyLiveSourcesQuery,
  PartyLiveSourcesResponse,
  PartyMemberBody,
  PartyPreview,
  PartyQueueBody,
  PartySettingsBody,
  PartyStatusBody,
  PartyStatusResponse,
  PartyStreamGrant,
  PartyStreamQuery,
} from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { PlaybackService, ViewerIdentity } from '../playback/types.js';
import type { RemuxService } from '../remux/types.js';
import type { FootballService } from '../football/types.js';
import type { ScannerService } from '../scanner/types.js';
import type { EngineService } from '../engine/types.js';

export interface PartyDeps extends CoreDeps {
  readonly playback: Pick<PlaybackService, 'acquire' | 'acquireVod' | 'heartbeat' | 'release'> &
    /* El automático del directo mira quién usa la plaza IPTV (sin él, se da por libre). */
    Partial<Pick<PlaybackService, 'status'>>;
  /**
   * La calidad ligera de los invitados (docs/ver-juntos.md §17). Sin él (tests viejos), nadie la
   * recibe: `index.m3u8` como siempre.
   */
  readonly remux?: Pick<RemuxService, 'vodLiteOffer' | 'vodLiteCovers'>;
  /**
   * Las fuentes de una sala en directo (§14, `partyLiveSources`) y el cambio automático del
   * servidor. Sin él (tests viejos), la sala no tiene fuentes propias ni salta sola.
   */
  readonly football?: Pick<FootballService, 'resolve'>;
  /** Los veredictos del comprobador (qué fuente está verificada) y los que aprende la sala. */
  readonly scanner?: Pick<ScannerService, 'job' | 'verdict' | 'recordVerdict'>;
  /** El vigilante del motor: con él caído, un corte de la sala no es «Sin señal» de la fuente. */
  readonly engine?: Pick<EngineService, 'status'>;
}

/** De dónde viene la petición de `partyStream`. */
export interface PartyStreamOptions {
  /** Entró por el proxy de la sala (`X-Ace-Origin: guest`, §9): un invitado de fuera. */
  readonly guest?: boolean;
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
    options?: PartyStreamOptions,
  ): Promise<PartyStreamGrant>;
  /** La sesión de vídeo de la persona con esta clave (`partyVideo`). */
  videoSession(code: string, key: string): string;
  control(code: string, body: PartyControlBody): PartyStatusResponse;
  /** Las fuentes del directo (`partyLiveSources`): el líder, los co-líderes y el anfitrión. */
  liveSources(
    code: string,
    query: Omit<PartyLiveSourcesQuery, 't'> & { readonly t: string },
  ): Promise<PartyLiveSourcesResponse>;
  status(code: string, body: PartyStatusBody): Promise<PartyStatusResponse>;
  chat(code: string, body: PartyChatBody): void;
  /** «Está escribiendo» (§13): se reenvía a la sala, como mucho uno cada `typingIntervalMs`. */
  typing(code: string, token: string): void;
  /** Líder, co-líderes, ajustes y lista (docs/ver-juntos.md §11 y §13). */
  settings(code: string, body: PartySettingsBody): void;
  member(code: string, body: PartyMemberBody): void;
  queue(code: string, body: PartyQueueBody): void;
  leave(code: string, token: string): void;
  close(code: string, token: string): void;
  /** Las salas abiertas (`partyList`, solo la web de casa). */
  list(): PartyList;
  /** Cerrar una sala desde casa, sin su credencial (`partyEnd`). */
  end(code: string): void;
  health(): PartyHealth;
}
