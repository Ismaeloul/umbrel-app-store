/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `search`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre, con las mismas entradas
   y salidas. `searchAceStreams` no se exporta: necesita el motor y vive en
   el servicio (`SearchService.search`). */

export { parseAceSearchResults } from './parse.js';
