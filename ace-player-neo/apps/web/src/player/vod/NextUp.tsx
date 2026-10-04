/* Las tarjetas del final (docs/vod.md §12.9), abajo a la derecha sobre el
   vídeo, siempre visibles aunque los controles se escondan:

   - «Siguiente episodio · T1 · E4 · {título}» [Ver ahora] [Ver créditos] con
     la cuenta atrás de 10 s (un anillo que se vacía con `transform`; con
     movimiento reducido, el número en texto). «Ver créditos» la deja sin
     cuenta atrás hasta el final.
   - «¿Sigues viendo «{serie}»?» [Seguir viendo] [Salir] tras 3 episodios que
     han saltado solos sin que nadie toque nada.
   - Al final de una película: «Terminada» [Ver de nuevo] [Volver a la ficha]. */

import { useEffect, useState, type CSSProperties } from 'react';
import { prefersReducedMotion } from '../../lib/media.ts';
import { Button } from '../../ui/Button.tsx';
import type { PlayerState } from '../api.ts';
import type { PlayerActions } from '../context.ts';
import { VOD_TEXT } from './texts.ts';

/** Segundos que quedan hasta `endsAt` (se repinta una vez por segundo). */
function useSecondsLeft(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}

function Countdown({ endsAt, totalMs }: { endsAt: number; totalMs: number }) {
  const left = useSecondsLeft(endsAt) ?? 0;
  const ratio = Math.min(1, Math.max(0, (endsAt - Date.now()) / totalMs));
  return (
    <span
      className="vod-ring"
      style={{ '--ring-left': prefersReducedMotion() ? 1 : ratio } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 36 36" className="vod-ring__svg">
        <circle className="vod-ring__track" cx="18" cy="18" r="15.5" />
        <circle className="vod-ring__fill" cx="18" cy="18" r="15.5" pathLength={1} />
      </svg>
      <span className="vod-ring__n">{left}</span>
    </span>
  );
}

export function VodEndCards({ state, actions }: { state: PlayerState; actions: PlayerActions }) {
  const vod = state.vod;
  if (!vod || state.phase === 'error') return null;
  const nextUp = vod.nextUp;
  if (nextUp?.mode === 'still') {
    return (
      <section className="vod-card glass--video" aria-label="¿Sigues viendo?" role="dialog">
        <p className="vod-card__title">{VOD_TEXT.stillWatching(vod.title)}</p>
        <div className="vod-card__actions">
          <Button variant="video" size="sm" icon="play" onClick={actions.keepWatching}>
            {VOD_TEXT.keepWatching}
          </Button>
          <Button variant="video" size="sm" onClick={actions.leaveVod}>
            {VOD_TEXT.leave}
          </Button>
        </div>
      </section>
    );
  }
  if (nextUp && vod.next) {
    return (
      <section className="vod-card glass--video" aria-label={VOD_TEXT.nextEpisode}>
        <div className="vod-card__head">
          {nextUp.mode === 'countdown' && nextUp.endsAt !== null ? (
            <Countdown endsAt={nextUp.endsAt} totalMs={10_000} />
          ) : null}
          <p className="vod-card__text">
            <span className="vod-card__kicker">
              {VOD_TEXT.nextEpisode} · {vod.next.label}
            </span>
            <span className="vod-card__title">{vod.next.title}</span>
          </p>
        </div>
        <div className="vod-card__actions">
          <Button variant="video" size="sm" icon="play" onClick={actions.nextEpisode}>
            {VOD_TEXT.watchNow}
          </Button>
          {nextUp.mode === 'countdown' ? (
            <Button variant="video" size="sm" onClick={actions.watchCredits}>
              {VOD_TEXT.watchCredits}
            </Button>
          ) : null}
        </div>
      </section>
    );
  }
  if (vod.ended && !vod.next) {
    return (
      <section className="vod-card vod-card--end glass--video" aria-label={VOD_TEXT.ended}>
        <p className="vod-card__title">{VOD_TEXT.ended}</p>
        <div className="vod-card__actions">
          <Button variant="video" size="sm" icon="refresh" onClick={actions.replay}>
            {VOD_TEXT.replay}
          </Button>
          <Button variant="video" size="sm" onClick={actions.openTitle}>
            {VOD_TEXT.backToTitle}
          </Button>
        </div>
      </section>
    );
  }
  return null;
}
