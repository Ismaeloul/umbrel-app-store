/* Navegación principal con los mismos cuatro destinos:

   - Móvil (< 768 px): barra inferior flotante de cristal casi opaco con una
     «gota» que se desliza hasta el destino activo (transform) y un velo
     debajo que funde la lista antes de la barra (corrección 4: que no asome
     texto alrededor).
   - Desde 768 px: carril lateral opaco con la marca arriba y el estado del
     motor abajo.

   Son enlaces de verdad (`?vista=…`): se pueden abrir en otra pestaña; el
   clic normal navega sin recargar. Pasar el ratón por encima precarga el JS
   de la vista. */

import type { CSSProperties, MouseEvent } from 'react';
import { cx } from '../lib/cx.ts';
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

export function TabBar({ route, hidden }: { route: Route; hidden?: boolean }) {
  const link = useNavLink(route);
  const index = (NAV_VISTAS as readonly string[]).indexOf(route.vista);
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

export function Rail({ route }: { route: Route }) {
  const link = useNavLink(route);
  return (
    <nav className="rail" aria-label="Principal">
      <a
        className="rail__brand"
        {...link('agenda')}
        aria-current={undefined}
        aria-label="Ace Player Neo: ir a la agenda"
      >
        <img src="/icon.svg" alt="" width={44} height={44} />
      </a>
      <div className="rail__items">
        {NAV_VISTAS.map((vista) => (
          <a key={vista} className="rail__item" {...link(vista)}>
            <Icon name={NAV_ICON[vista]} size={24} />
            <span>{VISTA_TITLE[vista]}</span>
          </a>
        ))}
      </div>
      <EngineIndicator variant="rail" className="rail__engine" />
    </nav>
  );
}
