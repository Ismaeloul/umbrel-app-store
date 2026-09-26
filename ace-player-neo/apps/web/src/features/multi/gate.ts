/* La puerta de la casa (docs/multidispositivo.md §2.4.1): cada play() pasa
   por aquí ANTES de tocar el reproductor. Con otro dispositivo viendo otra
   cosa, se guarda la orden y se pregunta «¿Cambiar en los dos o solo aquí?»
   (la hoja la pinta HouseQuestion.tsx con `houseQuestionStore`).

   - La decisión es pura (decide.ts) y síncrona; sin SSE contesta `pending`:
     se refresca `playbackStatus` con 1,5 s de plazo y se decide otra vez con
     lo que haya (nunca dos `pending` seguidos). Solo vale la última orden.
   - La hoja abierta no se queda vieja: cada `playback.sessions` vuelve a
     decidir (si ya no hace falta preguntar, se cierra y sigue; si el otro ha
     cambiado de canal, cambian la frase y `from`), y un `playback.handoff`
     para este visor la cierra y tira la orden (el otro ha actuado después).
   - Contestar «Cambiar en los dos» se recuerda 5 min con los mismos
     dispositivos (D-M3); «Solo aquí» no. */

import { MULTI_TIMINGS, type PlaybackStatus, type SessionSummary } from '@ace/shared';
import { api } from '../../api/client.ts';
import { getViewerId } from '../../api/identity.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import { onSseEvent } from '../../api/sse.ts';
import { haptic } from '../../lib/haptics.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { notify } from '../../notices/notify.ts';
import {
  dispatchPlay,
  notifyPlayCancelled,
  playerStore,
  type HouseGate,
  type PlayCommand,
} from '../../player/api.ts';
import {
  decideHouseChange,
  devicesKey,
  type HouseDecision,
  type HouseQuestion,
  type RememberedBoth,
} from './decide.ts';
import {
  houseMe,
  housePolicy,
  houseSessions,
  labelsFor,
  multiEnabled,
  pausedMap,
  sseOpen,
  trackPaused,
} from './house.ts';
import { answeredText, channelName, questionTexts, type QuestionTexts } from './texts.ts';

/** La pregunta abierta: la orden guardada y sus textos. */
export interface OpenQuestion {
  readonly command: PlayCommand;
  readonly question: HouseQuestion;
  readonly texts: QuestionTexts;
  /** Nombres cortos de los otros dispositivos (para la línea de estado al contestar). */
  readonly labels: readonly string[];
}

export const houseQuestionStore = createStore<OpenQuestion | null>(null);

export function useHouseQuestion(): OpenQuestion | null {
  return useStore(houseQuestionStore);
}

/** ¿Está la hoja abierta? (el zapping ← → no hace nada mientras tanto). */
export function isHouseQuestionOpen(): boolean {
  return houseQuestionStore.get() !== null;
}

let remembered: RememberedBoth | null = null;
/** Orden a la espera de refrescar `playbackStatus` (solo la última). */
let queued: PlayCommand | null = null;
let refreshSeq = 0;
let now: () => number = () => Date.now();

const ENGAGED = new Set([
  'cargando',
  'buffer',
  'reproduciendo',
  'pausado',
  'buscando',
  'bloqueado',
]);

function engagedHash(): string | null {
  const player = playerStore.get();
  return player.channel && ENGAGED.has(player.phase) ? player.channel.hash : null;
}

function decideFor(
  command: PlayCommand,
  fresh: boolean,
  sessions: readonly SessionSummary[] = houseSessions(),
): HouseDecision {
  if (!multiEnabled()) return { go: {} };
  trackPaused(sessions, now());
  return decideHouseChange({
    sessions,
    me: houseMe(),
    hash: command.channel.hash,
    house: command.options.house,
    policy: housePolicy(),
    remembered,
    now: now(),
    sseOpen: sseOpen(),
    fresh,
    pausedSince: pausedMap(),
    engagedHash: engagedHash(),
  });
}

function withDecision(command: PlayCommand, go: { others?: string; from?: string }): PlayCommand {
  if (!go.others && !go.from) return command;
  return {
    ...command,
    options: {
      ...command.options,
      ...(go.others ? { others: go.others as 'move' | 'stop' } : {}),
      ...(go.from ? { from: go.from } : {}),
    },
  };
}

