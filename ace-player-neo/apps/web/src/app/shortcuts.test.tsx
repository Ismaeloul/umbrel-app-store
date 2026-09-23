import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { popOverlay, pushOverlay } from '../ui/overlay.ts';
import {
  groupShortcuts,
  installShortcutListener,
  matchShortcut,
  prettyKey,
  registerShortcut,
  shortcutStore,
  useShortcut,
  type ShortcutDef,
} from './shortcuts.ts';

afterEach(() => shortcutStore.set([]));

const key = (k: string, init: KeyboardEventInit = {}, target?: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
};

const def = (overrides: Partial<ShortcutDef> = {}): ShortcutDef => ({
  id: 'x',
  keys: ['k'],
  label: 'Pausa',
  group: 'Reproductor',
  handler: vi.fn(),
  ...overrides,
});

describe('atajos', () => {
  it('las letras no distinguen mayúsculas; Ctrl/Cmd/Alt se dejan al navegador', () => {
    registerShortcut(def({ keys: ['m'] }));
    expect(matchShortcut(key('M'))).not.toBeNull();
    expect(matchShortcut(key('m', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key('m', { metaKey: true }))).toBeNull();
  });

  it('mientras se escribe no salta nada salvo Escape o lo permitido', () => {
    const input = document.createElement('input');
    registerShortcut(def({ id: 'a', keys: ['/'] }));
    registerShortcut(def({ id: 'esc', keys: ['Escape'] }));
    registerShortcut(def({ id: 'libre', keys: ['Enter'], allowInInput: true }));
    expect(matchShortcut(key('/', {}, input))).toBeNull();
    expect(matchShortcut(key('Escape', {}, input))?.id).toBe('esc');
    expect(matchShortcut(key('Enter', {}, input))?.id).toBe('libre');
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    expect(matchShortcut(key('/', {}, checkbox))?.id).toBe('a');
  });

  it('respeta `when` y gana el último registrado', () => {
    registerShortcut(def({ id: 'general', keys: ['ArrowRight'] }));
    let viendo = false;
    registerShortcut(def({ id: 'zapear', keys: ['ArrowRight'], when: () => viendo }));
    expect(matchShortcut(key('ArrowRight'))?.id).toBe('general');
    viendo = true;
    expect(matchShortcut(key('ArrowRight'))?.id).toBe('zapear');
  });

  it('si alguien ya atendió la tecla (unas pestañas), no salta (regla 9)', () => {
    registerShortcut(def({ keys: ['ArrowLeft'] }));
    const event = key('ArrowLeft');
    event.preventDefault();
    expect(matchShortcut(event)).toBeNull();
  });

  it('el oyente global llama al atajo, salvo con una hoja abierta', () => {
    const handler = vi.fn();
    registerShortcut(def({ keys: ['?'], handler }));
    const uninstall = installShortcutListener(window);
    window.dispatchEvent(key('?', { shiftKey: true }));
    expect(handler).toHaveBeenCalledOnce();
    const id = pushOverlay(false);
    window.dispatchEvent(key('?'));
    expect(handler).toHaveBeenCalledOnce();
    popOverlay(id);
    uninstall();
  });

  it('agrupa para el panel de ayuda y pinta las teclas', () => {
    const groups = groupShortcuts([
      def({ id: 'p', keys: [' ', 'k'], label: 'Pausa y reanuda' }),
      def({ id: 'p', keys: [' '], label: 'Repetido' }),
      def({ id: 'ayuda', keys: ['?'], label: 'Ayuda', group: 'General' }),
    ]);
    expect(groups).toEqual([
      {
        group: 'Reproductor',
        items: [{ id: 'p', label: 'Pausa y reanuda', display: ['Espacio', 'K'] }],
      },
      { group: 'General', items: [{ id: 'ayuda', label: 'Ayuda', display: ['?'] }] },
    ]);
    expect(prettyKey('ArrowLeft')).toBe('←');
    expect(prettyKey('Escape')).toBe('Esc');
  });

  it('useShortcut registra mientras está montado', () => {
    function Vista() {
      useShortcut({
        id: 'vista.g',
        keys: ['g'],
        label: 'Favorito',
        group: 'Reproductor',
        handler: () => {},
      });
      return null;
    }
    const { unmount } = render(<Vista />);
    expect(shortcutStore.get().map((s) => s.id)).toContain('vista.g');
    unmount();
    expect(shortcutStore.get().map((s) => s.id)).not.toContain('vista.g');
  });
});
