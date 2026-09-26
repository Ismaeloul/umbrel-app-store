/* Bus de dominio tipado (arquitectura §5.1 y §5.2).

   Rompe los ciclos que tiene hoy server.js: el comprobador no llama a
   fuentes, precalentado ni playback; emite `scan.verdict` y `scan.jobDone`
   y quien quiera se suscribe. Lo mismo el motor (`engine.status`), playback
   (`playback.*`, `stream.*`), el estado (`state.changed`), diagnóstico y
   auth (`devices.changed`). El hub SSE (módulo events) reenvía a los clientes
   los que tienen esquema en @ace/shared/events.

   Entrega SÍNCRONA y en orden de suscripción: quien emite sabe que, al
   volver de `emit`, todos los suscriptores lo han visto. Un suscriptor que
   lanza no rompe al que emite ni a los demás: se anota en el log y sigue. */

import type {
  DiagnosticCause,
  DiagnosticEntry,
  EngineStatus,
  ScanJobKind,
  SseEventData,
} from '@ace/shared';
import type { Logger } from './logger.js';

/** Un fallo que un módulo quiere dejar en el registro de diagnóstico sin depender de él. */
export interface DiagnosticReport {
  readonly cause: DiagnosticCause;
  /** Código corto `[a-z0-9_]` (del catálogo de errores si existe). */
  readonly code: string;
  readonly message: string;
  readonly hash?: string;
  readonly channel?: string;
  readonly deviceId?: string;
  readonly sessionId?: string;
  readonly requestId?: string;
}

/**
 * Destino opcional de un evento de visor (paso 1.3, lo pidió events): si
 * viene, el hub solo lo manda a las conexiones de esos dispositivos y lo
 * quita antes de validar el esquema SSE. Sin él, va a todas y cada cliente
 * filtra por sus `viewerIds`.
 */
export interface DeviceTargeted {
  readonly targetDeviceIds?: readonly string[];
}

/** Mapa evento → carga. Los que van a los clientes reutilizan el esquema SSE. */
export interface DomainEvents {
  /** Veredicto de una fuente (comprobador o reproductor). Lo consumen fuentes, precalentado, playback y SSE. */
  'scan.verdict': SseEventData<'scan.verdict'>;
  /** Progreso de un trabajo del comprobador (para el SSE de quien lo mira). */
  'scan.progress': SseEventData<'scan.progress'>;
  /** Un trabajo ha terminado (completo o cancelado): precalentado e informes actualizan su estado. */
  'scan.jobDone': {
    readonly jobId: string;
    readonly kind: ScanJobKind;
    readonly status: 'complete' | 'cancelled';
    readonly matchId: string | null;
    /** Clave del informe que lo lanzó, si fue un informe (arregla backend-modulos §8.2.11). */
    readonly reportKey: string | null;
    readonly total: number;
    readonly playable: number;
  };
  /** Estado del motor con histéresis: solo se emite al cambiar (arquitectura §5.5). */
  'engine.status': EngineStatus;
  /** Cambió quién tiene el mando (`nowPlaying`) o el aprendizaje. */
  'playback.nowPlaying': SseEventData<'playback.nowPlaying'>;
  /** Un visor pierde el canal: otro dispositivo se lo ha quedado. */
  'playback.handoff': SseEventData<'playback.handoff'> & DeviceTargeted;
  /** «Dónde se está reproduciendo»: la lista de sesiones cada vez que cambia (a web e iOS). */
  'playback.sessions': SseEventData<'playback.sessions'>;
  /**
   * Hay o no hay alguien viendo, y qué. Lo usan el vigilante del motor
   * (histéresis de 2 o 3 fallos) y el comprobador (ritmo lento y nunca el
   * hash que se está viendo, arquitectura §5.8) sin depender de playback.
   */
  'playback.activity': {
    readonly watching: boolean;
    readonly hashes: readonly string[];
    readonly viewers: number;
  };
  'stream.ready': SseEventData<'stream.ready'> & DeviceTargeted;
  'stream.reopened': SseEventData<'stream.reopened'> & DeviceTargeted;
  'stream.modeChanged': SseEventData<'stream.modeChanged'> & DeviceTargeted;
  'stream.closed': SseEventData<'stream.closed'> & DeviceTargeted;
  'stream.stats': SseEventData<'stream.stats'> & DeviceTargeted;
  /** Algo guardado cambió (lo emite state tras persistir). */
  'state.changed': SseEventData<'state.changed'>;
  /** Petición de anotar un fallo: la atiende diagnostics y luego emite `diagnostics.new`. */
  'diagnostics.report': DiagnosticReport;
  /** Fallo ya anotado (con id y fecha). */
  'diagnostics.new': DiagnosticEntry;
  /** Alta, baja o cambio de un dispositivo emparejado (desde la 0.8.1 va a todos los orígenes). */
  'devices.changed': SseEventData<'devices.changed'>;
  /**
   * Estado de la IPTV (lo emite el módulo iptv; docs/iptv.md §5.5). El hub lo
   * manda solo a la web (`WEB_ONLY_EVENT_TYPES`).
   */
  'iptv.status': SseEventData<'iptv.status'>;
}

export type DomainEventType = keyof DomainEvents;
export type DomainListener<T extends DomainEventType> = (payload: DomainEvents[T]) => void;
/** Se llama para darse de baja. */
export type Unsubscribe = () => void;

export interface DomainBus {
  on<T extends DomainEventType>(type: T, listener: DomainListener<T>): Unsubscribe;
  once<T extends DomainEventType>(type: T, listener: DomainListener<T>): Unsubscribe;
  emit<T extends DomainEventType>(type: T, payload: DomainEvents[T]): void;
  listenerCount(type: DomainEventType): number;
  /** Quita todos los suscriptores (apagado y tests). */
  clear(): void;
}

export interface DomainBusOptions {
  /** Donde se anotan los suscriptores que lanzan. Sin él, se ignoran en silencio. */
  readonly logger?: Pick<Logger, 'error'>;
}

export function createDomainBus(options: DomainBusOptions = {}): DomainBus {
  const listeners = new Map<DomainEventType, Set<(payload: unknown) => void>>();

  const add = (type: DomainEventType, listener: (payload: unknown) => void): Unsubscribe => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  return {
    on(type, listener) {
      return add(type, listener as (payload: unknown) => void);
    },
    once(type, listener) {
      const off = add(type, (payload) => {
        off();
        (listener as (payload: unknown) => void)(payload);
      });
      return off;
    },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      /* Copia: un suscriptor que se da de baja (o da de alta a otro) durante
         la entrega no cambia a quién le llega este evento. */
      for (const listener of [...set]) {
        try {
          listener(payload);
        } catch (error) {
          options.logger?.error({ err: error, event: type }, 'suscriptor del bus ha fallado');
        }
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    clear() {
      listeners.clear();
    },
  };
}
