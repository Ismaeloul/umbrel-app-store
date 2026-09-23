/* Registro de vistas por carpetas (views.tsx) y el CONTRATO con los agentes
   de las vistas: todo lo que el armazón encuentra en src/features y
   src/player tiene que exportar por defecto un componente. Si alguien rompe
   su export default, esto falla aquí, con el nombre del fichero, en vez de
   dejar una pantalla en blanco en producción. */

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '../api/query.ts';
import type { ViewModule } from './contracts.ts';
import { RouterProvider } from './router.tsx';
import {
  asideComponent,
  FEATURE_FOLDER,
  FOUND_MODULES,
  isViewLoaded,
  preloadView,
  viewComponent,
  viewLoader,
} from './views.tsx';

/** Un componente de React: función, clase, o un objeto de memo/forwardRef/lazy. */
function isComponent(value: unknown): boolean {
  if (typeof value === 'function') return true;
  return typeof value === 'object' && value !== null && '$$typeof' in value;
}

describe('views (registro por carpetas)', () => {
  it('sin src/features/<vista>/index.tsx sale el marcador «en construcción»', async () => {
    const { default: Pending } = await viewLoader('partido', {})();
    // Sin decidir el modo (live/demo), la consulta del motor espera y no sale a la red.
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider initialSearch="?vista=partido/x">
          <Pending route={{ vista: 'partido', id: 'x', canal: null }} active />
        </RouterProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Partido: en construcción' })).toBeInTheDocument();
  });

  it('cada vista sale de su carpeta y se carga una sola vez', () => {
    const fake = { '../features/biblioteca/index.tsx': async () => ({}) as ViewModule };
    expect(viewLoader('biblioteca', fake)).toBe(fake['../features/biblioteca/index.tsx']);
    expect(viewComponent('agenda')).toBe(viewComponent('agenda'));
    expect(asideComponent('sistema')).toBeNull();
    expect(Object.values(FEATURE_FOLDER)).toEqual([
      'agenda',
      'biblioteca',
      'buscar',
      'ajustes',
      'partido',
    ]);
  });

  it('una vista precargada se pinta sin suspender (misma transición: franja → partido)', async () => {
    preloadView('ajustes');
    await waitFor(() => expect(isViewLoaded('ajustes')).toBe(true));
    const Settings = viewComponent('ajustes');
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider initialSearch="?vista=ajustes">
          <Suspense fallback={<p>esqueleto</p>}>
            <Settings route={{ vista: 'ajustes', seccion: null }} active />
          </Suspense>
        </RouterProvider>
      </QueryClientProvider>,
    );
    // Sin pasar por el esqueleto: el primer render ya es la vista.
    expect(screen.queryByText('esqueleto')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument();
  });

  it('contrato: todo lo que existe exporta por defecto un componente', async () => {
    const groups = Object.entries(FOUND_MODULES);
    for (const [group, modules] of groups) {
      for (const [file, load] of Object.entries(
        modules as Record<string, () => Promise<unknown>>,
      )) {
        const mod = (await load()) as { default?: unknown };
        expect(isComponent(mod.default), `${group}: ${file} sin export default`).toBe(true);
      }
    }
  });
});
