/* HLS nativo del navegador: Safari de iPhone y iPad (el remux fMP4 del
   backend, `hls-fmp4`) y, de respaldo, Safari sin MSE con el HLS del motor.

   - En iOS ni mpegts.js (sin MSE completo) ni hls.js (ciclos de pausa con
     ManagedMediaSource) sirven (reproductor.md §1.3): el vídeo lee la URL
     que da el backend y Safari hace el resto.
   - No precarga: el remux ya esperó en el servidor a tener 2 segmentos y 6 s.
   - `error` o `ended` del vídeo con la señal viva = corte: reconexión al
     momento (index.html:5275-5281). Lo decide el orquestador, que ya escucha
     esos eventos; aquí solo se avisa de que hay metadatos. */

import { absoluteUrl, type Engine, type EngineArgs } from './types.ts';

export function createNativeEngine(args: EngineArgs): Engine {
  let destroyed = false;
  let ready = false;
  const onMeta = () => {
    if (destroyed || ready) return;
    ready = true;
    args.callbacks.onReady();
  };
  return {
    kind: 'native',
    preloads: false,
    start() {
      if (destroyed) return;
      args.video.addEventListener('loadedmetadata', onMeta);
      args.video.src = absoluteUrl(args.url);
      try {
        args.video.load();
      } catch {}
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      args.video.removeEventListener('loadedmetadata', onMeta);
    },
    liveSyncPosition: () => null,
    info: () => ({}),
  };
}
