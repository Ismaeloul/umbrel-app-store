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
   `playback.sessions` que ya está en la caché: no pide nada).

   En el menú lateral (desde 1024; rediseño de escritorio, maqueta 01) es
   la tarjeta de la maqueta: la imagen con la cápsula «● Directo», una línea
   fina de progreso (el minuto del partido o lo visto de la película), el
   partido y «67' · DAZN 1» en rojo, y la pausa. Detener aparece sobre la
   imagen al pasar el ratón (o con el foco). player.css elige qué se ve. */

import { useRef, type CSSProperties, type RefObject } from 'react';
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
import { LiveDot } from '../ui/LiveRing.tsx';
import { ProgressBar } from '../ui/ProgressBar.tsx';
import { play, playVod, stop, usePlayer, type PlayerState, type VodPlayback } from './api.ts';
import { usePlayerContext, type PlayerContextValue } from './context.ts';
import { Equalizer } from './PlayerSurface.tsx';
import { useChannelTitle } from './channel-title.ts';
import { liveButton } from './status.ts';
import { clockText, durationWords } from './vod/timeline.ts';

/** La segunda línea del mini con una película: «T1 · E3 · quedan 12 min». */
export function vodMiniLine(
  vod: Pick<VodPlayback, 'subtitle' | 'positionS' | 'durationS'>,
): string {
  const label = vod.subtitle?.split(' · ').slice(0, 2).join(' · ') ?? '';
  const left = vod.durationS > 0 ? `quedan ${durationWords(vod.durationS - vod.positionS)}` : null;
  return [label, left].filter(Boolean).join(' · ');
}

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

/** Fases en las que el estado sustituye a la segunda línea en el nombre accesible. */
const MINI_STATUS_PHASES: ReadonlySet<PlayerState['phase']> = new Set([
  'cargando',
  'reconectando',
  'error',
  'bloqueado',
]);

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

/**
 * El minuto del partido que suena («67'», «Descanso», «Final»; no es un
 * spoiler: el marcador sigue tapado) y cuánto va de partido (0-1), de lo que
 * ya hay en la caché.
 */
function useMatchClock(matchId: string | null): { text: string | null; progress: number | null } {
  const scores = useApiQuery('scores', undefined, { enabled: false }).data;
  const score = matchId && scores?.available ? paintableScore(scores.scores[matchId]) : null;
  if (!score) return { text: null, progress: null };
  if (score.state === 'post') return { text: 'Final', progress: 1 };
  const minute = liveMinute(score);
  if (!minute) return { text: null, progress: null };
  if (minute.halftime) return { text: 'Descanso', progress: 0.5 };
  // «45+2» cuenta como 45: la línea no pasa del final.
  const played = Number.parseInt(minute.minute, 10);
  return {
    text: `${minute.minute}'`,
    progress: Number.isFinite(played) ? Math.min(1, played / 90) : null,
  };
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
  // El nombre que se pinta: el de la biblioteca si el reproductor solo tiene el del hash.
  const channelTitle = useChannelTitle(state.channel);
  const title = channelTitle ?? 'Ace Player Neo';
  const matchId = state.route?.vista === 'partido' ? (state.route.id ?? null) : null;
  const vod = state.kind === 'vod' ? state.vod : null;
  // Una película: «T1 · E3 · quedan 12 min» y una barra fina (docs/vod.md §12.7).
  const subtitle = vod ? vodMiniLine(vod) : (state.channel?.subtitle ?? null);
  const armed = useRef(false);
  const clock = useMatchClock(matchId);
  // La tarjeta del menú lateral: el partido, «67' · DAZN 1» y la línea de progreso.
  const live = !vod && liveButton(state).mode !== 'off';
  const sideTitle = state.channel?.event ?? title;
  const sideSub = vod
    ? vodMiniLine(vod)
    : [clock.text, state.channel?.event ? channelTitle : null].filter(Boolean).join(' · ');
  // El nombre accesible sale de lo que se ve (WCAG 2.5.3): el partido (o el
  // canal) y, si algo pasa, el estado («Conectando…», «Sin señal»); si no, la
  // segunda línea («60' · DAZN»). Nunca lleva el marcador (regla 29).
  const status = MINI_STATUS_PHASES.has(state.phase) ? miniKicker(state) : null;
  const infoLabel = `Volver al vídeo: ${sideTitle}${status ? `, ${status}` : sideSub ? `, ${sideSub}` : ''}`;
  const sideProgress = vod
    ? vod.durationS > 0
      ? vod.positionS / vod.durationS
      : 0
    : (clock.progress ?? 1);

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
    const film = state.kind === 'vod' ? state.vod : null;
    const finish = () => {
      stop();
      if (channel)
        toast('Reproducción detenida', {
          tone: 'info',
          icon: 'stop',
          ms: 6000,
          action: {
            label: 'Deshacer',
            onAction: () =>
              film
                ? playVod({
                    id: film.id,
                    kind: film.kind,
                    title: film.title,
                    subtitle: film.subtitle,
                    seriesId: film.seriesId,
                    startS: film.positionS,
                  })
                : play(channel, route ? { origin, route } : { origin }),
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
      {live ? (
        <span className="player-mini__cap" aria-hidden="true">
          <LiveDot />
          Directo
        </span>
      ) : null}
      <span
        className="player-mini__line"
        data-tone={vod ? 'vod' : 'live'}
        style={{ '--v': sideProgress } as CSSProperties}
        aria-hidden="true"
      >
        <i />
      </span>
      <button
        type="button"
        className="player-mini__info"
        onClick={actions.expand}
        aria-label={infoLabel}
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
        <span className="player-mini__side" aria-hidden="true">
          <span className="player-mini__side-title">{sideTitle}</span>
          {sideSub ? (
            <span className="player-mini__side-sub" data-tone={vod ? 'vod' : 'live'}>
              {sideSub}
            </span>
          ) : null}
        </span>
        {vod && vod.durationS > 0 ? (
          <ProgressBar
            className="player-mini__progress"
            size="thin"
            value={vod.positionS / vod.durationS}
            label={`${clockText(vod.positionS)} de ${clockText(vod.durationS)}`}
          />
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
        className="player-mini__btn player-mini__stop"
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
