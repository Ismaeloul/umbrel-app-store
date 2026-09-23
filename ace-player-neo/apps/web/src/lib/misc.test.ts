import { describe, expect, it } from 'vitest';
import { cx } from './cx.ts';
import { hasFlag, isSystemPageEnabled } from './flags.ts';
import { keyboardInset } from './viewport.ts';
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
