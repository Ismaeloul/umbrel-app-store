/* «Ahora / después» de los canales de tu IPTV en la tabla de Canales
   (rediseño de escritorio, pantalla 4; docs/iptv.md §20.6): GET
   /api/v1/iptv/guide/now con los ids IPTV de las filas, de 100 en 100.

   - Una consulta por trozo de 100 ids (`useQueries`): al desplazarse por
     «Todos» solo se piden los trozos nuevos.
   - Lo que se emite cambia con el reloj: se vuelve a pedir cada minuto
     mientras la vista está a la vista (con Activity oculta, nada).
   - Sin guía (o sin IPTV activa) el servidor dice `available: false`: la
     fila enseña «Sin guía», no es un error. */

import {
  demoGuideNow,
  IPTV_GUIDE_API,
  type IptvGuideNowItem,
  type IptvGuideNowResponse,
  type IptvGuideProgramme,
} from '@ace/shared';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiQuery, registerDemoHandler } from '../../api/index.ts';

const REFRESH_MS = 60_000;

/** Ids en trozos de `size` (en el orden de las filas, sin repetir). */
export function chunkIds(ids: readonly string[], size = IPTV_GUIDE_API.nowIdsMax): string[][] {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let at = 0; at < unique.length; at += size) out.push(unique.slice(at, at + size));
  return out;
}

/** Lo que dice la guía de cada id (los que no tienen guía no están). */
export function useGuideNow(
  ids: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, IptvGuideNowItem> {
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
): ReadonlyMap<string, IptvGuideNowItem> {
  const map = new Map<string, IptvGuideNowItem>();
  for (const { data } of results) {
    if (!data?.available) continue;
    for (const item of data.items) if (item.now || item.next) map.set(item.id, item);
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

function demoFill(id: string, now: number): Pick<IptvGuideNowItem, 'now' | 'next'> {
  const seed = seedOf(id);
  const slot = 30 * 60_000;
  const length = (1 + (seed % 4)) * slot;
  const start = Math.floor((now - (seed % 5) * 7 * 60_000) / slot) * slot;
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

/** En la demo, la guía de ejemplo de @ace/shared y relleno para los demás canales. */
export function registerGuideNowDemo(): void {
  if (demoRegistered) return;
  demoRegistered = true;
  registerDemoHandler('iptvGuideNow', async ({ query }) => {
    const now = Date.now();
    const response = demoGuideNow({ ids: String(query?.ids ?? '') }, now);
    return {
      ...response,
      items: response.items.map((item) =>
        item.now || item.next ? item : { ...item, ...demoFill(item.id, now) },
      ),
    };
  });
}
