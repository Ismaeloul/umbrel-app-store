/* Buscador del motor AceStream en /api/v1 (api.md §4.20). */

import { z } from 'zod';
import { SEARCH_QUERY_MAX } from '../../constants/limits.js';
import { SearchResultSchema } from '../common.js';

/** La consulta se colapsa, se recorta y se corta a 80; menos de 2 letras da 400 `empty_query`. */
export const SearchQuerySchema = z.strictObject({
  q: z.string().max(500).default(''),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResponseSchema = z.strictObject({
  query: z.string().max(SEARCH_QUERY_MAX),
  /** Hasta 100, por disponibilidad de mayor a menor. Todos infohash. */
  results: z.array(SearchResultSchema).max(100),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
