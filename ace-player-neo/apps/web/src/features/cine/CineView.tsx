/* Vista Películas y series (docs/vod.md §12): la portada con la rejilla
   (`?vista=cine`) o la ficha de un título (`?vista=cine/<id>`). Las dos
   viven en la misma vista del armazón: al volver de una ficha, la portada
   conserva su estado (sigue montada, oculta) y el armazón le devuelve el
   scroll (scrollKey `cine:portada`). Oculta (Activity), no pide nada. */

import type { ViewProps } from '../../app/contracts.ts';
import { Ficha } from './Ficha.tsx';
import { Home } from './Home.tsx';
import './cine.css';

export default function CineView({ route, active }: ViewProps) {
  const id = route.vista === 'cine' ? route.id : null;
  /* La ficha va delante: el armazón da el foco al primer h1[tabindex=-1] de
     la vista, y el de la portada está oculto mientras hay ficha. */
  return (
    <>
      {id ? (
        <div className="cine-screen">
          <Ficha key={id} id={id} active={active} />
        </div>
      ) : null}
      <div className="cine-screen" hidden={id !== null}>
        <Home active={active && id === null} />
      </div>
    </>
  );
}
