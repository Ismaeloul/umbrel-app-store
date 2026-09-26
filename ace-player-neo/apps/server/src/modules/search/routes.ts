/* Rutas del módulo `search`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.20):
   - GET /api/search?q=… → `{ query, results }` (server.js:4941-4947):
     400 `empty_query`, 400 `ace_timeout`, 503 `engine_unavailable`,
     502 `engine_bad_response`.

   v1 (tabla de @ace/shared/routes.ts):
   - search: GET /api/v1/search?q=… → la misma respuesta; los errores con su
     HTTP de v1 (504 `ace_timeout`). Con IPTV activa, cada resultado que es
     un canal de tu IPTV lleva su id en `iptv` (docs/iptv.md §14.3); la ruta
     antigua nunca lo lleva.
   - Buscador «como Google» (docs/iptv.md §20, solo v1): con una errata se
     pregunta al motor, además de lo escrito, el nombre de siempre del alias
     o lo corregido (`correct.ts`); `searched` dice qué más se preguntó (si
     trajo algo) y, sin resultados, `suggestion` es el «Quizás quisiste
     decir». */

import {
  displayWords,
  searchFold,
  type FuzzyVocabulary,
  type SearchResponse,
  type StateV1,
} from '@ace/shared';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import {
  mergeEngineResults,
  planEngineQuery,
  suggestEngineQuery,
  titlesVocabulary,
} from './correct.js';
import { routeQuery } from './parse.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = ['GET /api/search'];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['search'];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  /* server.js:4943: `searchParams.get("q") || ""`. */
  router.handle('GET', '/api/search', (req, ctx) =>
    services.search.search(req.query.get('q') || '', { signal: ctx.signal }),
  );
}

export function registerV1Routes(router: V1Router, services: Services): void {
  /* Las palabras de tu biblioteca, las mismas mientras no cambie el estado. */
  let library: {
    state: Readonly<StateV1>;
    vocabulary: FuzzyVocabulary;
    display: ReadonlyMap<string, string>;
  } | null = null;
  const libraryWords = () => {
    const state = services.state.get();
    if (library?.state !== state) {
      const titles = [...state.favorites, ...state.history, ...state.web].map((item) => item.title);
      library = { state, vocabulary: titlesVocabulary(titles), display: displayWords(titles) };
    }
    return library;
  };
  const vocabularies = (): FuzzyVocabulary[] => {
    const out: FuzzyVocabulary[] = [];
    const iptv = services.iptv?.active() ? services.iptv.searchVocabulary() : null;
    if (iptv) out.push(iptv);
    out.push(libraryWords().vocabulary);
    return out;
  };
  /* Cómo se escriben las palabras (tu biblioteca y tu IPTV), para el «Quizás quisiste decir». */
  const displays = (): ReadonlyMap<string, string>[] => {
    const out: ReadonlyMap<string, string>[] = [libraryWords().display];
    const iptv = services.iptv?.active() ? services.iptv.searchDisplayWords?.() : null;
    if (iptv) out.push(iptv);
    return out;
  };

  router.handle('search', async (input, ctx) => {
    const shown = routeQuery(input.query.q);
    /* La corrección nunca tumba la búsqueda: si algo falla, la consulta tal cual. */
    let known: FuzzyVocabulary[];
    try {
      known = vocabularies();
    } catch {
      known = [];
    }
    const plan = planEngineQuery(shown, known);
    const ask = (q: string) => services.search.search(q, { signal: ctx.signal });
    let response: SearchResponse;
    let searched: string | null = null;
    if (plan.extra) {
      /* Lo escrito y, a la vez, el alias o la errata corregida: lo escrito primero. */
      const [own, extra] = await Promise.allSettled([ask(shown), ask(plan.extra)]);
      if (own.status === 'rejected' && extra.status === 'rejected') throw own.reason;
      const ownResults = own.status === 'fulfilled' ? own.value.results : [];
      const extraResults = extra.status === 'fulfilled' ? extra.value.results : [];
      response = { query: shown, results: mergeEngineResults(ownResults, extraResults) };
      if (extraResults.length) searched = plan.extra;
    } else {
      response = await ask(shown);
    }
    let suggestion: string | null = null;
    if (!response.results.length) {
      let shownAs: ReadonlyMap<string, string>[];
      try {
        shownAs = displays();
      } catch {
        shownAs = [];
      }
      suggestion = suggestEngineQuery(shown, known, shownAs);
    }
    const iptv = services.iptv;
    const results =
      iptv?.active() && response.results.length
        ? iptv.annotateSearch(response.results)
        : response.results;
    return {
      ...response,
      results,
      ...(searched ? { searched: searched.slice(0, 80) } : {}),
      ...(suggestion && searchFold(suggestion) !== searchFold(searched ?? '')
        ? { suggestion: suggestion.slice(0, 80) }
        : {}),
    };
  });
}
