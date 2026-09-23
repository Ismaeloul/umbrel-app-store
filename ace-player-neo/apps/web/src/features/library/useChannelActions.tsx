/* Acciones sobre canales compartidas por la biblioteca, su ficha lateral y el
   buscador: reproducir, favorito (con hoja para el nombre al añadir y
   deshacer al quitar), renombrar y eliminar con deshacer. Devuelve también
   las hojas, que cada vista monta una vez. */

import type { Item, LibraryCollection, LibraryView } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { Sheet, type MenuItem } from '../../ui/index.ts';
import { channelMenuItems } from './actions.ts';
import { removeWithUndo, renameChannel, saveFavorite } from './data.ts';
import { playChannel, type PlayOrigin } from './play.ts';
import {
  RenameFooter,
  RenameSheetBody,
  SaveFavoriteBody,
  SaveFavoriteFooter,
  type FavoriteTarget,
} from './sheets.tsx';

export interface ActionableChannel {
  id: string;
  title: string;
  category: string;
  ih: boolean;
  alias?: string | undefined;
}

interface RenameState {
  collection: LibraryCollection;
  item: Item;
}

export interface ChannelActions {
  library: LibraryView | undefined;
  favoriteIds: ReadonlySet<string>;
  play(channel: ActionableChannel, origin?: PlayOrigin): void;
  toggleFavorite(channel: ActionableChannel): void;
  rename(collection: LibraryCollection, item: Item): void;
  remove(collection: LibraryCollection, item: Item): void;
  menuFor(
    channel: ActionableChannel,
    collection: LibraryCollection | 'search',
    options?: { withPlay?: boolean },
  ): MenuItem[];
  sheets: ReactNode;
}

export function useChannelActions({
  onFavoriteSaved,
}: { onFavoriteSaved?(): void } = {}): ChannelActions {
  const client = useQueryClient();
  const navigate = useNavigate();
  const library = useApiQuery('libraryGet');
  const data = library.data;
  const [renameTarget, setRenameTarget] = useState<RenameState | null>(null);
  const [favoriteTarget, setFavoriteTarget] = useState<FavoriteTarget | null>(null);
  const [busy, setBusy] = useState(false);
  // Lo último abierto, para que la hoja no se quede vacía durante su salida.
  const lastRename = useRef<RenameState | null>(null);
  const lastFavorite = useRef<FavoriteTarget | null>(null);
  if (renameTarget) lastRename.current = renameTarget;
  if (favoriteTarget) lastFavorite.current = favoriteTarget;
  const renameForm = useId();
  const favoriteForm = useId();

  const favoriteIds = useMemo(
    () => new Set((data?.favorites ?? []).map((item) => item.id)),
    [data?.favorites],
  );

  const play = (channel: ActionableChannel, origin: PlayOrigin = 'biblioteca') =>
    playChannel(navigate, {
      hash: channel.id,
      title: channel.title,
      ih: channel.ih,
      category: channel.category,
      record: true,
      origin,
    });

  const toggleFavorite = (channel: ActionableChannel) => {
    const existing = data?.favorites.find((item) => item.id === channel.id);
    if (existing) {
      removeWithUndo({ client, kind: 'unfavorite', collection: 'favorites', item: existing });
      return;
    }
    setFavoriteTarget({
      id: channel.id,
      title: channel.title,
      category: channel.category,
      ih: channel.ih,
    });
  };

  const rename = (collection: LibraryCollection, item: Item) =>
    setRenameTarget({ collection, item });

  const remove = (collection: LibraryCollection, item: Item) =>
    removeWithUndo({
      client,
      kind: collection === 'favorites' ? 'unfavorite' : 'delete',
      collection,
      item,
      ...(collection === 'web' && data?.activeWebSourceId
        ? { sourceId: data.activeWebSourceId }
        : {}),
    });

  const menuFor: ChannelActions['menuFor'] = (channel, collection, options = {}) => {
    const libraryItem =
      collection === 'search'
        ? null
        : ((collection === 'favorites'
            ? data?.favorites
            : collection === 'history'
              ? data?.history
              : data?.web
          )?.find((item) => item.id === channel.id) ?? null);
    return channelMenuItems({
      hash: channel.id,
      title: channel.title,
      ih: channel.ih,
      isFavorite: favoriteIds.has(channel.id),
      onToggleFavorite: () => toggleFavorite(channel),
      ...(options.withPlay
        ? { onPlay: () => play(channel, collection === 'search' ? 'buscar' : 'biblioteca') }
        : {}),
      ...(libraryItem && collection !== 'search'
        ? { onRename: () => rename(collection, libraryItem) }
        : {}),
      // En Favoritos, borrar ES quitar el favorito (ya está arriba, con deshacer).
      ...(libraryItem && (collection === 'history' || collection === 'web')
        ? {
            onDelete: () => remove(collection, libraryItem),
            deleteLabel: collection === 'history' ? 'Quitar de recientes' : 'Eliminar de la lista',
          }
        : {}),
    });
  };

  const renameShown = renameTarget ?? lastRename.current;
  const favoriteShown = favoriteTarget ?? lastFavorite.current;

  const sheets = (
    <>
      <Sheet
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Renombrar canal"
        size="sm"
        footer={<RenameFooter formId={renameForm} busy={busy} />}
      >
        {renameShown ? (
          <RenameSheetBody
            key={`${renameShown.collection}:${renameShown.item.id}`}
            formId={renameForm}
            target={renameShown.item}
            onSave={(title) => {
              const target = renameTarget;
              if (!target || !title.trim()) return;
              setBusy(true);
              setRenameTarget(null);
              void renameChannel(
                client,
                target.collection,
                target.item,
                title,
                data?.activeWebSourceId,
              ).finally(() => setBusy(false));
            }}
          />
        ) : null}
      </Sheet>
      <Sheet
        open={favoriteTarget !== null}
        onClose={() => setFavoriteTarget(null)}
        title="Guardar favorito"
        size="sm"
        footer={<SaveFavoriteFooter formId={favoriteForm} busy={busy} />}
      >
        {favoriteShown ? (
          <SaveFavoriteBody
            key={favoriteShown.id}
            formId={favoriteForm}
            target={favoriteShown}
            onSave={(title) => {
              const target = favoriteTarget;
              if (!target) return;
              setBusy(true);
              setFavoriteTarget(null);
              void saveFavorite(client, { ...target, title })
                .then((ok) => {
                  if (ok) onFavoriteSaved?.();
                })
                .finally(() => setBusy(false));
            }}
          />
        ) : null}
      </Sheet>
    </>
  );

  return { library: data, favoriteIds, play, toggleFavorite, rename, remove, menuFor, sheets };
}
