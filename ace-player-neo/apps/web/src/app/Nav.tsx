/* Navegación principal.

   - Móvil (< 768 px; rediseño móvil, maqueta movil-barra-isla): la «isla»,
     una barra flotante opaca abajo con cuatro pestañas de solo icono
     (Agenda · Canales · Guía · Pelis y series; tres sin películas en el
     servidor, docs/vod.md §12.1) y una rayita amarilla bajo la activa. El
     mini-reproductor se acopla dentro de la misma isla. Buscar y Ajustes
     suben a la cabecera de cada vista (lupa y engranaje, ViewHeader.tsx) y
     se abren encima de cualquier pestaña, sin la isla.
   - Desde 768 px: MENÚ LATERAL fijo de 232 px (rediseño de escritorio),
     con la Guía y «Ver juntos» como destinos propios; Buscar pasa a la barra
     de cada sección (Ctrl K).

   Son enlaces de verdad (`?vista=…`): se pueden abrir en otra pestaña; el
   clic normal navega sin recargar. Pasar el ratón por encima precarga el JS
   de la vista. Los nombres accesibles que usan las e2e (`navigation
   'Principal'`, `link 'Agenda'`) no cambian.

   El número de pestañas cambia: `--n` sale SIEMPRE de la lista que se pinta
   (T17), nunca de un 4 fijo. */

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
  islaParent,
  islaVistas,
  searchFor,
  sideParent,
  sideVistas,
  VISTA_TITLE,
  type IslaVista,
  type Route,
  type SideVista,
} from './routes.ts';
import { preloadView } from './views.tsx';

const ISLA_ICON: Record<IslaVista, IconName> = {
  agenda: 'agenda',
  biblioteca: 'biblioteca',
  guia: 'guia',
  cine: 'cine',
};

function islaRoute(vista: IslaVista): Route {
  if (vista === 'cine') return { vista: 'cine', id: null };
  return { vista };
}

function useIslaLink(current: Route) {
  const navigate = useNavigate();
  const parent = islaParent(current.vista);
  return (vista: IslaVista) => ({
    // El mismo destino que el clic (abrir en otra pestaña lleva lo mismo).
    href: searchFor(
      islaRoute(vista),
      globalThis.location?.search ?? '',
      rememberedViewParams(vista),
    ),
    // En una vista hija (la sala de una película), su madre se marca como «estás dentro».
    'aria-current':
      current.vista === vista
        ? ('page' as const)
        : parent === vista
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
      navigate(islaRoute(vista));
    },
    onPointerEnter: () => preloadView(vista),
    onFocus: () => preloadView(vista),
  });
}

/**
 * La «isla» del móvil (por debajo de 768 px; maqueta movil-barra-isla): una
 * barra flotante opaca con solo los iconos (siluetas distintas) y una rayita
 * amarilla bajo el de la pestaña activa. Con algo sonando, el
 * mini-reproductor se acopla encima, dentro de la misma isla (lo coloca
 * shell.css: el reproductor no se mueve de sitio en el árbol). Sin rótulos a
 * la vista: el nombre de cada pestaña va en `aria-label` y en `title`.
 */
export function TabBar({ route, hidden }: { route: Route; hidden?: boolean }) {
  const link = useIslaLink(route);
  const vod = useVodActive();
  const vistas = islaVistas({ vod });
  return (
    <nav
      className="tabbar"
      aria-label="Principal"
      hidden={hidden}
      data-n={vistas.length}
      style={{ '--n': vistas.length } as CSSProperties}
    >
      {vistas.map((vista) => (
        <a
          key={vista}
          className="tabbar__item"
          {...link(vista)}
          aria-label={VISTA_TITLE[vista]}
          title={VISTA_TITLE[vista]}
        >
          <span className="tabbar__tile">
            <Icon name={ISLA_ICON[vista]} size={24} />
            <i className="tabbar__bar" aria-hidden="true" />
          </span>
        </a>
      ))}
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
