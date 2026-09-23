/* Dorsal de canal (injerto C2, sustituye a los cuadrados de dos letras de A):
   el número del canal o su inicial, grande y recortado por la esquina, sobre
   un tono sacado del nombre con la regla de tonos de C (nunca violeta, ni el
   verde ni el rojo de los estados). Decorativo: el nombre va al lado. */

import type { CSSProperties } from 'react';
import { channelTone, oklchCss } from '../lib/color.ts';
import { cx } from '../lib/cx.ts';
import './ChannelMark.css';

/** «DAZN 1» → «1», «M+ Liga de Campeones 2» → «2», «Eurosport» → «E». */
export function channelDorsal(name: string): string {
  const numbers = name.match(/\d+/g);
  const last = numbers?.at(-1);
  if (last) return last.slice(0, 3);
  const letter = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[A-Za-z]/);
  return letter ? letter[0].toUpperCase() : '·';
}

export interface ChannelMarkProps {
  name: string;
  size?: number;
  className?: string;
}

export function ChannelMark({ name, size = 52, className }: ChannelMarkProps) {
  const tone = channelTone(name);
  const style = {
    '--s': `${size}px`,
    '--tone': oklchCss(tone),
    '--tone-hi': oklchCss({ ...tone, l: tone.l + 0.12 }),
  } as CSSProperties;
  const dorsal = channelDorsal(name);
  // Una cifra se recorta por abajo; una letra, por la derecha (una «E»
  // cortada por abajo se lee «F»).
  const letter = !/\d/.test(dorsal);
  return (
    <span
      className={cx(
        'dorsal',
        dorsal.length > 1 && 'dorsal--long',
        letter && 'dorsal--letter',
        className,
      )}
      style={style}
      aria-hidden="true"
    >
      <b>{dorsal}</b>
    </span>
  );
}
