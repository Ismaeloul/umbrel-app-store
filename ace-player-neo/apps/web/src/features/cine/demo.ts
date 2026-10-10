/* Respuestas del modo demo para Películas y series (docs/vod.md §12.11).
   Diminuto a propósito: solo REGISTRA los manejadores; el catálogo de
   muestra (demo-data.ts) se descarga con import() la primera vez que la demo
   lo pide. Lo importan index.tsx y aside.tsx (`import './demo.ts';`). Se ve
   con `?demo=1`. Los idiomas (§4.10) se guardan en el navegador:
   la primera vez sale el selector. */

import { ApiError, registerDemoHandlers } from '../../api/index.ts';

const load = () => import('./demo-data.ts');
/** Un poco de espera, como el servidor de verdad: así se ven los esqueletos. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

registerDemoHandlers({
  vodHome: async ({ query }) => {
    const { demoVodHome } = await load();
    await wait(120);
    return demoVodHome(query);
  },
  vodBrowse: async ({ query }) => {
    const { demoVodBrowse } = await load();
    await wait(90);
    return demoVodBrowse(query ?? {});
  },
  vodTitle: async ({ params }) => {
    const { demoVodTitle } = await load();
    await wait(150);
    const title = demoVodTitle(params.id);
    if (!title) throw new ApiError({ code: 'vod_not_found', status: 404, route: 'vodTitle' });
    return title;
  },
  /* Reproducir en la demo (§12.11): la concesión de prueba con la duración del
     título; el reproductor lleva un reloj de mentira (no hay vídeo). */
  vodStream: async ({ params, query }) => {
    const { demoVodStream } = await load();
    await wait(400);
    const number = (value: unknown) =>
      value === undefined || value === null || value === '' || !Number.isFinite(Number(value))
        ? undefined
        : Number(value);
    const grant = demoVodStream(params.id, {
      start: number(query?.start),
      audio: number(query?.audio),
    });
    if (!grant) throw new ApiError({ code: 'vod_not_found', status: 404, route: 'vodStream' });
    return grant;
  },
  vodLanguagesGet: async () => {
    const { demoLanguages } = await load();
    await wait(40);
    return demoLanguages();
  },
  vodLanguagesUpdate: async ({ body }) => {
    const { demoSaveLanguages } = await load();
    await wait(120);
    return demoSaveLanguages(body);
  },
  /* «Mi lista» (0.9.1): empieza con un par de títulos; los cambios, en memoria. */
  vodListGet: async () => {
    const { demoVodList } = await load();
    await wait(60);
    return demoVodList();
  },
  vodListAdd: async ({ params }) => {
    const { demoListAdd } = await load();
    await wait(150);
    const list = demoListAdd(params.id);
    if (!list) throw new ApiError({ code: 'vod_not_found', status: 404, route: 'vodListAdd' });
    return list;
  },
  vodListRemove: async ({ params }) => {
    const { demoListRemove } = await load();
    await wait(150);
    return demoListRemove(params.id);
  },
});
