/* Una sinopsis recortada con «Más» (docs/vod.md §12.6): 3 líneas en el
   móvil y 6 en el PC (cine.css). Sirve para la de la ficha y para la de una
   temporada.

   «Más» sale solo si el texto no cabe, y eso se vuelve a medir cada vez que
   cambia el tamaño del párrafo (ResizeObserver) y cuando llega la fuente: al
   girar el iPhone o estrechar la ventana, un texto que cabía puede dejar de
   caber, y sin «Más» se quedaría cortado con «…» sin forma de leerlo. */

import { useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { Button } from '../../ui/index.ts';
import { CINE_TEXT } from './texts.ts';

export interface SynopsisProps {
  plot: string;
  /** Con título (para el lector de pantalla), va en su propia sección. */
  title?: string;
  /** El id del título (único en la página). */
  titleId?: string;
  className?: string;
}

/** ¿Se sale el texto de su recorte? */
function overflows(node: HTMLElement): boolean {
  return node.scrollHeight > node.clientHeight + 1;
}

export function Synopsis({ plot, title, titleId, className }: SynopsisProps) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || open) return;
    const measure = () => setLong(overflows(node));
    measure();
    let alive = true;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    if ('fonts' in document)
      void document.fonts.ready.then(() => {
        if (alive) measure();
      });
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [plot, open]);
  const body = (
    <>
      <p ref={ref} className={cx('cine-synopsis__text', !open && 'cine-synopsis__text--clamp')}>
        {plot}
      </p>
      {long || open ? (
        <Button
          variant="ghost"
          size="sm"
          className="cine-synopsis__more"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? CINE_TEXT.less : CINE_TEXT.more}
        </Button>
      ) : null}
    </>
  );
  if (!title) return <div className={cx('cine-synopsis', className)}>{body}</div>;
  return (
    <section className={cx('cine-synopsis', className)} aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      {body}
    </section>
  );
}
