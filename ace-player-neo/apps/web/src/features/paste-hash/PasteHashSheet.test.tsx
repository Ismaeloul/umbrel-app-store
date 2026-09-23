import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { mockFetch } from '../../test/fetch.ts';
import { getPlayer } from '../../player/api.ts';
import { makeLibrary, renderWithApp, resetPlayback } from '../library/test-utils.tsx';
import { INVALID_HASH_MESSAGE, PasteHashSheet, pastedTitle } from './index.ts';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
let net: ReturnType<typeof mockFetch>;

function Harness({ onSubmit }: { onSubmit?: (hash: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        abrir
      </button>
      <PasteHashSheet open={open} onClose={() => setOpen(false)} onSubmit={onSubmit} />
    </>
  );
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  resetToasts();
  resetMode();
  resetPlayback();
});

const input = () => screen.getByRole('textbox', { name: 'Content ID o enlace AceStream' });
const play = () => screen.getByRole('button', { name: 'Reproducir hash' });

describe('Pegar hash (§7.5)', () => {
  it('textos, validación a cada tecla y botón apagado hasta que vale', async () => {
    net = mockFetch({ 'GET /api/v1/library': makeLibrary() });
    renderWithApp(<Harness />);
    expect(await screen.findByRole('dialog', { name: 'Reproducir otro hash' })).toBeInTheDocument();
    expect(screen.getByText('Fuente externa')).toBeInTheDocument();
    expect(input()).toHaveAttribute('placeholder', 'acestream://…');
    expect(play()).toBeDisabled();
    fireEvent.change(input(), { target: { value: 'acestream://123' } });
    expect(screen.getByText(INVALID_HASH_MESSAGE)).toBeInTheDocument();
    expect(play()).toBeDisabled();
    // Formatos: acestream://, URL con ?id= o ?content_id=, o 40 hex sueltos.
    for (const value of [
      `acestream://${HASH}`,
      `https://ejemplo.com/ver?content_id=${HASH.toUpperCase()}`,
      `mira esto ${HASH} ya`,
    ]) {
      fireEvent.change(input(), { target: { value } });
      expect(play()).toBeEnabled();
      expect(screen.getByText(HASH)).toBeInTheDocument();
    }
  });

  it('Intro reproduce: va al canal con título «Stream …» y el servidor decide id o infohash', async () => {
    net = mockFetch({ 'GET /api/v1/library': makeLibrary() });
    renderWithApp(<Harness />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Content ID o enlace AceStream' }), {
      target: { value: `acestream://${HASH}` },
    });
    fireEvent.submit(input().closest('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent(`partido/canal/${HASH}`));
    expect(getPlayer().channel).toMatchObject({
      hash: HASH,
      title: `Stream ${HASH.slice(0, 8)}`,
      kind: 'auto',
    });
    expect(toastStore.get().at(-1)?.text).toBe('Hash externo añadido y reproduciendo');
  });

  it('si el hash ya está en tu biblioteca, usa su título', async () => {
    const library = makeLibrary();
    const known = library.favorites[1]!;
    net = mockFetch({ 'GET /api/v1/library': library });
    renderWithApp(<Harness />);
    await waitFor(() => expect(net.calls.length).toBeGreaterThan(0));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Content ID o enlace AceStream' }), {
      target: { value: known.id },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.click(play());
    await waitFor(() => expect(getPlayer().channel?.title).toBe('Eurosport 1'));
    expect(toastStore.get().at(-1)?.text).toBe('Reproduciendo el hash seleccionado');
  });

  it('con onSubmit (centro de partido) entrega el hash y no navega', async () => {
    net = mockFetch({});
    const got: string[] = [];
    renderWithApp(<Harness onSubmit={(hash) => got.push(hash)} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Content ID o enlace AceStream' }), {
      target: { value: HASH },
    });
    fireEvent.click(play());
    expect(got).toEqual([HASH]);
    expect(screen.getByTestId('ruta')).toHaveTextContent('biblioteca');
  });

  it('título por defecto', () => {
    expect(pastedTitle(HASH)).toBe('Stream a1b2c3d4');
    expect(pastedTitle(HASH, '  DAZN 1 ')).toBe('DAZN 1');
  });
});
