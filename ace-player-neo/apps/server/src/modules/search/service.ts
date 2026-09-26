/* Servicio del buscador del motor AceStream (arquitectura §5.2 y §5.10;
   api.md §4.20; B-209, B-211, B-213, B-216).

   `search()` porta la ruta `/api/search` y `searchAceStreams`
   (server.js:4941-4947 y 3634-3656): la consulta se limpia dos veces como
   hoy, se pide `/search?query=…&page_size=60` y se interpreta con
   `parseAceSearchResults`. Los códigos de error los pone el cliente del motor
   (`ace_timeout`, `engine_unavailable`) y el parser (`engine_bad_response`).

   Motor al que se pregunta (`via`, arquitectura §5.10 y backend-modulos
   §9.11):
   - `main` (por defecto): el principal, como hoy. La pestaña "Buscar" va
     siempre aquí.
   - `scanner`: el comprobador, si está configurado.
   - `auto`: el comprobador si hay alguien viendo algo (evento
     `playback.activity`) y el comprobador existe; si no, el principal. Es lo
     que deben pedir las hasta 8 búsquedas de la resolución.
   Si el comprobador falla, se repite en el principal (como en la 0.6.59, que
   siempre buscaba en el principal): una resolución no se queda sin
   resultados por el segundo motor. */

import type { SearchResponse, SearchResult } from '@ace/shared';
import { engineQuery, parseAceSearchResults, routeQuery } from './parse.js';
import type { SearchDeps, SearchOptions, SearchService } from './types.js';

export interface SearchRuntime {
  readonly service: SearchService;
  /** A qué motor iría una búsqueda con estas opciones (tests y diagnóstico). */
  target(via: SearchOptions['via']): 'main' | 'scanner';
}

export function createSearchRuntime(deps: SearchDeps): SearchRuntime {
  const { engine, scanner, bus } = deps;
  const logger = deps.logger.child({ module: 'search' });
  let watching = false;
  /* Con solo IPTV el motor principal está libre: las búsquedas van a él (docs/iptv.md §6.4). */
  bus.on('playback.activity', (activity) => {
    watching = activity.engineWatching ?? activity.watching;
  });

  const scannerEnabled = (): boolean => {
    try {
      return scanner.isEnabled();
    } catch {
      return false;
    }
  };

  const target = (via: SearchOptions['via']): 'main' | 'scanner' => {
    if (via === 'scanner') return scannerEnabled() ? 'scanner' : 'main';
    if (via === 'auto') return watching && scannerEnabled() ? 'scanner' : 'main';
    return 'main';
  };

  async function fetchRaw(q: string, options: SearchOptions): Promise<string> {
    const signal = options.signal;
    if (target(options.via) === 'scanner') {
      try {
        return await scanner.searchRaw(q, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        logger.debug(
          { err: error },
          'búsqueda en el comprobador fallida; se repite en el principal',
        );
      }
    }
    return engine.client().searchRaw(q, signal);
  }

  const service: SearchService = {
    async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
      const shown = routeQuery(query);
      const sent = engineQuery(shown);
      const raw = await fetchRaw(sent, options);
      return { query: shown, results: parseAceSearchResults(raw) };
    },
    parseResults(body: string): SearchResult[] {
      return parseAceSearchResults(body);
    },
  };

  return { service, target };
}
