/* Respuestas del modo demo para Películas y series (docs/vod.md §12.11).
   Diminuto a propósito: solo REGISTRA los manejadores; el catálogo de
   muestra (demo-data.ts) se descarga con import() la primera vez que la demo
   lo pide. Lo importan index.tsx y aside.tsx (`import './demo.ts';`). Se ve
   con `?demo=1&flag=cine`. Los idiomas (§4.10) se guardan en el navegador:
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
});
