/* Centro de un canal suelto (`?vista=partido/canal/<hash>`): lo que se abre
   al reproducir desde la biblioteca, el buscador, «Pegar hash» o el
   zapping. Cabecera con el dorsal del canal (C2), sus fuentes HERMANAS del
   mismo canal (regla 23: ≥ 92 por nombre; sin hermanas no hay selector,
   §7.1) y el inspector con las acciones del canal. Aquí nunca se salta de
   fuente sola (reproductor.md §4.4: en la biblioteca, nunca). */

import type { Item, LibraryView } from '@ace/shared';
import { useEffect, useMemo } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { useLayout } from '../../app/layout.tsx';
import { play, usePlayerSelector } from '../../player/api.ts';
import { Button, ChannelMark, IconButton } from '../../ui/index.ts';
import { findKnownItem } from '../library/model.ts';
import { librarySiblings } from '../sources/model.ts';
import { enterChannel, leaveSession } from '../sources/session.ts';
import { SourcesPanel } from '../sources/SourcesPanel.tsx';
import type { InspectorTarget } from '../sources/SourceInspector.tsx';
import { NerdSection } from './NerdSection.tsx';

export interface ChannelContext {
  title: string;
  item: Item | null;
  siblings: Item[];
  target: InspectorTarget;
  library: LibraryView | undefined;
}

/** Lo que se sabe del canal: su ficha en la biblioteca (si está) y lo que dice el reproductor. */
export function useChannelContext(hash: string): ChannelContext {
  const library = useApiQuery('libraryGet').data;
  const playerTitle = usePlayerSelector((state) =>
    state.channel?.hash === hash ? state.channel.title : null,
  );
  return useMemo(() => {
    const item = findKnownItem(library, hash) ?? null;
    const title = item?.title || playerTitle || `Canal ${hash.slice(0, 8)}`;
    return {
      title,
      item,
      siblings: librarySiblings(library, hash),
      target: { hash, title, ih: item?.ih === true, learned: false },
      library,
    };
  }, [library, hash, playerTitle]);
}

function originText(item: Item | null, library: LibraryView | undefined): string {
  if (!item) return 'Fuera de tu biblioteca';
  if (library?.favorites.some((fav) => fav.id === item.id)) return 'En tus favoritos';
  if (item.type === 'web') {
    const list = library?.webSources.find((source) => source.id === library.activeWebSourceId)?.name;
    return list ? `De tu lista ${list}` : 'De tu lista';
  }
  return 'En tus recientes';
}

export function ChannelCenter({ hash, active }: { hash: string; active: boolean }) {
  const layout = useLayout();
  const context = useChannelContext(hash);
  const { title, item, siblings, library } = context;
  const onScreen = usePlayerSelector(
    (state) => state.channel?.hash === hash && state.phase !== 'idle' && state.phase !== 'error',
  );
  const siblingsKey = siblings.map((sibling) => sibling.id).join(',');

  useEffect(() => {
    if (!active) return;
    enterChannel({ hash, title, siblings, activeListId: library?.activeWebSourceId ?? null });
    return () => leaveSession();
    // Se vuelve a entrar si cambian el canal, su nombre o sus hermanas (no por identidad).
  }, [active, hash, title, siblingsKey]);

  const count = siblings.length > 1 ? siblings.length : 0;
  return (
    <div className="mc mc--channel" data-layout={layout.kind}>
      <section className="mc-channel" aria-labelledby={`mc-canal-${hash}`}>
        <ChannelMark name={title} size={64} className="mc-channel__mark" />
        <div className="mc-channel__text">
          <p className="mc-channel__kicker">Canal</p>
          <h1 id={`mc-canal-${hash}`} className="mc-channel__title" tabIndex={-1}>
            {title}
          </h1>
          <p className="mc-channel__meta">
            {originText(item, library)}
            {count ? ` · ${count} fuentes del mismo canal` : ''}
          </p>
        </div>
        {onScreen ? null : (
          <Button
            variant="primary"
            icon="play"
            className="mc-channel__play"
            onClick={() =>
              play(
                { hash, title, kind: item?.ih ? 'infohash' : 'auto' },
                { origin: 'library', route: { vista: 'partido', id: null, canal: hash } },
              )
            }
          >
            Reproducir
          </Button>
        )}
      </section>
      {layout.asideVisible ? null : (
        <>
          <SourcesPanel
            variant={layout.kind === 'mobile' || layout.kind === 'tablet' ? 'list' : 'rack'}
            channelFallback={context.target}
            className="mc-sources"
            headerExtra={
              layout.asideAvailable ? (
                <IconButton icon="panel" label="Mostrar el panel lateral" onClick={() => layout.setAsideOpen(true)} />
              ) : null
            }
          />
          <NerdSection variant="fold" />
        </>
      )}
    </div>
  );
}
