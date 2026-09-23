/* Identidad de este navegador ante el backend (arquitectura §5.6).

   - deviceId: persistente en localStorage. Es «este navegador»: el mismo en
     todas sus pestañas y tras recargar. Lo usan el SSE (para recibir lo de sus
     visores) y la apertura de canal.
   - viewerId: uno por pestaña y por carga de página, SOLO en memoria. Así dos
     pestañas del mismo navegador son dos consumidores y no se pisan (P12: la
     0.6.59 lo guardaba en sessionStorage, que Chrome COPIA al duplicar una
     pestaña). Al recargar sale otro; el anterior lo suelta el reproductor en
     `pagehide` (regla 38) o caduca a los 45 s sin latido.

   Los dos cumplen DeviceIdSchema / ViewerIdSchema: [A-Za-z0-9_-]{4,64}. */

import { readItem, STORAGE_KEYS, writeItem } from '../lib/storage.ts';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

function randomToken(bytes = 16): string {
  const data = new Uint8Array(bytes);
  try {
    globalThis.crypto.getRandomValues(data);
  } catch {
    for (let i = 0; i < data.length; i += 1) data[i] = Math.floor(Math.random() * 256);
  }
  // base64url sin relleno: solo letras, números, - y _.
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let deviceId: string | null = null;
let viewerId: string | null = null;

export function getDeviceId(): string {
  if (deviceId) return deviceId;
  const stored = readItem(STORAGE_KEYS.device);
  if (stored && ID_RE.test(stored)) {
    deviceId = stored;
    return stored;
  }
  const fresh = `web_${randomToken(12)}`;
  writeItem(STORAGE_KEYS.device, fresh);
  deviceId = fresh;
  return fresh;
}

export function getViewerId(): string {
  if (!viewerId) viewerId = `v_${randomToken(10)}`;
  return viewerId;
}

/** ¿Este evento dirigido es para esta pestaña? */
export function isForThisViewer(viewerIds: readonly string[] | undefined): boolean {
  if (!viewerIds || viewerIds.length === 0) return true;
  return viewerIds.includes(getViewerId());
}

/** Solo para los tests. */
export function resetIdentity(): void {
  deviceId = null;
  viewerId = null;
}
