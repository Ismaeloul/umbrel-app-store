/* Modo de reproducción (inventario-front §8.9): Baja latencia, Equilibrado o
   Estable. Es una comodidad POR VISOR guardada en localStorage['aceneo-pb'],
   como en la 0.6.59. Quien la guarda y la aplica es el reproductor
   (src/player/api.ts: `setPlaybackMode` avisa «Modo «…» activado» y, si algo
   suena, se reengancha con el perfil nuevo); Ajustes solo la elige. Aquí van
   el orden en pantalla y la explicación de siempre. */

import type { PlaybackMode } from '@ace/shared';

export { setPlaybackMode, usePlaybackMode } from '../../player/api.ts';

/** Orden en pantalla: de menos a más colchón. */
export const PLAYBACK_MODE_ORDER: readonly PlaybackMode[] = ['low', 'balanced', 'stable'];

export const PLAYBACK_MODE_HELP =
  '«Equilibrado» mantiene un colchón moderado y es el modo recomendado. «Estable» prioriza la continuidad en canales con pocos pares. «Baja latencia» se acerca más al directo y asume mayor riesgo de cortes. El botón LIVE siempre permite volver al borde manualmente.';
