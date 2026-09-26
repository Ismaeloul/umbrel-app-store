/* Datos de la biblioteca y sus cambios (inventario-front §13.4-§13.5).

   - Los datos vienen de GET /api/v1/library (TanStack Query). El SSE
     (`state.changed` → library) invalida la consulta cuando otro dispositivo
     cambia algo, así que no hay sondeo.
   - Cada cambio se ve al momento (optimista) y, si el servidor falla, se
     deshace con su aviso, como la 0.6.59.
   - Borrar y quitar un favorito van con DESHACER durante 6 s y el borrado real
     después (regla 31). La 0.6.59 quitaba el favorito de la estrella al
     instante y sin vuelta atrás (§29.25): aquí los dos caminos se comportan
     igual. Las bajas pendientes viven fuera de React (sobreviven a cambiar de
     vista) y, si se cierra la página antes de tiempo, se mandan con
     `keepalive` para no perder lo que el usuario ya decidió. */

import type { Item, LibraryCollection, LibraryView } from '@ace/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api, describeFailure, routeKey } from '../../api/index.ts';
import { notify, toast } from '../../notices/index.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { rowKey, UNDO_MS } from './model.ts';

export type RemovalKind = 'delete' | 'unfavorite';

interface PendingRemoval {
  key: string;
  kind: RemovalKind;
  collection: LibraryCollection;
  item: Item;
  sourceId?: string;
  client: QueryClient;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Filas que se han quitado y esperan los 6 s del deshacer. */
export const pendingStore = createStore<ReadonlyMap<string, PendingRemoval>>(new Map());

export function usePendingKeys(): ReadonlyMap<string, unknown> {
  return useStore(pendingStore);
}

function dropPending(key: string): PendingRemoval | null {
  const entry = pendingStore.get().get(key) ?? null;
  if (!entry) return null;
  if (entry.timer) clearTimeout(entry.timer);
  pendingStore.set((map) => {
    const next = new Map(map);
    next.delete(key);
    return next;
  });
  return entry;
}

export function setLibraryData(client: QueryClient, view: LibraryView): void {
  client.setQueryData(routeKey('libraryGet'), view);
  // La vista de directorios comparte canales y listas: se mantiene al día sin pedirla.
  client.setQueryData(routeKey('directoriesGet'), {
    web: view.web,
    webSyncedAt: view.webSyncedAt,
    webSources: view.webSources,
    activeWebSourceId: view.activeWebSourceId,
  });
}

function libraryData(client: QueryClient): LibraryView | undefined {
  return client.getQueryData<LibraryView>(routeKey('libraryGet'));
}

async function commit(key: string, keepalive = false): Promise<void> {
  const entry = pendingStore.get().get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  try {
    const view = await api('libraryMutate', {
      body: {
        action: 'delete',
        collection: entry.collection,
        id: entry.item.id,
        ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
      },
      keepalive,
    });
    setLibraryData(entry.client, view);
    dropPending(key);
  } catch {
    // Sin cambios en los datos: al soltar la baja, la fila vuelve a su sitio.
    dropPending(key);
    notify(
      entry.kind === 'unfavorite'
        ? 'No se pudo quitar el favorito'
        : 'No se pudo eliminar el canal',
      { tone: 'err' },
    );
  }
}

let pagehideInstalled = false;
function installPagehideFlush(): void {
  if (pagehideInstalled || typeof window === 'undefined') return;
  pagehideInstalled = true;
  window.addEventListener('pagehide', () => {
    for (const key of [...pendingStore.get().keys()]) void commit(key, true);
  });
}

export interface RemoveOptions {
  client: QueryClient;
  kind: RemovalKind;
  collection: LibraryCollection;
  item: Item;
  /** Solo con `web`: la lista de la que se quita (por defecto, la activa). */
  sourceId?: string;
}

/** Quita una fila con «Deshacer» durante 6 s; después la borra en el servidor. */
export function removeWithUndo({ client, kind, collection, item, sourceId }: RemoveOptions): void {
  const key = rowKey(collection, item.id);
  if (pendingStore.get().has(key)) return;
  installPagehideFlush();
  const entry: PendingRemoval = {
    key,
    kind,
    collection,
    item,
    ...(sourceId ? { sourceId } : {}),
    client,
    timer: null,
  };
  entry.timer = setTimeout(() => void commit(key), UNDO_MS);
  pendingStore.set((map) => new Map(map).set(key, entry));
  const title = item.title || 'Canal';
  toast(kind === 'unfavorite' ? `«${title}» quitado de favoritos` : `«${title}» eliminado`, {
    tone: 'warn',
    icon: kind === 'unfavorite' ? 'star' : 'trash',
    ms: UNDO_MS,
    action: { label: 'Deshacer', onAction: () => void dropPending(key) },
  });
}

/** Solo para los tests: manda ya las bajas pendientes. */
export function commitPendingNow(): Promise<void[]> {
  return Promise.all([...pendingStore.get().keys()].map((key) => commit(key)));
}

/** Solo para los tests. */
export function resetPending(): void {
  for (const entry of pendingStore.get().values()) if (entry.timer) clearTimeout(entry.timer);
  pendingStore.set(new Map());
}

/* ---- Renombrar ----------------------------------------------------------- */

export async function renameChannel(
  client: QueryClient,
  collection: LibraryCollection,
  item: Item,
  rawTitle: string,
  sourceId?: string,
): Promise<boolean> {
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  // Un nombre vacío se ignora (index.html:5395).
  if (!title || title === item.title) return false;
  const previous = libraryData(client);
  if (previous) {
    const apply = (list: Item[]) => list.map((i) => (i.id === item.id ? { ...i, title } : i));
    const key =
      collection === 'favorites' ? 'favorites' : collection === 'history' ? 'history' : 'web';
    client.setQueryData(routeKey('libraryGet'), { ...previous, [key]: apply(previous[key]) });
  }
  try {
    const view = await api('libraryMutate', {
      body: {
        action: 'rename',
        collection,
        id: item.id,
        title,
        ...(collection === 'web' && sourceId ? { sourceId } : {}),
      },
    });
    setLibraryData(client, view);
    notify('Canal renombrado', { tone: 'ok' });
    return true;
  } catch {
    if (previous) client.setQueryData(routeKey('libraryGet'), previous);
    notify('No se pudo renombrar el canal', { tone: 'err' });
    return false;
  }
}

/* ---- Favoritos ----------------------------------------------------------- */

export interface FavoriteInput {
  id: string;
  title: string;
  category?: string;
  ih?: boolean;
  /** El nombre del canal en tu IPTV (§14.6): el re-emparejado lo usa aunque lo renombres. */
  alias?: string;
}

/** Nombre por defecto sin escribir nada: `Canal {6 del hash}` (index.html:5364). */
export function defaultFavoriteTitle(hash: string): string {
  return `Canal ${hash.slice(0, 6)}`;
}

export async function saveFavorite(client: QueryClient, input: FavoriteInput): Promise<boolean> {
  const title = input.title.replace(/\s+/g, ' ').trim() || defaultFavoriteTitle(input.id);
  const previous = libraryData(client);
  const fromWebSync = previous?.web.some((w) => w.id === input.id) ?? false;
  const alias = input.alias?.replace(/\s+/g, ' ').trim();
  const item: Item = {
    id: input.id,
    title,
    type: 'fav',
    category: input.category || 'Guardado',
    date: new Date().toISOString(),
    fromWebSync,
    ih: input.ih === true,
    ...(alias && alias !== title ? { alias } : {}),
  };
  if (previous) {
    client.setQueryData(routeKey('libraryGet'), {
      ...previous,
      favorites: [item, ...previous.favorites.filter((f) => f.id !== item.id)],
    });
  }
  try {
    const view = await api('libraryMutate', {
      body: {
        action: 'favorite-upsert',
        item: {
          id: item.id,
          title,
          category: item.category,
          fromWebSync,
          ih: item.ih,
          ...(alias ? { alias } : {}),
        },
      },
    });
    setLibraryData(client, view);
    notify(`«${title}» guardado en favoritos`, { tone: 'ok', icon: 'star' });
    return true;
  } catch (error) {
    if (previous) client.setQueryData(routeKey('libraryGet'), previous);
    notify(`No se pudo guardar el favorito. ${describeFailure(error)}`, { tone: 'err' });
    return false;
  }
}
