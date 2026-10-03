/* Resaltar en el nombre de una fila lo que casa con lo escrito (0.9.0,
   docs/buscador.md): «la 1» marca «La 1» en «La 1 Catalunya» y «laliga»
   marca «LA LIGA» en «DAZN LA LIGA», con las mismas reglas que el buscador
   (`nameHighlights` de @ace/shared).

   Con la API de resaltado de CSS (`CSS.highlights` y `::highlight()`): no
   toca el DOM (el texto sigue siendo un solo nodo, así que el lector de
   pantalla, la búsqueda del navegador y las pruebas lo ven igual) y se pinta
   con `::highlight(canal-coincide)` en library.css. Donde no hay esa API
   (navegadores viejos, jsdom), no se resalta nada. Todas las filas
   comparten un solo `Highlight`: cada una añade sus rangos y los quita al
   cambiar o desmontarse. */

import { nameHighlights } from '@ace/shared';
import { useLayoutEffect, type RefObject } from 'react';

/** El nombre del resaltado en `::highlight()`. */
export const NAME_HIGHLIGHT = 'canal-coincide';

let shared: Highlight | null = null;

function registry(): Highlight | null {
  if (shared) return shared;
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined')
    return null;
  shared = new Highlight();
  CSS.highlights.set(NAME_HIGHLIGHT, shared);
  return shared;
}

/**
 * Resalta en el elemento (que tiene que contener solo el texto `text`) los
 * trozos que casan con `query`. Sin `query`, nada.
 */
export function useNameHighlight(
  ref: RefObject<HTMLElement | null>,
  query: string | undefined,
  text: string,
): void {
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!query || !node || node.nodeType !== Node.TEXT_NODE || node.textContent !== text) return;
    const highlight = registry();
    if (!highlight) return;
    const ranges: Range[] = [];
    for (const [start, end] of nameHighlights(query, text)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(end, text.length));
      ranges.push(range);
      highlight.add(range);
    }
    return () => {
      for (const range of ranges) highlight.delete(range);
    };
  }, [ref, query, text]);
}
