/* Biblioteca («Canales» en iPhone): Favoritos / Recientes / Listas con
   «Emitiendo ahora» como bloque de marcadores arriba. Filas de 48 pt con
   dorsal 32. Acciones con Deshacer las da el núcleo (toasts). */
import { useMemo, useState } from 'react';
import { activateDirectory, channelsOf, isFavorite, removeRecent, toggleFavorite, useNow, useSim } from '../../../core/store';
import { navigate } from '../../../core/router';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { team } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { hhmm, relativeTime } from '../../../core/format';
import type { Item, Match } from '../../../core/types';
import { Empty, Meter, Segmented } from './atoms';
import { bucketOf, useMatchOnChannel, useOnAir, useScoreHidden, useSignal } from './data';
import { IChevronDown, ICopy, IExternal, IMore, IPencil, ISearch, IStar, ITrash } from './icons';
import { copyText, openSheet } from './prefs';

export type LibTab = 'favoritos' | 'recientes' | 'listas';

export function useDefaultLibTab(): LibTab {
  const favs = useSim((s) => s.favorites.length);
  const hist = useSim((s) => s.history.length);
  return favs ? 'favoritos' : hist ? 'recientes' : 'listas';
}

export function Library({ mode, tab, onTab, selectedId, dense }: { mode: 'web' | 'phone'; tab: LibTab; onTab: (t: LibTab) => void; selectedId?: string | null; dense?: boolean }) {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const dirChannels = channelsOf(activeDir);
  const onAir = useOnAir(useMemo(() => [...favorites, ...dirChannels], [favorites, dirChannels]));

  return (
    <div className="pz-lib">
      {onAir.length > 0 && (
        <>
          <div className="pz-sect" style={{ position: 'static' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i className="pz-dot pz-dot--pulse pz-anim" style={{ color: 'var(--pz-live)' }} /> Emitiendo ahora
            </div>
            <span>{onAir.length}</span>
          </div>
          <div className="pz-onair">
            {onAir.map(({ item, match }) => (
              <OnAirCard key={item.id} item={item} match={match} />
            ))}
          </div>
        </>
      )}
      <div className="pz-filterbar">
        <Segmented value={tab} onChange={onTab} options={[{ id: 'favoritos', label: 'Favoritos', count: favorites.length }, { id: 'recientes', label: 'Recientes', count: history.length }, { id: 'listas', label: 'Listas', count: directories.length }]} label="Biblioteca" />
      </div>
      {tab === 'favoritos' &&
        (favorites.length ? (
          favorites.map((it) => <ChannelRow key={it.id} item={it} mode={mode} selected={selectedId === it.id} />)
        ) : (
          <Empty
            title="Aún no tienes favoritos"
            text="Marca con la estrella cualquier canal de las listas o de un partido."
            actions={
              <>
                <button type="button" className="pz-btn pz-btn--sm" onClick={() => onTab('listas')}>
                  Ver las listas
                </button>
                <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={() => navigate('buscar')}>
                  <ISearch size={14} /> Buscar en el motor
                </button>
              </>
            }
          />
        ))}
      {tab === 'recientes' && <Recents history={history} mode={mode} selectedId={selectedId} />}
      {tab === 'listas' && <Lists mode={mode} selectedId={selectedId} dense={dense} />}
    </div>
  );
}

function OnAirCard({ item, match }: { item: Item; match: Match }) {
  const nowMs = useNow();
  const s = scoreAt(match, nowMs);
  const hidden = useScoreHidden(match.id);
  const signal = useSignal('match', match.id);
  return (
    <button type="button" className="pz-onair-card" onClick={() => navigate('canal', item.id)}>
      <span className="top">
        <ChannelMark name={item.title} size={18} radius={4} />
        <b>{item.title}</b>
      </span>
      <span className="mid">
        <span>
          {team(match.home).short} {hidden ? '–' : `${s.home}–${s.away}`} {team(match.away).short}
        </span>
        <span className="min">{s.halftime ? 'DESC' : s.clock}</span>
      </span>
      <Meter kind={signal.kind} word slate label={signal.text} />
    </button>
  );
}

function Recents({ history, mode, selectedId }: { history: Item[]; mode: 'web' | 'phone'; selectedId?: string | null }) {
  if (!history.length)
    return (
      <Empty
        title="Aún no has visto nada"
        text="Lo que reproduzcas aparecerá aquí por días."
        actions={
          <button type="button" className="pz-btn pz-btn--sm" onClick={() => navigate('agenda')}>
            Abrir la agenda
          </button>
        }
      />
    );
  const nowReal = Date.now();
  const buckets = ['Hoy', 'Ayer', 'Esta semana', 'Antes'] as const;
  return (
    <>
      {buckets.map((b) => {
        const items = history.filter((h) => bucketOf(h.date, nowReal) === b);
        if (!items.length) return null;
        return (
          <div key={b}>
            <div className="pz-sect">
              {b}
              <span>{items.length}</span>
            </div>
            {items.map((it) => (
              <ChannelRow key={it.id} item={it} mode={mode} selected={selectedId === it.id} recent />
            ))}
          </div>
        );
      })}
    </>
  );
}

function Lists({ mode, selectedId, dense }: { mode: 'web' | 'phone'; selectedId?: string | null; dense?: boolean }) {
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const [shown, setShown] = useState<string | null>(null);
  const dirId = shown && directories.some((d) => d.id === shown) ? shown : activeDir;
  const dir = directories.find((d) => d.id === dirId);
  const items = channelsOf(dirId);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const cats = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) m.set(it.category, [...(m.get(it.category) ?? []), it]);
    return [...m.entries()];
  }, [items]);

  if (!directories.length)
    return (
      <Empty
        title="Aún no hay ninguna lista"
        text="Añade una lista M3U o una página de canales desde Ajustes."
        actions={
          <button type="button" className="pz-btn pz-btn--sm" onClick={() => openSheet({ type: 'add-list' })}>
            Añadir una lista
          </button>
        }
      />
    );
  return (
    <>
      <div className="pz-dir-bar" role="tablist" aria-label="Listas">
        {directories.map((d) => (
          <button key={d.id} type="button" role="tab" aria-selected={d.id === dirId} className={`pz-chip${d.id === dirId ? ' is-on' : ''}`} onClick={() => setShown(d.id)}>
            {d.name}
            {d.id === activeDir && <span className="pz-tag pz-tag--ok" style={{ height: 16, fontSize: 10 }}>En uso</span>}
          </button>
        ))}
      </div>
      {dir && (
        <div className="pz-filterbar" style={{ fontSize: 12, color: 'var(--pz-ink-3)' }}>
          <span className="pz-ellipsis">
            {dir.syncing ? `Actualizando… ${Math.round((dir.syncProgress ?? 0) * 100)} %` : dir.syncedAt ? `${dir.count} canales · actualizada ${relativeTime(new Date(dir.syncedAt).getTime(), Date.now())}` : `${dir.count} canales`}
            {dir.lastError && !dir.syncing ? ' · la última actualización falló' : ''}
          </span>
          {dir.id !== activeDir && (
            <button type="button" className="pz-btn pz-btn--sm" onClick={() => activateDirectory(dir.id)}>
              Usar esta lista
            </button>
          )}
        </div>
      )}
      {dir?.syncing && (
        <div style={{ padding: '0 10px 8px' }}>
          <div className="pz-progress">
            <i style={{ transform: `scaleX(${dir.syncProgress ?? 0})` }} />
          </div>
        </div>
      )}
      {cats.map(([cat, list]) => {
        const open = !closed[cat];
        return (
          <div key={cat}>
            <button type="button" className={`pz-cat${open ? ' is-open' : ''}`} onClick={() => setClosed((c) => ({ ...c, [cat]: open }))} aria-expanded={open}>
              {cat}
              <span>
                {list.length}
                <IChevronDown size={14} />
              </span>
            </button>
            {open && list.map((it) => <ChannelRow key={it.id} item={it} mode={mode} selected={selectedId === it.id} dense={dense} />)}
          </div>
        );
      })}
    </>
  );
}

