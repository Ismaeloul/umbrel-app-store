/* La máquina de estados explícita de una fuente (arquitectura §5.9) y la de
   sus informes (backend-modulos §7.4).

   Fuente: desconocida → comprobando → verificada / floja / fallida.
   - El veredicto del reproductor manda 3 min sobre cualquier sonda.
   - Una verificada que falla UNA sonda por causa ajena al vídeo queda floja;
     el segundo fallo seguido la deja fallida; `unsupported_codec` y
     `no_video` no se suavizan.
   - Todo caduca a los 10 min (lo fallido, al retraso de reintento) y vuelve
     a desconocida. El reintento único de las fallidas lo lleva la cola del
     comprobador (`scannerRetryPlan`).
   Las transiciones son las mismas funciones que usa la caché del
   comprobador (scanner/verdicts.ts): aquí se componen para poder recorrer la
   máquina entera en los tests sin montar la cola.

   Informe: checking → working / weak / failed / reported (según el motivo y
   la comprobación), `reported` si se queda sin comprobación, y `working` sin
   cuarentena si el usuario confirma el canal. */

import type { SourceReport } from '@ace/shared';
import {
  applyVerdict,
  isFresh,
  sourceStateOf,
  type CachedVerdict,
  type SourceState,
  type VerdictInput,
  type VerdictPolicy,
} from '../scanner/verdicts.js';
import { reportAfterProbe, reportWithoutProbe, type ProbeOutcome } from './reports.js';

export {
  API_NAME_OF_STATE,
  applyVerdict,
  sourceStateOf,
  verdictPolicy,
  type CachedVerdict,
  type SourceState,
  type VerdictPolicy,
} from '../scanner/verdicts.js';

export interface SourceMachine {
  readonly state: SourceState;
  /** El veredicto guardado (null = ninguno o caducado). */
  readonly entry: CachedVerdict | null;
}

export type SourceEvent =
  /** Empieza una sonda (o el reproductor está conectando). */
  | { readonly type: 'check'; readonly now: number }
  /** Llega un veredicto del comprobador o del reproductor. */
  | { readonly type: 'verdict'; readonly result: VerdictInput; readonly now: number }
  /** Pasa el tiempo: lo caducado vuelve a desconocida. */
  | { readonly type: 'tick'; readonly now: number };

export const INITIAL_SOURCE: SourceMachine = { state: 'desconocida', entry: null };

/** Un paso de la máquina de una fuente. */
export function stepSource(
  machine: SourceMachine,
  event: SourceEvent,
  policy: VerdictPolicy,
): SourceMachine {
  const entry = machine.entry && isFresh(machine.entry, event.now, policy) ? machine.entry : null;
  switch (event.type) {
    case 'check':
      return { state: 'comprobando', entry };
    case 'verdict': {
      const next = applyVerdict(entry ?? undefined, event.result, event.now, policy);
      const kept = next.entry ?? entry;
      return { state: sourceStateOf(kept ?? undefined, event.now, policy), entry: kept };
    }
    case 'tick':
      return {
        state:
          machine.state === 'comprobando'
            ? 'comprobando'
            : sourceStateOf(entry ?? undefined, event.now, policy),
        entry,
      };
  }
}

export type ReportEvent =
  /** La comprobación del informe dio un resultado definitivo. */
  | { readonly type: 'probe'; readonly outcome: ProbeOutcome; readonly now: number }
  /** Se quedó sin comprobación: sin comprobador, trabajo cancelado o podado, reinicio. */
  | { readonly type: 'unchecked' }
  /** "Es el canal correcto" sobre un informe de canal equivocado. */
  | { readonly type: 'confirmed'; readonly at: string };

/** Un paso de la máquina de un informe. */
export function stepReport(report: SourceReport, event: ReportEvent): SourceReport {
  switch (event.type) {
    case 'probe':
      return reportAfterProbe(report, event.outcome, event.now);
    case 'unchecked':
      return reportWithoutProbe(report);
    case 'confirmed':
      return report.reason === 'wrong_channel'
        ? { ...report, state: 'working', quarantineUntil: null, lastCheckedAt: event.at }
        : report;
  }
}
