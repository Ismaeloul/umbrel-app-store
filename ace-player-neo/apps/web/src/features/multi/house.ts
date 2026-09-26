/* Lo que se sabe de la casa ahora mismo, leído de la caché (sin pedir nada):
   las sesiones de `playbackStatus` (que el SSE `playback.sessions` tiene al
   día), la política de «Un solo dispositivo a la vez», quién es este visor y
   desde cuándo está en pausa cada visor de los demás (docs/multidispositivo.md
   §2.1). Lo usan la puerta, seguir, la cápsula y la sesión de fuentes. */

import type {
  BootstrapResponse,
  PlaybackStatus,
  SameChannelPolicy,
  SessionSummary,
  SessionViewer,
  SettingsResponse,
} from '@ace/shared';
import { getDeviceId, getViewerId } from '../../api/identity.ts';
import { isDemo } from '../../api/mode.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import type { Navigate } from '../../app/router.tsx';
import type { Route } from '../../app/routes.ts';
import type { HouseMe } from './decide.ts';
import { deviceLabels, deviceShortLabel, type DeviceRef } from './texts.ts';

export function houseMe(): HouseMe {
  return { viewerId: getViewerId(), deviceId: getDeviceId() };
}

/** Las sesiones de la casa que hay en la caché (vacío si aún no se sabe). */
export function houseSessions(): readonly SessionSummary[] {
  return queryClient.getQueryData<PlaybackStatus>(routeKey('playbackStatus'))?.sessions ?? [];
}

/** «Un solo dispositivo a la vez»: Ajustes si se ha cargado; si no, lo que dijo el arranque. */
export function housePolicy(): SameChannelPolicy {
  const settings = queryClient.getQueryData<SettingsResponse>(routeKey('settingsGet'));
  if (settings) return settings.settings.sameChannelPolicy;
  const boot = queryClient.getQueryData<BootstrapResponse>(routeKey('bootstrap'));
  return boot?.settings.sameChannelPolicy ?? 'share';
}

/**
 * ¿El servidor entiende `others`, `from`, `join`, `match` y `follows`?
 * (`bootstrap.features.multi`). Sin él, nada de esto se manda ni se pregunta:
 * el esquema del servidor es estricto y rechazaría la petición.
 */
export function multiEnabled(): boolean {
  if (isDemo()) return false;
  const boot = queryClient.getQueryData<BootstrapResponse>(routeKey('bootstrap'));
  return boot?.features.multi === true;
}

export function sseOpen(): boolean {
  return realtimeStore.get().status === 'open';
}

// ---- Pausa de los demás (pausedStaleMs) ---------------------------------------------------

const pausedSince = new Map<string, number>();

/**
 * Apunta cuándo se vio pasar cada visor a `playing: false` (y lo olvida al
 * volver a sonar o irse). En la carga cuenta desde ese momento (§2.1).
 */
export function trackPaused(sessions: readonly SessionSummary[], now = Date.now()): void {
  const present = new Set<string>();
  for (const session of sessions) {
    for (const viewer of session.viewers) {
      present.add(viewer.viewerId);
      if (viewer.playing === false) {
        if (!pausedSince.has(viewer.viewerId)) pausedSince.set(viewer.viewerId, now);
      } else pausedSince.delete(viewer.viewerId);
    }
  }
  for (const id of [...pausedSince.keys()]) if (!present.has(id)) pausedSince.delete(id);
}

export function pausedMap(): ReadonlyMap<string, number> {
  return pausedSince;
}

// ---- Nombres ---------------------------------------------------------------------------------

/** Este dispositivo tal como lo ve el servidor (su nombre, si ya está en alguna sesión). */
export function myDeviceRef(
  sessions: readonly SessionSummary[] = houseSessions(),
): DeviceRef | null {
  const deviceId = getDeviceId();
  for (const session of sessions) {
    const viewer = session.viewers.find((candidate) => candidate.deviceId === deviceId);
    if (viewer) return { platform: viewer.platform, deviceName: viewer.deviceName, deviceId };
  }
  return null;
}

/** Nombres cortos de estos visores de otros dispositivos, con las reglas de choque. */
export function labelsFor(viewers: readonly SessionViewer[]): string[] {
  return deviceLabels(viewers, myDeviceRef());
}

/** Nombre corto de quien se ha quedado la casa en un `playback.handoff`. */
export function handoffLabel(by: {
  client: SessionViewer['platform'];
  deviceId: string | null;
  deviceName?: string | undefined;
}): string {
  if (by.deviceId && by.deviceId === getDeviceId()) return deviceShortLabel(by, getDeviceId());
  if (!by.deviceName) return deviceShortLabel(null);
  return (
    deviceLabels(
      [{ platform: by.client, deviceName: by.deviceName, deviceId: by.deviceId }],
      myDeviceRef(),
    )[0] ?? deviceShortLabel(null)
  );
}

// ---- Navegar desde fuera de React (seguir y la cápsula) ---------------------------------------

let navigator: Navigate | null = null;
let currentRoute: () => Route | null = () => null;

/** Lo registra el armazón: seguir con partido y la cápsula abren rutas. */
export function registerHouseNavigation(
  navigate: Navigate | null,
  route: () => Route | null,
): void {
  navigator = navigate;
  currentRoute = route;
}

export function houseNavigate(to: Route, options?: { replace?: boolean }): void {
  navigator?.(to, options);
}

export function houseRoute(): Route | null {
  return currentRoute();
}
