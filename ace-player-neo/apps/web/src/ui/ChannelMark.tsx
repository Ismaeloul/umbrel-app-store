/* Dorsal de canal (injerto C2, sustituye a los cuadrados de dos letras de A):
   el número del canal o su inicial, grande y recortado por la esquina, sobre
   un tono sacado del nombre con la regla de tonos de C (nunca violeta, ni el
   verde ni el rojo de los estados). Decorativo: el nombre va al lado.

   Palco (fase 2, corrección 2) añade la forma `tile`: una tesela 16:9 con la
   misma cifra grande y la sigla del canal arriba, para los carteles de fuente
   y de canal (que no llevan miniatura). `size` es el lado en `round` y el ALTO
   en `tile` (el ancho sale de 16:9).

   Los carteles de FUENTE (Isma, 26-sep) cambian esa etiqueta por el proveedor
   («Elcano», «New Era») con `label`: mismo sitio y misma tipografía; si no
   cabe, puntos suspensivos (y una letra algo menor si es larga). El tono y la
   cifra siguen saliendo de `name`. */

import type { CSSProperties } from 'react';
import { isQualityNumber, stripQualityMarks } from '@ace/shared';
import { channelTone, oklchCss } from '../lib/color.ts';
import { cx } from '../lib/cx.ts';
import './ChannelMark.css';

/**
 * «DAZN 1» → «1», «M+ Liga de Campeones 2» → «2», «Eurosport» → «E». Las
 * cifras de resolución, códec y fotogramas no son el número del canal (Isma,
 * 26-sep; docs/iptv.md §18): «La 1 TVE 720p» → «1», «DAZN 2 1080p50 H265» →
 * «2», «Eurosport 4K» → «E».
 */
export function channelDorsal(name: string): string {
  const numbers = stripQualityMarks(name)
    .match(/\d+/g)
    ?.filter((number) => !isQualityNumber(number));
  const last = numbers?.at(-1);
  if (last) return last.slice(0, 3);
  const letter = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[A-Za-z]/);
  return letter ? letter[0].toUpperCase() : '·';
}

/** Sigla corta para la tesela: «DAZN LaLiga» → «DAZN», «M+ Liga de Campeones 2» → «M+», «La 1 HD» → «LA 1». */
export function channelAbbrev(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0] ?? '';
  // Un artículo solo («La 1») se lleva la siguiente palabra.
  const abbrev = /^(la|el|los|las)$/i.test(first) && words[1] ? `${first} ${words[1]}` : first;
  return abbrev.slice(0, 6).toUpperCase();
}

export interface ChannelMarkProps {
  name: string;
  size?: number;
  /** `round` (dorsal cuadrado redondeado) o `tile` (tesela 16:9). */
  shape?: 'round' | 'tile';
  className?: string;
  /** Solo en `tile`: la etiqueta de arriba en lugar de la sigla del canal. */
  label?: string | undefined;
}

export function ChannelMark({
  name,
  size = 52,
  shape = 'round',
  className,
  label,
}: ChannelMarkProps) {
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
  const tag = label?.trim() || channelAbbrev(name);
  return (
    <span
      className={cx(
        'dorsal',
        shape === 'tile' && 'dorsal--tile',
        dorsal.length > 1 && 'dorsal--long',
        letter && 'dorsal--letter',
        className,
      )}
      style={style}
      data-shape={shape}
      aria-hidden="true"
    >
      {shape === 'tile' ? (
        <small className={cx('dorsal__abbrev', tag.length > 9 && 'dorsal__abbrev--long')}>
          {tag}
        </small>
      ) : null}
      <b>{dorsal}</b>
    </span>
  );
}
