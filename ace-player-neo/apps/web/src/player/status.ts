/* Textos del reproductor: la línea de estado bajo el vídeo (estado base de
   src/notices/statusLine.ts), el panel del vídeo y el botón de directo.
   Funciones puras sobre el estado público: se prueban solas.

   Regla del diseño (sistema.md, StatusLine): lo que pasa, en lenguaje humano
   («Fuente 1 verificada. Vas en directo.») y, si hace falta, un dato corto a
   la derecha («−34 s» si vas por detrás). Lo técnico (pares, velocidades,
   códec, el retraso respecto a la emisión) va en «Datos técnicos», nunca aquí.

   «En directo» y «por detrás» se miden contra el borde útil del propio
   reproductor (`live.atLive`, `live.behindS`), no contra lo último que ha
   llegado: un directo IPTV/HLS (o AceStream) siempre va unos segundos por
   detrás de la emisión (el colchón de seguridad), y decir «Vas en directo» con
   «8 s de retraso» al lado se contradecía. Ese retraso (`live.delayS`) solo
   sale en «Datos técnicos». */

import type { StatusContent } from '../notices/statusLine.ts';
import { isIptvPlayback, type PlayerState } from './api.ts';
import { VOD_TEXT } from './vod/texts.ts';
import { clockText, remainingText } from './vod/timeline.ts';

/** «Conectando con AceStream…» o, si la fuente es de la IPTV, «Conectando con tu IPTV…» (§8.3). */
function connectingText(state: PlayerState): string {
  return isIptvPlayback(state) ? 'Conectando con tu IPTV…' : 'Conectando con AceStream…';
}

function withLead(lead: string | undefined, text: string): string {
  const clean = lead?.trim();
  return clean ? `${clean} ${text}` : text;
}

/**
 * La línea de estado con una película o un episodio (docs/vod.md §12.7):
 * «Preparando la película…», «Buscando…», «Cargando…», «En pausa» y, sonando,
 * lo que queda. Nunca un aviso encima del vídeo.
 */
export function vodStatusFor(state: PlayerState): StatusContent | null {
  const vod = state.vod;
  const clock =
    vod && vod.durationS > 0
      ? `${clockText(vod.positionS)} / ${clockText(vod.durationS)}`
      : undefined;
  switch (state.phase) {
    case 'cargando':
      return {
        text: state.message ?? VOD_TEXT.preparingMovie,
        signal: 'checking',
      };
    case 'reconectando':
      return { text: state.message ?? VOD_TEXT.preparingMovie, signal: 'checking', tone: 'warn' };
    case 'error':
      return {
        text: state.message ?? 'No se ha podido abrir el vídeo.',
        signal: 'fail',
        tone: 'err',
      };
    case 'buffer':
      return { text: VOD_TEXT.loading, signal: 'weak', ...(clock ? { meta: clock } : {}) };
    case 'buscando':
      return { text: VOD_TEXT.seeking, icon: 'refresh', ...(clock ? { meta: clock } : {}) };
    case 'pausado':
      return {
        text: vod?.ended ? VOD_TEXT.ended : VOD_TEXT.paused,
        // Terminada no es una pausa: la marca de hecho, no el icono de pausa.
        icon: vod?.ended ? 'check' : 'pause',
        ...(clock ? { meta: clock } : {}),
      };
    case 'reproduciendo':
      if (!vod || !(vod.durationS > 0)) return { text: VOD_TEXT.loading, signal: 'ok' };
      if (vod.ended) return { text: VOD_TEXT.ended, icon: 'check' };
      return {
        text: remainingText(vod.positionS, vod.durationS),
        signal: 'ok',
        ...(state.demo ? { meta: 'demo' } : clock ? { meta: clock } : {}),
      };
    case 'bloqueado':
      return { text: 'Toca el vídeo para reproducir.', icon: 'play' };
    default:
      return null;
  }
}

