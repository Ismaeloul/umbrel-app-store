/* Tiempo real por SSE (arquitectura §5.13 y §7.4): sustituye a los sondeos.

   - EventSource a /api/v1/events?device=<id>. Si el navegador reconecta solo,
     manda Last-Event-ID; si hay que abrir otro EventSource (el servidor lo
     cerró del todo), se pasa `lastEventId` en la query.
   - Si en 10 s no conecta, RESPALDO: se refrescan cada 5 s las consultas
     activas de /api/v1/playback y cada 20 s las del motor (como la 0.6.59),
     hasta que el SSE vuelva. Con el SSE abierto no se sondea nada.
   - Cada evento actualiza o invalida las consultas de TanStack Query que le
     tocan (tabla de abajo) y se reparte a quien lo escuche con onSseEvent /
     useSseEvent. Los eventos dirigidos a visores (stream.*,
     playback.handoff) solo llegan si son de un visor de ESTA pestaña.
   - En desarrollo, cada evento se valida con su esquema zod de @ace/shared. */

import type { QueryClient } from '@tanstack/react-query';
import type { SseEventData, SseEventType, StateScope } from '@ace/shared';
import { useEffect, useEffectEvent } from 'react';
import { getDeviceId, isForThisViewer } from './identity.ts';
import { routeKey, routePrefix } from './query.ts';
import { realtimeStore } from './realtime-store.ts';
import type { ApiResponse, JsonRouteId } from './routes.ts';

/** Todos los tipos de evento (el test comprueba que coinciden con @ace/shared). */
export const SSE_TYPES = [
  'playback.nowPlaying',
  'playback.handoff',
  'stream.ready',
  'stream.reopened',
  'stream.modeChanged',
  'stream.closed',
  'stream.stats',
  'engine.status',
  'scan.progress',
  'scan.verdict',
  'state.changed',
  'diagnostics.new',
  'devices.changed',
  'resync',
] as const satisfies readonly SseEventType[];

/** Dirigidos a visores concretos: se filtran por el visor de esta pestaña. */
const TARGETED: ReadonlySet<SseEventType> = new Set([
  'playback.handoff',
  'stream.ready',
  'stream.reopened',
  'stream.modeChanged',
  'stream.closed',
  'stream.stats',
]);

/** `state.changed` → rutas que hay que volver a pedir. */
export const SCOPE_ROUTES: Record<StateScope, readonly JsonRouteId[]> = {
  library: ['libraryGet', 'bootstrap'],
  preferences: ['preferencesGet', 'bootstrap'],
  directories: ['directoriesGet', 'libraryGet', 'bootstrap'],
  bindings: ['footballResolve'],
  reports: ['footballResolve', 'health'],
  learning: ['playbackStatus', 'health'],
  stats: ['health'],
  nowPlaying: ['playbackStatus'],
  settings: ['settingsGet', 'bootstrap'],
};

export const SSE_FALLBACK_AFTER_MS = 10_000;
export const FALLBACK_PLAYBACK_MS = 5_000;
export const FALLBACK_ENGINE_MS = 20_000;

// ---- Reparto de eventos --------------------------------------------------------

type Handler<T extends SseEventType> = (
  data: SseEventData<T>,
  meta: { id: string | null; synthetic: boolean },
) => void;

const handlers = new Map<SseEventType, Set<Handler<SseEventType>>>();

export function onSseEvent<T extends SseEventType>(type: T, handler: Handler<T>): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler as unknown as Handler<SseEventType>);
  return () => {
    set.delete(handler as unknown as Handler<SseEventType>);
  };
}

/** Escucha un evento mientras el componente está montado (siempre con el manejador más reciente). */
export function useSseEvent<T extends SseEventType>(type: T, handler: Handler<T>): void {
  const onEvent = useEffectEvent(handler);
  useEffect(() => onSseEvent(type, (data, meta) => onEvent(data, meta)), [type]);
}

