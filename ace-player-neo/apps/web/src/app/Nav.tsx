/* Navegación principal con cuatro destinos (Agenda · Canales · Buscar ·
   Ajustes) o cinco con «Pelis y series» entre Canales y Buscar (docs/vod.md
   §12.1: solo si el servidor tiene películas y series), en la forma de «Palco» (plan de la fase 2, decisión W3):

   - Móvil (< 768 px): barra inferior FLOTANTE de cristal (márgenes de 12,
     radio 24, sombra Palco) con una píldora que se desliza hasta el destino
     activo (solo transform) y un velo debajo que funde la lista antes de la
     barra (corrección 4: que no asome texto alrededor).
   - Desde 768 px: MENÚ LATERAL fijo de 232 px (rediseño de escritorio),
     con la Guía y «Ver juntos» como destinos propios; Buscar pasa a la barra
     de cada sección (Ctrl K).

   Son enlaces de verdad (`?vista=…`): se pueden abrir en otra pestaña; el
   clic normal navega sin recargar. Pasar el ratón por encima precarga el JS
   de la vista. Los nombres accesibles que usan las e2e (`navigation
   'Principal'`, `link 'Agenda'`) no cambian.

   El número de destinos cambia: `--n` y el índice de la píldora (`--i`) salen
   SIEMPRE de la lista que se pinta (T17), nunca de un 4 fijo. */

import { type CSSProperties, type MouseEvent } from 'react';
import { useAppMode, useEngineSummary, useVodActive } from '../api/index.ts';
import { useLiveCountToday } from '../features/agenda/live-count.ts';
import { cx } from '../lib/cx.ts';
import { BrandMark } from '../ui/BrandMark.tsx';
import { Icon } from '../ui/Icon.tsx';
import type { IconName } from '../ui/icons.ts';
import { EngineIndicator } from './EngineIndicator.tsx';
import { rememberedViewParams, useNavigate } from './router.tsx';
import {
  navLabel,
  navParent,
  navVistas,
  searchFor,
  sideParent,
  sideVistas,
  VISTA_TITLE,
  type NavVista,
  type Route,
  type SideVista,
} from './routes.ts';
import { preloadView } from './views.tsx';

const NAV_ICON: Record<NavVista, IconName> = {
  agenda: 'agenda',
  biblioteca: 'biblioteca',
  cine: 'cine',
  buscar: 'buscar',
  ajustes: 'ajustes',
};

function navRoute(vista: NavVista): Route {
  if (vista === 'ajustes') return { vista: 'ajustes', seccion: null };
  if (vista === 'cine') return { vista: 'cine', id: null };
  return { vista };
}

/** Los destinos que se pintan ahora mismo (`cine` según `features.vod`). */
function useNavVistas(): readonly NavVista[] {
  const vod = useVodActive();
  return navVistas({ vod });
}

/**
 * Lo que se ve y lo que se lee de un destino: «Pelis y series» a la vista y
 * «Películas y series» como nombre y `title` (docs/vod.md §12.1).
 */
function labelProps(vista: NavVista) {
  const label = navLabel(vista);
  const title = VISTA_TITLE[vista];
  return label === title ? { label } : { label, 'aria-label': title, title };
}

function useNavLink(current: Route) {
  const navigate = useNavigate();
  return (vista: NavVista) => ({
    // El mismo destino que el clic (abrir en otra pestaña lleva lo mismo).
    href: searchFor(
      navRoute(vista),
      globalThis.location?.search ?? '',
      rememberedViewParams(vista),
    ),
    // En una vista hija (la Guía TV), su madre se marca como «estás dentro».
    'aria-current':
      current.vista === vista
        ? ('page' as const)
        : navParent(current.vista) === vista
          ? ('true' as const)
          : undefined,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      navigate(navRoute(vista));
    },
    onPointerEnter: () => preloadView(vista),
    onFocus: () => preloadView(vista),
  });
}

/** Índice del destino activo en la lista que se pinta (−1 fuera de ella: partido, sistema). */
function activeIndex(route: Route, vistas: readonly NavVista[]): number {
  const parent = navParent(route.vista);
  return parent ? vistas.indexOf(parent) : -1;
}

