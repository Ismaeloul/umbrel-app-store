/* Marcador LCD de 7 segmentos dibujado en SVG (no es una fuente).
   Admite cifras, «-», « », «:», «·» (separador) y «'» (minuto).
   Los segmentos apagados se pintan tenues, como en un LCD real.
   En SwiftUI: `Canvas`/`Path` con el mismo mapa de segmentos. */

import { useEffect, useRef, useState } from 'react';

const W = 56; // caja de una cifra
const H = 100;
const T = 13; // grosor del segmento
const G = 2.5; // separación entre segmentos
const SKEW = 5; // grados de cursiva

const SEGS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

function hSeg(cx: number, cy: number, len: number): string {
  const l = cx - len / 2;
  const r = cx + len / 2;
  const t = T / 2;
  return `${l},${cy} ${l + t},${cy - t} ${r - t},${cy - t} ${r},${cy} ${r - t},${cy + t} ${l + t},${cy + t}`;
}

function vSeg(cx: number, cy: number, len: number): string {
  const top = cy - len / 2;
  const bot = cy + len / 2;
  const t = T / 2;
  return `${cx},${top} ${cx + t},${top + t} ${cx + t},${bot - t} ${cx},${bot} ${cx - t},${bot - t} ${cx - t},${top + t}`;
}

const HL = W - T - 2 * G;
const VL = H / 2 - T / 2 - 2 * G;
const SEG_POINTS: Record<string, string> = {
  a: hSeg(W / 2, T / 2, HL),
  g: hSeg(W / 2, H / 2, HL),
  d: hSeg(W / 2, H - T / 2, HL),
  f: vSeg(T / 2, (T / 2 + G + H / 2 - G) / 2, VL),
  b: vSeg(W - T / 2, (T / 2 + G + H / 2 - G) / 2, VL),
  e: vSeg(T / 2, (H / 2 + G + H - T / 2 - G) / 2, VL),
  c: vSeg(W - T / 2, (H / 2 + G + H - T / 2 - G) / 2, VL),
};

const NARROW = 0.42;

function widthOf(ch: string): number {
  if (ch === ':' || ch === '·' || ch === '.') return W * NARROW;
  if (ch === "'") return W * 0.3;
  return W;
}

const GAP = 10;

export interface LcdProps {
  text: string;
  /** Altura en px de la cifra. */
  height?: number;
  className?: string;
  /** Cuando cambia, el LCD parpadea dos veces (`steps(1)`). */
  blinkKey?: string | number;
  label?: string;
  /** Sin segmentos apagados (para tamaños muy pequeños). */
  plain?: boolean;
}

export function Lcd({ text, height = 40, className, blinkKey, label, plain = false }: LcdProps) {
  const chars = [...text];
  const total = chars.reduce((a, c) => a + widthOf(c), 0) + GAP * Math.max(0, chars.length - 1);
  const skewPad = Math.tan((SKEW * Math.PI) / 180) * H;
  const vbW = total + skewPad + 4;
  const scale = height / H;
  const [blink, setBlink] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (blinkKey === undefined) return;
    setBlink(true);
    const t = setTimeout(() => setBlink(false), 1300);
    return () => clearTimeout(t);
  }, [blinkKey]);

  let x = skewPad + 2;
  const glyphs = chars.map((ch, i) => {
    const w = widthOf(ch);
    const gx = x;
    x += w + GAP;
    const off: string[] = [];
    const on: string[] = [];
    if (ch === ':' ) {
      const s = T * 0.95;
      on.push(`${gx + w / 2 - s / 2},${H * 0.3 - s / 2} ${gx + w / 2 + s / 2},${H * 0.3 - s / 2} ${gx + w / 2 + s / 2},${H * 0.3 + s / 2} ${gx + w / 2 - s / 2},${H * 0.3 + s / 2}`);
      on.push(`${gx + w / 2 - s / 2},${H * 0.7 - s / 2} ${gx + w / 2 + s / 2},${H * 0.7 - s / 2} ${gx + w / 2 + s / 2},${H * 0.7 + s / 2} ${gx + w / 2 - s / 2},${H * 0.7 + s / 2}`);
    } else if (ch === '·' || ch === '.') {
      const s = T * 0.95;
      const cy = ch === '.' ? H - s / 2 : H / 2;
      on.push(`${gx + w / 2 - s / 2},${cy - s / 2} ${gx + w / 2 + s / 2},${cy - s / 2} ${gx + w / 2 + s / 2},${cy + s / 2} ${gx + w / 2 - s / 2},${cy + s / 2}`);
    } else if (ch === "'") {
      const s = T * 0.8;
      on.push(`${gx + w / 2 - s / 2},0 ${gx + w / 2 + s / 2},0 ${gx + w / 2 + s / 2 - 2},${T * 1.6} ${gx + w / 2 - s / 2 - 2},${T * 1.6}`);
    } else {
      const lit = SEGS[ch] ?? '';
      for (const seg of 'abcdefg') {
        const pts = SEG_POINTS[seg]
          .split(' ')
          .map((p) => {
            const [px, py] = p.split(',').map(Number);
            return `${px + gx},${py}`;
          })
          .join(' ');
        (lit.includes(seg) ? on : off).push(pts);
      }
    }
    return { key: i, on, off };
  });

  return (
    <svg
      className={`tr-lcd${blink ? ' is-blink' : ''}${className ? ` ${className}` : ''}`}
      width={vbW * scale}
      height={height}
      viewBox={`0 0 ${vbW} ${H}`}
      role="img"
      aria-label={label ?? text.replace('·', ' a ').replace(/-/g, 'raya')}
      shapeRendering="geometricPrecision"
    >
      <g transform={`skewX(-${SKEW}) translate(${skewPad * 0.5} 0)`}>
        {!plain && (
          <g className="tr-lcd-off">
            {glyphs.flatMap((g) => g.off.map((pts, j) => <polygon key={`${g.key}-${j}`} points={pts} />))}
          </g>
        )}
        <g className="tr-lcd-on">
          {glyphs.flatMap((g) => g.on.map((pts, j) => <polygon key={`${g.key}-${j}`} points={pts} />))}
        </g>
      </g>
    </svg>
  );
}

/** Marcador «2·1» o «-·-» cuando va tapado. Parpadea con cada gol visible. */
export function LcdScore({ home, away, hidden, height = 40, className, plain }: { home: number; away: number; hidden: boolean; height?: number; className?: string; plain?: boolean }) {
  const text = hidden ? '-·-' : `${home}·${away}`;
  /* En tamaños pequeños (mini) no se pintan los segmentos apagados: con el
     marcador tapado, «-·-» podría leerse como un «00» tenue. */
  return <Lcd text={text} height={height} className={className} blinkKey={hidden ? 'oculto' : `${home}-${away}`} label={hidden ? 'Marcador tapado' : `${home} a ${away}`} plain={plain ?? height < 32} />;
}

/** Hora «21:00». */
export function LcdTime({ text, height = 24, className, plain }: { text: string; height?: number; className?: string; plain?: boolean }) {
  return <Lcd text={text} height={height} className={className} label={text} plain={plain} />;
}

/** Minuto «67'». */
export function LcdMinute({ minute, height = 24, className }: { minute: number; height?: number; className?: string }) {
  const t = `${minute}'`;
  return <Lcd text={t} height={height} className={className} label={`minuto ${minute}`} />;
}