export function dispatchSse<T extends SseEventType>(
  type: T,
  data: SseEventData<T>,
  meta: { id: string | null; synthetic: boolean },
): void {
  for (const handler of [...(handlers.get(type) ?? [])]) {
    try {
      handler(data, meta);
    } catch (error) {
      console.error(`[sse] Un oyente de «${type}» ha fallado`, error);
    }
  }
}

// ---- Efecto en la caché de consultas ---------------------------------------------

export function applyToCache(client: QueryClient, type: SseEventType, data: unknown): void {
  switch (type) {
    case 'state.changed': {
      const { scopes } = data as SseEventData<'state.changed'>;
      const routes = new Set(scopes.flatMap((scope) => SCOPE_ROUTES[scope] ?? []));
      for (const id of routes) void client.invalidateQueries({ queryKey: routePrefix(id) });
      break;
    }
    case 'engine.status':
      client.setQueryData(routeKey('engineStatus'), data as ApiResponse<'engineStatus'>);
      break;
    case 'playback.nowPlaying': {
      const next = data as SseEventData<'playback.nowPlaying'>;
      client.setQueryData<ApiResponse<'playbackStatus'>>(routeKey('playbackStatus'), (old) =>
        old ? { ...old, nowPlaying: next.nowPlaying, learningCount: next.learningCount } : old,
      );
      break;
    }
    case 'scan.progress': {
      const { jobId } = data as SseEventData<'scan.progress'>;
      void client.invalidateQueries({ queryKey: ['v1', 'footballScan', { id: jobId }] });
      break;
    }
    case 'scan.verdict': {
      const { jobId } = data as SseEventData<'scan.verdict'>;
      if (jobId) void client.invalidateQueries({ queryKey: ['v1', 'footballScan', { id: jobId }] });
      break;
    }
    case 'devices.changed':
      void client.invalidateQueries({ queryKey: routePrefix('devicesList') });
      break;
    case 'diagnostics.new':
      void client.invalidateQueries({ queryKey: routePrefix('diagnosticsList') });
      void client.invalidateQueries({ queryKey: routePrefix('health') });
      break;
    case 'resync':
      // Lo que faltaba ya no está en el búfer del servidor: se pide todo otra vez.
      void client.invalidateQueries({ queryKey: ['v1'] });
      break;
    default:
      break;
  }
}

async function validateInDev(type: SseEventType, data: unknown): Promise<void> {
  if (!import.meta.env.DEV) return;
  const { SseEventSchema } = await import('@ace/shared');
  const result = SseEventSchema.safeParse({ type, data });
  if (!result.success)
    console.error(`[sse] El evento «${type}» no cumple su esquema`, result.error.issues);
}

// ---- Conexión -------------------------------------------------------------------

export interface RealtimeOptions {
  client: QueryClient;
  /** Para los tests: un EventSource simulado. */
  EventSourceImpl?: typeof EventSource;
  fallbackAfterMs?: number;
}

