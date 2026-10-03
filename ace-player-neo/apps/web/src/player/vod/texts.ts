/* Textos del reproductor de películas y episodios (docs/vod.md §12.7, §12.9
   y la tabla de §13). Lo que va en la línea de estado bajo el vídeo y en el
   panel del vídeo, en castellano llano. */

import { errorMessage, isAnyErrorCode } from '@ace/shared';
import { clockText } from './timeline.ts';

export const VOD_TEXT = {
  preparingMovie: 'Preparando la película…',
  preparingEpisode: 'Preparando el episodio…',
  resumed: (at: number) => `Reanudado en ${clockText(at)}`,
  fromStart: 'Empezar desde el principio',
  seeking: 'Buscando…',
  loading: 'Cargando…',
  paused: 'En pausa',
  reconnecting: (at: number) => `Se ha cortado. Seguimos desde ${clockText(at)}.`,
  busyWaiting: 'El proveedor tarda en liberar la conexión…',
  codecHevc: 'Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el iPhone.',
  codecOther: 'Este navegador no puede reproducir el vídeo de este título.',
  ended: 'Terminada',
  replay: 'Ver de nuevo',
  backToTitle: 'Volver a la ficha',
  nextEpisode: 'Siguiente episodio',
  watchNow: 'Ver ahora',
  watchCredits: 'Ver créditos',
  stillWatching: (series: string) => `¿Sigues viendo «${series}»?`,
  keepWatching: 'Seguir viendo',
  leave: 'Salir',
  stillWatchingIdle:
    'En pausa para no tener ocupada tu IPTV. Pulsa Reintentar para seguir donde ibas.',
  demo: 'reproducción simulada — en el Umbrel verías la película',
} as const;

/** Por qué no se puede reproducir (`vod_unsupported`, `data.reason`), §13. */
const UNSUPPORTED: Record<string, string> = {
  sin_saltos: 'Tu proveedor no deja saltar dentro del vídeo; no se puede reproducir aquí.',
  indice: 'Este archivo no tiene índice; todavía no se puede reproducir.',
  video: 'El vídeo usa un formato antiguo que no se puede reproducir.',
  formato: 'El vídeo usa un formato antiguo que no se puede reproducir.',
  hevc: VOD_TEXT.codecHevc,
};

/** El texto de §13 para un `vod_*` (y su `data.reason`). */
export function vodErrorText(code: string, reason?: unknown): string {
  if (code === 'vod_unsupported' && typeof reason === 'string' && UNSUPPORTED[reason])
    return UNSUPPORTED[reason];
  if (code === 'vod_busy')
    return 'Tu cuenta IPTV está en uso en otro aparato. Ciérralo y pulsa Reintentar.';
  if (code === 'vod_dropped') return 'El proveedor ha cortado el vídeo.';
  return isAnyErrorCode(code) ? errorMessage(code) : 'No se ha podido abrir el vídeo.';
}

/**
 * ¿Merece la pena «Reintentar»? (§13): con el formato o el códec no, se
 * vuelve a la ficha; con la cuenta, a Ajustes.
 */
export function vodErrorAction(code: string): 'retry' | 'title' | 'settings' {
  if (code === 'vod_unsupported' || code === 'vod_disk_full' || code === 'vod_codec')
    return 'title';
  if (code === 'vod_account') return 'settings';
  return 'retry';
}