function textsFor(command: PlayCommand, question: HouseQuestion): OpenQuestion {
  const labels = labelsFor(question.others);
  const cannot = labelsFor(question.cannotFollow);
  const texts = questionTexts({
    labels,
    cannotFollow: cannot,
    ability: question.ability,
    together: question.together,
    title: channelName(question.sessionTitle, question.sessionHash),
  });
  return { command, question, texts, labels };
}

function openQuestion(command: PlayCommand, question: HouseQuestion): void {
  const previous = houseQuestionStore.get();
  if (previous && previous.command !== command) notifyPlayCancelled(previous.command);
  houseQuestionStore.set(textsFor(command, question));
  haptic('selection');
}

/** Refresca lo que se sabe de la casa (sin SSE) y decide otra vez con `fresh`. */
function refreshAndDecide(command: PlayCommand): void {
  queued = command;
  const seq = ++refreshSeq;
  void api('playbackStatus', { timeoutMs: MULTI_TIMINGS.freshStatusMs })
    .then((status: PlaybackStatus) => {
      queryClient.setQueryData(routeKey('playbackStatus'), status);
    })
    .catch(() => undefined)
    .finally(() => {
      if (seq !== refreshSeq || queued !== command) return;
      queued = null;
      const decision = decideFor(command, true);
      if ('ask' in decision) openQuestion(command, decision.ask);
      else if ('go' in decision) dispatchPlay(withDecision(command, decision.go));
      /* Sin respuesta en plazo: se sigue sin preguntar (el servidor para al otro con el aviso nuevo). */ else
        dispatchPlay(command);
    });
}

export const houseGate: HouseGate = {
  decide(command) {
    /* Un salto automático que ya dice de qué sesión viene (la que falla, §2.1). */
    if (command.options.house === 'continue' && command.options.from) return { go: {} };
    const decision = decideFor(command, false);
    if ('pending' in decision) {
      refreshAndDecide(command);
      return decision;
    }
    /* Una orden nueva sustituye a la pendiente. */
    queued = null;
    refreshSeq += 1;
    if ('ask' in decision) {
      openQuestion(command, decision.ask);
      return decision;
    }
    return decision;
  },
};

export type HouseAnswer = 'both' | 'here' | 'cancel';

/** Contesta la hoja: «Cambiar en los dos» / «Cambiar en todos», «Solo aquí» o «Cancelar». */
export function answerHouse(answer: HouseAnswer): void {
  const open = houseQuestionStore.get();
  if (!open) return;
  houseQuestionStore.set(null);
  const { command, question, labels } = open;
  if (answer === 'cancel') {
    notifyPlayCancelled(command);
    return;
  }
  haptic('success');
  const both = answer === 'both' && question.ability !== 'none';
  remembered = both ? { devices: devicesKey(question.others), at: now() } : null;
  dispatchPlay(withDecision(command, { others: both ? 'move' : 'stop', from: question.from }));
  notify(answeredText(both ? 'both' : 'here', { labels, title: command.channel.title }), {
    kind: 'signal',
    icon: 'movil',
  });
}

/** Cada `playback.sessions` con la hoja abierta: se vuelve a decidir con lo nuevo. */
function onSessions(sessions: readonly SessionSummary[]): void {
  trackPaused(sessions, now());
  const open = houseQuestionStore.get();
  if (!open) return;
  const decision = decideFor(open.command, true, sessions);
  if ('go' in decision) {
    houseQuestionStore.set(null);
    dispatchPlay(withDecision(open.command, decision.go));
    return;
  }
  if ('ask' in decision) houseQuestionStore.set(textsFor(open.command, decision.ask));
}

/** Un traspaso para este visor con la hoja abierta: el otro ha actuado después. */
function onHandoff(viewerIds: readonly string[]): void {
  if (!viewerIds.includes(getViewerId())) return;
  queued = null;
  refreshSeq += 1;
  const open = houseQuestionStore.get();
  if (!open) return;
  houseQuestionStore.set(null);
  notifyPlayCancelled(open.command);
}

/** Lo engancha el armazón (installHouse): devuelve la función para soltarlo. */
export function listenHouseGate(): () => void {
  const offs = [
    onSseEvent('playback.sessions', (data) => onSessions(data.sessions)),
    onSseEvent('playback.handoff', (data) => onHandoff(data.viewerIds)),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Solo para los tests. */
export function resetHouseGate(clock?: () => number): void {
  remembered = null;
  queued = null;
  refreshSeq += 1;
  now = clock ?? (() => Date.now());
  houseQuestionStore.set(null);
}
