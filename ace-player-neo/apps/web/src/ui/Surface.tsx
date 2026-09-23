/* Superficies.

   - Card: superficie opaca (listas, bloques del centro de partido). Es lo
     normal: el cristal NO se usa para contenido que se lee de corrido.
   - Panel: cristal, solo para lo que flota sobre otra cosa (hojas, menús,
     el mini-reproductor, cápsulas sobre el vídeo). Tres materiales:
       regular (sobre contenido), dense (casi opaco, sobre listas: una sola
       capa desenfocada sobre una lista larga para ir a 60 fps en iPhone) y
       video (siempre oscuro, sobre la imagen).
     Con «Reducir transparencia» (sistema o Ajustes) pasa a opaco solo.

   Radios concéntricos: el radio interior es el exterior menos el margen. Card
   y Panel publican --r-outer y --pad para que lo de dentro use
   `border-radius: var(--r-inner)`. */

import type { CSSProperties, ElementType, ReactNode, Ref, HTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';
import './Surface.css';

type Radius = 'xl' | 'l' | 'm' | 's';
type Padding = 0 | 2 | 3 | 4 | 5 | 6;

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  ref?: Ref<HTMLElement>;
  radius?: Radius;
  padding?: Padding;
  children?: ReactNode;
}

const RADIUS: Record<Radius, string> = {
  xl: 'var(--r-xl)',
  l: 'var(--r-l)',
  m: 'var(--r-m)',
  s: 'var(--r-s)',
};

function surfaceStyle(radius: Radius, padding: Padding, style?: CSSProperties): CSSProperties {
  return {
    '--r-outer': RADIUS[radius],
    '--pad': padding === 0 ? '0px' : `var(--s-${padding})`,
    ...style,
  } as CSSProperties;
}

export function Card({
  as: Tag = 'div',
  ref,
  radius = 'xl',
  padding = 4,
  className,
  style,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <Tag
      ref={ref}
      className={cx('card', className)}
      style={surfaceStyle(radius, padding, style)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface PanelProps extends SurfaceProps {
  material?: 'regular' | 'dense' | 'video';
}

export function Panel({
  as: Tag = 'div',
  ref,
  radius = 'l',
  padding = 3,
  material = 'regular',
  className,
  style,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag
      ref={ref}
      className={cx(
        'panel',
        material === 'video' ? 'glass--video' : 'glass',
        material === 'dense' && 'glass--dense',
        className,
      )}
      data-material={material}
      style={surfaceStyle(radius, padding, style)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
