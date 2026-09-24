/* Consola · barra lateral (240 px, plegable a 56): Partidos, Canales, Ajustes
   (Dispositivos, Sistema) y el mini-reproductor como fila de 48 px abajo. */

import { navigate, useRoute } from '../../../core/router';
import { useNow, useSim } from '../../../core/store';
import { phaseOf } from '../../../core/score';
import { Icon, type IconName } from '../components/icons';
import { Dot, IconButton, Keys } from '../components/ui';
import { isoDay } from '../components/lib';
import { MiniRow } from './Player';
import { openPalette, setCollapsed, setDrawer, useUi } from './state';

function NavItem({ icon, label, active, onClick, right, collapsed, indent, dot }: { icon?: IconName; label: string; active: boolean; onClick: () => void; right?: React.ReactNode; collapsed: boolean; indent?: boolean; dot?: React.ReactNode }) {
  return (
    <button type="button" className={`co-nav ${active ? 'is-active' : ''} ${indent ? 'is-indent' : ''}`} onClick={onClick} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>
      {icon ? <Icon name={icon} size={16} className="co-nav-icon" /> : dot ? <span className="co-nav-icon co-nav-dotwrap">{dot}</span> : <span className="co-nav-icon" />}
      {!collapsed && <span className="co-truncate co-grow">{label}</span>}
      {!collapsed && right && <span className="co-nav-right">{right}</span>}
    </button>
  );
}

function Group({ title, collapsed, children }: { title: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="co-navgroup">
      {!collapsed && <div className="co-navgroup-title">{title}</div>}
      {collapsed && <div className="co-navgroup-rule" />}
      {children}
    </div>
  );
}

export function Sidebar() {
  const collapsed = useUi((u) => u.collapsed);
  const route = useRoute();
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const favorites = useSim((s) => s.favorites.length);
  const history = useSim((s) => s.history.length);
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const devices = useSim((s) => s.devices.filter((d) => !d.revokedAt).length);
  const engine = useSim((s) => s.engine.status);
  const sessions = useSim((s) => s.sessions.length);
  const today = isoDay(nowMs);
  const todays = agenda.filter((m) => m.date === today);
  const live = todays.filter((m) => phaseOf(m, nowMs) === 'live').length;
  const engineTone = engine === 'online' ? 'ok' : engine === 'restarting' ? 'checking' : 'fail';
  const go = (screen: Parameters<typeof navigate>[0], param?: string | null) => {
    navigate(screen, param ?? null);
    setDrawer(false);
  };
  const isMatches = route.screen === 'agenda' || route.screen === 'partido';
  const lib = route.screen === 'biblioteca' || route.screen === 'canal' ? route.param ?? 'favoritos' : null;

  return (
    <aside className={`co-sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Navegación">
      <header className="co-sidebar-head">
        {!collapsed && (
          <span className="co-brand">
            <span className="co-brand-mark">
              <Icon name="ball" size={14} />
            </span>
            <span className="co-truncate">Ace Player Neo</span>
          </span>
        )}
        <IconButton icon="sidebar" label={collapsed ? 'Desplegar la barra lateral ([)' : 'Plegar la barra lateral ([)'} onClick={() => setCollapsed(!collapsed)} className="co-sidebar-toggle" />
      </header>

      <button type="button" className="co-searchbtn" onClick={() => openPalette()} title="Buscar y comandos (⌘K o /)">
        <Icon name="search" size={15} />
        {!collapsed && (
          <>
            <span className="co-grow co-truncate">Buscar o hacer…</span>
            <Keys keys="⌘ K" />
          </>
        )}
      </button>

      <nav className="co-sidebar-nav">
        <Group title="Partidos" collapsed={collapsed}>
          <NavItem icon="ball" label={`Hoy · ${todays.length}`} active={isMatches} onClick={() => go('agenda')} collapsed={collapsed} right={live ? <span className="co-nav-live"><Dot tone="live" size="sm" /> {live}</span> : undefined} />
        </Group>
        <Group title="Canales" collapsed={collapsed}>
          <NavItem icon="star" label="Favoritos" active={lib === 'favoritos'} onClick={() => go('biblioteca', 'favoritos')} collapsed={collapsed} right={<span className="co-nav-count">{favorites}</span>} />
          <NavItem icon="clock" label="Recientes" active={lib === 'recientes'} onClick={() => go('biblioteca', 'recientes')} collapsed={collapsed} right={<span className="co-nav-count">{history}</span>} />
          {!collapsed && <div className="co-navgroup-sub">Listas</div>}
          {directories.map((d) => (
            <NavItem
              key={d.id}
              dot={<Dot tone={d.syncing ? 'checking' : d.lastError ? 'weak' : 'idle'} size="sm" />}
              icon={collapsed ? 'list' : undefined}
              label={d.name}
              active={lib === d.id}
              onClick={() => go('biblioteca', d.id)}
              collapsed={collapsed}
              indent
              right={d.id === activeDir ? <span className="co-nav-tag">En uso</span> : <span className="co-nav-count">{d.count}</span>}
            />
          ))}
        </Group>
        <Group title="Ajustes" collapsed={collapsed}>
          <NavItem icon="phone" label="Dispositivos" active={route.screen === 'ajustes' && (route.param === 'dispositivos' || route.param === 'donde')} onClick={() => go('ajustes', 'dispositivos')} collapsed={collapsed} right={<span className="co-nav-count">{sessions ? <Dot tone="ok" size="sm" /> : devices}</span>} />
          <NavItem icon="activity" label="Sistema" active={route.screen === 'ajustes' && (route.param === 'salud' || route.param === 'listas')} onClick={() => go('ajustes', 'salud')} collapsed={collapsed} right={<Dot tone={engineTone} size="sm" title={engine === 'online' ? 'Motor en línea' : engine === 'restarting' ? 'Motor reiniciándose' : 'Motor apagado'} />} />
          <NavItem icon="settings" label="Más ajustes" active={(route.screen === 'ajustes' && !['dispositivos', 'donde', 'salud', 'listas'].includes(route.param ?? '')) || route.screen === 'gustos'} onClick={() => go('ajustes', 'apariencia')} collapsed={collapsed} right={<Keys keys="⌘ ," />} />
        </Group>
      </nav>

      <footer className="co-sidebar-foot">
        <MiniRow collapsed={collapsed} />
      </footer>
    </aside>
  );
}
