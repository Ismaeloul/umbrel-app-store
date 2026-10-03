/* Respuestas del modo demo para Películas y series (docs/vod.md §12.11).
   Diminuto a propósito: solo REGISTRA los manejadores; el catálogo de
   muestra (demo-data.ts) se descarga con import() la primera vez que la demo
   lo pide. Lo importan index.tsx y aside.tsx (`import './demo.ts';`). Se ve
   con `?demo=1&flag=cine`. */

import { ApiError, registerDemoHandlers } from '../../api/index.ts';

const load = () => import('./demo-data.ts');
/** Un poco de espera, como el servidor de verdad: así se ven los esqueletos. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

registerDemoHandlers({
  vodHome: async () => {
    const { demoVodHome } = await load();
    await wait(120);
    return demoVodHome();
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
});
