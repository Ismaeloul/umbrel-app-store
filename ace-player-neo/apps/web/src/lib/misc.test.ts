import { describe, expect, it, vi } from 'vitest';
import { cx } from './cx.ts';
import { hasFlag, isSystemPageEnabled } from './flags.ts';
import { installViewportWatcher, keyboardInset } from './viewport.ts';
import { writeItem } from './storage.ts';

describe('cx', () => {
  it('junta clases sin las vacías', () => {
    const primary = true;
    const ghost = false;
    expect(cx('btn', ghost && 'x', null, undefined, 0, primary && 'btn--primary')).toBe(
      'btn btn--primary',
    );
  });
});

describe('flags', () => {
  it('por la URL o guardado en el navegador', () => {
    expect(hasFlag('sistema', '?vista=sistema')).toBe(false);
    expect(hasFlag('sistema', '?vista=sistema&flag=sistema')).toBe(true);
    writeItem('aceneo-flags', 'otro, sistema');
    expect(hasFlag('sistema', '')).toBe(true);
  });

  it('la página de sistema siempre en desarrollo (los tests corren en modo desarrollo)', () => {
    expect(isSystemPageEnabled('')).toBe(true);
  });
});

describe('teclado que no tapa campos (installViewportWatcher)', () => {
  it('publica en --kb lo que tapa el teclado y lleva a la vista el campo que queda debajo', async () => {
    vi.useFakeTimers();
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    const fakeWindow = {
      innerHeight: 844,
      visualViewport: viewport,
      document,
    } as unknown as Window;
    const stop = installViewportWatcher(fakeWindow);
    try {
      const field = document.createElement('input');
      document.body.appendChild(field);
      field.getBoundingClientRect = () => ({ top: 700, bottom: 740 }) as DOMRect;
      const scroll = vi.fn();
      field.scrollIntoView = scroll;
      // Sube el teclado (iOS no encoge la página): la zona visible baja a 500 px.
      viewport.height = 500;
      viewport.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(20);
      expect(document.documentElement.style.getPropertyValue('--kb')).toBe('344px');
      field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(320);
      expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
      field.remove();
    } finally {
      stop();
      vi.useRealTimers();
    }
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('');
  });
});

describe('keyboardInset', () => {
  it('mide lo que tapa el teclado y descarta la barra del navegador', () => {
    const base = { innerHeight: 844 } as Pick<Window, 'innerHeight' | 'visualViewport'>;
    expect(keyboardInset({ ...base, visualViewport: null })).toBe(0);
    expect(
      keyboardInset({ ...base, visualViewport: { height: 500, offsetTop: 0 } as VisualViewport }),
    ).toBe(344);
    expect(
      keyboardInset({ ...base, visualViewport: { height: 800, offsetTop: 0 } as VisualViewport }),
    ).toBe(0);
  });
});
