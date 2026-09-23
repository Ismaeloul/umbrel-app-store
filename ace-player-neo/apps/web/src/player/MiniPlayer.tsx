/* Mini-reproductor «Sonando» (B-096, maqueta opcion-A/base.css .mini): al
   volver a la portada con algo sonando no se para; queda una cápsula con la
   imagen pequeña, el canal y la segunda línea (sin marcador: regla 29),
   pausa y detener. Tocarla vuelve al vídeo.

   En el móvil se arrastra: hacia arriba vuelve al vídeo; hacia un lado la
   quita (detiene, con «Deshacer» durante 6 s). Durante el arrastre solo se
   mueve con transform.

   «Dónde se está reproduciendo» (Ajustes → `ajustes/donde`): un botón con la
   tele. En pantallas anchas siempre; en el móvil, para no apretar el título,
   solo cuando otro dispositivo ve lo mismo (`data-shared`, del evento SSE
   `playback.sessions` que ya está en la caché: no pide nada). */

import type { RefObject } from 'react';
import { getDeviceId, getViewerId } from '../api/identity.ts';
import { useApiQuery } from '../api/query.ts';
import { useNavigate } from '../app/router.tsx';
import { otherDevicesWatching } from '../features/where-playing/model.ts';
import { useSwipe } from '../lib/gestures.ts';
import { prefersReducedMotion } from '../lib/media.ts';
import { toast } from '../notices/toasts.ts';
import { IconButton } from '../ui/Button.tsx';
import { play, stop, usePlayer, type PlayerState } from './api.ts';
import { usePlayerContext, type PlayerContextValue } from './context.ts';
import { Equalizer } from './PlayerSurface.tsx';

export function miniKicker(state: PlayerState): string {
  switch (state.phase) {
    case 'reproduciendo':
    case 'buffer':
    case 'buscando':
      return 'Sonando';
    case 'cargando':
      return 'Conectando…';
    case 'reconectando':
      return 'Reconectando…';
    case 'pausado':
      return 'En pausa';
    case 'bloqueado':
      return 'Toca para reproducir';
    case 'error':
      return 'Sin señal';
    default:
      return 'Detenido';
  }
}

function Mini({
  ctx,
  rootRef,
}: {
  ctx: PlayerContextValue;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const state = usePlayer();
  const { actions } = ctx;
  const navigate = useNavigate();
  /* Solo lo que ya hay en la caché (arranque + SSE): el mini no pide nada. */
  const playback = useApiQuery('playbackStatus', undefined, { enabled: false });
  const others = otherDevicesWatching(playback.data?.sessions, getViewerId(), getDeviceId());
  const wantsPlay = state.desiredPlaying || state.phase === 'buffer';
  const title = state.channel?.title ?? 'Ace Player Neo';

  const move = (dx: number, dy: number) => {
    const el = rootRef.current;
    if (!el) return;
    // Hacia abajo no hay a dónde ir (está la barra): se frena.
    const y = dy > 0 ? dy * 0.25 : dy;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dx}px, ${y}px, 0)`;
    el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 320));
  };
  const settle = () => {
    const el = rootRef.current;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
  };
  const dismiss = (direction: 1 | -1) => {
    const el = rootRef.current;
    const channel = state.channel;
    const route = state.route;
    const origin = state.origin ?? 'user';
    const finish = () => {
      stop();
      if (channel)
        toast('Reproducción detenida', {
          tone: 'info',
          icon: 'stop',
          ms: 6000,
          action: {
            label: 'Deshacer',
            onAction: () => play(channel, route ? { origin, route } : { origin }),
          },
        });
    };
    if (!el || prefersReducedMotion()) {
      finish();
      return;
    }
    el.style.transition = '';
    el.style.transform = `translate3d(${direction * 110}%, 0, 0)`;
    el.style.opacity = '0';
    window.setTimeout(finish, 220);
  };

  useSwipe(rootRef, {
    axis: 'both',
    enabled: !ctx.finePointer,
    threshold: 72,
    onMove: move,
    onCancel: settle,
    onSwipe: (direction) => {
      if (direction === 'up') {
        settle();
        actions.expand();
      } else if (direction === 'left' || direction === 'right') {
        dismiss(direction === 'right' ? 1 : -1);
      } else settle();
    },
  });

  return (
    <div className="player-mini">
      <button
        type="button"
        className="player-mini__info"
        onClick={actions.expand}
        aria-label={`Volver al vídeo: ${title}`}
      >
        <span className="player-mini__kicker">
          <Equalizer playing={state.phase === 'reproduciendo'} />
          {miniKicker(state)}
        </span>
        <span className="player-mini__title">{title}</span>
        {state.channel?.subtitle ? (
          <span className="player-mini__sub">{state.channel.subtitle}</span>
        ) : null}
      </button>
      <IconButton
        icon="tv"
        label={
          others > 0
            ? `Dónde se está reproduciendo (también en ${others === 1 ? 'otro dispositivo' : `${others} dispositivos más`})`
            : 'Dónde se está reproduciendo'
        }
        onClick={() => navigate({ vista: 'ajustes', seccion: 'donde' })}
        className="player-mini__btn player-mini__where"
        data-shared={others > 0 ? 'true' : undefined}
        data-fill="true"
      />
      <IconButton
        icon={wantsPlay ? 'pause' : 'play'}
        label={wantsPlay ? 'Pausar' : 'Reproducir'}
        onClick={actions.toggle}
        className="player-mini__btn"
        data-fill="true"
      />
      <IconButton
        icon="stop"
        label="Detener la reproducción"
        onClick={actions.stop}
        className="player-mini__btn"
        data-fill="true"
      />
    </div>
  );
}

/**
 * La presentación pequeña. La monta el PlayerDock (no la montes tú); fuera
 * de él no pinta nada.
 */
export function MiniPlayer({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const ctx = usePlayerContext();
  if (!ctx) {
    if (import.meta.env.DEV)
      console.warn('[reproductor] <MiniPlayer/> fuera del PlayerDock: el armazón ya lo monta.');
    return null;
  }
  return <Mini ctx={ctx} rootRef={rootRef} />;
}
