/* Consola · armazón de la web: barra lateral + columna central + inspector,
   panel de comandos, ayuda, hojas, avisos, pantalla completa y teclado. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { back, navigate, useRoute } from '../../../core/router';
import { useWebShortcuts } from '../../../core/keys';
import { getState, setFullscreen, useSim } from '../../../core/store';
import { Icon } from '../components/icons';
import { IconButton, Keys, Toasts } from '../components/ui';
import { AddListSheet, HelpSheet, PasteSheet, RenameSheet, ReportSheet } from '../components/sheets';
import { Sidebar } from './Sidebar';
import { Palette } from './Palette';
import { FullscreenOverlay } from './Player';
import { closePalette, closeSheet, getUi, isModalOpen, openPalette, setCollapsed, setDrawer, setHelp, useUi } from './state';
import { Agenda } from './Agenda';
import { Inspector } from './Inspector';
import { Full } from './Full';
import { Library } from './Library';
import { Search } from './Search';
import { Settings } from './Settings';
import { Gustos } from './Gustos';

/** ¿La ventana es estrecha? (sin inspector fijo / sin barra lateral fija) */
export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export function Shell() {
  const route = useRoute();
  const collapsed = useUi((u) => u.collapsed);
  const drawer = useUi((u) => u.drawer);
  const help = useUi((u) => u.help);
  const sheet = useUi((u) => u.sheet);
  const fullscreen = useSim((s) => s.player.fullscreen);
  const narrow = useMedia('(max-width: 1023px)');
  const phone = useMedia('(max-width: 767px)');
  const chord = useRef<{ key: string; at: number } | null>(null);

  // Teclado estándar + extras de Consola
  const handlers = useMemo(
    () => ({
      onSearch: () => openPalette(),
      onHelp: () => setHelp(true),
      onEscape: () => {
        const ui = getUi();
        if (ui.palette.open) {
          closePalette();
          return true;
        }
        if (ui.help) {
          setHelp(false);
          return true;
        }
        if (ui.sheet) {
          closeSheet();
          return true;
        }
        if (ui.drawer) {
          setDrawer(false);
          return true;
        }
        if (getState().player.fullscreen) {
          setFullscreen(false);
          return true;
        }
        const r = route;
        if (r.screen === 'partido' || r.screen === 'canal' || r.screen === 'gustos') {
          back(r.screen === 'canal' ? 'biblioteca' : r.screen === 'gustos' ? 'ajustes' : 'agenda');
          return true;
        }
        return false;
      },
      onArrowIdle: (dir: -1 | 1) => {
        window.dispatchEvent(new CustomEvent('co:arrow', { detail: dir }));
      },
    }),
    [route.screen],
  );
  useWebShortcuts(handlers);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        navigate('ajustes', 'apariencia');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isModalOpen()) return;
      if (e.key === '[') {
        e.preventDefault();
        setCollapsed(!getUi().collapsed);
        return;
      }
      // Acordes «g» + letra
      const now = Date.now();
      if (chord.current && now - chord.current.at < 900) {
        const k = e.key.toLowerCase();
        chord.current = null;
        if (k === 'p') navigate('agenda');
        else if (k === 'c') navigate('biblioteca', 'favoritos');
        else if (k === 'd') navigate('ajustes', 'dispositivos');
        else if (k === 's') navigate('ajustes', 'salud');
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === 'g') chord.current = { key: 'g', at: now };
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cerrar el cajón al navegar
  useEffect(() => {
    setDrawer(false);
  }, [route.seq]);

  const isFull = route.screen === 'partido' || route.screen === 'canal';
  const showInspector = !isFull && (route.screen === 'agenda' || route.screen === 'biblioteca' || route.screen === 'buscar') && !narrow;

  let main: ReactNode;
  switch (route.screen) {
    case 'partido':
      main = <Full kind="match" id={route.param ?? ''} key={`m-${route.param}`} />;
      break;
    case 'canal':
      main = <Full kind="channel" id={route.param ?? ''} key={`c-${route.param}`} />;
      break;
    case 'biblioteca':
      main = <Library tab={route.param ?? 'favoritos'} narrow={narrow} />;
      break;
    case 'buscar':
      main = <Search narrow={narrow} />;
      break;
    case 'ajustes':
      main = <Settings section={route.param ?? 'apariencia'} />;
      break;
    case 'gustos':
      main = <Gustos />;
      break;
    case 'emparejar':
      main = <Settings section="dispositivos" />;
      break;
    default:
      main = <Agenda narrow={narrow} />;
  }

  return (
    <div className={`co-root co-web ${collapsed ? 'is-collapsed' : ''} ${showInspector ? 'has-inspector' : ''} ${isFull ? 'is-full' : ''}`} data-screen={route.screen}>
      {!phone && <Sidebar />}
      {phone && (
        <header className="co-topbar">
          <IconButton icon="list" label="Menú" onClick={() => setDrawer(true)} />
          <span className="co-brand">
            <span className="co-brand-mark">
              <Icon name="ball" size={14} />
            </span>
            Ace Player Neo
          </span>
          <button type="button" className="co-searchbtn co-searchbtn--top" onClick={() => openPalette()} aria-label="Buscar">
            <Icon name="search" size={15} />
            <Keys keys="⌘ K" />
          </button>
        </header>
      )}
      {phone && drawer && (
        <>
          <div className="co-scrim" onClick={() => setDrawer(false)} />
          <div className="co-drawer">
            <Sidebar />
          </div>
        </>
      )}
      <main className="co-main" key={`${route.screen}/${route.param ?? ''}`}>
        <div className="co-main-anim">{main}</div>
        <Toasts className="co-toasts--main" />
      </main>
      {showInspector && (
        <aside className="co-inspector-col" aria-label="Inspector">
          <Inspector variant="list" />
        </aside>
      )}
      <Palette />
      {help && <HelpSheet onClose={() => setHelp(false)} />}
      {sheet?.type === 'report' && <ReportSheetFor kind={sheet.kind} id={sheet.id} sourceId={sheet.sourceId} />}
      {sheet?.type === 'paste' && <PasteSheet kind={sheet.kind} id={sheet.id} onClose={closeSheet} />}
      {sheet?.type === 'rename' && <RenameSheet id={sheet.id} current={sheet.title} onClose={closeSheet} />}
      {sheet?.type === 'addList' && <AddListSheet onClose={closeSheet} />}
      {fullscreen && <FullscreenOverlay />}
    </div>
  );
}

function ReportSheetFor({ kind, id, sourceId }: { kind: 'match' | 'channel'; id: string; sourceId: string }) {
  const session = useSim((s) => s.sourceSessions[`${kind}:${id}`]);
  const src = session?.sources.find((x) => x.id === sourceId);
  if (!src || !session) return null;
  return <ReportSheet kind={kind} id={id} source={src} index={session.sources.indexOf(src) + 1} onClose={closeSheet} />;
}
