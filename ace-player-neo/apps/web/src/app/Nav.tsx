/* Navegación principal con cuatro destinos (Agenda · Canales · Buscar ·
   Ajustes) o cinco con «Pelis y series» entre Canales y Buscar (docs/vod.md
   §12.1: solo si el servidor tiene películas y series y, hasta la 0.9.0, con
   `?flag=cine`), en la forma de «Palco» (plan de la fase 2, decisión W3):

   - Móvil (< 768 px): barra inferior FLOTANTE de cristal (márgenes de 12,
     radio 24, sombra Palco) con una píldora que se desliza hasta el destino
     activo (solo transform) y un velo debajo que funde la lista antes de la
     barra (corrección 4: que no asome texto alrededor).
   - Desde 768 px: BARRA SUPERIOR de 64 px, de cristal mientras la página está
     arriba y sólida en cuanto se baja (un centinela con IntersectionObserver
     cambia una clase; el color lo hace una capa con opacidad). Marca a la
     izquierda, destinos al centro con la misma píldora deslizante, estado del
     motor y ayuda a la derecha.

   Son enlaces de verdad (`?vista=…`): se pueden abrir en otra pestaña; el
   clic normal navega sin recargar. Pasar el ratón por encima precarga el JS
   de la vista. Los nombres accesibles que usan las e2e (`navigation
   'Principal'`, `link 'Agenda'`) no cambian.

   El número de destinos cambia: `--n` y el índice de la píldora (`--i`) salen
   SIEMPRE de la lista que se pinta (T17), nunca de un 4 fijo. */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
} from 'react';
import { useVodActive } from '../api/index.ts';
import { cx } from '../lib/cx.ts';
import { BrandMark } from '../ui/BrandMark.tsx';
import { IconButton } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import type { IconName } from '../ui/icons.ts';
import { EngineIndicator } from './EngineIndicator.tsx';
import { rememberedViewParams, useNavigate } from './router.tsx';
import {
  cineFlagOn,
  navLabel,
  navParent,
  navVistas,
  searchFor,
  VISTA_TITLE,
  type NavVista,
  type Route,
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

/** Los destinos que se pintan ahora mismo (`cine` según `features.vod` y el interruptor). */
function useNavVistas(): readonly NavVista[] {
  const vod = useVodActive();
  return navVistas({ vod }, cineFlagOn());
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

/**
 * ¿La página ha bajado? Un centinela de 32 px arriba del todo: cuando deja de
 * verse, la barra pasa de cristal a sólida. Sin IntersectionObserver (jsdom,
 * navegadores viejos) se queda de cristal, que también se lee.
 */
function useScrolledPast(): [boolean, RefObject<HTMLDivElement | null>] {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setScrolled(!entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [scrolled, sentinel];
}

export function TopBar({ route, onHelp }: { route: Route; onHelp?: () => void }) {
  const link = useNavLink(route);
  const vistas = useNavVistas();
  const index = activeIndex(route, vistas);
  const [scrolled, sentinel] = useScrolledPast();
  return (
    <>
      <div ref={sentinel} className="topbar-sentinel" aria-hidden="true" />
      <nav
        className={cx('topbar', scrolled && 'topbar--solid', index < 0 && 'topbar--none')}
        aria-label="Principal"
        data-n={vistas.length}
        style={{ '--i': Math.max(0, index), '--n': vistas.length } as CSSProperties}
      >
        <a
          className="topbar__brand"
          {...link('agenda')}
          aria-current={undefined}
          aria-label="Ace Player Neo: ir a la agenda"
        >
          <BrandMark className="topbar__mark" size={28} />
          <span className="topbar__name">Ace Player Neo</span>
        </a>
        <div className="topbar__items">
          {vistas.map((vista) => {
            const { label, ...named } = labelProps(vista);
            return (
              <a key={vista} className="topbar__item" {...link(vista)} {...named}>
                <Icon name={NAV_ICON[vista]} size={20} />
                <span>{label}</span>
              </a>
            );
          })}
        </div>
        <div className="topbar__right">
          <EngineIndicator className="topbar__engine" />
          {onHelp ? (
            <IconButton
              icon="ayuda"
              label="Atajos de teclado"
              shortcut="?"
              className="topbar__help"
              onClick={onHelp}
            />
          ) : null}
        </div>
      </nav>
    </>
  );
}
