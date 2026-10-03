/* Respuestas del modo demo para la Guía TV (docs/iptv.md §20.8). La guía de
   ejemplo es la de @ace/shared (`demoGuide*`: 55 canales españoles y de
   otros países, programas de 5 min a 3 h, huecos de madrugada, un relleno de
   14 h y un favorito sin guía); aquí solo se registran los manejadores. Lo
   importa index.tsx (`import './demo.ts';`).

   Dos variantes por la URL (`&guia=`, separadas por comas):
   - `hoy`: como la guía real del panel de Isma (Paso 0 del 3-oct), que solo
     cubre de ayer a hoy: sin «Mañana» ni «Pasado».
   - `grande`: «Todos» con 4 391 canales (los 55 repetidos con otro nombre),
     para ver la parrilla virtual con el tamaño del proveedor de Isma. */

import {
  DemoGuideError,
  demoGuide,
  demoGuideChannelId,
  demoGuideProgramme,
  demoGuideProgrammes,
  type DemoGuideOptions,
  type DemoGuideProgrammesQuery,
  type DemoGuideQuery,
  type IptvGuideChannel,
  type IptvGuideResponse,
} from '@ace/shared';
import { ApiError, registerDemoHandlers } from '../../api/index.ts';

/** Canales de «Todos» con `guia=grande` (los del proveedor de Isma). */
const BIG_TOTAL = 4391;

function variants(): { options: DemoGuideOptions; big: boolean } {
  let raw = '';
  try {
    raw = new URLSearchParams(globalThis.location?.search ?? '').get('guia') ?? '';
  } catch {}
  const parts = raw.split(',');
  return { options: { onlyToday: parts.includes('hoy') }, big: parts.includes('grande') };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function demoOrApiError<T>(route: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof DemoGuideError)
      throw new ApiError({ code: error.code, status: error.status, route });
    throw error;
  }
}

let baseCache: readonly IptvGuideChannel[] | null = null;
/** Los 55 canales de «Todos» de la guía de ejemplo. */
function baseChannels(options: DemoGuideOptions): readonly IptvGuideChannel[] {
  baseCache ??= demoGuide({ scope: 'all', limit: 1000 }, Date.now(), options).channels;
  return baseCache;
}

/** El canal de la guía de ejemplo del que copia su parrilla una fila de la guía grande. */
function baseRef(ref: number, size: number): number {
  return ((ref - 1) % size) + 1;
}

function bigRow(index: number, base: readonly IptvGuideChannel[]): IptvGuideChannel {
  const source = base[index % base.length] as IptvGuideChannel;
  if (index < base.length) return source;
  const name = `${source.name} (${Math.floor(index / base.length) + 1})`;
  return {
    ...source,
    guide: index + 1,
    id: demoGuideChannelId(name),
    number: index + 1,
    name,
    favorite: false,
  };
}

function bigGuide(
  response: IptvGuideResponse,
  options: DemoGuideOptions,
  limit: number,
): IptvGuideResponse {
  const base = baseChannels(options);
  const all = BIG_TOTAL;
  if (response.scope !== 'all') return { ...response, all };
  const rows: IptvGuideChannel[] = [];
  const end = Math.min(all, response.offset + limit);
  for (let index = response.offset; index < end; index += 1) rows.push(bigRow(index, base));
  return { ...response, all, total: all, channels: rows };
}

registerDemoHandlers({
  iptvGuide: async ({ query }) => {
    const { options, big } = variants();
    await wait(110);
    const response = demoGuide((query ?? {}) as DemoGuideQuery, Date.now(), options);
    const limit = Math.min(1000, Math.max(0, Number(query?.limit ?? 200) || 0));
    return big ? bigGuide(response, options, limit) : response;
  },
  iptvGuideProgrammes: async ({ query: raw }) => {
    const query = raw as DemoGuideProgrammesQuery;
    const { options, big } = variants();
    await wait(70 + Math.round(Math.random() * 90));
    if (!big)
      return demoOrApiError('iptvGuideProgrammes', () =>
        demoGuideProgrammes(query, Date.now(), options),
      );
    const size = baseChannels(options).length;
    const refs = String(query.ch)
      .split(',')
      .map(Number)
      .filter((ref) => Number.isInteger(ref) && ref > 0);
    const response = demoOrApiError('iptvGuideProgrammes', () =>
      demoGuideProgrammes(
        { ...query, ch: [...new Set(refs.map((ref) => baseRef(ref, size)))].join(',') },
        Date.now(),
        options,
      ),
    );
    const byBase = new Map(response.channels.map((channel) => [channel.guide, channel]));
    return {
      ...response,
      channels: refs.map((ref) => ({
        guide: ref,
        programmes: (byBase.get(baseRef(ref, size))?.programmes ?? []).map((programme) => ({
          ...programme,
          id: `${ref}.${programme.id.split('.')[1] ?? '0'}`,
        })),
      })),
    };
  },
  iptvGuideProgramme: async ({ params, query }) => {
    const { options, big } = variants();
    await wait(90);
    const [ref = '0', minute = '0'] = params.id.split('.');
    const size = baseChannels(options).length;
    const id = big ? `${baseRef(Number(ref), size)}.${minute}` : params.id;
    const detail = demoOrApiError('iptvGuideProgramme', () =>
      demoGuideProgramme(id, query, Date.now(), options),
    );
    return big ? { ...detail, id: params.id, guide: Number(ref) } : detail;
  },
});
