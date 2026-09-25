/* Canales (biblioteca, web): Emitiendo ahora · Favoritos · Recientes por tramo ·
   Listas por directorio y categoría. Acciones con Deshacer. */

import { useMemo, useState } from 'react';
import type { Item } from '../../../core/types';
import { navigate } from '../../../core/router';
import { activateDirectory, channelsOf, isFavorite, playChannel, removeRecent, renameItem, toggleFavorite, useNow, useSim } from '../../../core/store';
import { Button, Empty, RowHeader, Segmented, TextField } from '../components/primitives';
import { Icon } from '../components/icons';
import { ChannelPoster } from '../components/posters';
import { ActionMenu, RenameSheet, openInItems, type MenuItem } from '../components/sheets';
import { ChannelRow, emittingNow, groupByCategory, groupRecents, nowLine, uniqueByTitle } from '../components/library';
import { useMemoryState } from '../components/hooks';
import { HRow } from './Home';
import { plural } from '../../../core/format';
import { directoryStatus } from '../components/text';

export function Channels({ onPaste }: { onPaste: () => void }) {
  const now = useNow();
  const agenda = useSim((s) => s.agenda);
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const player = useSim((s) => s.player);
  const [dir, setDir] = useMemoryState<string>('pl-web-dir', activeDir);
  const [menu, setMenu] = useState<{ item: Item; items: MenuItem[] } | null>(null);
  const [rename, setRename] = useState<Item | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useMemoryState<Record<string, boolean>>('pl-web-cats', {});

  const dirItems = channelsOf(directories.some((d) => d.id === dir) ? dir : activeDir);
  const libraryChannels = useMemo(() => uniqueByTitle([...favorites, ...channelsOf(activeDir)]), [favorites, activeDir]);
  const emitting = useMemo(() => emittingNow(libraryChannels, agenda, now), [libraryChannels, agenda, now]);
  const recents = useMemo(() => groupRecents(history, Date.now()), [history]);
  const cats = useMemo(() => groupByCategory(dirItems), [dirItems]);
  const watchingId = player.target?.kind === 'channel' ? player.target.id : null;

  const play = (it: Item) => {
    playChannel(it.id);
    navigate('canal', it.id);
  };
  const itemsFor = (it: Item, inRecents: boolean): MenuItem[] => [
    { id: 'ver', label: 'Ver canal', icon: 'play', run: () => play(it) },
    { id: 'fav', label: isFavorite(it.id) ? 'Quitar de favoritos' : 'Guardar en favoritos', icon: isFavorite(it.id) ? 'star' : 'starFill', run: () => toggleFavorite(it.id, it.title) },
    { id: 'ren', label: 'Renombrar', icon: 'pencil', run: () => setRename(it) },
    ...(inRecents ? [{ id: 'rm', label: 'Quitar de recientes', icon: 'trash' as const, danger: true, run: () => removeRecent(it.id) }] : []),
    ...openInItems({ id: it.id } as never),
  ];

  const dirMeta = directories.find((d) => d.id === dir) ?? directories[0];

  return (
    <div className="pl-page pl-channels">
      <header className="pl-page__head">
        <div>
          <span className="pl-eyebrow">Biblioteca</span>
          <h1 className="pl-page__title">Canales</h1>
        </div>
        <div className="pl-page__tools">
          <form
            className="pl-page__search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate('buscar', q || null);
            }}
          >
            <TextField icon="search" placeholder="Buscar un canal…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Button variant="quiet" icon="paste" onClick={onPaste}>
            Pegar Content ID
          </Button>
        </div>
      </header>

      {emitting.length > 0 && (
        <HRow title="Emitiendo ahora" count={emitting.length} live sub="Canales con partido en juego">
          {emitting.map((e) => (
            <ChannelPoster key={e.item.id} item={e.item} now={nowLine(e.item.title, agenda, now)} size="md" favorite={isFavorite(e.item.id)} watching={watchingId === e.item.id} onClick={() => play(e.item)} onMore={() => setMenu({ item: e.item, items: itemsFor(e.item, false) })} fixedWidth={260} />
          ))}
        </HRow>
      )}

      <HRow title="Favoritos" count={favorites.length}>
        {favorites.length === 0 ? (
          <Empty compact icon="star" title="Aún no tienes favoritos" text="Marca un canal con la estrella y aparecerá aquí, en el zapping y en «Emitiendo ahora»." action={{ label: 'Ver las listas', run: () => document.getElementById('pl-listas')?.scrollIntoView({ behavior: 'smooth' }) }} secondary={{ label: 'Buscar en el motor', run: () => navigate('buscar') }} />
        ) : (
          favorites.map((f) => <ChannelPoster key={f.id} item={f} now={nowLine(f.title, agenda, now)} size="sm" favorite watching={watchingId === f.id} onClick={() => play(f)} onMore={() => setMenu({ item: f, items: itemsFor(f, false) })} fixedWidth={220} />)
        )}
      </HRow>

      <section className="pl-recents">
        <RowHeader title="Recientes" count={history.length} />
        {recents.length === 0 ? (
          <Empty compact icon="clock" title="Aún no has visto nada" text="Lo que veas irá quedando aquí, por días." action={{ label: 'Ver la agenda', run: () => navigate('agenda') }} />
        ) : (
          <div className="pl-recents__groups">
            {recents.map((g) => (
              <div key={g.label} className="pl-recents__group">
                <h3 className="pl-recents__label">{g.label}</h3>
                <div className="pl-recents__list">
                  {g.items.map((it) => (
                    <ChannelRow key={it.id} item={it} now={nowLine(it.title, agenda, now)} favorite={isFavorite(it.id)} watching={watchingId === it.id} onPlay={() => play(it)} onStar={() => toggleFavorite(it.id, it.title)} onMore={() => setMenu({ item: it, items: itemsFor(it, true) })} dense />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pl-lists" id="pl-listas">
        <RowHeader title="Listas" count={directories.length} sub="Los canales que traen tus listas, por categoría" action={{ label: 'Gestionar listas', run: () => navigate('ajustes', 'listas'), icon: 'chevronRight' }} />
        <div className="pl-lists__bar">
          <Segmented label="Lista" value={dirMeta?.id ?? ''} onChange={setDir} options={directories.map((d) => ({ id: d.id, label: d.name, count: d.count }))} />
          {dirMeta && (
            <span className="pl-lists__meta">
              {dirMeta.id === activeDir ? (
                <span className="pl-lists__inuse">
                  <Icon name="check" size={14} /> En uso para el zapping
                </span>
              ) : (
                <Button variant="quiet" size="sm" onClick={() => activateDirectory(dirMeta.id)}>
                  Usar para el zapping
                </Button>
              )}
              <span>· {directoryStatus(dirMeta, now)}</span>
            </span>
          )}
        </div>
        {cats.length === 0 ? (
          <Empty compact icon="list" title="Esta lista está vacía" text="Actualízala o añade otra en Ajustes › Listas." action={{ label: 'Ir a Listas', run: () => navigate('ajustes', 'listas') }} />
        ) : (
          <div className="pl-cats">
            {cats.map((c, i) => {
              const isOpen = open[`${dir}:${c.category}`] ?? i < 2;
              return (
                <div key={c.category} className={`pl-cat${isOpen ? ' is-open' : ''}`}>
                  <button type="button" className="pl-cat__head" onClick={() => setOpen({ ...open, [`${dir}:${c.category}`]: !isOpen })} aria-expanded={isOpen}>
                    <span className="pl-cat__title">{c.category}</span>
                    <span className="pl-cat__count">{plural(c.items.length, 'canal', 'canales')}</span>
                    <Icon name="chevronDown" size={16} className="pl-cat__chev" />
                  </button>
                  {isOpen && (
                    <div className="pl-cat__grid">
                      {c.items.map((it) => (
                        <ChannelRow key={it.id} item={it} now={nowLine(it.title, agenda, now)} favorite={isFavorite(it.id)} watching={watchingId === it.id} onPlay={() => play(it)} onStar={() => toggleFavorite(it.id, it.title)} onMore={() => setMenu({ item: it, items: itemsFor(it, false) })} dense />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ActionMenu open={!!menu} onClose={() => setMenu(null)} mode="web" title={menu?.item.title} items={menu?.items ?? []} />
      <RenameSheet open={!!rename} onClose={() => setRename(null)} mode="web" title={rename?.title ?? ''} onSave={(t) => rename && renameItem(rename.id, t)} />
    </div>
  );
}