/** Estado base de la línea de estado (null: que la ponga el centro de partido). */
export function statusFor(state: PlayerState): StatusContent | null {
  if (state.kind === 'vod' && state.phase !== 'idle') return vodStatusFor(state);
  const lead = state.channel?.lead;
  switch (state.phase) {
    case 'idle':
      if (state.waiting && state.waitingFinal)
        return { text: state.waiting, signal: 'fail', tone: 'err' };
      if (state.waiting) return { text: state.waiting, signal: 'checking' };
      if (state.idleReason === 'traspasado' && state.message)
        return { text: state.message, icon: 'movil' };
      if (state.idleReason === 'detenido' && state.message)
        return { text: state.message, icon: 'stop' };
      return null;
    case 'cargando':
      return {
        text: state.message ?? connectingText(state),
        signal: 'checking',
        ...(state.attempt ? { meta: `intento ${state.attempt.n} de ${state.attempt.max}` } : {}),
      };
    // El aviso ya lleva «(n/máx)»: sin dato a la derecha, que en el móvil no cabe.
    case 'reconectando':
      return {
        text: state.message ?? 'Reconectando…',
        signal: 'checking',
        tone: 'warn',
      };
    case 'error':
      return {
        text: state.message ?? 'No se pudo abrir el canal.',
        signal: 'fail',
        tone: 'err',
      };
    case 'bloqueado':
      return {
        text: 'Toca el vídeo para reproducir.',
        icon: 'play',
      };
    case 'buffer':
      return {
        text: withLead(lead, 'La señal va justa: rellenando el colchón.'),
        signal: 'weak',
        ...(state.rebuffering
          ? { meta: `${Math.floor(state.bufferAheadS)} de ${state.rebuffering.targetS} s` }
          : {}),
      };
    case 'buscando':
      return { text: 'Saltando…', icon: 'refresh' };
    case 'pausado':
      return {
        text: 'En pausa. Pulsa Directo para volver al directo.',
        icon: 'pause',
        // Solo si de verdad te has quedado atrás (no por el colchón de siempre).
        ...(state.live.available && !state.live.atLive && state.live.behindS > 0
          ? { meta: `−${state.live.behindS} s` }
          : {}),
      };
    case 'reproduciendo':
      if (state.demo)
        return {
          text: withLead(lead, 'Vas en directo.'),
          signal: 'ok',
          meta: 'demo',
        };
      // Por detrás, lo importante es eso: sin la frase de la fuente, que en
      // 390 px cortaba «Vas por detrás…» justo en lo que había que leer.
      if (state.live.available && !state.live.atLive)
        return {
          text: 'Vas por detrás del directo.',
          signal: 'ok',
          meta: `−${state.live.behindS} s`,
        };
      // En el borde útil: sin cifra (el retraso inherente va en «Datos técnicos»).
      return { text: withLead(lead, 'Vas en directo.'), signal: 'ok' };
  }
}

export type LiveButtonMode = 'live' | 'behind' | 'resume' | 'off';

/**
 * Botón de directo con dos estados (injerto B4): relleno «Directo» si vas en
 * el borde; con contorno «Ir al directo · −34 s» si te has quedado atrás; y
 * «Reanudar» en pausa o bloqueado estando en el borde (inventario §8.2).
 */
export function liveButton(state: PlayerState): {
  mode: LiveButtonMode;
  /** Lo que se puede esconder si no cabe («Ir al directo · »). */
  prefix: string;
  text: string;
  label: string;
} {
  // Sin imagen (conectando, reconectando, error) no hay directo al que ir.
  const noPicture = state.conn !== 'activa' && state.phase !== 'bloqueado';
  if (!state.channel || state.phase === 'idle' || state.phase === 'error' || noPicture)
    return { mode: 'off', prefix: '', text: 'Directo', label: 'Directo' };
  const behind = state.live.available && !state.live.atLive && !state.demo;
  if (behind)
    return {
      mode: 'behind',
      prefix: 'Ir al directo · ',
      text: `−${state.live.behindS} s`,
      label: `Ir al directo (vas ${state.live.behindS} segundos por detrás)`,
    };
  if (state.phase === 'pausado' || state.phase === 'bloqueado')
    return { mode: 'resume', prefix: '', text: 'Reanudar', label: 'Reanudar en directo' };
  return { mode: 'live', prefix: '', text: 'Directo', label: 'Ya en directo' };
}

/** Titular y frase del panel del vídeo mientras no hay imagen. */
export function stageMessage(state: PlayerState): {
  title: string;
  text: string;
  tone: 'idle' | 'busy' | 'error';
} | null {
  if (state.kind === 'vod') {
    switch (state.phase) {
      case 'cargando':
        if (state.conn === 'activa') return null;
        return {
          title:
            state.vod?.kind === 'episode' ? 'Preparando el episodio' : 'Preparando la película',
          text: state.vod?.title ?? state.channel?.title ?? '',
          tone: 'busy',
        };
      case 'reconectando':
        return { title: 'Reconectando', text: state.message ?? '', tone: 'busy' };
      case 'error':
        return state.vod?.failure?.code === 'vod_idle'
          ? { title: 'En pausa', text: state.message ?? '', tone: 'idle' }
          : {
              title: 'No se puede reproducir',
              text: state.message ?? 'No se ha podido abrir el vídeo.',
              tone: 'error',
            };
      default:
        break;
    }
  }
  switch (state.phase) {
    case 'idle':
      if (state.waiting && state.waitingFinal)
        return { title: 'Sin señal', text: state.waiting, tone: 'idle' };
      if (state.waiting) return { title: 'Buscando señal', text: state.waiting, tone: 'busy' };
      if (state.idleReason === 'traspasado')
        return { title: 'En otro dispositivo', text: state.message ?? '', tone: 'idle' };
      return {
        title: 'Sin señal',
        text: state.message ?? 'Elige un partido en la agenda o un canal de la biblioteca.',
        tone: 'idle',
      };
    case 'cargando':
      // Con imagen (reanudar tras una pausa) no se tapa el vídeo; sin ella, sí.
      if (state.conn === 'activa') return null;
      return {
        title: state.started || state.attempt ? 'Reconectando' : 'Conectando',
        text: state.message ?? connectingText(state),
        tone: 'busy',
      };
    case 'reconectando':
      return { title: 'Reconectando', text: state.message ?? 'Reconectando…', tone: 'busy' };
    case 'error':
      return {
        title: 'No se pudo abrir',
        text: state.message ?? 'El reproductor no pudo iniciar esta fuente. Prueba la siguiente.',
        tone: 'error',
      };
    default:
      return null;
  }
}
