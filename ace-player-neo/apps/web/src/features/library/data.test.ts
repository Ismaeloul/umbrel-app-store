import type { LibraryView } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFetch } from '../../api/client.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { createQueryClient, routeKey } from '../../api/query.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import {
  defaultFavoriteTitle,
  pendingStore,
  removeWithUndo,
  renameChannel,
  resetPending,
  saveFavorite,
} from './data.ts';
import { UNDO_MS } from './model.ts';
import { makeLibrary } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  resetPending();
  resetToasts();
  resetMode();
});

function clientWith(library: LibraryView) {
  const client = createQueryClient();
  client.setQueryData(routeKey('libraryGet'), library);
  return client;
}

describe('borrar con deshacer (regla 31)', () => {
  it('la fila se quita al momento y el borrado real va a los 6 s', async () => {
    vi.useFakeTimers();
    const library = makeLibrary();
    const target = library.history[0]!;
    const after = { ...library, history: [] };
    net = mockFetch({ 'POST /api/v1/library': after });
    const client = clientWith(library);
    removeWithUndo({ client, kind: 'delete', collection: 'history', item: target });
    expect(pendingStore.get().has(`history:${target.id}`)).toBe(true);
    expect(toastStore.get().at(-1)).toMatchObject({
      text: '«Canal de prueba» eliminado',
      tone: 'warn',
    });
    expect(toastStore.get().at(-1)?.action?.label).toBe('Deshacer');
    await vi.advanceTimersByTimeAsync(UNDO_MS - 100);
    expect(net.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(net.calls[0]?.body).toEqual({ action: 'delete', collection: 'history', id: target.id });
    expect(pendingStore.get().size).toBe(0);
    expect(client.getQueryData<LibraryView>(routeKey('libraryGet'))?.history).toEqual([]);
  });

  it('«Deshacer» cancela el borrado: no se llama al servidor', async () => {
    vi.useFakeTimers();
    const library = makeLibrary();
    net = mockFetch({});
    const client = clientWith(library);
    removeWithUndo({
      client,
      kind: 'unfavorite',
      collection: 'favorites',
      item: library.favorites[0]!,
    });
    expect(toastStore.get().at(-1)?.text).toBe('«DAZN 1» quitado de favoritos');
    toastStore.get().at(-1)?.action?.onAction();
    expect(pendingStore.get().size).toBe(0);
    await vi.advanceTimersByTimeAsync(UNDO_MS + 500);
    expect(net.calls).toHaveLength(0);
  });

  it('si el servidor falla, la fila vuelve y se avisa', async () => {
    vi.useFakeTimers();
    const library = makeLibrary();
    net = mockFetch({
      'POST /api/v1/library': () =>
        json({ error: { code: 'internal_error', message: 'Algo falló.', requestId: 'r' } }, 500),
    });
    const client = clientWith(library);
    removeWithUndo({
      client,
      kind: 'delete',
      collection: 'web',
      item: library.web[0]!,
      sourceId: 'principal',
    });
    await vi.advanceTimersByTimeAsync(UNDO_MS + 10);
    expect(net.calls[0]?.body).toMatchObject({ collection: 'web', sourceId: 'principal' });
    expect(pendingStore.get().size).toBe(0);
    expect(toastStore.get().at(-1)?.text).toBe('No se pudo eliminar el canal');
  });

  it('al cerrar la página, lo pendiente se manda ya y con keepalive', async () => {
    const library = makeLibrary();
    const seen: Array<RequestInit | undefined> = [];
    setFetch(async (_input, init) => {
      seen.push(init);
      return json(library);
    });
    try {
      const client = clientWith(library);
      removeWithUndo({ client, kind: 'delete', collection: 'history', item: library.history[0]! });
      window.dispatchEvent(new Event('pagehide'));
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]?.keepalive).toBe(true);
      await vi.waitFor(() => expect(pendingStore.get().size).toBe(0));
    } finally {
      setFetch(null);
    }
  });
});

describe('renombrar y favoritos', () => {
  it('renombra al momento y lo deshace si falla', async () => {
    const library = makeLibrary();
    net = mockFetch({
      'POST /api/v1/library': () =>
        json({ error: { code: 'bad_title', message: 'Título no válido.', requestId: 'r' } }, 400),
    });
    const client = clientWith(library);
    const fav = library.favorites[0]!;
    const promise = renameChannel(client, 'favorites', fav, '  Nuevo   nombre ');
    expect(client.getQueryData<LibraryView>(routeKey('libraryGet'))?.favorites[0]?.title).toBe(
      'Nuevo nombre',
    );
    await expect(promise).resolves.toBe(false);
    expect(net.calls[0]?.body).toEqual({
      action: 'rename',
      collection: 'favorites',
      id: fav.id,
      title: 'Nuevo nombre',
    });
    expect(client.getQueryData<LibraryView>(routeKey('libraryGet'))?.favorites[0]?.title).toBe(
      'DAZN 1',
    );
    expect(toastStore.get().at(-1)?.text).toBe('No se pudo renombrar el canal');
  });

  it('un nombre vacío se ignora (sin llamada)', async () => {
    net = mockFetch({});
    const library = makeLibrary();
    await expect(
      renameChannel(clientWith(library), 'history', library.history[0]!, '   '),
    ).resolves.toBe(false);
    expect(net.calls).toHaveLength(0);
  });

  it('guardar favorito sin nombre usa «Canal {6 del hash}» y marca fromWebSync', async () => {
    const library = makeLibrary();
    const web = library.web[1]!;
    net = mockFetch({ 'POST /api/v1/library': library });
    const ok = await saveFavorite(clientWith(library), { id: web.id, title: ' ', ih: false });
    expect(ok).toBe(true);
    expect(net.calls[0]?.body).toEqual({
      action: 'favorite-upsert',
      item: {
        id: web.id,
        title: defaultFavoriteTitle(web.id),
        category: 'Guardado',
        fromWebSync: true,
        ih: false,
      },
    });
    expect(toastStore.get().at(-1)?.text).toBe(
      `«Canal ${web.id.slice(0, 6)}» guardado en favoritos`,
    );
  });
});
