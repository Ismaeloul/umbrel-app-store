/* Reproducir una película o un episodio desde Películas y series.

   Hasta VOD-6 (docs/vod.md §16: el reproductor en modo VOD, `playVod()` de
   player/api.ts, la vista `sala` y el progreso al reproducir) esto es un
   aviso «Próximamente»: la ficha, «Seguir viendo» y los episodios ya llaman
   aquí, así que el reproductor solo tendrá que cambiar este fichero.

   `canPlayHevc()` es la misma prueba que hará el reproductor (§12.7) y aquí
   solo sirve para no ofrecer un «Reproducir» que seguro falla (§12.6). */

import { notify } from '../../notices/index.ts';
import { CINE_TEXT } from './texts.ts';

export interface VodPlayRequest {
  /** Película o episodio (id sellado). */
  id: string;
  kind: 'movie' | 'episode';
  title: string;
  subtitle?: string | null;
  seriesId?: string | null;
  /** Segundos; ausente = el progreso guardado (0 = desde el principio). */
  startS?: number;
}

/** Hoy: el aviso de que llega en la siguiente versión. */
export function playVod(_request: VodPlayRequest): void {
  notify(CINE_TEXT.comingSoon, { tone: 'info', icon: 'info' });
}

let hevc: boolean | null = null;

/** ¿Decodifica este navegador HEVC en fMP4? (MSE; en Safari, `canPlayType`). */
export function canPlayHevc(): boolean {
  if (hevc !== null) return hevc;
  const type = 'video/mp4; codecs="hvc1.1.6.L120.90"';
  try {
    const mse = (globalThis as { MediaSource?: { isTypeSupported?(t: string): boolean } })
      .MediaSource;
    if (mse?.isTypeSupported?.(type)) return (hevc = true);
    const video = globalThis.document?.createElement('video');
    hevc = Boolean(video?.canPlayType?.(type));
  } catch {
    hevc = false;
  }
  return hevc;
}

/** Solo para los tests. */
export function setHevcSupport(value: boolean | null): void {
  hevc = value;
}
