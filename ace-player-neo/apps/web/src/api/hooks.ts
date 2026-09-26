/* Consultas que usa más de una vista (y el propio armazón). */

import type { EngineState } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { iptvActive } from './boot.ts';
import { useApiQuery } from './query.ts';

/** Estado del motor: llega por SSE (`engine.status`) o, en respaldo, cada 20 s. */
export function useEngineStatus() {
  return useApiQuery('engineStatus');
}

export interface EngineSummary {
  state: EngineState | 'loading' | 'error';
  /** «Motor en línea», «Motor arrancando…», «Motor apagado»... */
  text: string;
  /** Solo se tiñe si algo falla (el diseño lo quiere discreto). */
  tone: 'ok' | 'weak' | 'fail' | 'idle';
}

export function summarizeEngine(status: EngineState | undefined, failed = false): EngineSummary {
  if (failed) return { state: 'error', text: 'Motor sin respuesta', tone: 'fail' };
  switch (status) {
    case 'online':
      return { state: 'online', text: 'Motor en línea', tone: 'ok' };
    case 'restarting':
      return { state: 'restarting', text: 'Motor arrancando…', tone: 'weak' };
    case 'offline':
      return { state: 'offline', text: 'Motor apagado', tone: 'fail' };
    case 'unknown':
      return { state: 'unknown', text: 'Motor: comprobando…', tone: 'idle' };
    default:
      return { state: 'loading', text: 'Motor: comprobando…', tone: 'idle' };
  }
}

export function useEngineSummary(): EngineSummary {
  const query = useEngineStatus();
  return summarizeEngine(query.data?.status, query.isError && !query.data);
}

/** Todo lo de la primera pantalla (sembrado al arrancar desde /api/v1/bootstrap). */
export function useBootstrap() {
  return useApiQuery('bootstrap');
}

/**
 * `iptvActive()` que repinta cuando cambia (`bootstrap.features.iptv`, que el
 * evento `iptv.status` vuelve a pedir). Sin pedir nada: solo mira la caché, así
 * que no cambia cuándo se pide el bootstrap (docs/iptv.md §14.3).
 */
export function useIptvActive(): boolean {
  const client = useQueryClient();
  return useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () => iptvActive(client),
    () => false,
  );
}
