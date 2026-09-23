/* Respuestas del modo demo para el centro de partido y el selector de
   fuentes: resolución, comprobador simulado, vínculos y reportes. Solo
   REGISTRA los manejadores; los datos (demo-data.ts) se descargan con
   import() la primera vez que la demo los pide, así que fuera de la demo no
   pesan nada. Lo importa el centro de partido (`import '../sources/demo.ts'`);
   `package.json` declara `src/**\/demo.ts` con efectos para que el build no lo
   quite. «Es el canal correcto» y los resultados usan los ejemplos de
   packages/shared (los contesta src/api/demo). */

import { registerDemoHandlers } from '../../api/index.ts';

const load = () => import('./demo-data.ts');

registerDemoHandlers({
  footballResolve: async ({ query }) => (await load()).demoResolve(query ?? {}),
  footballScan: async ({ params }) => (await load()).demoScan(params.id),
  footballBind: async ({ body }) => (await load()).demoBind(body),
  sourcesReport: async ({ body }) => (await load()).demoReport(body),
});
