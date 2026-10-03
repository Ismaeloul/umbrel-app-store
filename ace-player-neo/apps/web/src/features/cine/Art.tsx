/* Un cartel, un fondo o un fotograma de Películas y series (docs/vod.md
   §12.4): un relleno con el color del título y su monograma y, encima, la
   imagen de `vodArt`. Decorativo: el título siempre va escrito al lado.

   La portada en filas puede pedir cientos de carteles de golpe y la cola de
   carteles del servidor contesta 503 cuando se llena (art.ts: 4 a la vez y 64
   en cola). Por eso:
   - Una imagen perezosa (todas menos la cabecera de la ficha) no se pide
     hasta que su sitio se acerca a la pantalla (IntersectionObserver): en un
     carrusel, solo las tarjetas que se ven y las de al lado, no las 20.
   - Si falla, se reintenta 3 veces con esperas crecientes (2, 6 y 15 s, con
     un poco de azar), lo que tarda la cola en vaciarse.
   - Si aun así falla, se queda el relleno, pero se vuelve a probar UNA vez
     cuando la tarjeta sale de la pantalla y vuelve a entrar: un cartel no se
     queda en blanco hasta recargar la página. */

import type { VodArtKind } from '@ace/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { channelTone, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { artSrc } from './data.ts';

/** Esperas antes de cada reintento de una imagen que ha fallado (más el azar). */
export const ART_RETRY_DELAYS_MS = [2_000, 6_000, 15_000] as const;
/** La primera espera. */
export const ART_RETRY_MS = ART_RETRY_DELAYS_MS[0];
const ART_RETRY_JITTER_MS = 1000;
/** Cuánto antes de verse se pide una imagen perezosa: arriba y abajo… */
export const ART_NEAR_MARGIN = '300px 0px';
/** …y, dentro de un carrusel, a los lados (Chrome; donde no se sepa, al entrar). */
const ART_NEAR_SCROLL_MARGIN = '0px 200px';

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

function observer(callback: IntersectionObserverCallback, near: boolean): IntersectionObserver {
  const init = near
    ? { rootMargin: ART_NEAR_MARGIN, scrollMargin: ART_NEAR_SCROLL_MARGIN }
    : { rootMargin: '0px' };
  return new IntersectionObserver(callback, init as IntersectionObserverInit);
}

/** ¿Se ha acercado ya a la pantalla? Una vez que sí, se queda en sí. */
function useNear(ref: RefObject<HTMLElement | null>, eager: boolean): boolean {
  const [near, setNear] = useState(() => eager || typeof IntersectionObserver !== 'function');
  useEffect(() => {
    const node = ref.current;
    if (near || !node) return;
    const io = observer((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNear(true);
      io.disconnect();
    }, true);
    io.observe(node);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}

export interface ArtProps {
  /** El id del título, del episodio o de la película al que pertenece la imagen. */
  id: string;
  art: VodArtKind;
  /** La `v` de vodArt; null = sin imagen (solo el relleno). */
  v: string | null;
  title: string;
  className?: string;
  /** Para lo que se ve nada más abrir (la cabecera de la ficha): se pide ya. */
  eager?: boolean;
  /** Sin monograma (el fondo desenfocado de la ficha). */
  bare?: boolean;
  /**
   * Lo que se ve mientras la imagen carga o si falla, en vez del monograma (el
   * fotograma de un episodio enseña su número: «P» de «El plan» no dice nada).
   */
  fallback?: ReactNode;
}

interface Load {
  src: string;
  /** Intento dentro de la vuelta (0 = el primero; hasta `ART_RETRY_DELAYS_MS.length`). */
  attempt: number;
  /** Vueltas tras volver a la pantalla (cambia la clave del <img>). */
  round: number;
  state: 'loading' | 'image' | 'retry' | 'failed';
}

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
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNear(ref, eager);
  const src = v ? artSrc(id, art, v, title) : null;
  const [load, setLoad] = useState<Load | null>(null);
  const current: Load | null =
    load && load.src === src ? load : src ? { src, attempt: 0, round: 0, state: 'loading' } : null;

  /* Reintentos con esperas crecientes. */
  useEffect(() => {
    if (current?.state !== 'retry') return;
    const base = ART_RETRY_DELAYS_MS[current.attempt] ?? ART_RETRY_DELAYS_MS.at(-1) ?? 0;
    const wait = base + Math.round(Math.random() * ART_RETRY_JITTER_MS);
    const next = { ...current, attempt: current.attempt + 1, state: 'loading' as const };
    const timer = window.setTimeout(() => setLoad(next), wait);
    return () => window.clearTimeout(timer);
    // `current` cambia con su estado, su intento y su vuelta.
  }, [current?.state, current?.src, current?.attempt, current?.round]);

  /* Rendida: un intento más cuando sale de la pantalla y vuelve a entrar. */
  useEffect(() => {
    const node = ref.current;
    if (current?.state !== 'failed' || !node || typeof IntersectionObserver !== 'function') return;
    let left = false;
    const io = observer((entries) => {
      const seen = entries.some((entry) => entry.isIntersecting);
      if (!seen) left = true;
      else if (left) {
        io.disconnect();
        setLoad({
          ...current,
          attempt: ART_RETRY_DELAYS_MS.length,
          round: current.round + 1,
          state: 'loading',
        });
      }
    }, false);
    io.observe(node);
    return () => io.disconnect();
  }, [current?.state, current?.src, current?.round]);

  const image =
    near && current && current.state !== 'failed' && current.state !== 'retry' ? current : null;
  const state =
    !current || current.state === 'failed' || current.state === 'retry'
      ? 'fill'
      : image?.state === 'image'
        ? 'image'
        : 'loading';
  const style = { '--art-fill': artFill(title) } as CSSProperties;
  return (
    <span
      ref={ref}
      className={cx('cine-art', `cine-art--${art}`, bare && 'cine-art--bare', className)}
      style={style}
      data-state={state}
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
          /* Otra clave en cada intento: un <img> nuevo vuelve a pedir la imagen. */
          key={`${image.src}#${image.round}.${image.attempt}`}
          className="cine-art__img"
          src={image.src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoad({ ...image, state: 'image' })}
          onError={() =>
            setLoad({
              ...image,
              state: image.attempt < ART_RETRY_DELAYS_MS.length ? 'retry' : 'failed',
            })
          }
        />
      ) : null}
    </span>
  );
}
