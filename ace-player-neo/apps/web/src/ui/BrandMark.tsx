/* Marca de Ace Player Neo, «Pantalla-campo»: el MISMO dibujo que el icono de
   la tienda de Umbrel (ismaeloul-ace-player-neo/icon.svg, copiado tal cual en
   public/icon.svg): pantalla redondeada amarilla sobre #0b0d11, la línea de
   medio campo y el círculo central amarillo con «reproducir» oscuro.

   En línea (no <img src="/icon.svg">) para que el menú lateral lo pinte nítido
   sin otra petición. El id del fondo sale de useId: único aunque haya dos
   marcas en la página. Decorativa: el nombre accesible lo pone quien la usa. */

import { useId } from 'react';

export interface BrandMarkProps {
  /** Lado en px (cuadrado). */
  size?: number;
  className?: string;
}

export function BrandMark({ size = 28, className }: BrandMarkProps) {
  const bg = `${useId().replace(/:/g, '')}-bg`;
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-brand-mark=""
    >
      <defs>
        <linearGradient id={bg} x1="0" x2="0" y1="0" y2="512" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0b0d11" />
          <stop offset="1" stopColor="#0b0d11" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${bg})`} />
      <rect
        x="86"
        y="132"
        width="340"
        height="248"
        rx="40"
        fill="none"
        stroke="#ffd60a"
        strokeWidth="26"
      />
      <path d="M256 145v222" stroke="#ffd60a" strokeWidth="14" strokeOpacity=".45" />
      <circle cx="256" cy="256" r="72" fill="#ffd60a" />
      <path
        d="M238 222l54 34-54 34z"
        fill="#1a1400"
        stroke="#1a1400"
        strokeWidth="10"
        strokeLinejoin="round"
      />
    </svg>
  );
}