export function TabBar({ route, hidden }: { route: Route; hidden?: boolean }) {
  const link = useNavLink(route);
  const vistas = useNavVistas();
  const index = activeIndex(route, vistas);
  return (
    <nav
      className={cx('tabbar', 'glass', 'glass--dense', index < 0 && 'tabbar--none')}
      aria-label="Principal"
      hidden={hidden}
      data-n={vistas.length}
      style={{ '--i': Math.max(0, index), '--n': vistas.length } as CSSProperties}
    >
      {vistas.map((vista) => {
        const { label, ...named } = labelProps(vista);
        return (
          <a key={vista} className="tabbar__item" {...link(vista)} {...named}>
            <Icon name={NAV_ICON[vista]} size={24} />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}

const SIDE_ICON: Record<SideVista, IconName> = {
  agenda: 'agenda',
  biblioteca: 'biblioteca',
  guia: 'guia',
  cine: 'cine',
  juntos: 'personas',
  ajustes: 'ajustes',
};

const SIDE_LABEL: Record<SideVista, string> = {
  agenda: 'Agenda',
  biblioteca: 'Canales',
  guia: 'Guía',
  cine: 'Pelis y series',
  juntos: 'Ver juntos',
  ajustes: 'Ajustes',
};

function sideRoute(vista: SideVista): Route {
  if (vista === 'ajustes') return { vista: 'ajustes', seccion: null };
  if (vista === 'cine') return { vista: 'cine', id: null };
  if (vista === 'juntos') return { vista: 'juntos', code: null };
  return { vista };
}

/**
 * El motor en el menú lateral, solo si algo falla (ámbar o rojo): con todo en
 * orden la marca va sola, como en la maqueta. «Comprobando» tampoco se pinta
 * (dura un instante al abrir).
 */
function EngineAlert() {
  const summary = useEngineSummary();
  const mode = useAppMode();
  if (mode === 'demo' || summary.tone === 'ok' || summary.tone === 'idle') return null;
  return <EngineIndicator className="sidenav__engine" />;
}

/**
 * Menú lateral fijo de escritorio (desde 768 px; rediseño de escritorio):
 * marca, los destinos con el contador rojo de partidos en directo en Agenda,
 * el hueco del mini-reproductor (lo coloca shell.css: el reproductor no se
 * mueve de sitio en el árbol) y, abajo del todo, Ajustes. Opaco, sin cristal;
 * el activo lleva fondo `--surface` y la barrita amarilla. La ayuda de atajos
 * no lleva botón (como en la maqueta): la abren «?» y Ajustes.
 */
export function SideNav({ route }: { route: Route }) {
  const navigate = useNavigate();
  const vod = useVodActive();
  const vistas = sideVistas({ vod });
  const current = sideParent(route.vista);
  const live = useLiveCountToday();
  const link = (vista: SideVista) => ({
    href: searchFor(
      sideRoute(vista),
      globalThis.location?.search ?? '',
      rememberedViewParams(vista),
    ),
    'aria-current': current === vista ? ('page' as const) : undefined,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      navigate(sideRoute(vista));
    },
    onPointerEnter: () => preloadView(vista),
    onFocus: () => preloadView(vista),
  });
  const item = (vista: SideVista, extra?: string) => (
    <a
      key={vista}
      className={cx('sidenav__item', extra)}
      {...link(vista)}
      {...(vista === 'cine' ? { title: VISTA_TITLE.cine, 'aria-label': VISTA_TITLE.cine } : {})}
    >
      <Icon name={SIDE_ICON[vista]} size={24} />
      <span className="sidenav__label">{SIDE_LABEL[vista]}</span>
      {vista === 'agenda' && live > 0 ? (
        <span className="sidenav__count" aria-label={`${live} en directo`}>
          {live}
        </span>
      ) : null}
    </a>
  );
  return (
    <nav className="sidenav" aria-label="Principal">
      <div className="sidenav__head">
        <a
          className="sidenav__brand"
          {...link('agenda')}
          aria-current={undefined}
          aria-label="Ace Neo: ir a la agenda"
        >
          <BrandMark className="sidenav__mark" size={34} />
          <span className="sidenav__name">Ace Neo</span>
        </a>
        <EngineAlert />
      </div>
      {vistas.map((vista) => item(vista, vista === 'juntos' ? 'sidenav__item--sep' : undefined))}
      <div className="sidenav__spacer" />
      <div className="sidenav__mini-slot" aria-hidden="true" />
      {item('ajustes', 'sidenav__item--foot')}
    </nav>
  );
}
