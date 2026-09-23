/* ¿Hay backend de verdad o es el modo demo? (inventario §22, igual que la
   0.6.59 pero preguntando a /api/v1/bootstrap):

   - `?demo=1` fuerza la demo;
   - el protocolo `file:` (abrir el HTML suelto) también;
   - si el arranque (`GET /api/v1/bootstrap`) falla en 2,5 s Y el host es
     localhost, 127.0.0.1 o ::1, demo. En un Umbrel real un fallo pasajero
     NUNCA activa la demo: la app sigue en vivo y reintentando.

   Toda llamada de api() espera a que esto se decida (whenModeReady). Si la
   respuesta del arranque llegó bien, se guarda para sembrar la caché y no
   pedirla dos veces. */

import type { BootstrapResponse } from '@ace/shared';
import { createStore, useStore } from '../lib/store.ts';

export type AppMode = 'pending' | 'live' | 'demo';

export interface ModeState {
  mode: AppMode;
  /** Por qué se decidió así (para el aviso y los tests). */
  reason: 'param' | 'file' | 'offline-local' | 'bootstrap' | 'offline' | null;
}

export const modeStore = createStore<ModeState>({ mode: 'pending', reason: null });

let resolveReady: (mode: AppMode) => void = () => {};
let ready = new Promise<AppMode>((resolve) => {
  resolveReady = resolve;
});

export function whenModeReady(): Promise<AppMode> {
  return ready;
}

export function isDemo(): boolean {
  return modeStore.get().mode === 'demo';
}

export function useAppMode(): AppMode {
  return useStore(modeStore, (state) => state.mode);
}

export function setMode(mode: Exclude<AppMode, 'pending'>, reason: ModeState['reason']): void {
  modeStore.set({ mode, reason });
  resolveReady(mode);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const DEMO_DETECT_TIMEOUT_MS = 2500;

export interface DetectOptions {
  location?: Pick<Location, 'search' | 'protocol' | 'hostname'>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface DetectResult {
  mode: Exclude<AppMode, 'pending'>;
  reason: NonNullable<ModeState['reason']>;
  bootstrap: BootstrapResponse | null;
}

export async function detectMode({
  location = globalThis.location,
  fetchImpl = globalThis.fetch.bind(globalThis),
  timeoutMs = DEMO_DETECT_TIMEOUT_MS,
}: DetectOptions = {}): Promise<DetectResult> {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') return { mode: 'demo', reason: 'param', bootstrap: null };
  if (location.protocol === 'file:') return { mode: 'demo', reason: 'file', bootstrap: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/v1/bootstrap', {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bootstrap = (await response.json()) as BootstrapResponse;
    return { mode: 'live', reason: 'bootstrap', bootstrap };
  } catch {
    if (LOCAL_HOSTS.has(location.hostname))
      return { mode: 'demo', reason: 'offline-local', bootstrap: null };
    return { mode: 'live', reason: 'offline', bootstrap: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Solo para los tests: vuelve a «sin decidir». */
export function resetMode(): void {
  modeStore.set({ mode: 'pending', reason: null });
  ready = new Promise<AppMode>((resolve) => {
    resolveReady = resolve;
  });
}
