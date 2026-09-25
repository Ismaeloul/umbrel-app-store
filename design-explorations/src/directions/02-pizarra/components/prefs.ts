/* Estado propio de la propuesta (no del simulador): densidad, filtro de la
   agenda, hoja abierta, fila enfocada con el teclado y muestras del
   sparkline. Un almacén mínimo con useSyncExternalStore. */
import { useSyncExternalStore } from 'react';
import type { Source } from '../../../core/types';

export type Density = 'comodo' | 'compacto';
export type AgendaFilter = 'para-ti' | 'todos';

export type SheetSpec =
  | { type: 'report'; kind: 'match' | 'channel'; id: string; sourceId: string }
  | { type: 'paste'; kind: 'match' | 'channel'; id: string }
  | { type: 'open-in'; source: Source | null; title: string }
  | { type: 'help' }
  | { type: 'rename'; id: string; title: string }
  | { type: 'add-list' }
  | { type: 'scan' }
  | { type: 'source-actions'; kind: 'match' | 'channel'; id: string; sourceId: string }
  | { type: 'channel-actions'; id: string; title: string }
  | { type: 'match-actions'; kind: 'match' | 'channel'; id: string }
  | null;

interface UiState {
  density: Density;
  filter: AgendaFilter;
  sheet: SheetSpec;
  /** Fila enfocada con ↑↓ en la web (id de partido). */
  focusId: string | null;
  /** Panel visible en web estrecha. */
  pane: 'agenda' | 'centro' | 'fuentes';
}

let ui: UiState = { density: 'comodo', filter: 'para-ti', sheet: null, focusId: null, pane: 'centro' };
const listeners = new Set<() => void>();

function set(patch: Partial<UiState>) {
  ui = { ...ui, ...patch };
  for (const l of listeners) l();
}

export function useUi<T>(sel: (u: UiState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(ui),
    () => sel(ui),
  );
}

export const getUi = () => ui;
export const setDensity = (density: Density) => set({ density });
export const toggleDensity = () => set({ density: ui.density === 'comodo' ? 'compacto' : 'comodo' });
export const setFilter = (filter: AgendaFilter) => set({ filter });
export const openSheet = (sheet: SheetSpec) => set({ sheet });
export const closeSheet = () => set({ sheet: null });
export const setFocusId = (focusId: string | null) => set({ focusId });
export const setPane = (pane: UiState['pane']) => set({ pane });

/* ---------- sparkline: muestras de bajada por fuente ---------- */
const SAMPLES = 24;
const samples = new Map<string, number[]>();
let sampleTick = 0;
const sampleListeners = new Set<() => void>();

export function recordSample(sourceId: string, value: number) {
  const arr = samples.get(sourceId) ?? [];
  arr.push(value);
  if (arr.length > SAMPLES) arr.shift();
  samples.set(sourceId, arr);
  sampleTick++;
  for (const l of sampleListeners) l();
}

export function useSamples(sourceId: string | null): number[] {
  useSyncExternalStore(
    (l) => {
      sampleListeners.add(l);
      return () => sampleListeners.delete(l);
    },
    () => sampleTick,
    () => sampleTick,
  );
  return sourceId ? (samples.get(sourceId) ?? []) : [];
}

/* ---------- utilidades pequeñas ---------- */
export function isHexHash(s: string): boolean {
  return /^[0-9a-f]{40}$/i.test(s.trim());
}

/** Extrae un Content ID de texto pegado: 40 hex, acestream://<hash> o URL con el hash. */
export function extractHash(s: string): string | null {
  const t = s.trim();
  const m = t.match(/([0-9a-f]{40})/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

/** Hash determinista de 40 hex a partir de un texto (para resultados del motor). */
export function fakeHashFrom(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (const c of text) {
    h1 = Math.imul(h1 ^ c.charCodeAt(0), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c.charCodeAt(0), 2246822519) >>> 0;
  }
  let out = '';
  let a = h1;
  let b = h2;
  while (out.length < 40) {
    a = Math.imul(a ^ (a >>> 15), 2654435761) >>> 0;
    b = Math.imul(b ^ (b >>> 13), 1597334677) >>> 0;
    out += (a ^ b).toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

export function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* sin portapapeles: nada */
  }
}
