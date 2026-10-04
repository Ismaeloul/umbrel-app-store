/* Reproducir una película o un episodio desde Películas y series (docs/vod.md
   §12.7): la ficha, «Seguir viendo» y los episodios llaman aquí. Pide al
   reproductor (player/api.ts, diminuto: no arrastra hls.js) que lo abra y
   lleva al escenario (`?vista=sala/<id>`, §12.8), como un partido.

   `canPlayHevc()` es la misma prueba que hace el reproductor (§12.7) y aquí
   solo sirve para no ofrecer un «Reproducir» que seguro falla (§12.6). */

import type { Navigate } from '../../app/router.tsx';
import { playVod as playerPlayVod, vodRoute, type VodPlayRequest } from '../../player/api.ts';

export type { VodPlayRequest } from '../../player/api.ts';

/** Abre la película o el episodio en el reproductor y, con `navigate`, va a su escenario. */
export function playVod(request: VodPlayRequest, navigate?: Navigate): void {
  if (!playerPlayVod(request)) return;
  navigate?.(vodRoute(request.id.toLowerCase()));
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
