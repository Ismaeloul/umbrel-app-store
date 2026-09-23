import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerShortcut } from '../../app/shortcuts.ts';
import { ShortcutHelp } from '../../app/ShortcutHelp.tsx';
import { MOUSE_GESTURES, TOUCH_GESTURES } from './gestures.ts';
import HelpPanel from './panel.tsx';

const offs: Array<() => void> = [];
const realMatchMedia = window.matchMedia;

function pointer(fine: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: fine && query.includes('pointer: fine'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
  window.matchMedia = realMatchMedia;
});

function register() {
  offs.push(
    registerShortcut({
      id: 'app.ayuda',
      keys: ['?'],
      label: 'Enseña esta ayuda',
      group: 'General',
      handler: () => {},
    }),
    registerShortcut({
      id: 'reproductor.pausa',
      keys: [' ', 'k'],
      display: ['Espacio', 'K'],
      label: 'Pausa y reanuda',
      group: 'Reproductor',
      handler: () => {},
    }),
  );
}

describe('panel de ayuda', () => {
  it('teclado: todo el registro central, agrupado, y se actualiza al registrar otro', () => {
    register();
    render(<HelpPanel />);
    const keyboard = screen.getByRole('region', { name: 'Teclado' });
    expect(within(keyboard).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(within(keyboard).getByText('Enseña esta ayuda')).toBeInTheDocument();
    expect(within(keyboard).getByText('Espacio')).toBeInTheDocument();
    expect(within(keyboard).getByText('Pausa y reanuda')).toBeInTheDocument();
    act(() => {
      offs.push(
        registerShortcut({
          id: 'agenda.hoy',
          keys: ['h'],
          label: 'Vuelve a hoy',
          group: 'Agenda',
          handler: () => {},
        }),
      );
    });
    expect(within(keyboard).getByText('Vuelve a hoy')).toBeInTheDocument();
    expect(
      within(keyboard).getByText(
        'Los atajos no funcionan mientras escribes en un campo (salvo Esc).',
      ),
    ).toBeInTheDocument();
  });

  it('gestos y ratón: los que existen, con qué hacen', () => {
    render(<HelpPanel />);
    const touch = screen.getByRole('region', { name: 'Gestos' });
    expect(within(touch).getAllByRole('term')).toHaveLength(TOUCH_GESTURES.length);
    expect(within(touch).getByText('Agenda: cambia de día')).toBeInTheDocument();
    expect(within(touch).getByText('Mini-reproductor: lo abre en grande')).toBeInTheDocument();
    const mouse = screen.getByRole('region', { name: 'Ratón' });
    expect(within(mouse).getAllByRole('term')).toHaveLength(MOUSE_GESTURES.length);
    expect(within(mouse).getByText('Doble clic en el vídeo')).toBeInTheDocument();
  });

  it('con el dedo, gestos primero; con ratón, teclado primero', () => {
    pointer(false);
    const { unmount } = render(<HelpPanel />);
    const order = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(order()).toEqual(['Gestos', 'Teclado', 'Ratón']);
    unmount();
    pointer(true);
    render(<HelpPanel />);
    expect(order()).toEqual(['Teclado', 'Ratón', 'Gestos']);
  });

  it('la hoja del armazón («?») carga este panel', async () => {
    register();
    render(<ShortcutHelp open onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Atajos de teclado' });
    // Mientras llega el trozo sale la lista de siempre; después, el panel con los gestos.
    expect(within(dialog).getByText('Enseña esta ayuda')).toBeInTheDocument();
    expect(await within(dialog).findByRole('region', { name: 'Gestos' })).toBeInTheDocument();
    expect(within(dialog).getByText('Enseña esta ayuda')).toBeInTheDocument();
  });
});
