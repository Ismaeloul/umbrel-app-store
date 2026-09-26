/* Utilidades de los tests de varios dispositivos (no es código de producto):
   siembran la caché con el arranque (`features.multi`) y las sesiones de la
   casa, y dejan el SSE abierto o cerrado. */

import type { BootstrapResponse, SessionSummary, SessionViewer } from '@ace/shared';
import { getDeviceId, getViewerId } from '../../api/identity.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { fixture } from '../../test/fetch.ts';

export const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
export const H2 = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
export const H3 = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';

/** El iPhone de Isma, que sabe seguir. */
export function iphone(over: Partial<SessionViewer> = {}): SessionViewer {
  return {
    client: 'ios',
    deviceId: 'dev_iphone',
    lastBeatAt: new Date().toISOString(),
    viewerId: 'v_iphone',
    deviceName: 'iPhone de Isma',
    platform: 'ios',
    playing: true,
    follows: true,
    ...over,
  };
}

/** Este navegador como visor (el PC). */
export function me(over: Partial<SessionViewer> = {}): SessionViewer {
  return {
    client: 'web',
    deviceId: getDeviceId(),
    lastBeatAt: new Date().toISOString(),
    viewerId: getViewerId(),
    deviceName: 'Chrome · Windows',
    platform: 'web',
    playing: true,
    follows: true,
    ...over,
  };
}

export function houseSession(
  hash: string,
  viewers: SessionViewer[],
  over: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id: `s_${hash.slice(0, 12)}`,
    hash,
    mode: 'hls',
    openedAt: new Date(Date.now() - 60_000).toISOString(),
    viewers,
    title: hash === H1 ? 'DAZN LaLiga' : hash === H2 ? 'Antena 3' : 'La 1',
    protocol: 'hls',
    ...over,
  };
}

/** Siembra el arranque (con o sin `features.multi`) y la política. */
export function seedHouse({
  sessions = [],
  multi = true,
  policy = 'share',
  sse = 'open',
}: {
  sessions?: SessionSummary[];
  multi?: boolean;
  policy?: 'share' | 'handoff';
  sse?: 'open' | 'fallback';
} = {}): void {
  setMode('live', 'bootstrap');
  const boot = fixture<BootstrapResponse>('bootstrap');
  queryClient.setQueryData(routeKey('bootstrap'), {
    ...boot,
    settings: { sameChannelPolicy: policy },
    features: { ...boot.features, ...(multi ? { multi: true } : {}) },
  });
  queryClient.setQueryData(routeKey('settingsGet'), {
    settings: { sameChannelPolicy: policy },
    source: 'saved',
  });
  setSessions(sessions);
  realtimeStore.set((state) => ({ ...state, status: sse }));
}

export function setSessions(sessions: SessionSummary[]): void {
  queryClient.setQueryData(routeKey('playbackStatus'), {
    nowPlaying: null,
    learningCount: 0,
    serverTime: Date.now(),
    sessions,
  });
}

export function resetHouse(): void {
  queryClient.clear();
  realtimeStore.set((state) => ({ ...state, status: 'idle' }));
  resetMode();
}
