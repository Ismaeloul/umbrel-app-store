/* Vídeo de Palco: luz de ambiente con los colores de los clubes, recorte
   cinematográfico del vídeo falso (cover/contain) y anillo de calidad. */

import { memo, type ReactNode } from 'react';
import { FakeVideo, type FakeVideoProps } from '../../../core/video/FakeVideo';
import { useSize } from './hooks';
import type { Tone } from './text';
import { Icon } from './icons';

/** Dos degradados radiales con los colores de los dos clubes. `flash` sube al 60 % al marcar. */
export const Ambient = memo(function Ambient({ home, away, flash = null, strength = 0.22, className, breathe = true }: { home: string; away: string; flash?: 'home' | 'away' | null; strength?: number; className?: string; breathe?: boolean }) {
  return (
    <div className={`pl-ambient${breathe ? ' pl-ambient--breathe' : ''} ${className ?? ''}`} aria-hidden="true">
      <div className="pl-ambient__a" style={{ ['--c' as string]: home, opacity: flash === 'home' ? 0.62 : strength }} />
      <div className="pl-ambient__b" style={{ ['--c' as string]: away, opacity: flash === 'away' ? 0.62 : strength }} />
    </div>
  );
});

export interface CoverVideoProps extends FakeVideoProps {
  /** cover: llena el contenedor recortando; contain: 16:9 dentro del contenedor. */
  fit?: 'cover' | 'contain';
  /** Zoom extra en cover (1 = ajustado). */
  zoom?: number;
  /** Punto de anclaje vertical del recorte 0..1 (0,5 centro). */
  focusY?: number;
  children?: ReactNode;
  wrapClassName?: string;
}

/** FakeVideo siempre a 16:9, recortado o encajado dentro de su caja. */
export function CoverVideo({ fit = 'cover', zoom = 1, focusY = 0.5, children, wrapClassName, className, radius, style, ...fake }: CoverVideoProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  let w = 0;
  let h = 0;
  if (size.w > 0 && size.h > 0) {
    const byW = size.w * (9 / 16);
    if (fit === 'cover') {
      if (byW >= size.h) {
        w = size.w;
        h = byW;
      } else {
        h = size.h;
        w = size.h * (16 / 9);
      }
      w *= zoom;
      h *= zoom;
    } else {
      if (byW <= size.h) {
        w = size.w;
        h = byW;
      } else {
        h = size.h;
        w = size.h * (16 / 9);
      }
    }
  }
  const top = size.h * focusY - h * focusY;
  return (
    <div ref={ref} className={`pl-cover ${wrapClassName ?? ''}`} style={style}>
      {w > 0 && (
        <div className="pl-cover__box" style={{ width: Math.round(w), height: Math.round(h), left: Math.round((size.w - w) / 2), top: Math.round(fit === 'cover' ? top : (size.h - h) / 2) }}>
          <FakeVideo {...fake} className={className} radius={radius} />
        </div>
      )}
      {children}
    </div>
  );
}

/** Anillo de calidad alrededor de un cartel 16:9. Nada de números. Al verificarse
    (Comprobando → Verificada) el anillo se «dibuja» de un tirón. */
export function QualityRing({ tone, active, radius = 12, className }: { tone: Tone; active?: boolean; radius?: number; className?: string }) {
  const dash = tone === 'weak' ? '66 34' : tone === 'checking' ? '5 5' : tone === 'queued' ? '1.5 5' : undefined;
  return (
    <span className={`pl-ring pl-ring--${tone}${active ? ' is-active' : ''} ${className ?? ''}`} aria-hidden="true">
      <svg className="pl-ring__svg">
        <rect className="pl-ring__track" rx={radius} ry={radius} pathLength={100} />
        <rect key={tone === 'ok' ? 'ok' : 'other'} className={`pl-ring__r${tone === 'ok' ? ' is-drawn' : ''}`} rx={radius} ry={radius} pathLength={100} strokeDasharray={dash} strokeDashoffset={tone === 'weak' ? -17 : 0} />
      </svg>
      {tone === 'fail' && (
        <span className="pl-ring__bang">
          <Icon name="warning" size={12} strokeWidth={2.4} />
        </span>
      )}
      {tone === 'checking' && <span className="pl-ring__sheen" />}
    </span>
  );
}
