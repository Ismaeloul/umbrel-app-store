/* Lo último que sonó en cada escenario (`sala/<id>`), en la sesión del
   navegador: al recargar sin nada sonando, la vista ofrece «Continuar» o
   «Reproducir» con su título (docs/vod.md §12.8). Solo esta pestaña: el
   progreso de verdad lo guarda el servidor. */

import type { VodPlayback } from '../../player/api.ts';
import { readJson, writeItem } from '../../lib/storage.ts';

export const HASH_RE_STRICT = /^[a-f0-9]{40}$/;
const KEY = 'aceneo-sala';
const MAX = 8;

export interface SalaItem {
  id: string;
  kind: 'movie' | 'episode';
  title: string;
  subtitle: string | null;
  seriesId: string | null;
  positionS: number;
  durationS: number;
}

export function isSalaItem(value: unknown): value is SalaItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item['id'] === 'string' &&
    HASH_RE_STRICT.test(item['id']) &&
    (item['kind'] === 'movie' || item['kind'] === 'episode') &&
    typeof item['title'] === 'string' &&
    (item['subtitle'] === null || typeof item['subtitle'] === 'string') &&
    (item['seriesId'] === null || typeof item['seriesId'] === 'string') &&
    typeof item['positionS'] === 'number' &&
    typeof item['durationS'] === 'number'
  );
}

function isSalaList(value: unknown): value is SalaItem[] {
  return Array.isArray(value) && value.every(isSalaItem);
}

function load(): SalaItem[] {
  return readJson(KEY, isSalaList, 'session') ?? [];
}

export function salaItem(id: string): SalaItem | null {
  return load().find((item) => item.id === id) ?? null;
}

export function rememberSala(vod: VodPlayback): void {
  if (!HASH_RE_STRICT.test(vod.id)) return;
  const item: SalaItem = {
    id: vod.id,
    kind: vod.kind,
    title: vod.title,
    subtitle: vod.subtitle,
    seriesId: vod.seriesId,
    positionS: Math.round(vod.positionS),
    durationS: Math.round(vod.durationS),
  };
  const list = [item, ...load().filter((entry) => entry.id !== vod.id)].slice(0, MAX);
  writeItem(KEY, JSON.stringify(list), 'session');
}
