/* «Ahora / después» de la tabla de Canales (rediseño de escritorio,
   sección 3; docs/iptv.md §20.6): GET /api/v1/iptv/guide/now con los ids
   de las filas, de 100 en 100. Los ids IPTV van por su guía; los AceStream
   de tu biblioteca, por el canal de tu IPTV que es por su nombre (lo casa
   el servidor).

   - Una consulta por trozo de 100 ids (`useQueries`): al desplazarse por
     «Todos» solo se piden los trozos nuevos.
   - Lo que se emite cambia con el reloj: se vuelve a pedir cada minuto
     mientras la vista está a la vista (con Activity oculta, nada).
   - Sin guía (o sin IPTV activa) el servidor dice `available: false`: la
     fila enseña «Sin guía», no es un error. */

import {
  demoGuideChannelId,
  demoGuideNow,
  IPTV_GUIDE_API,
  type IptvGuideNowItem,
  type IptvGuideNowResponse,
  type IptvGuideProgramme,
} from '@ace/shared';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, apiQuery, isDemo, registerDemoHandler, routeUrl } from '../../api/index.ts';

const REFRESH_MS = 60_000;

/** Ids en trozos de `size` (en el orden de las filas, sin repetir). */
export function chunkIds(ids: readonly string[], size = IPTV_GUIDE_API.nowIdsMax): string[][] {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let at = 0; at < unique.length; at += size) out.push(unique.slice(at, at + size));
  return out;
}

/** Lo que dice la guía de un canal, con su logo (si la guía lo tiene). */
export interface GuideNow extends IptvGuideNowItem {
  /** El logo por el proxy propio (`iptvGuideArt`); null sin logo o en la demo. */
  logoSrc: string | null;
}

/** Lo que dice la guía de cada id (los que no tienen guía no están). */
export function useGuideNow(
  ids: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, GuideNow> {
  const chunks = useMemo(() => chunkIds(ids), [ids]);
  return useQueries({
    queries: chunks.map((chunk) => ({
      ...apiQuery('iptvGuideNow', { query: { ids: chunk.join(',') } }),
      enabled,
      staleTime: REFRESH_MS,
      refetchInterval: enabled ? REFRESH_MS : (false as const),
      retry: false,
    })),
    combine: byId,
  });
}

/* Fuera del componente: con la misma función, TanStack solo la vuelve a
   llamar (y da un mapa nuevo) si cambia alguna respuesta. */
function byId(
  results: ReadonlyArray<{ data?: IptvGuideNowResponse | undefined }>,
): ReadonlyMap<string, GuideNow> {
  const map = new Map<string, GuideNow>();
  const demo = isDemo();
  for (const { data } of results) {
    if (!data?.available) continue;
    for (const item of data.items) {
      if (!item.now && !item.next) continue;
      const logoSrc =
        item.logo && item.guide !== null && !demo
          ? routeUrl('iptvGuideArt', { ref: `c${item.guide}` }, { v: data.version })
          : null;
      map.set(item.id, { ...item, logoSrc });
    }
  }
  return map;
}

/** Cuánto lleva emitido un programa (0…1) a la hora `now`. */
export function programmeProgress(
  programme: Pick<IptvGuideProgramme, 'start' | 'end'>,
  now: number,
) {
  const span = programme.end - programme.start;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (now - programme.start) / span));
}

/** «20:25» en hora de Madrid (la de la agenda y la guía). */
export function clockText(epoch: number): string {
  try {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(epoch));
  } catch {
    const date = new Date(epoch);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

// ---- Demo --------------------------------------------------------------------------------

/* Programas de relleno para los canales IPTV de la demo que no están en la
   guía de ejemplo (la pestaña IPTV de la demo tiene 812, la guía 55). */
const DEMO_SHOWS = [
  'Informativo',
  'Fútbol internacional',
  'Resúmenes',
  'Cine: El infiltrado',
  'Documental',
  'Magacín de tarde',
  'Previa',
  'Análisis',
  'Serie: Temporada 2',
  'Música en directo',
];

function seedOf(id: string): number {
  return Number.parseInt(id.slice(0, 6), 16) || 1;
}

export function demoFill(id: string, now: number): Pick<IptvGuideNowItem, 'now' | 'next'> {
  const seed = seedOf(id);
  const slot = 30 * 60_000;
  const slots = 1 + (seed % 4);
  const length = slots * slot;
  /* Empieza en una media hora de las `slots` últimas: así `now` siempre cae
     dentro (antes podía salir un programa ya acabado, con la barra al 100 %). */
  const start = (Math.floor(now / slot) - (Math.floor(seed / 4) % slots)) * slot;
  const programme = (at: number, span: number, index: number): IptvGuideProgramme => ({
    id: `${1 + (seed % 9000)}.${Math.floor(at / 60_000)}`,
    start: at,
    end: at + span,
    title: DEMO_SHOWS[(seed + index) % DEMO_SHOWS.length] ?? 'Programa',
    flags: 0,
  });
  return { now: programme(start, length, 0), next: programme(start + length, slot * 2, 1) };
}

let demoRegistered = false;

/* Los canales AceStream de la biblioteca de la demo, a su canal de la guía de
   ejemplo por el nombre (como hace el servidor): «DAZN 1» o «M+ LaLiga» (TV). */
async function demoLinks(ids: readonly string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  try {
    const library = await api('libraryGet', {});
    const wanted = new Set(ids);
    for (const item of [...library.favorites, ...library.history, ...library.web]) {
      if (!wanted.has(item.id) || links.has(item.id) || !item.title) continue;
      const known = demoGuideNow(
        { ids: [item.title, `${item.title} TV`].map(demoGuideChannelId).join(',') },
        Date.now(),
      ).items.find((guide) => guide.guide !== null);
      if (known) links.set(item.id, known.id);
    }
  } catch {
    /* Sin biblioteca, relleno. */
  }
  return links;
}

/** En la demo, la guía de ejemplo de @ace/shared y relleno para los demás canales. */
export function registerGuideNowDemo(): void {
  if (demoRegistered) return;
  demoRegistered = true;
  registerDemoHandler('iptvGuideNow', async ({ query }) => {
    const now = Date.now();
    const ids = [...new Set(String(query?.ids ?? '').split(','))];
    const links = await demoLinks(ids);
    const response = demoGuideNow({ ids: ids.map((id) => links.get(id) ?? id).join(',') }, now);
    const byId = new Map(response.items.map((item) => [item.id, item] as const));
    return {
      ...response,
      items: ids.flatMap((id) => {
        const item = byId.get(links.get(id) ?? id);
        if (!item) return [];
        return [item.now || item.next ? { ...item, id } : { ...item, id, ...demoFill(id, now) }];
      }),
    };
  });
}
