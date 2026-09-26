/* Re-emparejado de favoritos y recientes IPTV (docs/iptv.md §14.6, D28). Puro.

   Tras una sincronización correcta con la IPTV activa (también la primera
   tras cambiar de proveedor), a cada favorito o reciente con un id IPTV que
   no está en el catálogo vigente, o que está pero ya no es la mejor
   variante de su grupo:
   - si casa por nombre (`alias` o, si no, el título; ≥ 92, ES o sin país,
     la regla del « 1»): se cambia el id por el de la mejor variante EN SU
     SITIO (mismo título, categoría, alias, fecha y posición); si ese id ya
     estaba en la colección, se quita el viejo;
   - si no casa, un reciente se quita al momento;
   - si no casa, un favorito se apunta en memoria desde cuándo falta y se
     quita en la primera sincronización correcta pasadas 24 h. Si el
     servidor se reinicia, la cuenta vuelve a empezar: dura más, nunca menos.
   Los vínculos guardados no se tocan. */

import { IPTV_SEARCH, type Item } from '@ace/shared';

export interface RelinkOptions {
  /** ¿Es un id IPTV de este Umbrel? (etiqueta HMAC, §4.1). */
  readonly isIptvId: (id: string) => boolean;
  /**
   * Si el id está en el catálogo vigente, el id de la mejor variante de su
   * grupo (puede ser él mismo); si no, null.
   */
  readonly currentBest: (id: string) => string | null;
  /** Mejor variante del canal que casa por nombre (≥ 92), o null. */
  readonly matchByName: (name: string) => string | null;
  /** Favoritos que faltan: id → desde cuándo (epoch ms). Se actualiza aquí. */
  readonly missingSince: Map<string, number>;
  readonly now: number;
  readonly graceMs?: number;
}

export interface RelinkResult {
  readonly favorites: Item[];
  readonly history: Item[];
  readonly changed: boolean;
  /** Ids cambiados (viejo → nuevo) y quitados, para el registro. */
  readonly relinked: number;
  readonly removed: number;
}

type Verdict =
  | { readonly kind: 'keep' }
  | { readonly kind: 'move'; readonly id: string }
  | {
      readonly kind: 'missing';
    };

function verdictFor(item: Item, options: RelinkOptions): Verdict {
  if (!options.isIptvId(item.id)) return { kind: 'keep' };
  const best = options.currentBest(item.id);
  if (best) return best === item.id ? { kind: 'keep' } : { kind: 'move', id: best };
  const name = (item.alias || item.title || '').trim();
  const matched = name ? options.matchByName(name) : null;
  if (matched) return matched === item.id ? { kind: 'keep' } : { kind: 'move', id: matched };
  return { kind: 'missing' };
}

function relinkList(
  list: readonly Item[],
  options: RelinkOptions,
  favorites: boolean,
): { items: Item[]; relinked: number; removed: number } {
  const grace = options.graceMs ?? IPTV_SEARCH.relinkGraceMs;
  const out: Item[] = [];
  let relinked = 0;
  let removed = 0;
  const verdicts = list.map((item) => verdictFor(item, options));
  /* Ids que se quedan tal cual: un id movido que ya estaba no se repite. */
  const kept = new Set(
    list.filter((_item, index) => verdicts[index]?.kind === 'keep').map((item) => item.id),
  );
  const placed = new Set<string>();
  for (const [index, item] of list.entries()) {
    const verdict = verdicts[index] as Verdict;
    if (verdict.kind === 'keep') {
      if (favorites) options.missingSince.delete(item.id);
      if (placed.has(item.id)) continue;
      placed.add(item.id);
      out.push(item);
      continue;
    }
    if (verdict.kind === 'move') {
      if (favorites) options.missingSince.delete(item.id);
      relinked += 1;
      if (kept.has(verdict.id) || placed.has(verdict.id)) {
        removed += 1;
        continue;
      }
      placed.add(verdict.id);
      out.push({ ...item, id: verdict.id });
      continue;
    }
    if (!favorites) {
      removed += 1;
      continue;
    }
    const since = options.missingSince.get(item.id);
    if (since === undefined) {
      options.missingSince.set(item.id, options.now);
      placed.add(item.id);
      out.push(item);
      continue;
    }
    if (options.now - since >= grace) {
      options.missingSince.delete(item.id);
      removed += 1;
      continue;
    }
    placed.add(item.id);
    out.push(item);
  }
  return { items: out, relinked, removed };
}

/** Re-empareja favoritos y recientes (§14.6). No toca nada que no sea un id IPTV. */
export function relinkLibrary(
  library: { readonly favorites: readonly Item[]; readonly history: readonly Item[] },
  options: RelinkOptions,
): RelinkResult {
  const favorites = relinkList(library.favorites, options, true);
  const history = relinkList(library.history, options, false);
  const same = (a: readonly Item[], b: readonly Item[]): boolean =>
    a.length === b.length && a.every((item, index) => item === b[index]);
  return {
    favorites: favorites.items,
    history: history.items,
    changed: !same(favorites.items, library.favorites) || !same(history.items, library.history),
    relinked: favorites.relinked + history.relinked,
    removed: favorites.removed + history.removed,
  };
}
