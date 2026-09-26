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
  play,
  playerStore,
  setHouseIdle,
  type HouseGate,
  type HouseIdleInfo,
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
import {
  NOTHING_CHANGED,
  answeredText,
  channelName,
  questionTexts,
  type QuestionTexts,
} from './texts.ts';

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

/**
 * Un `move` que sale: con «en los dos» recordado, se apunta su `from` (el
 * zapping siguiente lo manda si este visor aún no está en ninguna sesión).
 */
function noteMove(go: { others?: string; from?: string }): void {
  if (go.others === 'move' && go.from && remembered) remembered = { ...remembered, from: go.from };
}

function withDecision(command: PlayCommand, go: { others?: string; from?: string }): PlayCommand {
  noteMove(go);
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

/** El panel «otra cosa en casa» que ha puesto la puerta (null si ninguno o ya no es el suyo). */
let gatePanel: HouseIdleInfo | null = null;

/**
 * Con la hoja abierta y nada sonando aquí, detrás no queda «Sin señal · Elige
 * un partido…»: el panel «otra cosa en casa» dice qué se ve en el otro, y
 * «Poner aquí» vuelve a preguntar (§2.5.1, fila 11 de la tabla A1). Vale
 * también para un canal suelto abierto por enlace o de un toque.
 */
function showElsewhere(open: OpenQuestion): void {
  const player = playerStore.get();
  if (player.phase !== 'idle' || engagedHash() !== null) return;
  if (player.houseIdle && player.houseIdle !== gatePanel) return;
  const info: HouseIdleInfo = {
    labels: [...open.labels],
    title: channelName(open.question.sessionTitle, open.question.sessionHash),
  };
  gatePanel = info;
  const { channel, options } = open.command;
  setHouseIdle(info, () => {
    gatePanel = null;
    play(channel, options);
  });
}

function openQuestion(command: PlayCommand, question: HouseQuestion): void {
  const previous = houseQuestionStore.get();
  if (previous && previous.command !== command) notifyPlayCancelled(previous.command);
  const open = textsFor(command, question);
  houseQuestionStore.set(open);
  showElsewhere(open);
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
    if (command.options.house === 'continue' && command.options.from) {
      noteMove({ others: command.options.others ?? '', from: command.options.from });
      return { go: {} };
    }
    const decision = decideFor(command, false);
    if ('go' in decision) noteMove(decision.go);
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
  clearSettle();
  houseQuestionStore.set(null);
  const { command, question, labels } = open;
  if (answer === 'cancel') {
    notifyPlayCancelled(command);
    /* La sesión de fuentes de un partido pone su propio panel y su aviso; si
       no (canal suelto), queda el de la puerta y «No has cambiado nada». */
    const player = playerStore.get();
    if (gatePanel && player.houseIdle === gatePanel && player.phase === 'idle')
      notify(NOTHING_CHANGED, { kind: 'signal', icon: 'movil' });
    return;
  }
  haptic('success');
  const both = answer === 'both' && question.ability !== 'none';
  remembered = both
    ? { devices: devicesKey(question.others), at: now(), from: question.from }
    : null;
  dispatchPlay(withDecision(command, { others: both ? 'move' : 'stop', from: question.from }));
  notify(answeredText(both ? 'both' : 'here', { labels, title: command.channel.title }), {
    kind: 'signal',
    icon: 'movil',
  });
}

/** «Ya no hace falta preguntar» esperando a confirmarse (no se sigue por un instante raro). */
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function clearSettle(): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
}

/**
 * Cada `playback.sessions` con la hoja abierta: se vuelve a decidir con lo
 * nuevo. Si el otro ha cambiado de canal, cambian la frase y `from` al
 * momento; si ya no hace falta preguntar (ha parado o ya ve lo mismo), la
 * hoja se cierra y sigue sola, pero solo si sigue así `capsuleHideMs` (un
 * traspaso a medias o un cambio de fuente del otro no la cierran).
 */
function onSessions(sessions: readonly SessionSummary[]): void {
  trackPaused(sessions, now());
  const open = houseQuestionStore.get();
  if (!open) return;
  const decision = decideFor(open.command, true, sessions);
  if ('ask' in decision) {
    clearSettle();
    houseQuestionStore.set(textsFor(open.command, decision.ask));
    return;
  }
  if (!('go' in decision) || settleTimer) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    const still = houseQuestionStore.get();
    if (still !== open) return;
    const again = decideFor(open.command, true);
    if (!('go' in again)) return;
    houseQuestionStore.set(null);
    dispatchPlay(withDecision(open.command, again.go));
  }, MULTI_TIMINGS.capsuleHideMs);
}

/** Un traspaso para este visor con la hoja abierta: el otro ha actuado después. */
function onHandoff(viewerIds: readonly string[]): void {
  if (!viewerIds.includes(getViewerId())) return;
  queued = null;
  refreshSeq += 1;
  clearSettle();
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
  gatePanel = null;
  queued = null;
  refreshSeq += 1;
  clearSettle();
  now = clock ?? (() => Date.now());
  houseQuestionStore.set(null);
}