/** Arranca el tiempo real. Devuelve la función para pararlo. */
export function startRealtime({
  client,
  EventSourceImpl = globalThis.EventSource,
  fallbackAfterMs = SSE_FALLBACK_AFTER_MS,
}: RealtimeOptions): () => void {
  let source: EventSource | null = null;
  let stopped = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackPoll: ReturnType<typeof setInterval> | null = null;
  let enginePoll: ReturnType<typeof setInterval> | null = null;
  let lastNowPlaying: unknown = undefined;

  const set = (patch: Partial<ReturnType<typeof realtimeStore.get>>) =>
    realtimeStore.set((s) => ({ ...s, ...patch }));

  const refetchActive = async (id: JsonRouteId) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    await client.refetchQueries({ queryKey: routePrefix(id), type: 'active' });
  };

  const pollPlayback = async () => {
    await refetchActive('playbackStatus');
    // En respaldo también se avisa del cambio de mando, como si viniera por SSE.
    const status = client.getQueryData<ApiResponse<'playbackStatus'>>(routeKey('playbackStatus'));
    if (!status) return;
    const key = JSON.stringify(status.nowPlaying);
    if (lastNowPlaying !== undefined && key !== lastNowPlaying) {
      dispatchSse(
        'playback.nowPlaying',
        { nowPlaying: status.nowPlaying, learningCount: status.learningCount },
        { id: null, synthetic: true },
      );
    }
    lastNowPlaying = key;
  };

  const startFallback = () => {
    if (stopped || realtimeStore.get().status === 'open') return;
    set({ status: 'fallback' });
    if (!playbackPoll) playbackPoll = setInterval(() => void pollPlayback(), FALLBACK_PLAYBACK_MS);
    if (!enginePoll)
      enginePoll = setInterval(() => void refetchActive('engineStatus'), FALLBACK_ENGINE_MS);
    void pollPlayback();
  };

  const stopFallback = () => {
    if (playbackPoll) clearInterval(playbackPoll);
    if (enginePoll) clearInterval(enginePoll);
    playbackPoll = null;
    enginePoll = null;
  };

  const armFallbackTimer = () => {
    if (fallbackTimer || playbackPoll) return;
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      startFallback();
    }, fallbackAfterMs);
  };

  const onMessage = (type: SseEventType) => (event: MessageEvent<string>) => {
    if (event.lastEventId) set({ lastEventId: event.lastEventId });
    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      console.error(`[sse] «${type}» trae datos que no son JSON`);
      return;
    }
    void validateInDev(type, data);
    if (TARGETED.has(type) && !isForThisViewer((data as { viewerIds?: string[] }).viewerIds))
      return;
    applyToCache(client, type, data);
    dispatchSse(type, data as SseEventData<typeof type>, {
      id: event.lastEventId || null,
      synthetic: false,
    });
  };

  const connect = () => {
    if (stopped) return;
    if (!EventSourceImpl) {
      startFallback();
      return;
    }
    source?.close();
    const params = new URLSearchParams({ device: getDeviceId() });
    const { lastEventId } = realtimeStore.get();
    if (lastEventId) params.set('lastEventId', lastEventId);
    const es = new EventSourceImpl(`/api/v1/events?${params.toString()}`);
    source = es;
    if (realtimeStore.get().status !== 'fallback') set({ status: 'connecting' });
    armFallbackTimer();

    es.onopen = () => {
      if (stopped || source !== es) return;
      const wasDegraded =
        realtimeStore.get().status === 'fallback' || realtimeStore.get().attempts > 0;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = null;
      stopFallback();
      set({ status: 'open', attempts: 0 });
      // Tras un corte se pudo perder algo: se refresca lo que cambia solo.
      if (wasDegraded) {
        void client.invalidateQueries({ queryKey: routePrefix('playbackStatus') });
        void client.invalidateQueries({ queryKey: routePrefix('engineStatus') });
      }
    };
    es.onerror = () => {
      if (stopped || source !== es) return;
      const attempts = realtimeStore.get().attempts + 1;
      set({ attempts, status: playbackPoll ? 'fallback' : 'connecting' });
      armFallbackTimer();
      if (es.readyState === 2 /* CLOSED */) {
        // El navegador se ha rendido (error HTTP): se reabre a mano con espera creciente.
        es.close();
        const delay = Math.min(60_000, 3_000 * 2 ** Math.min(attempts - 1, 5));
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, delay);
      }
    };
    for (const type of SSE_TYPES) es.addEventListener(type, onMessage(type) as EventListener);
  };

  const onVisible = () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    if (realtimeStore.get().status !== 'open' && (!source || source.readyState === 2)) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      connect();
    }
  };

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  connect();

  return () => {
    stopped = true;
    source?.close();
    source = null;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    stopFallback();
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisible);
    set({ status: 'idle', attempts: 0 });
  };
}

/** Modo demo: sin tiempo real. */
export function markRealtimeDemo(): void {
  realtimeStore.set((s) => ({ ...s, status: 'demo' }));
}
