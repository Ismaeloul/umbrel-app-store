/* Textos del reproductor: la línea de estado bajo el vídeo (estado base de
   src/notices/statusLine.ts), el panel del vídeo y el botón de directo.
   Funciones puras sobre el estado público: se prueban solas.

   Regla del diseño (sistema.md, StatusLine): lo que pasa, en lenguaje humano
   («Fuente 1 verificada. Vas en directo.») y un dato corto a la derecha
   («6 s de retraso»). Lo técnico (pares, velocidades, códec) va en «Datos
   técnicos», nunca aquí. */

import type { StatusContent } from '../notices/statusLine.ts';
import type { PlayerState } from './api.ts';

function withLead(lead: string | undefined, text: string): string {
  const clean = lead?.trim();
  return clean ? `${clean} ${text}` : text;
}

/** Estado base de la línea de estado (null: que la ponga el centro de partido). */
export function statusFor(state: PlayerState): StatusContent | null {
  const lead = state.channel?.lead;
  switch (state.phase) {
    case 'idle':
      if (state.waiting) return { text: state.waiting, signal: 'checking' };
      if (state.idleReason === 'traspasado' && state.message)
        return { text: state.message, icon: 'movil' };
      if (state.idleReason === 'detenido' && state.message)
        return { text: state.message, icon: 'stop' };
      return null;
    case 'cargando':
      return {
        text: state.message ?? 'Conectando con AceStream…',
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
        ...(state.live.available && state.live.behindS > 0
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
      return {
        text: withLead(lead, 'Vas en directo.'),
        signal: 'ok',
        ...(state.live.delayS !== null ? { meta: `${state.live.delayS} s de retraso` } : {}),
      };
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
  switch (state.phase) {
    case 'idle':
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
        text: state.message ?? 'Conectando con AceStream…',
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
