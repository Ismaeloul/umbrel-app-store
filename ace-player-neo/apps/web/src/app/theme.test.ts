import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryStorage } from '../lib/storage.ts';
import {
  applyTheme,
  resolveScheme,
  setTheme,
  setTransparency,
  themeStore,
  THEME_COLOR,
} from './theme.ts';

beforeEach(() => {
  resetMemoryStorage();
  document.head.innerHTML =
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content=""><meta name="theme-color" media="(prefers-color-scheme: dark)" content="">';
});
afterEach(() => {
  themeStore.set({ theme: 'sistema', transparency: 'normal' });
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.scheme;
  delete root.dataset.transparency;
});

const metas = () =>
  [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

describe('tema', () => {
  it('por defecto sigue al sistema (sin data-theme, con el esquema resuelto)', () => {
    applyTheme({ theme: 'sistema', transparency: 'normal' });
    const root = document.documentElement;
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.scheme).toBe('light');
    expect(metas()).toEqual([THEME_COLOR.light, THEME_COLOR.dark]);
  });

  it('fijarlo en Ajustes lo guarda y lo aplica (también a la barra del sistema)', () => {
    setTheme('oscuro');
    expect(localStorage.getItem('aceneo-tema')).toBe('oscuro');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.scheme).toBe('dark');
    expect(metas()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
  });

  it('«Reducir transparencia» propio', () => {
    setTransparency('reducida');
    expect(document.documentElement.dataset.transparency).toBe('reduced');
    expect(localStorage.getItem('aceneo-transparencia')).toBe('reducida');
    setTransparency('normal');
    expect(document.documentElement.dataset.transparency).toBeUndefined();
  });

  it('resolveScheme', () => {
    expect(resolveScheme('sistema', true)).toBe('dark');
    expect(resolveScheme('sistema', false)).toBe('light');
    expect(resolveScheme('claro', true)).toBe('light');
  });
});
