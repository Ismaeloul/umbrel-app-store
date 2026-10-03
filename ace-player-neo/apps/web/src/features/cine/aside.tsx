/* Panel lateral de Películas y series en escritorio (≥ 1024 px, plegable):
   «Inicio» (la portada en filas) y las categorías del tipo elegido (docs/vod.md
   §12.4). Una categoría abre su rejilla; desde una ficha, vuelve a la rejilla
   con ella. Comparte el estado de la URL con la vista (data.ts). */

import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate } from '../../app/router.tsx';
import { CategoryList } from './CategorySheet.tsx';
import { closeCineGrid, openCineGrid, setCineState, useCineState, useVodHome } from './data.ts';
import { CINE_TEXT } from './texts.ts';
import './demo.ts';
import './cine.css';

export default function CineAside({ route, active }: ViewProps) {
  const state = useCineState();
  const navigate = useNavigate();
  const home = useVodHome(active);
  const data = home.data;
  if (!data || !data.active || data.state !== 'ready') return null;
  const categories = data.categories[state.kind];
  if (categories.length === 0) return null;
  const inFicha = route.vista === 'cine' && route.id !== null;
  const value = inFicha ? '' : state.q ? '' : state.cat;
  return (
    <nav className="cine-aside" aria-label={CINE_TEXT.categories}>
      <h2 className="cine-aside__title">
        {state.kind === 'movie' ? CINE_TEXT.movies : CINE_TEXT.series}
      </h2>
      <CategoryList
        categories={categories}
        value={value}
        withHome
        onChange={(cat) => {
          if (inFicha) {
            setCineState({ cat, tag: null, q: '' });
            navigate({ vista: 'cine', id: null });
            return;
          }
          if (state.q) setCineState({ q: '' });
          if (cat === null) closeCineGrid();
          else openCineGrid({ cat, tag: null });
        }}
      />
    </nav>
  );
}
