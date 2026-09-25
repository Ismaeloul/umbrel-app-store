/* Anillo de estado de una fuente o de un partido, para los carteles (plan
   fase 2, corrección 2 y primitiva nueva C4). Como el medidor (SignalBadge),
   SIEMPRE forma + palabra + color: cada estado tiene un dibujo propio y la
   palabra va al lado (o solo para lectores de pantalla con `hideWord`, cuando
   ya está escrita en el cartel).

   | estado    | forma                                     | palabra (la pasa quien lo usa) |
   |-----------|-------------------------------------------|--------------------------------|
   | ok        | anillo lleno                              | Verificada                     |
   | weak      | dos tercios de anillo                     | Floja                          |
   | fail      | anillo con un aspa dentro                 | Sin señal                      |
   | checking  | anillo discontinuo que gira (rotate)      | Comprobando                    |
   | pending   | anillo punteado                           | Pendiente                      |
   | reported  | anillo tachado (una barra en diagonal)    | Reportada                      |

   `active` (la fuente que está en pantalla) lo pinta en oro y más grueso. Los
   trazos son SVG con `stroke-dasharray` FIJO (pathLength 100): nada de animar
   `stroke-dashoffset`; el anillo aparece con scale + opacity y el de
   «comprobando» gira con transform. */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import './SignalRing.css';

export type SignalRingState = 'ok' | 'weak' | 'fail' | 'checking' | 'pending' | 'reported';

/** Trazo de cada estado sobre una circunferencia de longitud 100. */
const DASH: Record<SignalRingState, string | undefined> = {
  ok: undefined,
  weak: '66 34',
  fail: undefined,
  checking: '9 7',
  pending: '2 6',
  reported: undefined,
};

export interface SignalRingProps {
  state: SignalRingState;
  /** Palabra visible (Verificada · Floja · Sin señal · Comprobando · Pendiente · Reportada). */
  word: string;
  /** En pantalla ahora: anillo de oro. */
  active?: boolean;
  /** Diámetro en px. */
  size?: number;
  /** La palabra ya está escrita al lado: solo para lectores de pantalla. */
  hideWord?: boolean;
  className?: string;
}

export function SignalRing({
  state,
  word,
  active = false,
  size = 28,
  hideWord = false,
  className,
}: SignalRingProps) {
  const dash = DASH[state];
  return (
    <span
      className={cx('sring', `sring--${state}`, active && 'sring--active', className)}
      data-state={state}
      data-active={active ? 'true' : 'false'}
      style={{ '--s': `${size}px` } as CSSProperties}
    >
      <svg className="sring__svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle className="sring__track" cx="16" cy="16" r="13" pathLength={100} />
        <circle
          className="sring__ring"
          cx="16"
          cy="16"
          r="13"
          pathLength={100}
          strokeDasharray={dash}
        />
        {state === 'fail' ? (
          <path className="sring__mark" d="M11.5 11.5 20.5 20.5M20.5 11.5 11.5 20.5" />
        ) : null}
        {state === 'reported' ? <path className="sring__mark" d="M8 24 24 8" /> : null}
      </svg>
      <span className={cx('sring__word', hideWord && 'sr-only')}>{word}</span>
    </span>
  );
}
