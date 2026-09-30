/* Un cartel, un fondo o un fotograma de Películas y series (docs/vod.md
   §12.4): un relleno con el color del título y su monograma y, encima, la
   imagen de `vodArt` (`loading="lazy"`). Si la imagen falla, vuelve a verse
   el relleno (la técnica de TeamMark). Decorativo: el título siempre va
   escrito al lado. */

import type { VodArtKind } from '@ace/shared';
import { useState, type CSSProperties } from 'react';
import { channelTone, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { artSrc } from './data.ts';

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
}

export function Art({ id, art, v, title, className, eager = false }: ArtProps) {
  const src = v ? artSrc(id, art, v, title) : null;
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const image = src && failed !== src ? src : null;
  const style = { '--art-fill': oklchCss(channelTone(title)) } as CSSProperties;
  return (
    <span
      className={cx('cine-art', `cine-art--${art}`, className)}
      style={style}
      data-state={!image ? 'fill' : loaded === image ? 'image' : 'loading'}
      aria-hidden="true"
    >
      <b className="cine-art__mono">{monogram(title)}</b>
      {image ? (
        <img
          key={image}
          className="cine-art__img"
          src={image}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(image)}
          onError={() => setFailed(image)}
        />
      ) : null}
    </span>
  );
}
