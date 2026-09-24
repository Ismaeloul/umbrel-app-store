/* Canales (biblioteca): presintonías numeradas, «Emitiendo ahora», filas de
   canal con menú, recientes por tramo y listas por directorio y categoría.
   Compartido entre la web y el iPhone. */

import { useMemo, useState, type ReactNode } from 'react';
import { activateDirectory, channelsOf as channelsOfDir, isFavorite, removeRecent, renameItem, toast, toggleFavorite, useSim } from '../../../core/store';
import type { Item, Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { ChannelMark, hueFromName } from '../../../core/ui/ChannelMark';
import { relativeTime } from '../../../core/format';
import { Empty, Field, Key, Progress, Tag } from './Key';
import { ActionSheet, Sheet } from './Sheet';
import { IcChevronDown, IcExternal, IcMore, IcPen, IcPlay, IcStar, IcTrash, IcSwap } from './icons';
import { RECENCY_ORDER, directoryErrorText, liveMatchesFor, nextMatchFor, recencyGroup } from './text';
import { Wave } from './Wave';

export type LibTab = 'favoritos' | 'recientes' | 'listas';

/** Línea «ahora» de un canal: partido en juego, próximo, o categoría. */
export function ChannelNowLine({ item, agenda, now, watchingId, revealed }: { item: Item; agenda: Match[]; now: number; watchingId: string | null; revealed: Record<string, boolean> }) {
  const live = liveMatchesFor(item, agenda, now)[0];
  if (live) {
    const s = scoreAt(live, now);
    const hidden = live.id === watchingId && !revealed[live.id];
    return (
      <span className="tr-chrow-now is-live">
        <Wave size={10} />
        <span>
          {team(live.home).short} {hidden ? '— —' : `${s.home}–${s.away}`} {team(live.away).short}
        </span>
        <span className="tr-chrow-min">{s.halftime ? 'Desc.' : s.clock}</span>
      </span>
    );
  }
  const next = nextMatchFor(item, agenda, now);
  if (next) {
    return (
      <span className="tr-chrow-now">
        A las {next.time}, {team(next.home).name} – {team(next.away).name}
      </span>
    );
  }
  return <span className="tr-chrow-now is-muted">{item.category || 'Canal'}</span>;
}

export interface ChannelRowProps {
  item: Item;
  agenda: Match[];
  now: number;
  onOpen: (item: Item) => void;
  onMenu?: (item: Item) => void;
  playing?: boolean;
  preset?: number;
  hint?: string;
  compact?: boolean;
}

export function ChannelRow({ item, agenda, now, onOpen, onMenu, playing, preset, hint, compact }: ChannelRowProps) {
  const watchingId = useSim((s) => (s.player.target?.kind === 'match' ? s.player.target.id : null));
  const revealed = useSim((s) => s.scoreRevealed);
  return (
    <div className={`tr-chrow${playing ? ' is-playing' : ''}${compact ? ' is-compact' : ''}`}>
      <button type="button" className="tr-chrow-main" onClick={() => onOpen(item)}>
        <span className="tr-chrow-mark">
          <ChannelMark name={item.title} size={compact ? 36 : 44} radius={8} />
          {preset !== undefined && <span className="tr-chrow-preset">{preset}</span>}
        </span>
        <span className="tr-chrow-text">
          <span className="tr-chrow-title">{item.title}</span>
          {hint ? <span className="tr-chrow-now is-muted">{hint}</span> : <ChannelNowLine item={item} agenda={agenda} now={now} watchingId={watchingId} revealed={revealed} />}
        </span>
        {playing && (
          <Tag tone="green" dot>
            En pantalla
          </Tag>
        )}
      </button>
      {onMenu && (
        <button type="button" className="tr-chrow-more" aria-label={`Opciones de ${item.title}`} onClick={() => onMenu(item)}>
          <IcMore />
        </button>
      )}
    </div>
  );
}

/** Presintonías: los favoritos como teclas numeradas con franja de color. */
export function Presets({ items, onOpen, playingId, max = 8 }: { items: Item[]; onOpen: (item: Item) => void; playingId: string | null; max?: number }) {
  const list = items.slice(0, max);
  return (
    <div className="tr-presets" role="list" aria-label="Presintonías">
      {list.map((it, i) => (
        <button key={it.id} type="button" role="listitem" className={`tr-preset${playingId === it.id ? ' is-on' : ''}`} onClick={() => onOpen(it)} title={it.title}>
          <span className="tr-preset-n">{i + 1}</span>
          <span className="tr-preset-stripe" style={{ background: `oklch(0.62 0.13 ${hueFromName(it.title)})` }} aria-hidden="true" />
          <span className="tr-preset-name">{it.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Canales de la biblioteca que dan un partido ahora mismo. */
export function useEmittingNow(agenda: Match[], now: number): { item: Item; match: Match }[] {
  const favorites = useSim((s) => s.favorites);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const dirs = useSim((s) => s.directories);
  return useMemo(() => {
    const live = agenda.filter((m) => scoreAt(m, now).state === 'in');
    const pool: Item[] = [...favorites];
    const seen = new Set(pool.map((p) => p.title));
    // El directorio en uso completa lo que no está en favoritos.
    void dirs;
    for (const it of channelsOfDir(activeDir)) {
      if (!seen.has(it.title)) {
        seen.add(it.title);
        pool.push(it);
      }
    }
    const out: { item: Item; match: Match }[] = [];
    for (const m of live) {
      for (const c of m.channels) {
        const it = pool.find((p) => p.title.toLowerCase() === c.name.toLowerCase());
        if (it && !out.some((o) => o.item.id === it.id)) out.push({ item: it, match: m });
      }
    }
    return out;
  }, [agenda, Math.floor(now / 30_000), favorites, activeDir, dirs]);
}

export function EmittingNow({ agenda, now, onOpen, horizontal }: { agenda: Match[]; now: number; onOpen: (item: Item) => void; horizontal?: boolean }) {
  const rows = useEmittingNow(agenda, now);
  const watchingId = useSim((s) => (s.player.target?.kind === 'match' ? s.player.target.id : null));
  const playingChannel = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));
  const revealed = useSim((s) => s.scoreRevealed);
  if (!rows.length) return null;
  return (
    <div className={`tr-emitting${horizontal ? ' is-horizontal' : ''}`}>
      {rows.map(({ item, match }) => {
        const s = scoreAt(match, now);
        const hidden = match.id === watchingId && !revealed[match.id];
        return (
          <button key={item.id} type="button" className={`tr-emit${playingChannel === item.id ? ' is-on' : ''}`} onClick={() => onOpen(item)}>
            <ChannelMark name={item.title} size={40} radius={8} />
            <span className="tr-emit-text">
              <span className="tr-emit-title">{item.title}</span>
              <span className="tr-emit-match">
                {team(match.home).short} <b>{hidden ? '— —' : `${s.home}–${s.away}`}</b> {team(match.away).short}
              </span>
            </span>
            <span className="tr-emit-min">
              <Wave size={10} />
              {s.halftime ? 'Desc.' : s.clock}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Recientes agrupados por «Hoy / Ayer / Esta semana / Antes». */
export function groupRecents(history: Item[], now: number): { label: string; items: Item[] }[] {
  const groups = new Map<string, Item[]>();
  for (const it of history) {
    const g = recencyGroup(it.date, now);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(it);
  }
  return RECENCY_ORDER.filter((g) => groups.has(g)).map((g) => ({ label: g, items: groups.get(g)! }));
}

/** Canales de un directorio agrupados por categoría (orden de aparición). */
export function groupByCategory(items: Item[]): { label: string; items: Item[] }[] {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const g = it.category || 'Otros';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(it);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

/** Cabecera de la lista en uso con selector y progreso de actualización. */
export function DirectoryBar({ dirId, onChange, onManage }: { dirId: string; onChange: (id: string) => void; onManage: () => void }) {
  const dirs = useSim((s) => s.directories);
  const active = useSim((s) => s.activeDirectoryId);
  const [open, setOpen] = useState(false);
  const d = dirs.find((x) => x.id === dirId) ?? dirs[0];
  if (!d) return null;
  const err = directoryErrorText(d.lastError);
  return (
    <div className="tr-dirbar">
      <button type="button" className="tr-dirbar-pick" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="tr-dirbar-name">
          {d.name}
          {d.id === active && <Tag tone="green">En uso</Tag>}
        </span>
        <span className="tr-dirbar-meta">
          {d.syncing ? `Actualizando… ${Math.round((d.syncProgress ?? 0) * 100)} %` : d.syncedAt ? `${d.count} canales · actualizada ${relativeTime(new Date(d.syncedAt).getTime(), Date.now())}` : `${d.count} canales`}
          {err && !d.syncing ? ` · ${err}` : ''}
        </span>
        <IcChevronDown size={18} />
      </button>
      <Key size="sm" variant="ghost" onClick={onManage}>
        Gestionar
      </Key>
      {d.syncing && <Progress value={d.syncProgress ?? 0} className="tr-dirbar-progress" />}
      <ActionSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cambiar de lista"
        mode="phone"
        actions={dirs.map((x) => ({
          label: x.name,
          hint: `${x.count} canales${x.id === active ? ' · en uso' : ''}`,
          icon: <IcSwap />,
          run: () => onChange(x.id),
        }))}
      />
    </div>
  );
}

/** Acordeón de categoría. */
export function Category({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`tr-cat${open ? ' is-open' : ''}`}>
      <button type="button" className="tr-cat-head" onClick={onToggle} aria-expanded={open}>
        <span>{label}</span>
        <span className="tr-cat-n">{count}</span>
        <IcChevronDown size={18} className="tr-cat-chev" />
      </button>
      {open && <div className="tr-cat-body">{children}</div>}
    </div>
  );
}

/** Menú de un canal + hoja de renombrar. Devuelve el gancho y el nodo a pintar. */
export function useChannelMenu(mode: 'web' | 'phone', opts: { onOpen: (item: Item) => void; recents?: boolean; onOpenIn?: (item: Item) => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const [rename, setRename] = useState<Item | null>(null);
  const [name, setName] = useState('');
  const fav = item ? isFavorite(item.id) : false;
  const node = (
    <>
      <ActionSheet
        open={!!item}
        onClose={() => setItem(null)}
        title={item?.title}
        subtitle={item ? (fav ? 'En tus favoritos' : item.category || 'Canal') : undefined}
        mode={mode}
        actions={
          item
            ? [
                { label: 'Ver canal', icon: <IcPlay />, run: () => opts.onOpen(item) },
                { label: fav ? 'Quitar de favoritos' : 'Guardar en favoritos', icon: <IcStar filled={fav} />, run: () => toggleFavorite(item.id, item.title) },
                {
                  label: 'Renombrar',
                  icon: <IcPen />,
                  run: () => {
                    setName(item.alias ?? item.title);
                    setRename(item);
                  },
                },
                ...(opts.recents ? [{ label: 'Quitar de recientes', icon: <IcTrash />, tone: 'red' as const, run: () => removeRecent(item.id) }] : []),
                { label: 'Abrir en…', hint: 'App de AceStream o VLC', icon: <IcExternal />, run: () => (opts.onOpenIn ? opts.onOpenIn(item) : toast('Abriendo en la app de AceStream…')) },
              ]
            : []
        }
      />
      <Sheet
        open={!!rename}
        onClose={() => setRename(null)}
        title="Renombrar canal"
        mode={mode}
        footer={
          <>
            <Key variant="ghost" onClick={() => setRename(null)}>
              Cancelar
            </Key>
            <Key
              variant="orange"
              disabled={!name.trim()}
              onClick={() => {
                if (rename && name.trim()) renameItem(rename.id, name.trim());
                setRename(null);
              }}
            >
              Guardar
            </Key>
          </>
        }
      >
        <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del canal" autoFocus={mode === 'web'} />
      </Sheet>
    </>
  );
  return { openMenu: setItem, node };
}

export function LibraryEmpty({ tab, onLists, onSearch, onAddList }: { tab: LibTab; onLists: () => void; onSearch: () => void; onAddList: () => void }) {
  if (tab === 'favoritos')
    return (
      <Empty
        title="Aún no tienes favoritos"
        text="Guarda los canales que más pones y tendrán su presintonía."
        actions={
          <>
            <Key variant="orange" onClick={onLists}>
              Ver las listas
            </Key>
            <Key variant="ghost" onClick={onSearch}>
              Buscar un canal
            </Key>
          </>
        }
      />
    );
  if (tab === 'recientes')
    return (
      <Empty
        title="Aún no has visto nada"
        text="Lo que pongas aparecerá aquí por días."
        actions={
          <Key variant="orange" onClick={onLists}>
            Ver las listas
          </Key>
        }
      />
    );
  return (
    <Empty
      title="Aún no hay ninguna lista"
      text="Añade una lista de canales y aparecerán aquí por categorías."
      actions={
        <Key variant="orange" onClick={onAddList}>
          Añadir una lista
        </Key>
      }
    />
  );
}

export function ListsHint({ onActivate, dirId }: { onActivate: () => void; dirId: string }) {
  const active = useSim((s) => s.activeDirectoryId);
  if (active === dirId) return null;
  return (
    <div className="tr-listhint">
      <span>Esta lista no es la que está en uso para el zapping.</span>
      <Key size="sm" onClick={() => { activateDirectory(dirId); onActivate(); }}>
        Usar esta lista
      </Key>
    </div>
  );
}
