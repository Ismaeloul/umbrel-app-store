/* Escudos reales opcionales. Si existe `public/escudos/index.json`
   ({ "rma": "rma.png", … }), el componente Crest pinta la imagen y deja el
   escudo generado como reserva (y como fallback si la imagen falla). El
   prototipo no descarga nada por sí mismo: la carpeta la llena Isma
   (a mano o con `node scripts/escudos.mjs`). */

import { useSyncExternalStore } from 'react';

type Manifest = Record<string, string>;

let manifest: Manifest | null = null;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const failed = new Set<string>();

function base(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
}

function emit() {
  for (const l of listeners) l();
}

function load(): Promise<void> {
  if (loading) return loading;
  loading = fetch(`${base()}escudos/index.json`, { cache: 'no-cache' })
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as Manifest;
      manifest = j && typeof j === 'object' ? j : {};
    })
    .catch(() => {
      manifest = {};
    })
    .finally(() => {
      loaded = true;
      emit();
    });
  return loading;
}

/** URL del escudo real de un equipo, o null si no hay (o aún no se sabe). */
export function realCrestUrl(teamId: string): string | null {
  if (!loaded) {
    void load();
    return null;
  }
  const f = manifest?.[teamId];
  if (!f || failed.has(teamId)) return null;
  return /^https?:|^data:|^\//.test(f) ? f : `${base()}escudos/${f}`;
}

export function markCrestFailed(teamId: string) {
  failed.add(teamId);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useRealCrest(teamId: string): string | null {
  return useSyncExternalStore(subscribe, () => realCrestUrl(teamId), () => null);
}

/** ¿Hay pack de escudos cargado (aunque sea vacío)? Útil para depuración. */
export function crestPackInfo(): { loaded: boolean; count: number } {
  return { loaded, count: manifest ? Object.keys(manifest).length : 0 };
}
