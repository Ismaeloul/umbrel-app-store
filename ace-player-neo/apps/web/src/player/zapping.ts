/* Lista de zapping (B-092, index.html:5323-5339): favoritos y después el
   directorio activo agrupado por categorías en el orden en que llegan, sin
   repetidos y sin los recientes. Si el canal actual no está en la lista, el
   siguiente es el primero. */

export interface ZapItem {
  id: string;
  title: string;
  ih?: boolean;
  category?: string;
}

export interface ZapSource {
  favorites?: readonly ZapItem[];
  web?: readonly ZapItem[];
}

export function zappingList(library: ZapSource | null | undefined): ZapItem[] {
  if (!library) return [];
  const grouped = new Map<string, ZapItem[]>();
  for (const item of library.web ?? []) {
    const category = item.category || 'General';
    const list = grouped.get(category);
    if (list) list.push(item);
    else grouped.set(category, [item]);
  }
  const flat = [...(library.favorites ?? []), ...[...grouped.values()].flat()];
  const seen = new Set<string>();
  const out: ZapItem[] = [];
  for (const item of flat) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** El canal al que se llega con ← (−1) o → (+1). */
export function zapTarget(
  list: readonly ZapItem[],
  currentId: string | null,
  direction: 1 | -1,
): ZapItem | null {
  if (!list.length) return null;
  const index = currentId ? list.findIndex((item) => item.id === currentId) : -1;
  const next = index === -1 ? 0 : (index + direction + list.length) % list.length;
  const target = list[next] ?? null;
  return target && target.id !== currentId ? target : null;
}
