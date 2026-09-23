/* Tema (sistema / claro / oscuro) y «Reducir transparencia», guardados en
   localStorage con try/catch (lib/storage.ts).

   Lo aplica a <html>:
   - data-theme="light|dark" solo si Ajustes lo fija (si no, manda el sistema);
   - data-scheme con el tema RESUELTO siempre (respaldo en hex de tokens.css);
   - data-transparency="reduced" con el interruptor propio (Safari y Firefox
     no tienen prefers-reduced-transparency);
   - <meta name="theme-color">, para que la barra del sistema combine.

   El script en línea de index.html hace lo mismo ANTES de pintar, para que no
   haya un fogonazo del tema equivocado; esto lo mantiene al día después. */

import { createStore, useStore } from '../lib/store.ts';
import { MEDIA, matches, subscribeMedia } from '../lib/media.ts';
import { readItem, STORAGE_KEYS, writeItem } from '../lib/storage.ts';

export type ThemePreference = 'sistema' | 'claro' | 'oscuro';
export type Transparency = 'normal' | 'reducida';

export interface ThemeState {
  theme: ThemePreference;
  transparency: Transparency;
}

/** Color de la barra del sistema (el fondo de cada tema). */
export const THEME_COLOR = { light: '#e5eef4', dark: '#081829' } as const;

function readTheme(): ThemePreference {
  const value = readItem(STORAGE_KEYS.theme);
  return value === 'claro' || value === 'oscuro' ? value : 'sistema';
}

function readTransparency(): Transparency {
  return readItem(STORAGE_KEYS.transparency) === 'reducida' ? 'reducida' : 'normal';
}

export const themeStore = createStore<ThemeState>({
  theme: readTheme(),
  transparency: readTransparency(),
});

export function resolveScheme(
  theme: ThemePreference,
  systemDark = matches(MEDIA.dark),
): 'light' | 'dark' {
  if (theme === 'claro') return 'light';
  if (theme === 'oscuro') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function applyTheme(state: ThemeState = themeStore.get(), doc: Document = document): void {
  const root = doc.documentElement;
  const scheme = resolveScheme(state.theme);
  if (state.theme === 'sistema') delete root.dataset.theme;
  else root.dataset.theme = scheme;
  root.dataset.scheme = scheme;
  if (state.transparency === 'reducida') root.dataset.transparency = 'reduced';
  else delete root.dataset.transparency;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Con el tema fijado, las dos etiquetas (claro y oscuro) llevan el mismo color.
    const media = meta.getAttribute('media') ?? '';
    const forScheme =
      state.theme === 'sistema' ? (media.includes('dark') ? 'dark' : 'light') : scheme;
    meta.content = THEME_COLOR[forScheme];
  }
}

export function setTheme(theme: ThemePreference): void {
  writeItem(STORAGE_KEYS.theme, theme);
  themeStore.set((s) => ({ ...s, theme }));
  applyTheme();
}

export function setTransparency(transparency: Transparency): void {
  writeItem(STORAGE_KEYS.transparency, transparency);
  themeStore.set((s) => ({ ...s, transparency }));
  applyTheme();
}

/** Sigue los cambios del tema del sistema (si Ajustes no lo fija). */
export function installThemeWatcher(): () => void {
  applyTheme();
  return subscribeMedia(MEDIA.dark, () => applyTheme());
}

export function useTheme(): ThemeState {
  return useStore(themeStore);
}
