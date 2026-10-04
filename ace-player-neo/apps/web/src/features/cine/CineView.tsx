/* Vista Películas y series (docs/vod.md §12): la portada con la rejilla
   (`?vista=cine`) o la ficha de un título (`?vista=cine/<id>`). Las dos
   viven en la misma vista del armazón: al volver de una ficha, la portada
   conserva su estado (sigue montada, oculta) y el armazón le devuelve el
   scroll (scrollKey `cine:portada`). Oculta (Activity), no pide nada. */

import { useEffect, useRef } from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { Ficha } from './Ficha.tsx';
import { Home } from './Home.tsx';
import './cine.css';

export default function CineView({ route, active }: ViewProps) {
  const id = route.vista === 'cine' ? route.id : null;
  /* Al volver de una ficha, el foco vuelve al cartel que la abrió (el armazón
     lo dejaba en el titular de la portada, arriba y fuera de la pantalla, y
     con el teclado había que empezar desde el principio). Va dos fotogramas
     después: el armazón enfoca el titular en el primero. */
  const lastFocus = useRef<HTMLElement | null>(null);
  const hadFicha = useRef(id !== null);
  useEffect(() => {
    const was = hadFicha.current;
    hadFicha.current = id !== null;
    if (!was || id !== null || !active) return;
    const target = lastFocus.current;
    if (!target) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (target.isConnected && target.getClientRects().length > 0)
          target.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [id, active]);
  /* La ficha va delante: el armazón da el foco al primer h1[tabindex=-1] de
     la vista, y el de la portada está oculto mientras hay ficha. */
  return (
    <>
      {id ? (
        <div className="cine-screen">
          <Ficha key={id} id={id} active={active} />
        </div>
      ) : null}
      <div
        className="cine-screen"
        hidden={id !== null}
        onFocus={(event) => {
          lastFocus.current = event.target;
        }}
      >
        <Home active={active && id === null} />
      </div>
    </>
  );
}
