/* Palco · web de escritorio (1440×900, adaptable a 390 px).
   Portada a pantalla completa con la señal del partido destacado, filas debajo,
   y «modo teatro» al reproducir con panel lateral. */

import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './tokens.css';
import './palco.css';
import './web.css';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { back, buildHash, navigate, useRoute, type Screen } from '../../core/router';
import { addManualSource, getState, now as simNow, playChannel, setExpanded, setFullscreen, useSim } from '../../core/store';
import { useWebShortcuts, type KeyHandlers } from '../../core/keys';
import { Capsule, IconButton } from './components/primitives';
import { Toasts } from './components/Toasts';
import { HelpSheet, PasteSheet } from './components/sheets';
import { PrefsForm } from './components/prefs';
import { useDays, useMemoryState, useReducedMotion } from './components/hooks';
import { ENGINE_TITLES } from './components/stage';
import { Home } from './web/Home';
import { Theater } from './web/Theater';
import { Channels } from './web/Channels';
import { Search } from './web/Search';
import { Settings } from './web/Settings';
import { MiniWeb } from './web/Mini';

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default function Web() {
  const route = useRoute();
  const player = useSim((s) => s.player);
  const engine = useSim((s) => s.engine.status);
  const onboarding = useSim((s) => s.preferences.onboardingComplete);
  const rm = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);
  const [paste, setPaste] = useState(false);
  const [panelOpen, setPanelOpen] = useMemoryState('pl-web-panel', true);
  const [day, setDay] = useMemoryState('pl-web-day', startOfDay(simNow()));
  const [searchKey, setSearchKey] = useState(0);
  const [barHidden, setBarHidden] = useState(false);
  const [barSolid, setBarSolid] = useState(false);
  const days = useDays(simNow());

  const inTheater = route.screen === 'partido' || route.screen === 'canal';
  const isHome = route.screen === 'agenda';

  // El teatro es el «grande»; fuera de él, el mini.
  useEffect(() => {
    setExpanded(inTheater);
  }, [inTheater]);

  // Si lo que suena cambia (zapping, «Ver aquí»…) estando en el teatro, la ruta lo sigue.
  const targetKey = player.target ? `${player.target.kind}:${player.target.id}` : null;
  useEffect(() => {
    if (!inTheater || !player.target) return;
    const want: Screen = player.target.kind === 'match' ? 'partido' : 'canal';
    if (route.screen !== want || route.param !== player.target.id) navigate(want, player.target.id, null, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Cambio de pantalla: arriba del todo y barra visible.
  useEffect(() => {
    rootRef.current?.scrollTo({ top: 0 });
    setBarHidden(false);
    setBarSolid(!isHome);
  }, [route.screen, route.param, isHome]);

  // La barra superior se esconde al bajar y se vuelve sólida pasada la portada.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let last = 0;
    const on = () => {
      const y = el.scrollTop;
      if (y > 140 && y > last + 2) setBarHidden(true);
      else if (y < last - 2 || y <= 140) setBarHidden(false);
      setBarSolid(!isHome || y > el.clientHeight * 0.6);
      last = y;
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [isHome]);

  const handlers = useMemo<KeyHandlers>(
    () => ({
      onSearch: () => {
        navigate('buscar');
        setSearchKey((k) => k + 1);
      },
      onHelp: () => setHelp(true),
      onEscape: () => {
        if (help) {
          setHelp(false);
          return true;
        }
        if (paste) {
          setPaste(false);
          return true;
        }
        if (getState().player.fullscreen) {
          setFullscreen(false);
          return true;
        }
        if (inTheater || route.screen === 'gustos') {
          back();
          return true;
        }
        return false;
      },
      onArrowIdle: (dir) => {
        if (route.screen !== 'agenda') return;
        setDay((d) => {
          const i = days.findIndex((x) => x === d);
          const n = Math.max(0, Math.min(days.length - 1, (i < 0 ? 1 : i) + dir));
          return days[n];
        });
      },
    }),
    [help, paste, inTheater, route.screen, days, setDay],
  );
  useWebShortcuts(handlers);

  const onPasteAnywhere = (hash: string) => {
    const t = getState().player.target;
    if (t && inTheater) addManualSource(t.kind, t.id, hash);
    else {
      ENGINE_TITLES.set(hash, 'Enlace pegado');
      playChannel(hash);
      navigate('canal', hash);
    }
  };

  let screen: ReactNode;
  let key: string = route.screen;
  switch (route.screen) {
    case 'partido':
    case 'canal':
      key = `${route.screen}:${route.param}`;
      screen = route.param ? <Theater kind={route.screen === 'partido' ? 'match' : 'channel'} id={route.param} panelOpen={panelOpen} setPanelOpen={setPanelOpen} pasteOpen={paste} setPasteOpen={setPaste} /> : null;
      break;
    case 'biblioteca':
      screen = <Channels onPaste={() => setPaste(true)} />;
      break;
    case 'buscar':
      screen = <Search focusKey={searchKey} />;
      break;
    case 'ajustes':
      screen = <Settings sub={route.param} onHelp={() => setHelp(true)} />;
      break;
    case 'gustos':
      screen = (
        <div className="pl-page pl-gustos">
          <div className="pl-gustos__card">
            <PrefsForm onDone={() => back()} onCancel={() => back()} firstUse={!onboarding} />
          </div>
        </div>
      );
      break;
    default:
      screen = <Home day={day} setDay={setDay} />;
  }

  return (
    <LayoutGroup>
      <div ref={rootRef} className={`pl-root pl-web${inTheater ? ' is-theater' : ''}${player.fullscreen && inTheater ? ' is-fullscreen' : ''}`}>
        <header className={`pl-topbar${barHidden && !inTheater ? ' is-hidden' : ''}${barSolid ? ' is-solid' : ''}`}>
          <a className="pl-topbar__brand" href={buildHash(3, 'web', 'agenda')}>
            <span className="pl-topbar__mark" aria-hidden="true" />
            <span>Ace Player Neo</span>
          </a>
          <nav className="pl-topbar__nav" aria-label="Principal">
            <NavLink screen="agenda" current={route.screen} label="Portada" />
            <NavLink screen="biblioteca" current={route.screen} label="Canales" />
            <NavLink screen="ajustes" current={route.screen} label="Ajustes" />
          </nav>
          <div className="pl-topbar__right">
            {engine !== 'online' && (
              <Capsule tone={engine === 'restarting' ? 'weak' : 'fail'} size="sm" icon="warning" onClick={() => navigate('ajustes', 'salud')} title="Ver salud">
                {engine === 'restarting' ? 'Motor reiniciándose' : 'Motor apagado'}
              </Capsule>
            )}
            <IconButton variant="ghost" icon="search" label="Buscar (/)" active={route.screen === 'buscar'} onClick={() => navigate('buscar')} />
            <IconButton variant="ghost" icon="help" label="Atajos de teclado (?)" onClick={() => setHelp(true)} />
          </div>
        </header>

        <main className="pl-web__main">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={key} className="pl-web__screen" initial={{ opacity: 0, y: rm ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: rm ? 0 : -8 }} transition={{ duration: rm ? 0.12 : 0.3, ease: [0.2, 0.7, 0.2, 1] }}>
              {screen}
            </motion.div>
          </AnimatePresence>
        </main>

        <AnimatePresence>{!inTheater && player.target && <MiniWeb key="mini" />}</AnimatePresence>
        <Toasts position="bottom" />
        <HelpSheet open={help} onClose={() => setHelp(false)} />
        {!inTheater && <PasteSheet open={paste} onClose={() => setPaste(false)} mode="web" onPlay={onPasteAnywhere} />}
      </div>
    </LayoutGroup>
  );
}

function NavLink({ screen, current, label }: { screen: Screen; current: Screen; label: string }) {
  const on = current === screen || (screen === 'biblioteca' && current === 'buscar') || (screen === 'ajustes' && current === 'gustos');
  return (
    <button type="button" className={`pl-topbar__link${on ? ' is-on' : ''}`} onClick={() => navigate(screen)} aria-current={on ? 'page' : undefined}>
      {label}
    </button>
  );
}
