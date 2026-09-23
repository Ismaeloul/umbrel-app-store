/* Acciones de una tarjeta de canal: el mismo menú en el botón «Más», el clic
   derecho y la pulsación larga (menús contextuales del prompt).

   - Favorito (conmuta), «Abrir en…» (D7: la app de AceStream con el enlace
     `acestream://` y la URL del stream para VLC) y las tres copias de siempre
     (enlace, hash y nombre, todas con respaldo para HTTP).
   - La URL del stream es la misma que ofrece el reproductor
     (`externalStreamUrl` de src/player/clipboard.ts, un módulo diminuto que no
     arrastra los motores): `/ace/getstream?id|infohash=<hash>` por el proxy de
     la app. Así los dos menús copian exactamente lo mismo y funciona con
     cualquier canal, no solo con el que suena.
   - Renombrar y Eliminar no salen en los resultados del buscador
     (index.html:5501-5506). */

import type { MenuItem } from '../../ui/index.ts';
import { externalStreamUrl } from '../../player/clipboard.ts';
import {
  copyAcestreamLink,
  copyChannelName,
  copyHash,
  copyStreamUrl,
  openInAceStream,
} from './clipboard.ts';

export interface ChannelMenuOptions {
  hash: string;
  title: string;
  /** true si es un infohash (resultado del buscador): la URL del stream lo pide así. */
  ih?: boolean;
  isFavorite: boolean;
  onToggleFavorite(): void;
  onPlay?(): void;
  onRename?(): void;
  onDelete?(): void;
  /** Etiqueta de «Eliminar» (en Recientes, «Quitar de recientes»). */
  deleteLabel?: string;
}

export function channelMenuItems({
  hash,
  title,
  ih = false,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onRename,
  onDelete,
  deleteLabel = 'Eliminar',
}: ChannelMenuOptions): MenuItem[] {
  const items: MenuItem[] = [];
  if (onPlay) items.push({ id: 'ver', label: 'Ver canal', icon: 'play', onSelect: onPlay });
  items.push({
    id: 'favorito',
    label: isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
    // Estrella llena si ya es favorito (lo mismo que dibuja el botón de la tarjeta).
    icon: isFavorite ? 'star-f' : 'star',
    onSelect: onToggleFavorite,
  });
  items.push({
    id: 'abrir-acestream',
    label: 'Abrir en la app de AceStream',
    icon: 'externo',
    separated: true,
    onSelect: () => openInAceStream(hash),
  });
  items.push(
    {
      id: 'copiar-stream',
      label: 'Copiar URL del stream (VLC)',
      icon: 'externo',
      // Se calcula al pulsar: el origen de la página es el de ese momento.
      onSelect: () => void copyStreamUrl(externalStreamUrl(hash, ih ? 'infohash' : 'auto')),
    },
    {
      id: 'copiar-enlace',
      label: 'Copiar enlace acestream://',
      icon: 'link',
      onSelect: () => void copyAcestreamLink(hash),
    },
    { id: 'copiar-hash', label: 'Copiar hash', icon: 'hash', onSelect: () => void copyHash(hash) },
    {
      id: 'copiar-nombre',
      label: 'Copiar nombre',
      icon: 'copy',
      onSelect: () => void copyChannelName(title),
    },
  );
  if (onRename)
    items.push({
      id: 'renombrar',
      label: 'Renombrar',
      icon: 'pencil',
      separated: true,
      onSelect: onRename,
    });
  if (onDelete)
    items.push({
      id: 'eliminar',
      label: deleteLabel,
      icon: 'trash',
      danger: true,
      separated: !onRename,
      onSelect: onDelete,
    });
  return items;
}
