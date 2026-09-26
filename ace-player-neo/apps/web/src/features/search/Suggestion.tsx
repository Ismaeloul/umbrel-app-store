/* «Quizás quisiste decir «…»» (docs/iptv.md §20): solo cuando una búsqueda
   no da nada, con la corrección tocable. Lo usan Buscar, el filtro de
   Canales y la pestaña IPTV. Los estilos, en search.css. */

import '../search/search.css';
import { suggestionText } from './matches.ts';

export function Suggestion({ value, onPick }: { value: string; onPick(value: string): void }) {
  return (
    <span className="search-suggest">
      {suggestionText.before}
      <button type="button" className="search-suggest__link" onClick={() => onPick(value)}>
        {value}
      </button>
      {suggestionText.after}
    </span>
  );
}
