/* Cifras de marcador, minuto, horas y contadores: condensadas (wdth 75),
   gruesas (780) y de ancho fijo para que un número que cambia no mueva nada.

   Por qué no `font-variant-numeric: tabular-nums`: el cero TABULAR de Mona
   Sans trae la barra de serie (se lee «Ø», corrección 1 de eleccion.md) y
   ninguna función de la fuente la quita (probado: zero, ss01-ss08 y
   cv01-cv11). Las cifras proporcionales sí tienen el cero limpio, así que
   cada cifra va en una celda del ancho de la más ancha (--num-cell, 0,49 em).

   Para lectores de pantalla el valor va entero en un texto oculto; las celdas
   se esconden para que no se lea «2, 1, :, 0, 0». Las cifras visibles se
   pintan con `content: attr(data-g)` y no como texto: así el único texto del
   componente es el valor entero (getByText('21:00') lo encuentra una vez, y
   el texto de un botón con contador no sale duplicado). */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import './Num.css';

export interface NumProps {
  value: number | string;
  className?: string;
  style?: CSSProperties;
  /** Texto para lectores de pantalla si el número solo no se entiende («minuto 72»). */
  label?: string;
  /** false: sin las fuentes condensadas (cifras en el texto normal). */
  condensed?: boolean;
}

/** Parte un texto en trozos: cada cifra suelta y lo demás en bloque. */
export function splitDigits(text: string): Array<{ digit: boolean; text: string }> {
  const parts: Array<{ digit: boolean; text: string }> = [];
  for (const ch of text) {
    const digit = ch >= '0' && ch <= '9';
    const last = parts.at(-1);
    if (!digit && last && !last.digit) last.text += ch;
    else parts.push({ digit, text: ch });
  }
  return parts;
}

export function Num({ value, className, style, label, condensed = true }: NumProps) {
  const text = String(value);
  return (
    <span className={cx('num-cells', condensed && 'num', className)} style={style}>
      <span className="sr-only">{label ?? text}</span>
      <span aria-hidden="true" className="num-cells__glyphs">
        {splitDigits(text).map((part, index) => (
          <span
            key={index}
            className={part.digit ? 'num-cells__d' : 'num-cells__s'}
            data-g={part.text}
          />
        ))}
      </span>
    </span>
  );
}
