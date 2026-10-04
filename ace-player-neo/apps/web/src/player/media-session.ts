/* Media Session: título, portada y ACCIONES en la pantalla de bloqueo, los
   auriculares, las teclas multimedia y la ventana PiP (P19). En la 0.6.59
   solo había metadatos, así que esos controles pausaban el <video> por
   debajo del controlador y la app creía que seguía sonando. Aquí cada acción
   pasa por el controlador (y P1 cubre el resto: un `play` nativo también
   cuenta como intención).

   Con una película o un episodio (docs/vod.md §12.7): `seekto`,
   `seekbackward`/`seekforward` (10 s), `nexttrack` (siguiente episodio),
   `setPositionState` cada 2 s y el cartel (`vodArt`) como portada. */

import { useEffect, useRef } from 'react';
import { routeUrl } from '../api/routes.ts';
import type { PlayerState } from './api.ts';
import { VOD_POSITION_STATE_MS } from './vod/timeline.ts';

export interface MediaSessionActions {
  play(): void;
  pause(): void;
  stop(): void;
  back(): void;
  previous: (() => void) | null;
  next: (() => void) | null;
  /** Solo con una película: +10 s. */
  forward?: (() => void) | null;
  /** Solo con una película: saltar a un punto (la barra de la pantalla de bloqueo). */
  seekTo?: ((seconds: number) => void) | null;
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

const APP_ARTWORK: MediaImage[] = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
];

/** El cartel de una película como portada (o el icono de la app si no hay). */
export function vodArtwork(state: Pick<PlayerState, 'vod' | 'demo'>): MediaImage[] {
  const vod = state.vod;
  if (!vod?.poster || state.demo) return APP_ARTWORK;
  const id = vod.kind === 'episode' && vod.seriesId ? vod.seriesId : vod.id;
  return [{ src: routeUrl('vodArt', { id, art: 'poster' }, { v: vod.poster }) }, ...APP_ARTWORK];
}

export function useMediaSession(state: PlayerState, actions: MediaSessionActions): void {
  const latest = useRef(actions);
  latest.current = actions;
  const channel = state.channel;
  const engaged = channel !== null && state.phase !== 'idle' && state.phase !== 'error';
  const vod = state.kind === 'vod' ? state.vod : null;
  const poster = vod?.poster ?? null;

  // Metadatos: título del canal (o de la película), la segunda línea y la portada.
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
          artwork: state.kind === 'vod' ? vodArtwork(state) : APP_ARTWORK,
        });
      }
    } catch {}
    // `state` entero cambia cada 500 ms: mandan el título, la segunda línea y el cartel.
  }, [engaged, channel?.hash, channel?.title, channel?.subtitle, poster]);

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

  // La barra de la pantalla de bloqueo (solo películas): cada 2 s como mucho.
  const lastPosition = useRef(0);
  useEffect(() => {
    const ms = session();
    if (!ms || typeof ms.setPositionState !== 'function') return;
    if (!vod || !(vod.durationS > 0) || !engaged) {
      if (lastPosition.current) {
        lastPosition.current = 0;
        try {
          ms.setPositionState();
        } catch {}
      }
      return;
    }
    const now = Date.now();
    if (now - lastPosition.current < VOD_POSITION_STATE_MS) return;
    lastPosition.current = now;
    try {
      ms.setPositionState({
        duration: vod.durationS,
        position: Math.min(vod.durationS, Math.max(0, vod.positionS)),
        playbackRate: 1,
      });
    } catch {}
  }, [vod?.positionS, vod?.durationS, engaged]);

  const hasPrevious = actions.previous !== null;
  const hasNext = actions.next !== null;
  const hasForward = Boolean(actions.forward);
  const hasSeekTo = Boolean(actions.seekTo);
  useEffect(() => {
    const ms = session();
    if (!ms || !engaged) return;
    const bind: Array<[string, Handler | null]> = [
      ['play', () => latest.current.play()],
      ['pause', () => latest.current.pause()],
      ['stop', () => latest.current.stop()],
      ['seekbackward', () => latest.current.back()],
      ['seekforward', hasForward ? () => latest.current.forward?.() : null],
      [
        'seekto',
        hasSeekTo
          ? (details) => {
              const time = (details as { seekTime?: number } | undefined)?.seekTime;
              if (typeof time === 'number' && Number.isFinite(time)) latest.current.seekTo?.(time);
            }
          : null,
      ],
      ['previoustrack', hasPrevious ? () => latest.current.previous?.() : null],
      ['nexttrack', hasNext ? () => latest.current.next?.() : null],
    ];
    for (const [action, handler] of bind) setHandler(ms, action, handler);
    return () => {
      for (const [action] of bind) setHandler(ms, action, null);
    };
  }, [engaged, hasPrevious, hasNext, hasForward, hasSeekTo]);
}
