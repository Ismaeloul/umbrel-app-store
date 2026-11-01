/* El nombre del canal que suena, para pintarlo (mini de la isla, píldora de
   la fuente, titular del vídeo).

   Al abrir un canal por enlace (`?vista=partido/canal/<hash>`) antes de que
   llegue la biblioteca, el reproductor arranca con el nombre provisional
   «Canal a1b2c3d4» (player/api.ts) y no lo cambia aunque luego se sepa que
   es «DAZN 1». Aquí solo se corrige lo que se pinta: si el título es ese
   provisional y el canal está en tu biblioteca, se usa su nombre. Sin nombre
   conocido se queda el del hash. No toca el estado del reproductor. */

import { useApiQuery } from '../api/query.ts';
import { findKnownItem } from '../features/library/model.ts';
import type { PlayerState } from './api.ts';

type Channel = PlayerState['channel'];
type Library = Parameters<typeof findKnownItem>[0];

/** ¿Es el nombre provisional que pone el reproductor a un hash sin título? */
export function isPlaceholderTitle(title: string, hash: string): boolean {
  return title === `Canal ${hash.slice(0, 8)}`;
}

/** El título que se pinta: el de la biblioteca si el del reproductor es el provisional. */
export function displayChannelTitle(channel: Channel, library: Library): string | null {
  if (!channel) return null;
  if (!isPlaceholderTitle(channel.title, channel.hash)) return channel.title;
  return findKnownItem(library, channel.hash)?.title.trim() || channel.title;
}

/** `displayChannelTitle` con la biblioteca que ya hay en la caché (no pide nada). */
export function useChannelTitle(channel: Channel): string | null {
  const library = useApiQuery('libraryGet', undefined, { enabled: false }).data;
  return displayChannelTitle(channel, library);
}
