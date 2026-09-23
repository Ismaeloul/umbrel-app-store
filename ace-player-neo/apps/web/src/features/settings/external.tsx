/* Secciones de Ajustes que construyen OTRAS vistas: Salud y Dispositivos
   (agente de salud y emparejamiento). Ajustes no las importa a mano: las
   busca con import.meta.glob, como el armazón busca las vistas, y cada una va
   en su propio trozo de JS (React.lazy) con su ErrorBoundary. («Tu fútbol»
   abre la hoja de preferencias, que sí tiene un sitio fijo.)

   Contrato: `src/features/<carpeta>/ajustes.tsx` con `export default` de un
   componente que recibe ViewProps y NO pinta cabecera propia (el título de la
   sección lo pone Ajustes). Carpetas que se miran, por sección:
   - salud:        health, salud
   - dispositivos: pairing, devices, dispositivos
   Se aceptan también `seccion.tsx` y `section.tsx` en esas carpetas. Si no
   hay ninguna, Ajustes se apaña sin ella (ver SettingsView). */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewProps } from '../../app/contracts.ts';

type SectionModule = { default?: ComponentType<ViewProps> };

const MODULES = import.meta.glob<SectionModule>(
  '../{health,salud,pairing,devices,dispositivos}/{ajustes,seccion,section}.tsx',
);

export type ExternalSection = 'salud' | 'dispositivos';

const FOLDERS: Record<ExternalSection, readonly string[]> = {
  salud: ['health', 'salud'],
  dispositivos: ['pairing', 'devices', 'dispositivos'],
};
const FILES = ['ajustes', 'seccion', 'section'] as const;

function Missing() {
  return null;
}

const cache = new Map<ExternalSection, LazyExoticComponent<ComponentType<ViewProps>> | null>();

/** Componente de la sección si alguna vista lo aporta; si no, null. */
export function externalSection(
  section: ExternalSection,
): LazyExoticComponent<ComponentType<ViewProps>> | null {
  if (cache.has(section)) return cache.get(section) ?? null;
  let loader: (() => Promise<SectionModule>) | null = null;
  for (const folder of FOLDERS[section]) {
    for (const file of FILES) {
      const found = MODULES[`../${folder}/${file}.tsx`];
      if (found && !loader) loader = found;
    }
  }
  const component = loader
    ? lazy(async () => {
        const mod = await loader();
        return { default: mod.default ?? Missing };
      })
    : null;
  cache.set(section, component);
  return component;
}
