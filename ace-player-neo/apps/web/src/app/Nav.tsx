/* Navegación principal con los mismos cuatro destinos (Agenda · Canales ·
   Buscar · Ajustes), en la forma de «Palco» (plan de la fase 2, decisión W3):

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
   'Principal'`, `link 'Agenda'`) no cambian. */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
} from 'react';
import { cx } from '../lib/cx.ts';
import { IconButton } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import type { IconName } from '../ui/icons.ts';
import { EngineIndicator } from './EngineIndicator.tsx';
import { useNavigate } from './router.tsx';
import { NAV_VISTAS, searchFor, VISTA_TITLE, type NavVista, type Route } from './routes.ts';
import { preloadView } from './views.tsx';

const NAV_ICON: Record<NavVista, IconName> = {
  agenda: 'agenda',
  biblioteca: 'biblioteca',
  buscar: 'buscar',
  ajustes: 'ajustes',
};

function navRoute(vista: NavVista): Route {
  return vista === 'ajustes' ? { vista: 'ajustes', seccion: null } : { vista };
}

function useNavLink(current: Route) {
  const navigate = useNavigate();
  return (vista: NavVista) => ({
    href: searchFor(navRoute(vista), globalThis.location?.search ?? ''),
    'aria-current': current.vista === vista ? ('page' as const) : undefined,
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

/** Índice del destino activo (−1 fuera de los cuatro: partido, sistema). */
function activeIndex(route: Route): number {
  return (NAV_VISTAS as readonly string[]).indexOf(route.vista);
}

export function TabBar({ route, hidden }: { route: Route; hidden?: boolean }) {
  const link = useNavLink(route);
  const index = activeIndex(route);
  return (
    <nav
      className={cx('tabbar', 'glass', 'glass--dense', index < 0 && 'tabbar--none')}
      aria-label="Principal"
      hidden={hidden}
      style={{ '--i': Math.max(0, index), '--n': NAV_VISTAS.length } as CSSProperties}
    >
      {NAV_VISTAS.map((vista) => (
        <a key={vista} className="tabbar__item" {...link(vista)}>
          <Icon name={NAV_ICON[vista]} size={24} />
          <span>{VISTA_TITLE[vista]}</span>
        </a>
      ))}
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
  const index = activeIndex(route);
  const [scrolled, sentinel] = useScrolledPast();
  return (
    <>
      <div ref={sentinel} className="topbar-sentinel" aria-hidden="true" />
      <nav
        className={cx('topbar', scrolled && 'topbar--solid', index < 0 && 'topbar--none')}
        aria-label="Principal"
        style={{ '--i': Math.max(0, index), '--n': NAV_VISTAS.length } as CSSProperties}
      >
        <a
          className="topbar__brand"
          {...link('agenda')}
          aria-current={undefined}
          aria-label="Ace Player Neo: ir a la agenda"
        >
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span className="topbar__name">Ace Player Neo</span>
        </a>
        <div className="topbar__items">
          {NAV_VISTAS.map((vista) => (
            <a key={vista} className="topbar__item" {...link(vista)}>
              <Icon name={NAV_ICON[vista]} size={20} />
              <span>{VISTA_TITLE[vista]}</span>
            </a>
          ))}
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
