/* B · Qué se ve en el otro dispositivo (docs/multidispositivo.md §3): una
   cápsula arriba, «En el iPhone · DAZN LaLiga · Ver aquí», que al tocarla une
   este dispositivo a esa sesión (`join=1`, nunca cambia el canal de la casa).

   - Sale si otro dispositivo ve algo de verdad (visor vivo: sin `away` y sin
     más de 10 min en pausa) y este no está en esa sesión, y solo si dura
     1,5 s (no parpadea en un traspaso ni en un salto de fuente). Se va 1,5 s
     después de dejar de verse, al unirse o con su «×» (para esa sesión).
   - No sale con un solo dispositivo, mientras el reproductor de aquí conecta,
     sigue a otro o enseña el aviso de traspaso o el panel «otra cosa en casa»
     (dirían lo mismo dos veces), en inmersivo, en el teatro del mismo
     partido ni en la demo.
   - Lee la caché de `playbackStatus` (no pide nada), como el mini. */

import { useEffect, useState } from 'react';
import { MULTI_TIMINGS, type PlaybackStatus, type SessionSummary } from '@ace/shared';
import { useApiQuery } from '../../api/query.ts';
import { usePlayerPresence } from '../../app/player-presence.ts';
import type { Route } from '../../app/routes.ts';
import { cx } from '../../lib/cx.ts';
import { readItem, STORAGE_KEYS, writeItem } from '../../lib/storage.ts';
import { useNoticeFlags } from '../../notices/notify.ts';
import { usePlayerSelector } from '../../player/api.ts';
import { Icon } from '../../ui/Icon.tsx';
import { deviceKind, KIND_ICON } from '../where-playing/model.ts';
import { houseSession, liveOthers, type HouseMe } from './decide.ts';
import { joinHouse, useFollowing } from './follow.ts';
import {
  houseMe,
  housePolicy,
  houseRoute,
  labelsFor,
  multiEnabled,
  pausedMap,
  trackPaused,
} from './house.ts';
import { capsuleTexts, channelName, listText } from './texts.ts';
import './multi.css';

const CONNECTING = new Set(['cargando', 'reconectando', 'buffer', 'buscando']);

/** Lo que enseñaría la cápsula ahora mismo (sin los retrasos de 1,5 s). */
export function capsuleCandidate(
  sessions: readonly SessionSummary[] | undefined,
  me: HouseMe,
  now: number,
): SessionSummary | null {
  trackPaused(sessions ?? [], now);
  const found = houseSession(sessions, me, now, pausedMap());
  if (!found) return null;
  /* Este dispositivo ya está en ella: el mini ya dice «+1» (D-M5). */
  if (found.session.viewers.some((viewer) => viewer.viewerId === me.viewerId)) return null;
  return found.session;
}

function hiddenId(): string | null {
  return readItem(STORAGE_KEYS.houseHidden, 'session');
}

/**
 * La sesión que se enseña, con los retrasos de §3.1: aparece si dura
 * `capsuleShowMs` y se va `capsuleHideMs` después de dejar de verse.
 */
function useDelayedSession(candidate: SessionSummary | null): SessionSummary | null {
  const [shown, setShown] = useState<SessionSummary | null>(null);
  const id = candidate?.id ?? null;
  useEffect(() => {
    if (id === null) {
      if (!shown) return;
      const timer = setTimeout(() => setShown(null), MULTI_TIMINGS.capsuleHideMs);
      return () => clearTimeout(timer);
    }
    if (shown?.id === id) return;
    const timer = setTimeout(() => setShown(candidate), MULTI_TIMINGS.capsuleShowMs);
    return () => clearTimeout(timer);
    // Solo al cambiar de sesión: sus datos se refrescan abajo sin reiniciar el retraso.
  }, [id, shown?.id]);
  /* Con la misma sesión, los datos más nuevos (pausa, visores, título). */
  if (shown && candidate && candidate.id === shown.id) return candidate;
  return shown;
}

export function HouseCapsule({
  placement,
  route: routeProp,
}: {
  placement: 'header' | 'topbar';
  /** La ruta actual (sin ella, la que registró el armazón). */
  route?: Route;
}) {
  const status = useApiQuery('playbackStatus', undefined, { enabled: false });
  const sessions = (status.data as PlaybackStatus | undefined)?.sessions;
  const player = usePlayerSelector((state) => ({
    phase: state.phase,
    idleReason: state.idleReason,
    handoff: state.handoff !== null,
    houseIdle: state.houseIdle !== null,
    demo: state.demo,
  }));
  const following = useFollowing();
  const flags = useNoticeFlags();
  const presence = usePlayerPresence();
  const route = routeProp ?? houseRoute();
  const [hidden, setHidden] = useState<string | null>(hiddenId);
  const [tick, setTick] = useState(0);
  const now = Date.now();
  const me = houseMe();
  const candidate = multiEnabled() ? capsuleCandidate(sessions, me, now) : null;
  const shown = useDelayedSession(candidate);

  /* La pausa de 10 min se vence sola aunque no llegue ningún evento. */
  useEffect(() => {
    if (!candidate) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [candidate?.id]);
  void tick;

  if (!shown) return null;
  if (hidden === shown.id) return null;
  if (player.demo) return null;
  if (flags.immersive || presence.immersive) return null;
  if (following || CONNECTING.has(player.phase)) return null;
  if (player.idleReason === 'traspasado' && player.handoff) return null;
  if (player.houseIdle) return null;
  if (route?.vista === 'partido' && shown.matchId && route.id === shown.matchId) return null;

  const others = liveOthers(shown, me, now, pausedMap());
  const labels = labelsFor(others);
  const title = channelName(shown.title, shown.hash);
  const paused = others.length > 0 && others.every((viewer) => viewer.playing === false);
  const texts = capsuleTexts({ labels, title, paused, policy: housePolicy() });
  const first = others[0];
  const icon = first ? KIND_ICON[deviceKind(first)] : 'movil';

  const join = () =>
    joinHouse({
      hash: shown.hash,
      title,
      matchId: shown.matchId ?? null,
      byLabel: listText(labels),
    });
  const hide = () => {
    writeItem(STORAGE_KEYS.houseHidden, shown.id, 'session');
    setHidden(shown.id);
  };

  return (
    <div className={cx('house-capsule', `house-capsule--${placement}`)} data-testid="casa">
      <button
        type="button"
        className="house-capsule__main press"
        aria-label={texts.label}
        onClick={join}
      >
        <Icon name={icon} size={16} className="house-capsule__icon" />
        {paused ? (
          <Icon name="pause" size={16} className="house-capsule__state" />
        ) : (
          <i className="house-capsule__dot" aria-hidden="true" />
        )}
        <span className="house-capsule__text">{texts.text}</span>
        <span className="house-capsule__action">{texts.action}</span>
      </button>
      <button
        type="button"
        className="house-capsule__close press"
        aria-label={texts.hide}
        onClick={hide}
      >
        <Icon name="x" size={16} />
      </button>
      <span className="sr-only" aria-live="polite" key={shown.id}>
        {texts.announce}
      </span>
    </div>
  );
}
