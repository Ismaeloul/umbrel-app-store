/* Un cartel, un fondo o un fotograma de Películas y series (docs/vod.md
   §12.4): un relleno con el color del título y su monograma y, encima, la
   imagen de `vodArt` (`loading="lazy"`). Decorativo: el título siempre va
   escrito al lado.

   Si la imagen falla, se reintenta UNA vez a los 2-3 s (con un poco de azar):
   con muchas filas en la portada la cola de carteles del servidor puede
   contestar 503 un momento (art.ts, más de 64 en cola). Si vuelve a fallar,
   se queda el relleno (la técnica de TeamMark). */

import type { VodArtKind } from '@ace/shared';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { channelTone, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { artSrc } from './data.ts';

/** Espera antes del único reintento de una imagen que ha fallado. */
export const ART_RETRY_MS = 2000;
const ART_RETRY_JITTER_MS = 1000;

/** «La casa de papel» → «LC»; «Dune» → «D». */
export function monogram(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 || /\d/.test(word));
  const picked = (words.length ? words : title.split(/\s+/)).slice(0, 2);
  return picked
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

/** El color de relleno de un título (también para el fondo de la ficha sin imagen). */
export function artFill(title: string): string {
  return oklchCss(channelTone(title));
}

export interface ArtProps {
  /** El id del título, del episodio o de la película al que pertenece la imagen. */
  id: string;
  art: VodArtKind;
  /** La `v` de vodArt; null = sin imagen (solo el relleno). */
  v: string | null;
  title: string;
  className?: string;
  /** Para lo que se ve nada más abrir (la cabecera de la ficha). */
  eager?: boolean;
  /** Sin monograma (el fondo desenfocado de la ficha). */
  bare?: boolean;
  /**
   * Lo que se ve mientras la imagen carga o si falla, en vez del monograma (el
   * fotograma de un episodio enseña su número: «P» de «El plan» no dice nada).
   */
  fallback?: ReactNode;
}

type Load = { src: string; attempt: 0 | 1; state: 'loading' | 'image' | 'retry' | 'failed' };

export function Art({
  id,
  art,
  v,
  title,
  className,
  eager = false,
  bare = false,
  fallback,
}: ArtProps) {
  const src = v ? artSrc(id, art, v, title) : null;
  const [load, setLoad] = useState<Load | null>(null);
  const current =
    load && load.src === src
      ? load
      : src
        ? { src, attempt: 0 as const, state: 'loading' as const }
        : null;
  useEffect(() => {
    if (current?.state !== 'retry') return;
    const wait = ART_RETRY_MS + Math.round(Math.random() * ART_RETRY_JITTER_MS);
    const timer = window.setTimeout(
      () => setLoad({ src: current.src, attempt: 1, state: 'loading' }),
      wait,
    );
    return () => window.clearTimeout(timer);
  }, [current?.state, current?.src]);
  const image = current && current.state !== 'failed' && current.state !== 'retry' ? current : null;
  const style = { '--art-fill': artFill(title) } as CSSProperties;
  return (
    <span
      className={cx('cine-art', `cine-art--${art}`, bare && 'cine-art--bare', className)}
      style={style}
      data-state={!image ? 'fill' : image.state === 'image' ? 'image' : 'loading'}
      aria-hidden="true"
    >
      {fallback !== undefined ? (
        fallback
      ) : bare ? null : art === 'poster' ? (
        /* Un cartel sin imagen se pinta como un cartel: el título en grande. */
        <b className="cine-art__name">{title}</b>
      ) : (
        <b className="cine-art__mono">{monogram(title)}</b>
      )}
      {image ? (
        <img
          /* Otra clave en el reintento: un <img> nuevo vuelve a pedir la imagen. */
          key={`${image.src}#${image.attempt}`}
          className="cine-art__img"
          src={image.src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoad({ src: image.src, attempt: image.attempt, state: 'image' })}
          onError={() =>
            setLoad({
              src: image.src,
              attempt: image.attempt,
              state: image.attempt === 0 ? 'retry' : 'failed',
            })
          }
        />
      ) : null}
    </span>
  );
}
