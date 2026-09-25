/* Consola · Canales (web): Favoritos, Recientes (Hoy/Ayer/Esta semana/Antes)
   y Listas por directorio y categoría. «Emitiendo ahora» arriba. Filas de 40 px. */

import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../../core/router';
import { activateDirectory, channelsOf, playChannel, removeRecent, syncDirectory, toast, toggleFavorite, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { hhmm, relativeTime } from '../../../core/format';
import type { Item } from '../../../core/types';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon } from '../components/icons';
import { Bar, Button, ClubDot, Dot, Empty, GroupHead, IconButton, Keys, Menu, useMenu } from '../components/ui';
import { openInItems } from '../components/sheets';
import { channelNow, groupByCategory, groupRecents, matchTitle, simTime } from '../components/lib';
import { team } from '../../../core/data/teams';
import { isModalOpen, openSheet, select, useUi } from './state';
import { openMatch } from './Agenda';

export function openChannel(id: string) {
  playChannel(id);
  navigate('canal', id);
}

export function Library({ tab, narrow }: { tab: string; narrow: boolean }) {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const agenda = useSim((s) => s.agenda);
  const nowMs = useNow();
  const selection = useUi((u) => u.selection);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dir = directories.find((d) => d.id === tab);
  const items: Item[] = tab === 'favoritos' ? favorites : tab === 'recientes' ? history : dir ? channelsOf(dir.id) : [];
  const q = filter.trim().toLowerCase();
  const filtered = q ? items.filter((it) => it.title.toLowerCase().includes(q) || it.category.toLowerCase().includes(q)) : items;

  const groups = useMemo(() => {
    if (tab === 'recientes') return groupRecents(filtered, nowMs);
    if (dir) return groupByCategory(filtered);
    return [{ title: 'Favoritos', items: filtered }];
  }, [filtered, tab, dir, Math.floor(nowMs / 60000)]);

  const onAir = useMemo(() => {
    const seen = new Set<string>();
    return filtered.filter((it) => {
      const n = channelNow(it, agenda, nowMs);
      if (!n || !n.live || seen.has(it.title)) return false;
      seen.add(it.title);
      return true;
    });
  }, [filtered, agenda, Math.floor(nowMs / 30000)]);

  const flat = useMemo(() => [...onAir, ...groups.flatMap((g) => (collapsed[g.title] ? [] : g.items))], [onAir, groups, collapsed]);

  useEffect(() => {
    if (narrow) return;
    const inList = selection?.kind === 'channel' && flat.some((c) => c.id === selection.id);
    if (!inList && flat[0]) select({ kind: 'channel', id: flat[0].id });
  }, [flat, narrow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select')) return;
      if (isModalOpen() || e.metaKey || e.ctrlKey || e.altKey || !flat.length) return;
      const idx = flat.findIndex((c) => c.id === selection?.id);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        select({ kind: 'channel', id: flat[Math.min(flat.length - 1, idx + 1)].id });
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        select({ kind: 'channel', id: flat[Math.max(0, idx - 1)].id });
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        openChannel(flat[idx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, selection]);

  const title = tab === 'favoritos' ? 'Favoritos' : tab === 'recientes' ? 'Recientes' : dir?.name ?? 'Lista';

  return (
    <div className="co-screen">
      <div className="co-toolbar">
        <h1 className="co-h2 co-toolbar-title">
          {title}
          <span className="co-count">{items.length}</span>
        </h1>
        {dir && (
          <>
            {dir.id === activeDir ? (
              <span className="co-chip co-chip--accent">En uso</span>
            ) : (
              <Button size="sm" onClick={() => activateDirectory(dir.id)}>
                Usar esta lista
              </Button>
            )}
            {dir.syncing ? (
              <span className="co-row-flex" style={{ gap: 8, width: 160 }}>
                <span className="co-label">Actualizando…</span>
                <Bar value={dir.syncProgress ?? 0} className="co-grow" />
              </span>
            ) : (
              <span className="co-label">
                {dir.syncedAt ? `Actualizada ${relativeTime(simTime(new Date(dir.syncedAt).getTime()), nowMs)}` : 'Sin actualizar'}
                {dir.lastError && <span style={{ color: 'var(--co-weak)' }}> · el último intento falló</span>}
              </span>
            )}
            <IconButton icon="refresh" label="Actualizar la lista" onClick={() => syncDirectory(dir.id)} disabled={dir.syncing} />
          </>
        )}
        <span className="co-grow" />
        <label className="co-field co-field--filter">
          <Icon name="search" size={13} className="co-ink-3" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filtrar en ${title.toLowerCase()}…`} />
          {filter && <IconButton icon="x" label="Borrar filtro" onClick={() => setFilter('')} style={{ width: 20, height: 20 }} iconSize={12} />}
        </label>
        <IconButton icon="clipboard" label="Pegar Content ID" onClick={() => navigate('buscar')} />
      </div>

      <div className="co-list" role="grid" aria-label={title}>
        {onAir.length > 0 && (
          <section className="co-section">
            <GroupHead
              title={
                <span className="co-row-flex" style={{ gap: 6 }}>
                  <Dot tone="live" size="sm" /> Emitiendo ahora
                </span>
              }
              count={onAir.length}
            />
            {onAir.map((it) => (
              <ChannelRow key={`air-${it.id}`} it={it} tab={tab} selected={selection?.kind === 'channel' && selection.id === it.id} narrow={narrow} />
            ))}
          </section>
        )}
        {groups.map((g) => (
          <section key={g.title} className="co-section">
            {(tab !== 'favoritos' || onAir.length > 0) && <GroupHead title={g.title} count={g.items.length} collapsed={!!collapsed[g.title]} onToggle={groups.length > 1 ? () => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] })) : undefined} />}
            {!collapsed[g.title] && g.items.map((it) => <ChannelRow key={it.id} it={it} tab={tab} selected={selection?.kind === 'channel' && selection.id === it.id} narrow={narrow} />)}
          </section>
        ))}
        {items.length === 0 && tab === 'favoritos' && (
          <Empty
            icon="star"
            title="Aún no tienes favoritos"
            text="Marca con la estrella cualquier canal de tus listas y aparecerá aquí."
            actions={
              <>
                <Button onClick={() => navigate('biblioteca', activeDir)}>Ver las listas</Button>
                <Button kind="ghost" onClick={() => navigate('buscar')}>
                  Buscar en el motor
                </Button>
              </>
            }
          />
        )}
        {items.length === 0 && tab === 'recientes' && <Empty icon="clock" title="Aún no has visto nada" text="Los canales que reproduzcas se quedan aquí." actions={<Button onClick={() => navigate('agenda')}>Ir a Partidos</Button>} />}
        {items.length > 0 && filtered.length === 0 && <Empty icon="search" title={`Nada con «${filter}»`} actions={<Button onClick={() => setFilter('')}>Borrar el filtro</Button>} />}
        <footer className="co-list-foot">
          <span className="co-label">{tab === 'recientes' ? 'Se guardan los últimos 60' : dir ? `${dir.type === 'm3u' ? 'Lista M3U' : 'Página web'} · ${dir.count} canales` : 'Hasta 60 favoritos'}</span>
          <span className="co-grow" />
          <span className="co-row-flex" style={{ gap: 6 }}>
            <Keys keys="↑ ↓" /> mover <Keys keys="↵" /> ver
          </span>
        </footer>
      </div>
    </div>
  );
}

function ChannelRow({ it, tab, selected, narrow }: { it: Item; tab: string; selected: boolean; narrow: boolean }) {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const fav = useSim((s) => s.favorites.some((f) => f.id === it.id));
  const isTarget = useSim((s) => s.player.target?.kind === 'channel' && s.player.target.id === it.id);
  const now = channelNow(it, agenda, nowMs);
  const menu = useMenu();
  const sc = now ? scoreAt(now.match, nowMs) : null;
  const onClick = () => (narrow ? openChannel(it.id) : select({ kind: 'channel', id: it.id }));
  return (
    <div className={`co-row co-row--channel ${selected ? 'is-selected' : ''}`} role="row" aria-selected={selected} onClick={onClick} onDoubleClick={() => openChannel(it.id)} onContextMenu={menu.openPointer}>
      <span className="co-c-mark">
        <ChannelMark name={it.title} size={24} radius={6} />
      </span>
      <span className="co-c-name co-truncate">
        {it.title}
        {isTarget && (
          <span className="co-chip co-chip--ok" style={{ marginLeft: 8 }}>
            En pantalla
          </span>
        )}
      </span>
      <span className="co-c-now co-truncate">
        {now ? (
          <>
            {now.live ? <Dot tone="live" size="sm" /> : <Dot tone="queued" size="sm" />}
            <ClubDot color={team(now.match.home).primary} />
            <span className="co-truncate">{matchTitle(now.match)}</span>
            <span className="co-mono co-label">{now.live && sc ? sc.clock : hhmm(now.match.start)}</span>
          </>
        ) : (
          <span className="co-label">—</span>
        )}
      </span>
      <span className="co-c-cat co-truncate co-label">{tab === 'recientes' ? relativeTime(simTime(new Date(it.date).getTime()), nowMs) : it.category}</span>
      <span className="co-c-fav">
        <IconButton
          icon={fav ? 'star-filled' : 'star'}
          label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
          on={fav}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(it.id);
          }}
          className={fav ? '' : 'co-row-more'}
        />
      </span>
      <span className="co-c-more">
        <IconButton icon="more" label="Más opciones" onClick={(e) => menu.openAt(e, 'right')} className="co-row-more" />
      </span>
      {menu.state && (
        <Menu
          at={menu.state}
          align={menu.state.align}
          onClose={menu.close}
          items={[
            { id: 'open', label: 'Ver canal', icon: 'play', keys: 'Enter', run: () => openChannel(it.id) },
            ...(now ? [{ id: 'match', label: 'Abrir el partido', icon: 'ball' as const, run: () => openMatch(now.match.id) }] : []),
            { id: 'fav', label: fav ? 'Quitar de favoritos' : 'Guardar en favoritos', icon: fav ? 'star-filled' : 'star', run: () => toggleFavorite(it.id) },
            { id: 'rename', label: 'Renombrar…', icon: 'edit', run: () => openSheet({ type: 'rename', id: it.id, title: it.title }) },
            { id: 'copyname', label: 'Copiar nombre', icon: 'copy', run: () => { navigator.clipboard?.writeText(it.title).catch(() => undefined); toast('Nombre copiado', 'ok'); } },
            { id: 'sep', label: '', sep: true },
            ...openInItems(undefined).map((x) => ({ ...x, disabled: false, run: x.id === 'copy' ? () => { navigator.clipboard?.writeText(`acestream://${it.id}`).catch(() => undefined); toast('Enlace copiado', 'ok'); } : x.run })),
            { id: 'sep2', label: '', sep: true },
            ...(tab === 'recientes' ? [{ id: 'rm', label: 'Quitar de recientes', icon: 'trash' as const, danger: true, run: () => removeRecent(it.id) }] : []),
            ...(tab === 'favoritos' ? [{ id: 'rmf', label: 'Quitar de favoritos', icon: 'trash' as const, danger: true, run: () => toggleFavorite(it.id) }] : []),
          ]}
        />
      )}
    </div>
  );
}
