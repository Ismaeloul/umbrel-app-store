/* Respuestas del modo demo para la agenda (inventario §3.8 y §22). Este
   fichero es diminuto a propósito: solo REGISTRA los manejadores; los datos
   (demo-data.ts) se descargan con import() la primera vez que la demo los
   pide, así que fuera de la demo no pesan nada.

   Lo importan index.tsx y column.tsx. Si otra vista pide la agenda antes que
   ellas (por ejemplo, abriendo ?vista=partido/demo-1 directamente), tiene que
   importar este fichero también: `import '../agenda/demo.ts';`. */

import { registerDemoHandlers } from '../../api/index.ts';

const load = () => import('./demo-data.ts');

registerDemoHandlers({
  footballSchedule: async () => (await load()).demoSchedule(),
  scores: async () => {
    const { demoScores } = await load();
    return {
      available: true,
      generatedAt: new Date().toISOString(),
      source: 'espn',
      attribution: 'Datos de muestra',
      leagues: 3,
      scores: demoScores(),
    };
  },
  footballPreheat: async ({ params }) => ({
    preheat: (await load()).demoPreheat(params.matchId),
  }),
});
