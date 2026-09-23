/* Dónde está cada vista. El armazón no importa ninguna vista a mano: las
   encuentra con import.meta.glob (cada una en su trozo de JS, cargada con
   React.lazy al abrirla por primera vez) y, si una carpeta aún no tiene su
   index.tsx, enseña un marcador. Así los agentes de las vistas trabajan a la
   vez sin tocar el armazón. */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PlayerModule, ViewModule, ViewProps } from './contracts.ts';
import { PendingView } from './PendingView.tsx';
import type { Vista } from './routes.ts';

type Loader<T> = () => Promise<T>;

const VIEWS = import.meta.glob<ViewModule>('../features/*/index.tsx');
const ASIDES = import.meta.glob<ViewModule>('../features/*/aside.tsx');
const COLUMNS = import.meta.glob<ViewModule>('../features/agenda/column.tsx');
const PLAYERS = import.meta.glob<PlayerModule>('../player/index.tsx');

/** Carpeta de cada vista en src/features/. */
export const FEATURE_FOLDER: Record<Exclude<Vista, 'sistema'>, string> = {
  agenda: 'agenda',
  biblioteca: 'biblioteca',
  buscar: 'buscar',
  ajustes: 'ajustes',
  partido: 'partido',
};

function find<T>(modules: Record<string, Loader<T>>, path: string): Loader<T> | null {
  return modules[path] ?? null;
}

const PENDING: ViewModule = { default: (props: ViewProps) => <PendingView {...props} /> };

/**
 * Cómo se carga una vista: la página de sistema es del armazón; las demás
 * salen de su carpeta y, si aún no tiene index.tsx, el marcador «en
 * construcción». `modules` es para los tests (por defecto, lo que encontró el
 * glob al compilar).
 */
export function viewLoader(
  vista: Vista,
  modules: Record<string, Loader<ViewModule>> = VIEWS,
): Loader<ViewModule> {
  if (vista === 'sistema') return () => import('./sistema/SistemaPage.tsx');
  return find(modules, `../features/${FEATURE_FOLDER[vista]}/index.tsx`) ?? (async () => PENDING);
}

/** Lo que encontró el armazón en src/features y src/player (el test del contrato lo recorre). */
export const FOUND_MODULES = {
  views: VIEWS,
  asides: ASIDES,
  columns: COLUMNS,
  players: PLAYERS,
} as const;

const viewCache = new Map<Vista, LazyExoticComponent<ComponentType<ViewProps>>>();

/* Vistas ya descargadas (preloadView o una visita). React.lazy recibe su
   módulo con un thenable que resuelve EN EL ACTO: así una vista precargada se
   pinta en la MISMA transición que la navegación, sin esqueleto, y la
   transición compartida franja → centro de partido funciona también la
   primera vez (con una promesa normal, lazy suspendía, salía el esqueleto y
   el partido llegaba en otra transición, sin elemento compartido). */
const loadedViews = new Map<Vista, ViewModule>();

function resolvedThenable<T>(value: T): Promise<T> {
  const thenable = {
    then(onFulfilled?: ((result: T) => unknown) | null) {
      onFulfilled?.(value);
      return thenable;
    },
  };
  return thenable as unknown as Promise<T>;
}

export function viewComponent(vista: Vista): LazyExoticComponent<ComponentType<ViewProps>> {
  const cached = viewCache.get(vista);
  if (cached) return cached;
  const load = viewLoader(vista);
  const component = lazy(() => {
    const ready = loadedViews.get(vista);
    if (ready) return resolvedThenable(ready);
    return load().then((module) => {
      loadedViews.set(vista, module);
      return module;
    });
  });
  viewCache.set(vista, component);
  return component;
}

const asideCache = new Map<Vista, LazyExoticComponent<ComponentType<ViewProps>> | null>();

/** Panel lateral de la vista (escritorio), o null si no tiene. */
export function asideComponent(vista: Vista): LazyExoticComponent<ComponentType<ViewProps>> | null {
  if (asideCache.has(vista)) return asideCache.get(vista) ?? null;
  const loader =
    vista === 'sistema' ? null : find(ASIDES, `../features/${FEATURE_FOLDER[vista]}/aside.tsx`);
  const component = loader ? lazy(loader) : null;
  asideCache.set(vista, component);
  return component;
}

const columnLoader = find(COLUMNS, '../features/agenda/column.tsx');
/** Columna compacta de la agenda junto al reproductor (pantallas anchas). */
export const AgendaColumn = columnLoader ? lazy(columnLoader) : null;

const playerLoader = find(PLAYERS, '../player/index.tsx');
/** El reproductor persistente (src/player/index.tsx), si ya existe. */
export const PlayerDock = playerLoader ? lazy(playerLoader) : null;

/** Descarga por adelantado el JS de una vista (al pasar por encima de su enlace). */
export function preloadView(vista: Vista): void {
  if (vista === 'sistema' || loadedViews.has(vista)) return;
  const load = find(VIEWS, `../features/${FEATURE_FOLDER[vista]}/index.tsx`);
  if (!load) return;
  load().then(
    (module) => loadedViews.set(vista, module),
    () => {
      // Sin red: ya se intentará al abrirla (con su esqueleto y su ErrorBoundary).
    },
  );
}

/** ¿Está ya descargada? (para los tests). */
export function isViewLoaded(vista: Vista): boolean {
  return loadedViews.has(vista);
}
