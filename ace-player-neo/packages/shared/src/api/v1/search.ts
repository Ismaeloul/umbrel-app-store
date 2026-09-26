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
  /**
   * Lo que se le ha preguntado al motor si no es `query` (docs/iptv.md §20):
   * la consulta con las erratas corregidas («telecinko» → «telecinco») o el
   * nombre de siempre de un alias («t5» → «Telecinco», que se pregunta junto
   * con la consulta tal cual). Solo en v1.
   */
  searched: z.string().min(1).max(SEARCH_QUERY_MAX).optional(),
  /** Solo sin resultados: «Quizás quisiste decir», con más tolerancia que la corrección. Solo en v1. */
  suggestion: z.string().min(1).max(SEARCH_QUERY_MAX).optional(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
