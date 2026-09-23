import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { mockFetch } from '../../test/fetch.ts';
import { ChannelDetail } from './ChannelDetail.tsx';
import { ChannelRow } from './ChannelRow.tsx';
import { channelMenuItems } from './actions.ts';
import { EMPTY_ON_AIR } from './on-air.ts';
import { selectionStore } from './selection.ts';
import { getPlayer } from '../../player/api.ts';
import { makeLibrary, renderWithApp, resetPlayback } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  resetToasts();
  resetMode();
  resetPlayback();
  selectionStore.set(null);
});

describe('ficha del canal (panel lateral)', () => {
  it('sin elegir nada, una pista', async () => {
    net = mockFetch({ 'GET /api/v1/library': makeLibrary() });
    renderWithApp(<ChannelDetail />);
    expect(await screen.findByText(/Elige un canal de la lista/)).toBeInTheDocument();
  });

  it('enseña el canal elegido y «Ver canal» lo reproduce', async () => {
    const library = makeLibrary();
    net = mockFetch({ 'GET /api/v1/library': library });
    selectionStore.set({ collection: 'favorites', id: library.favorites[0]!.id });
    renderWithApp(<ChannelDetail />);
    expect(await screen.findByRole('heading', { name: 'DAZN 1' })).toBeInTheDocument();
    expect(screen.getByText('En tus favoritos · Deportes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/Sin partido anunciado|Cargando la agenda/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver canal' }));
    await waitFor(() =>
      expect(screen.getByTestId('ruta')).toHaveTextContent(
        `partido/canal/${library.favorites[0]!.id}`,
      ),
    );
    // Se lo pide al reproductor con su título y el tipo que declara (ih: false → id, B-010).
    expect(getPlayer().channel).toMatchObject({
      hash: library.favorites[0]!.id,
      title: 'DAZN 1',
      kind: 'id',
    });
  });
});

describe('menú de la tarjeta («Abrir en…», D7)', () => {
  const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const base = { hash: HASH, title: 'DAZN 1', isFavorite: false, onToggleFavorite: () => {} };

  it('abrir en AceStream, URL del stream y las tres copias; sin renombrar ni borrar en el buscador', () => {
    const ids = channelMenuItems(base).map((item) => item.id);
    expect(ids).toEqual([
      'favorito',
      'abrir-acestream',
      'copiar-stream',
      'copiar-enlace',
      'copiar-hash',
      'copiar-nombre',
    ]);
    const items = channelMenuItems({ ...base, onRename: () => {}, onDelete: () => {} });
    expect(items.map((item) => item.id).slice(-2)).toEqual(['renombrar', 'eliminar']);
    expect(items.find((item) => item.id === 'eliminar')?.danger).toBe(true);
  });

  it('«Copiar URL del stream» copia la del proxy, con infohash si viene del buscador', async () => {
    // Por HTTP (sin portapapeles moderno) se copia con execCommand: se captura el texto.
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    const copied: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        copied.push(document.querySelector('textarea')?.value ?? '');
        return true;
      },
    });
    channelMenuItems(base)
      .find((item) => item.id === 'copiar-stream')
      ?.onSelect();
    channelMenuItems({ ...base, ih: true })
      .find((item) => item.id === 'copiar-stream')
      ?.onSelect();
    await waitFor(() => expect(copied).toHaveLength(2));
    expect(copied[0]).toBe(`${location.origin}/ace/getstream?id=${HASH}`);
    expect(copied[1]).toBe(`${location.origin}/ace/getstream?infohash=${HASH}`);
    expect(toastStore.get().at(-1)?.text).toBe('URL del stream copiada: pégala en VLC');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('el clic derecho abre el mismo menú y no reproduce', async () => {
    net = mockFetch({});
    let played = 0;
    renderWithApp(
      <ChannelRow
        item={{ id: HASH, title: 'DAZN 1', category: 'Deportes', ih: false }}
        kind="favorites"
        href={`?vista=partido/canal/${HASH}`}
        isFavorite
        onScreen
        onAir={EMPTY_ON_AIR}
        onPlay={() => {
          played += 1;
        }}
        onToggleFavorite={() => {}}
        menuItems={channelMenuItems(base)}
      />,
    );
    const link = screen.getByRole('link', { name: 'DAZN 1, en pantalla' });
    expect(screen.getByText('En pantalla')).toBeInTheDocument();
    fireEvent.contextMenu(link, { clientX: 10, clientY: 10 });
    expect(await screen.findByRole('menu', { name: 'Acciones de DAZN 1' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Abrir en la app de AceStream' }),
    ).toBeInTheDocument();
    fireEvent.click(link);
    expect(played).toBe(0);
  });
});
