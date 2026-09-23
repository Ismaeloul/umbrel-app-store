/* Funciones puras del buscador del motor, portadas de la 0.6.59. */

import {
  MAX_SEARCH_RESULTS,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  cleanTitle,
  normalizeHash,
  type SearchResult,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * `parseAceSearchResults` (server.js:3599-3632), igual: resultados planos
 * (`content_id`) y agrupados (`items` con `infohash`), deduplicados por id,
 * 100 como máximo y ordenados por disponibilidad (los que no la tienen, al
 * final). JSON inválido → `engine_bad_response` (502). T-030, B-211.
 */
export function parseAceSearchResults(body: string): SearchResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AppError('engine_bad_response', { detail: 'la búsqueda no devolvió JSON' });
  }
  const result = field(parsed, 'result');
  const nested = field(result, 'results');
  const plain = field(parsed, 'results');
  const rawResults: unknown[] = Array.isArray(nested)
    ? nested
    : Array.isArray(result)
      ? result
      : Array.isArray(plain)
        ? plain
        : [];
  const seen = new Set<string>();
  const items: SearchResult[] = [];
  for (const entry of rawResults) {
    const grouped = field(entry, 'items');
    const candidates: unknown[] = Array.isArray(grouped) ? grouped : [entry];
    for (const candidate of candidates) {
      const id = normalizeHash(
        field(candidate, 'infohash') || field(candidate, 'content_id') || field(candidate, 'url'),
      );
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const categories = field(candidate, 'categories');
      const availability = field(candidate, 'availability');
      const bitrate = field(candidate, 'bitrate');
      items.push({
        id,
        title: cleanTitle(
          field(candidate, 'name') || field(entry, 'name'),
          `Stream ${id.slice(0, 8)}`,
        ),
        category: cleanTitle(Array.isArray(categories) ? categories[0] : '', 'Busqueda'),
        availability: typeof availability === 'number' ? availability : null,
        bitrate: typeof bitrate === 'number' ? bitrate : null,
        ih: true,
      });
      if (items.length >= MAX_SEARCH_RESULTS) break;
    }
    if (items.length >= MAX_SEARCH_RESULTS) break;
  }
  return items.sort((a, b) => (b.availability ?? -1) - (a.availability ?? -1));
}

/**
 * La consulta tal y como la limpia `/api/search` (server.js:4944-4945):
 * espacios colapsados, recortada y cortada a 80. Es la `query` de la
 * respuesta. Menos de 2 caracteres → `empty_query`.
 */
export function routeQuery(value: unknown): string {
  const q = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_MAX);
  if (q.length < SEARCH_QUERY_MIN) throw new AppError('empty_query');
  return q;
}

/**
 * La que manda `searchAceStreams` al motor (server.js:3635-3640): además
 * quita etiquetas HTML y entidades (`cleanTitle`). Menos de 2 → `empty_query`.
 */
export function engineQuery(value: string): string {
  const q = cleanTitle(value, '').slice(0, SEARCH_QUERY_MAX);
  if (q.length < SEARCH_QUERY_MIN) throw new AppError('empty_query');
  return q;
}
