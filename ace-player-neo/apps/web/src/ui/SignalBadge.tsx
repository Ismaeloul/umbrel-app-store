/* Estado de una fuente (o de la señal de un partido): medidor de tres barras
   SIEMPRE con su palabra. El mismo componente en la agenda, las fuentes, la
   biblioteca y la línea de estado. Nunca solo color: cada estado tiene forma
   propia.

   | estado     | forma                                         | palabra      |
   |------------|-----------------------------------------------|--------------|
   | ok         | tres barras llenas                             | Verificada   |
   | weak       | dos llenas                                     | Floja        |
   | fail       | ninguna llena y un aspa (B: nada encendido)   | Sin señal    |
   | checking   | huecas, se rellenan una tras otra (corr. 3);  | Comprobando  |
   |            | con movimiento reducido, contorno discontinuo  |              |
   | pending    | punteadas en gris                              | Pendiente    |

   `compact` (injerto C4): glifo ● ▲ ✕ ○ ◌ + palabra, para donde no cabe el
   medidor (chips, avisos, Live Activity). */

import type { ScanCandidateState, VerdictState } from '@ace/shared';
import { cx } from '../lib/cx.ts';
import './SignalBadge.css';

export type SignalState = 'ok' | 'weak' | 'fail' | 'checking' | 'pending';

export const SIGNAL_WORD: Record<SignalState, string> = {
  ok: 'Verificada',
  weak: 'Floja',
  fail: 'Sin señal',
  checking: 'Comprobando',
  pending: 'Pendiente',
};

export const SIGNAL_GLYPH: Record<SignalState, string> = {
  ok: '●',
  weak: '▲',
  fail: '✕',
  checking: '◌',
  pending: '○',
};

/** Estado del comprobador o veredicto → estado del medidor. */
export function signalFromCandidate(
  state: ScanCandidateState | VerdictState | null | undefined,
): SignalState {
  switch (state) {
    case 'working':
      return 'ok';
    case 'weak':
      return 'weak';
    case 'failed':
      return 'fail';
    case 'checking':
      return 'checking';
    default:
      return 'pending';
  }
}

export interface SignalBadgeProps {
  state: SignalState;
  /** Otra palabra («Sin señal · reintento 20:51», injerto B7). */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  /** `stacked`: barras encima y palabra debajo, alineadas a la derecha (fila de agenda). */
  layout?: 'inline' | 'stacked';
  /** Glifo en vez de medidor (C4). */
  compact?: boolean;
  /** Sin palabra visible (la frase de al lado ya lo dice); se sigue leyendo. */
  hideWord?: boolean;
  className?: string;
}

export function SignalBadge({
  state,
  label,
  size = 'md',
  layout = 'inline',
  compact = false,
  hideWord = false,
  className,
}: SignalBadgeProps) {
  const word = label ?? SIGNAL_WORD[state];
  return (
    <span
      className={cx(
        'sig',
        `sig--${state}`,
        `sig--${size}`,
        layout === 'stacked' && 'sig--stacked',
        compact && 'sig--compact',
        className,
      )}
      data-state={state}
    >
      {compact ? (
        <span className="sig__glyph" aria-hidden="true">
          {SIGNAL_GLYPH[state]}
        </span>
      ) : (
        <span className="sig__bars" aria-hidden="true">
          <i>
            <b />
          </i>
          <i>
            <b />
          </i>
          <i>
            <b />
          </i>
        </span>
      )}
      <span className={cx('sig__word', hideWord && 'sr-only')}>{word}</span>
    </span>
  );
}
