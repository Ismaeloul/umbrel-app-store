/* Armazón de la app: el esqueleto adaptativo en el que se montan las vistas y
   el reproductor.

   Maquetación (docs/diseno/sistema.md §Maquetación, piel «Palco» W3):
   - Móvil (< 768): la vista a lo ancho, barra inferior flotante con los 4
     destinos y el mini-reproductor encima. En el centro de partido no hay
     barra: el vídeo va arriba, pegado, y se minimiza con la flecha o deslizando.
   - Tableta (768-1023): barra superior + la vista.
   - Escritorio (1024-1279): barra superior + vista + panel lateral de la vista.
   - Ancho (≥ 1280): en el centro de partido, columna de agenda + reproductor +
     panel lateral, todo a la vez bajo la barra superior.
   - Móvil en horizontal viendo un partido: el vídeo ocupa la pantalla (el
     reproductor oculta sus controles solo).

   Reglas que cuida:
   - Las vistas visitadas siguen montadas (Activity) y ocultas: al volver
     conservan estado y scroll (regla 4). Oculta, una vista no tiene efectos
     vivos: sus sondeos, atajos y peticiones se paran solos.
   - El reproductor es UN componente en UN sitio del árbol: pasar de grande a
     mini no recrea el <video>.
   - Los toasts nunca van sobre el vídeo; la línea de estado es una cápsula
     SOBRE él, abajo a la izquierda (Palco W5: la coloca shell.css en la
     misma celda que el vídeo). */

import {
  Activity,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  ViewTransition,
  type CSSProperties,
} from 'react';
import {
  clearStatus,
  setImmersive,
  setWatching,
  StatusLineHost,
  Toaster,
} from '../notices/index.ts';
import { registerHouseNavigation } from '../features/multi/house.ts';
import { HouseQuestion } from '../features/multi/HouseQuestion.tsx';
import { installHouse } from '../features/multi/install.ts';
import { MEDIA, useLayoutKind, useMediaQuery } from '../lib/media.ts';
import { readItem, STORAGE_KEYS, writeItem } from '../lib/storage.ts';
import { Icon } from '../ui/Icon.tsx';
import { Skeleton, SkeletonRows } from '../ui/Skeleton.tsx';
import type { PlayerPresentation } from './contracts.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { requestFocus } from './focus.ts';
import { LayoutContext, type LayoutValue } from './layout.tsx';
import { TabBar, TopBar } from './Nav.tsx';
import { usePlayerPresence } from './player-presence.ts';
import { useBack, useNavigate, useRoute } from './router.tsx';
import { formatVista, type Route, type Vista } from './routes.ts';
import { restoreScroll } from './scroll-memory.ts';
import { ShortcutHelp } from './ShortcutHelp.tsx';
import { useShortcut } from './shortcuts.ts';
import { AgendaColumn, asideComponent, PlayerDock, viewComponent } from './views.tsx';
import './shell.css';

const WHAT: Record<Vista, string> = {
  agenda: 'la agenda',
  biblioteca: 'la biblioteca',
  buscar: 'la búsqueda',
  ajustes: 'los ajustes',
  partido: 'el centro de partido',
  sistema: 'el sistema de diseño',
};

function ViewSkeleton({ vista }: { vista: Vista }) {
  return (
    <div className="view-skeleton" aria-busy="true">
      <div className="view-skeleton__head">
        <Skeleton width={vista === 'partido' ? 220 : 160} height={34} radius="m" />
      </div>
      <SkeletonRows rows={vista === 'ajustes' ? 3 : 5} label={`Cargando ${WHAT[vista]}…`} />
    </div>
  );
}

function ViewSlot({ vista, route, active }: { vista: Vista; route: Route; active: boolean }) {
  const Component = viewComponent(vista);
  const navigate = useNavigate();
  return (
    <div className="view" data-vista={vista} data-active={active ? 'true' : 'false'}>
      <ErrorBoundary what={WHAT[vista]} onHome={() => navigate({ vista: 'agenda' })}>
        <Suspense fallback={<ViewSkeleton vista={vista} />}>
          <Component route={route} active={active} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

/** Hueco del reproductor mientras src/player/ no existe (o mientras se descarga). */
function StagePlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <div className="stage-placeholder" aria-busy={loading || undefined}>
      <Icon name="tv" size={32} />
      <p>{loading ? 'Preparando el reproductor…' : 'Aquí va el reproductor'}</p>
    </div>
  );
}

function asideInitiallyOpen(): boolean {
  return readItem(STORAGE_KEYS.aside) !== 'plegado';
}