/* ---------- fila de canal ---------- */
export function ChannelRow({ item, mode, selected, recent, dense }: { item: Item; mode: 'web' | 'phone'; selected?: boolean; recent?: boolean; dense?: boolean }) {
  const fav = useSim(() => isFavorite(item.id));
  const on = useMatchOnChannel(item.title);
  const nowMs = useNow();
  const hidden = useScoreHidden(on?.match.id ?? null);
  const [menu, setMenu] = useState(false);
  const s = on ? scoreAt(on.match, nowMs) : null;
  const sub = on && s ? (
    on.live ? (
      <>
        <span className="is-live">●</span>
        <span className="pz-cond">
          {team(on.match.home).short} {hidden ? '–' : `${s.home}–${s.away}`} {team(on.match.away).short}
        </span>
        <span className="pz-cond is-live">{s.halftime ? 'DESC' : s.clock}</span>
      </>
    ) : (
      <>
        <span className="pz-cond">{hhmm(on.match.start)}</span>
        {team(on.match.home).name} – {team(on.match.away).name}
      </>
    )
  ) : (
    <>{item.category}</>
  );
  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === 'phone') openSheet({ type: 'channel-actions', id: item.id, title: item.title });
    else setMenu(true);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className={`pz-ch${selected ? ' is-selected' : ''}`} onClick={() => navigate('canal', item.id)} style={dense ? { minHeight: 40 } : undefined} aria-current={selected ? 'true' : undefined}>
        <ChannelMark name={item.title} size={32} radius={6} />
        <span className="pz-ch-txt">
          <b>{item.title}</b>
          <small>{sub}</small>
        </span>
        <span className="pz-ch-side">
          {mode === 'web' && (
            <span
              role="button"
              tabIndex={0}
              className={`pz-tap pz-star${fav ? ' is-on' : ''}`}
              style={{ minWidth: 36, minHeight: 36 }}
              aria-label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(item.id, item.title);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFavorite(item.id, item.title);
                }
              }}
            >
              <IStar size={16} filled={fav} />
            </span>
          )}
          <span role="button" tabIndex={0} className="pz-tap" style={{ minWidth: 36, minHeight: 36 }} aria-label="Más opciones" onClick={openMenu} onKeyDown={(e) => e.key === 'Enter' && openMenu(e as unknown as React.MouseEvent)}>
            <IMore size={16} />
          </span>
        </span>
      </button>
      {menu && (
        <>
          <div className="pz-menu-backdrop" onClick={() => setMenu(false)} />
          <div className="pz-menu" style={{ right: 8, top: 40 }} role="menu">
            <button type="button" onClick={() => { toggleFavorite(item.id, item.title); setMenu(false); }}>
              <IStar size={16} filled={fav} /> {fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
            </button>
            <button type="button" onClick={() => { openSheet({ type: 'rename', id: item.id, title: item.title }); setMenu(false); }}>
              <IPencil size={16} /> Renombrar
            </button>
            <hr />
            <button type="button" onClick={() => { copyText(item.id); setMenu(false); }}>
              <ICopy size={16} /> Copiar Content ID
            </button>
            <button type="button" onClick={() => { openSheet({ type: 'open-in', source: null, title: item.title }); setMenu(false); }}>
              <IExternal size={16} /> Abrir en…
            </button>
            {recent && (
              <>
                <hr />
                <button type="button" className="is-danger" onClick={() => { removeRecent(item.id); setMenu(false); }}>
                  <ITrash size={16} /> Quitar de recientes
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
