/* Media Session: título, portada y ACCIONES en la pantalla de bloqueo, los
   auriculares, las teclas multimedia y la ventana PiP (P19). En la 0.6.59
   solo había metadatos, así que esos controles pausaban el <video> por
   debajo del controlador y la app creía que seguía sonando. Aquí cada acción
   pasa por el controlador (y P1 cubre el resto: un `play` nativo también
   cuenta como intención). */

import { useEffect, useRef } from 'react';
import type { PlayerState } from './api.ts';

export interface MediaSessionActions {
  play(): void;
  pause(): void;
  stop(): void;
  back(): void;
  previous: (() => void) | null;
  next: (() => void) | null;
}

type Handler = (details?: unknown) => void;

function session(): MediaSession | null {
  try {
    return typeof navigator !== 'undefined' && 'mediaSession' in navigator
      ? navigator.mediaSession
      : null;
  } catch {
    return null;
  }
}

function setHandler(ms: MediaSession, action: string, handler: Handler | null): void {
  try {
    ms.setActionHandler(action as MediaSessionAction, handler);
  } catch {
    // Acción que este navegador no conoce: se ignora.
  }
}

export function useMediaSession(state: PlayerState, actions: MediaSessionActions): void {
  const latest = useRef(actions);
  latest.current = actions;
  const channel = state.channel;
  const engaged = channel !== null && state.phase !== 'idle' && state.phase !== 'error';

  // Metadatos: título del canal, la segunda línea (sin marcador) y el icono.
  useEffect(() => {
    const ms = session();
    if (!ms) return;
    if (!engaged || !channel) {
      try {
        ms.metadata = null;
      } catch {}
      return;
    }
    try {
      if (typeof MediaMetadata === 'function') {
        ms.metadata = new MediaMetadata({
          title: channel.title || 'Ace Player Neo',
          artist: channel.subtitle || 'Ace Player Neo',
          album: 'Ace Player Neo',
          artwork: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        });
      }
    } catch {}
  }, [engaged, channel?.hash, channel?.title, channel?.subtitle]);

  useEffect(() => {
    const ms = session();
    if (!ms) return;
    try {
      ms.playbackState =
        state.phase === 'reproduciendo' || state.phase === 'buffer'
          ? 'playing'
          : state.phase === 'pausado' || state.phase === 'bloqueado'
            ? 'paused'
            : 'none';
    } catch {}
  }, [state.phase]);

  const canZap = actions.previous !== null && actions.next !== null;
  useEffect(() => {
    const ms = session();
    if (!ms || !engaged) return;
    const bind: Array<[string, Handler | null]> = [
      ['play', () => latest.current.play()],
      ['pause', () => latest.current.pause()],
      ['stop', () => latest.current.stop()],
      ['seekbackward', () => latest.current.back()],
      ['previoustrack', canZap ? () => latest.current.previous?.() : null],
      ['nexttrack', canZap ? () => latest.current.next?.() : null],
    ];
    for (const [action, handler] of bind) setHandler(ms, action, handler);
    return () => {
      for (const [action] of bind) setHandler(ms, action, null);
    };
  }, [engaged, canZap]);
}