export function Shell() {
  const route = useRoute();
  const navigate = useNavigate();
  const back = useBack();
  const kind = useLayoutKind();
  const phoneLandscape = useMediaQuery(MEDIA.phoneLandscape);
  const presence = usePlayerPresence();
  const [helpOpen, setHelpOpen] = useState(false);
  const [asideOpen, setAsideOpenState] = useState(asideInitiallyOpen);

  // Vistas visitadas: se quedan montadas (ocultas) para conservar su estado.
  const [visited, setVisited] = useState<Vista[]>([route.vista]);
  if (!visited.includes(route.vista)) setVisited([...visited, route.vista]);
  const lastRoutes = useRef(new Map<Vista, Route>());
  lastRoutes.current.set(route.vista, route);

  const inPartido = route.vista === 'partido';
  const dockMounted = PlayerDock !== null && (inPartido || presence.active);
  const presentation: PlayerPresentation = inPartido ? 'stage' : 'mini';
  const immersive = presence.immersive || (inPartido && phoneLandscape);
  const Aside = asideComponent(route.vista);
  const wideEnough = kind === 'desktop' || kind === 'wide';
  const asideAvailable = Aside !== null && wideEnough;
  const asideVisible = asideAvailable && asideOpen;
  const columnVisible = inPartido && kind === 'wide' && AgendaColumn !== null;
  const miniVisible = dockMounted && presentation === 'mini';
  const tabbarVisible = kind === 'mobile' && !inPartido;

  // Avisos: la línea de estado solo vive en el centro de partido; con el
  // vídeo a pantalla completa no se pinta ningún toast.
  useEffect(() => {
    setWatching(inPartido);
    if (!inPartido) clearStatus();
  }, [inPartido]);
  useEffect(() => setImmersive(immersive), [immersive]);

  // Varios dispositivos (docs/multidispositivo.md): la puerta de play() y seguir al otro.
  useEffect(() => installHouse(), []);
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    registerHouseNavigation(navigate, () => routeRef.current);
    return () => registerHouseNavigation(null, () => null);
  }, [navigate]);

  // Cada vista vuelve a su scroll (o arriba la primera vez).
  const key = formatVista(route);
  useLayoutEffect(() => {
    restoreScroll(route);
    // Solo al cambiar de ruta; `route` cambia de identidad con `key`.
  }, [key]);

  // Al navegar (no al abrir), el foco va al titular de la vista nueva.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const view = document.querySelector<HTMLElement>('.view[data-active="true"]');
      const heading = view?.querySelector<HTMLElement>('h1[tabindex="-1"]');
      (heading ?? document.getElementById('contenido'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);

  useShortcut({
    id: 'app.ayuda',
    keys: ['?'],
    display: ['?'],
    label: 'Enseña esta ayuda',
    group: 'General',
    handler: () => setHelpOpen(true),
  });
  useShortcut({
    id: 'app.buscar',
    keys: ['/'],
    display: ['/'],
    label: 'Abre la biblioteca y enfoca el buscador',
    group: 'General',
    handler: () => {
      navigate({ vista: 'biblioteca' });
      void requestFocus('buscar-biblioteca');
    },
  });

  const setAsideOpen = (open: boolean) => {
    setAsideOpenState(open);
    writeItem(STORAGE_KEYS.aside, open ? 'abierto' : 'plegado');
  };

  const layout: LayoutValue = { kind, asideVisible, asideAvailable, setAsideOpen, columnVisible };

  const toastBottom = tabbarVisible
    ? miniVisible
      ? 'calc(var(--tabbar-h) + var(--tabbar-gap) + var(--mini-h) + 20px)'
      : 'calc(var(--tabbar-h) + var(--tabbar-gap) + 8px)'
    : kind === 'mobile' && miniVisible
      ? 'calc(var(--mini-h) + 16px)'
      : '0px';

  return (
    <LayoutContext value={layout}>
      <div
        className="app"
        data-vista={route.vista}
        data-layout={kind}
        data-immersive={immersive ? 'true' : 'false'}
        data-mini={miniVisible ? 'true' : 'false'}
        data-aside={asideVisible ? 'true' : 'false'}
        data-column={columnVisible ? 'true' : 'false'}
        style={{ '--toast-bottom': toastBottom } as CSSProperties}
      >
        <a
          className="skip-link"
          href="#contenido"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('contenido')?.focus();
          }}
        >
          Saltar al contenido
        </a>
        <TopBar route={route} onHelp={() => setHelpOpen(true)} />
        {columnVisible && AgendaColumn ? (
          <aside className="app-column" aria-label="Agenda">
            <ErrorBoundary what="la agenda">
              <Suspense fallback={<SkeletonRows rows={5} label="Cargando la agenda…" />}>
                <AgendaColumn route={route} active />
              </Suspense>
            </ErrorBoundary>
          </aside>
        ) : null}
        <main id="contenido" className="app-main" tabIndex={-1}>
          {dockMounted || inPartido ? (
            <div className="stage" data-presentation={presentation}>
              {dockMounted && PlayerDock ? (
                <ViewTransition name="ace-reproductor">
                  <div className="dock" data-presentation={presentation}>
                    <ErrorBoundary what="el reproductor">
                      <Suspense fallback={<StagePlaceholder loading />}>
                        <PlayerDock
                          presentation={presentation}
                          route={route}
                          onMinimize={() => back({ vista: 'agenda' })}
                          onExpand={() => navigate(presence.route ?? { vista: 'agenda' })}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                </ViewTransition>
              ) : (
                <StagePlaceholder />
              )}
              {inPartido ? <StatusLineHost className="stage__status" /> : null}
            </div>
          ) : null}
          <ViewTransition name="ace-vista">
            <div className="views">
              {visited.map((vista) => (
                <Activity key={vista} mode={vista === route.vista ? 'visible' : 'hidden'}>
                  <ViewSlot
                    vista={vista}
                    route={lastRoutes.current.get(vista) ?? route}
                    active={vista === route.vista}
                  />
                </Activity>
              ))}
            </div>
          </ViewTransition>
        </main>
        {asideVisible && Aside ? (
          <aside className="app-aside" aria-label="Panel lateral">
            <ErrorBoundary what="el panel lateral">
              <Suspense fallback={<SkeletonRows rows={4} label="Cargando el panel…" />}>
                <Aside route={route} active />
              </Suspense>
            </ErrorBoundary>
          </aside>
        ) : null}
        <div className="bottom-veil" aria-hidden="true" hidden={!tabbarVisible} />
        <TabBar route={route} hidden={!tabbarVisible} />
        <Toaster bottomOffset={toastBottom} />
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        <HouseQuestion />
      </div>
    </LayoutContext>
  );
}
