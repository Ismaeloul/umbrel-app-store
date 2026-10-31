import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { mockFetch } from '../../test/fetch.ts';
import { ChannelRow } from './ChannelRow.tsx';
import { channelMenuItems } from './actions.ts';
import { EMPTY_ON_AIR } from './on-air.ts';
import { renderWithApp, resetPlayback } from './test-utils.tsx';

/* El menú de cada canal («Abrir en…», copias, renombrar y eliminar): el mismo
   en la tarjeta del móvil, en la fila de la tabla de escritorio y en el clic
   derecho. Venía de ChannelDetail.test.tsx, la ficha lateral que el
   rediseño de escritorio quitó. */

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetToasts();
  resetMode();
  resetPlayback();
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
