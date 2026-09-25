/* Mini-reproductor «Sonando» (B-096; piel Palco, plan fase 2 W7): al volver
   a la portada con algo sonando no se para; queda una banda de cristal denso
   con la IMAGEN VIVA a 96×54 (es el mismo <video> del escenario, que sigue en
   .player-frame: solo cambia el CSS; ninguna miniatura aparte), el estado
   («Sonando», «Conectando…»…), el canal y la segunda línea: la fuente y, si
   es un partido, «Marcador oculto» o el minuto (nunca las cifras: regla 29).
   Pausa y detener. Tocarla vuelve al vídeo.

   En el móvil se arrastra: hacia arriba vuelve al vídeo; hacia un lado la
   quita (detiene, con «Deshacer» durante 6 s). Durante el arrastre solo se
   mueve con transform; al cruzar el umbral de quitarla, un toque háptico
   fuerte (HAPTIC_MAP: heavy) y al abrirla, uno suave.

   «Dónde se está reproduciendo» (Ajustes → `ajustes/donde`): un botón con la
   tele. En pantallas anchas siempre; en el móvil, para no apretar el título,
   solo cuando otro dispositivo ve lo mismo (`data-shared`, del evento SSE
   `playback.sessions` que ya está en la caché: no pide nada). */

import { useRef, type RefObject } from 'react';
import { getDeviceId, getViewerId } from '../api/identity.ts';
import { useApiQuery } from '../api/query.ts';
import { useNavigate } from '../app/router.tsx';
import { liveMinute, paintableScore } from '../features/agenda/domain.ts';
import { useScoreHidden } from '../features/agenda/score-reveal.ts';
import { otherDevicesWatching } from '../features/where-playing/model.ts';
import { useSwipe } from '../lib/gestures.ts';
import { haptic } from '../lib/haptics.ts';
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

/** Distancia a un lado a partir de la que soltar el mini lo detiene. */
const DISMISS_PX = 72;

/**
 * Lo que el mini dice del partido que suena (si es un partido): «Marcador
 * oculto» mientras esté tapado y, destapado, solo el minuto («72'»,
 * «Descanso», «Final»). Nunca las cifras. Solo con lo que ya hay en la
 * caché (la agenda pide los marcadores): el mini no pide nada.
 */
function useScoreNote(matchId: string): string | null {
  const hidden = useScoreHidden(matchId, true);
  const scores = useApiQuery('scores', undefined, { enabled: false }).data;
  if (!scores?.available) return null;
  const score = paintableScore(scores.scores[matchId]);
  if (!score) return null;
  if (hidden) return 'Marcador oculto';
  if (score.state === 'post') return 'Final';
  const minute = liveMinute(score);
  if (!minute) return 'En directo';
  return minute.halftime ? 'Descanso' : `${minute.minute}'`;
}

/* Con su propia clave por partido: el selector de useScoreHidden no puede
   cambiar de partido sobre la marcha (useStore guarda el primero). */
function ScoreNote({ matchId, separated }: { matchId: string; separated: boolean }) {
  const note = useScoreNote(matchId);
  if (!note) return null;
  return (
    <>
      <span className="player-mini__note">{note}</span>
      {separated ? ' · ' : null}
    </>
  );
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
  const matchId = state.route?.vista === 'partido' ? (state.route.id ?? null) : null;
  const subtitle = state.channel?.subtitle ?? null;
  const armed = useRef(false);

  const move = (dx: number, dy: number) => {
    const el = rootRef.current;
    if (!el) return;
    // Al cruzar el umbral de quitarlo, un toque (una vez por cruce).
    const past = Math.abs(dx) >= DISMISS_PX && Math.abs(dx) > Math.abs(dy);
    if (past !== armed.current) {
      armed.current = past;
      if (past) haptic('heavy');
    }
    // Hacia abajo no hay a dónde ir (está la barra): se frena.
    const y = dy > 0 ? dy * 0.25 : dy;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dx}px, ${y}px, 0)`;
    el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 320));
  };
  const settle = () => {
    armed.current = false;
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
    threshold: DISMISS_PX,
    onMove: move,
    onCancel: settle,
    onSwipe: (direction) => {
      if (direction === 'up') {
        settle();
        haptic('light');
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
        {matchId || subtitle ? (
          <span className="player-mini__sub">
            {matchId ? (
              <ScoreNote key={matchId} matchId={matchId} separated={subtitle !== null} />
            ) : null}
            {subtitle ? <span>{subtitle}</span> : null}
          </span>
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
