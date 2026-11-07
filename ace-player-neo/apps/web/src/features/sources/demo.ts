/* Respuestas del modo demo para el centro de partido y el selector de
   fuentes: resolución, comprobador simulado, vínculos y reportes. Solo
   REGISTRA los manejadores; los datos (demo-data.ts) se descargan con
   import() la primera vez que la demo los pide, así que fuera de la demo no
   pesan nada. Lo importa el centro de partido (`import '../sources/demo.ts'`);
   `package.json` declara `src/**\/demo.ts` con efectos para que el build no lo
   quite. «Es el canal correcto» y los resultados usan los ejemplos de
   packages/shared (los contesta src/api/demo).

   También las fuentes de la sala en directo de «Ver juntos» (`partyLiveSources`,
   directo §14): la demo no tiene salas, pero la revisión visual abre una de
   mentira (scripts/revision-visual.mjs, vista `juntos-directo`) y su pestaña
   Fuentes pide esta ruta. Sale la resolución del partido de ejemplo `demo-1`
   (con «Buscar más fuentes», más) y el comprobador simulado. Lo importan
   también LivePanels.tsx y LiveMatches.tsx. */

import type { PartyLiveSourcesResponse, ResolutionCandidate } from '@ace/shared';
import { registerDemoHandlers } from '../../api/index.ts';

const load = () => import('./demo-data.ts');

/** Las fuentes de cada trabajo del comprobador de la sala: el sondeo (`job`) solo trae su estado. */
const roomCandidates = new Map<string, ResolutionCandidate[]>();

async function demoRoomSources(query: {
  job?: string | undefined;
}): Promise<PartyLiveSourcesResponse> {
  const data = await load();
  if (query.job) {
    return { candidates: roomCandidates.get(query.job) ?? [], scan: data.demoScan(query.job) };
  }
  const resolution = data.demoResolve({ match: 'demo-1', channel: ['DAZN 1'], research: '1' });
  const scan = resolution.scan ? data.demoScan(resolution.scan.id) : null;
  if (scan) roomCandidates.set(scan.id, resolution.candidates);
  return { candidates: resolution.candidates, scan };
}

registerDemoHandlers({
  footballResolve: async ({ query }) => (await load()).demoResolve(query ?? {}),
  footballScan: async ({ params }) => (await load()).demoScan(params.id),
  footballBind: async ({ body }) => (await load()).demoBind(body),
  sourcesReport: async ({ body }) => (await load()).demoReport(body),
  partyLiveSources: ({ query }) => demoRoomSources(query),
});
