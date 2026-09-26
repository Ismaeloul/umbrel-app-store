/* Arranque de la capa de datos (lo llama main.tsx una vez):

   1. decide si hay backend o es la demo (mode.ts);
   2. con la respuesta de /api/v1/bootstrap siembra las consultas que ya trae
      (biblioteca, preferencias, mando y motor): la primera pantalla se pinta
      con UNA sola petición;
   3. arranca el SSE (o marca la demo, sin tiempo real);
   4. devuelve el aviso que hay que enseñar, si hay alguno (inventario §10.2). */

import type { BootstrapResponse } from '@ace/shared';
import type { QueryClient } from '@tanstack/react-query';
import { detectMode, setMode, type DetectOptions } from './mode.ts';
import { apiQuery, queryClient, routeKey } from './query.ts';
import { markRealtimeDemo, startRealtime, type RealtimeOptions } from './sse.ts';

export function seedFromBootstrap(client: QueryClient, bootstrap: BootstrapResponse): void {
  client.setQueryData(routeKey('bootstrap'), bootstrap);
  client.setQueryData(routeKey('libraryGet'), bootstrap.library);
  client.setQueryData(routeKey('preferencesGet'), { preferences: bootstrap.preferences });
  client.setQueryData(routeKey('playbackStatus'), bootstrap.playback);
  client.setQueryData(routeKey('engineStatus'), bootstrap.engine);
}

/**
 * ¿Hay IPTV activa con catálogo cargado? (`bootstrap.features.iptv`, docs/iptv.md
 * §5.1). Es el dato barato con el que la web decide si al tocar un canal, o al
 * abrir un partido sin canales, merece la pena preguntar antes por la IPTV.
 * Ausente o falso (servidor sin IPTV, o de antes de la 0.8.1): el camino de
 * siempre, sin ninguna espera. Lo mantiene al día el evento `iptv.status`.
 */
export function iptvActive(client: QueryClient = queryClient): boolean {
  return client.getQueryData<BootstrapResponse>(routeKey('bootstrap'))?.features.iptv === true;
}

export interface BootNotice {
  tone: 'info' | 'warn';
  text: string;
}

export interface BootResult {
  mode: 'live' | 'demo';
  notice: BootNotice | null;
  stop(): void;
}

export async function bootApi(
  client: QueryClient,
  options: { detect?: DetectOptions; realtime?: Omit<RealtimeOptions, 'client'> } = {},
): Promise<BootResult> {
  const detected = await detectMode(options.detect);
  setMode(detected.mode, detected.reason);
  if (detected.mode === 'demo') {
    markRealtimeDemo();
    // La demo también dice si hay IPTV (iptvActive): el arranque de muestra se pide ya.
    void client.prefetchQuery(apiQuery('bootstrap'));
    return {
      mode: 'demo',
      notice: { tone: 'info', text: 'Modo demo: sin backend, canales de muestra cargados' },
      stop: () => {},
    };
  }
  if (detected.bootstrap) seedFromBootstrap(client, detected.bootstrap);
  const stop = startRealtime({ client, ...options.realtime });
  return {
    mode: 'live',
    notice:
      detected.reason === 'offline'
        ? { tone: 'warn', text: 'Backend no disponible; la app seguirá reintentando' }
        : null,
    stop,
  };
}
