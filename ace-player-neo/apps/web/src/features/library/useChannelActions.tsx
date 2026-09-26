/* Acciones sobre canales compartidas por la biblioteca, su ficha lateral y el
   buscador: reproducir, favorito (con hoja para el nombre al añadir y
   deshacer al quitar), renombrar y eliminar con deshacer. Devuelve también
   las hojas, que cada vista monta una vez.

   Canales de tu IPTV (docs/iptv.md §14.4 a §14.6): una fila puede traer el
   canal IPTV que es (`iptv`); si es un id IPTV (de «En tu IPTV», o un favorito
   o reciente que lo es, según `iptvIds`), se guarda en favoritos con
   `{ category: 'IPTV', alias: nombre limpio, ih: false }` y su menú no tiene
   las acciones del hash. */

import type { Item, LibraryCollection, LibraryView } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { haptic } from '../../lib/haptics.ts';
import { Sheet, type MenuItem } from '../../ui/index.ts';
import { channelMenuItems } from './actions.ts';
import {
  cancelRemoval,
  isPendingRemoval,
  removeWithUndo,
  renameChannel,
  saveFavorite,
  usePendingKeys,
} from './data.ts';
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
  /** El canal IPTV que es esta fila (igual a `id` si es un canal de «En tu IPTV»). */
  iptv?: string | null | undefined;
}

interface RenameState {
  collection: LibraryCollection;
  item: Item;
}

export interface ChannelActions {
  library: LibraryView | undefined;
  favoriteIds: ReadonlySet<string>;
  /** `ace`: las entradas de AceStream de tu biblioteca que son ese canal IPTV (respaldo, §19). */
  play(
    channel: ActionableChannel,
    origin?: PlayOrigin,
    extra?: { readonly ace?: readonly string[] },
  ): void;
  /** ¿Es un canal de tu IPTV (id sintético)? Sin hash de AceStream que copiar. */
  isIptvId(id: string): boolean;
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

  // Un favorito quitado que espera los 6 s del «Deshacer» ya no cuenta: la estrella se vacía al momento.
  const pending = usePendingKeys();
  const favoriteIds = useMemo(
    () =>
      new Set(
        (data?.favorites ?? [])
          .filter((item) => !isPendingRemoval(pending, 'favorites', item.id))
          .map((item) => item.id),
      ),
    [data?.favorites, pending],
  );

  const isIptvId = (id: string): boolean => Object.hasOwn(data?.iptvIds ?? {}, id);
  const iptvOf = (channel: ActionableChannel): string | null =>
    channel.iptv ?? (isIptvId(channel.id) ? channel.id : null);

  const play = (
    channel: ActionableChannel,
    origin: PlayOrigin = 'biblioteca',
    extra: { readonly ace?: readonly string[] } = {},
  ) => {
    const iptv = iptvOf(channel);
    playChannel(navigate, {
      hash: channel.id,
      title: channel.title,
      ih: iptv === channel.id ? false : channel.ih,
      category: channel.category,
      record: true,
      origin,
      ...(iptv ? { iptv } : {}),
      // Un id IPTV renombrado se busca por su nombre en la IPTV (§14.6).
      ...(iptv === channel.id && channel.alias ? { alias: channel.alias } : {}),
      ...(iptv && extra.ace?.length ? { ace: extra.ace } : {}),
    });
  };

  const toggleFavorite = (channel: ActionableChannel) => {
    const existing = data?.favorites.find((item) => item.id === channel.id);
    if (existing) {
      // Segundo toque durante el «Deshacer»: vuelve a ser favorito, como si se deshiciera.
      if (cancelRemoval('favorites', existing.id)) return;
      removeWithUndo({ client, kind: 'unfavorite', collection: 'favorites', item: existing });
      return;
    }
    // Un canal de tu IPTV (de «En tu IPTV», o un reciente que es un id IPTV):
    // su nombre en la IPTV queda como alias (§14.6), también si ya lo renombraste.
    if (iptvOf(channel) === channel.id) {
      setFavoriteTarget({
        id: channel.id,
        title: channel.title,
        category: 'IPTV',
        ih: false,
        alias: channel.alias || channel.title,
      });
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
      iptv: iptvOf(channel) === channel.id,
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
                  if (!ok) return;
                  // Favorito guardado: toque de éxito (HAPTIC_MAP).
                  haptic('success');
                  onFavoriteSaved?.();
                })
                .finally(() => setBusy(false));
            }}
          />
        ) : null}
      </Sheet>
    </>
  );

  return {
    library: data,
    favoriteIds,
    play,
    isIptvId,
    toggleFavorite,
    rename,
    remove,
    menuFor,
    sheets,
  };
}
