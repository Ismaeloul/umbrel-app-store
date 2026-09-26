/* Seguir y unirse (docs/multidispositivo.md §2.4.3, §2.4.4 y §3.3).

   - Seguir: otro dispositivo ha contestado «Cambiar en los dos» y el
     reproductor nos pasa su `playback.handoff` con `follow`. Se pide el canal
     nuevo con `join=1` (nunca cierra nada). Si llega tarde (el otro ya ha
     vuelto a cambiar: zapping rápido), se relee `playbackStatus` y se sigue al
     mismo dispositivo donde esté ahora, como mucho 3 saltos en 10 s; si ya no
     ve nada, el panel «Nada en {el PC}».
   - Unirse: la cápsula, «Ver … aquí» y «Pasar aquí». También con `join=1`;
     si llega tarde, el toast «{Antena 3} ya no se está viendo en {el PC}.».
     Con partido, abre su centro y la sesión de fuentes arranca la fuente que
     suena en casa (lo que suena en casa, primero). */

import { MULTI_TIMINGS, type PlaybackStatus } from '@ace/shared';
import { api } from '../../api/client.ts';
import { queryClient, routeKey } from '../../api/query.ts';
import type { Route } from '../../app/routes.ts';
import { haptic } from '../../lib/haptics.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { notify } from '../../notices/notify.ts';
import { toast } from '../../notices/toasts.ts';
import {
  channelRoute,
  onJoinExpired,
  play,
  playerStore,
  type FollowRequest,
  type HandoffInfo,
  type JoinExpired,
} from '../../player/api.ts';
import { isLiveViewer } from './decide.ts';
import { houseNavigate, housePolicy, houseRoute, houseSessions, pausedMap } from './house.ts';
import { channelName, followedText, goneText, nothingToFollowTexts } from './texts.ts';

/** Seguir en curso: la cápsula no sale mientras (aunque el cerrojo tarde en abrir). */
export const followingStore = createStore<boolean>(false);

export function useFollowing(): boolean {
  return useStore(followingStore);
}

interface Chain {
  readonly byDeviceId: string | null;
  readonly byLabel: string;
  readonly previous: HandoffInfo['previous'];
  readonly startedAt: number;
  hops: number;
}

let chain: Chain | null = null;
/** Lo último que se pidió unir (la cápsula o «Ver … aquí»), para el toast si llega tarde. */
let lastJoin: { hash: string; title: string; byLabel: string } | null = null;
let now: () => number = () => Date.now();

function matchRoute(matchId: string): Route {
  return { vista: 'partido', id: matchId, canal: null };
}

/** Pide el canal de la casa con `join=1` (seguir o unirse). */
function requestJoin(
  target: { hash: string; title: string; matchId: string | null },
  house: 'follow' | 'join',
): void {
  const route = target.matchId ? matchRoute(target.matchId) : channelRoute(target.hash);
  const current = houseRoute();
  /* En el teatro del canal viejo se pasa a la ruta nueva (reemplazando); en el
     mini o en otra vista no se navega: el mini cambia de canal. */
  if (current?.vista === 'partido') houseNavigate(route, { replace: true });
  play(
    { hash: target.hash, title: target.title },
    {
      origin: house === 'follow' ? 'auto' : 'library',
      route,
      house,
      ...(target.matchId ? { match: target.matchId } : {}),
    },
  );
}

/** El reproductor recibió un traspaso con `follow`: este dispositivo sigue al otro. */
export function followHouse(request: FollowRequest): void {
  chain = {
    byDeviceId: request.byDeviceId,
    byLabel: request.byLabel,
    previous: request.previous,
    startedAt: now(),
    hops: 1,
  };
  followingStore.set(true);
  const title = channelName(request.title, request.hash);
  requestJoin({ hash: request.hash, title, matchId: request.matchId }, 'follow');
  notify(followedText(request.byLabel, title), { kind: 'signal', icon: 'movil' });
}

/** La cápsula, «Ver … aquí» y «Pasar aquí»: unirse a lo que se ve en casa. */
export function joinHouse(target: {
  hash: string;
  title: string;
  matchId: string | null;
  byLabel: string;
}): void {
  haptic('selection');
  const title = channelName(target.title, target.hash);
  lastJoin = { hash: target.hash, title, byLabel: target.byLabel };
  requestJoin({ hash: target.hash, title, matchId: target.matchId }, 'join');
}

/** Seguir llegó tarde: relee la casa y sigue al mismo dispositivo, o se rinde. */
async function followAgain(current: Chain, expired: JoinExpired): Promise<void> {
  let sessions = houseSessions();
  try {
    const status: PlaybackStatus = await api('playbackStatus', {
      timeoutMs: MULTI_TIMINGS.freshStatusMs,
    });
    queryClient.setQueryData(routeKey('playbackStatus'), status);
    sessions = status.sessions;
  } catch {}
  if (chain !== current) return;
  const t = now();
  const there = sessions.find(
    (session) =>
      session.hash !== expired.channel.hash &&
      session.viewers.some(
        (viewer) =>
          current.byDeviceId !== null &&
          viewer.deviceId === current.byDeviceId &&
          isLiveViewer(viewer, t, pausedMap()),
      ),
  );
  const inTime =
    current.hops < MULTI_TIMINGS.followHops && t - current.startedAt < MULTI_TIMINGS.followWindowMs;
  if (there && inTime) {
    current.hops += 1;
    requestJoin(
      {
        hash: there.hash,
        title: channelName(there.title, there.hash),
        matchId: there.matchId ?? null,
      },
      'follow',
    );
    return;
  }
  /* Nada que seguir: el panel «Nada en {el PC}» con «Volver a …». */
  chain = null;
  followingStore.set(false);
  const previous = current.previous;
  const texts = nothingToFollowTexts(current.byLabel, previous.channel.title);
  playerStore.set((state) => ({
    ...state,
    idleReason: 'traspasado',
    message: texts.text,
    handoff: {
      kind: 'nothing',
      reason: 'other_channel',
      byLabel: current.byLabel,
      by: { client: 'web', deviceId: current.byDeviceId, deviceName: null },
      hash: expired.channel.hash,
      title: '',
      matchId: null,
      policy: housePolicy(),
      previous,
    },
  }));
  notify(texts.status, { kind: 'signal', icon: 'movil' });
}

function onExpired(expired: JoinExpired): void {
  if (expired.options.house === 'follow' && chain) {
    void followAgain(chain, expired);
    return;
  }
  if (expired.options.house !== 'join') return;
  /* Solo lo que pidió la persona (la cápsula, «Ver … aquí»): lo que suena en
     casa, primero, sigue solo con la fuente de siempre (session.ts). */
  const join = lastJoin?.hash === expired.channel.hash ? lastJoin : null;
  lastJoin = null;
  if (!join) return;
  toast(goneText(join.title, join.byLabel), { tone: 'info', icon: 'movil' });
}

/** Cuando el reproductor ya suena (o se para por otra cosa), el seguir ha terminado. */
function onPlayer(): void {
  if (!followingStore.get()) return;
  const { phase } = playerStore.get();
  if (phase === 'reproduciendo' || phase === 'error' || (phase === 'idle' && !chain)) {
    chain = null;
    followingStore.set(false);
  }
}

/** Lo engancha el armazón (installHouse). */
export function listenFollow(): () => void {
  const offs = [onJoinExpired(onExpired), playerStore.subscribe(onPlayer)];
  return () => {
    for (const off of offs) off();
  };
}

/** Solo para los tests. */
export function resetFollow(clock?: () => number): void {
  chain = null;
  lastJoin = null;
  followingStore.set(false);
  now = clock ?? (() => Date.now());
}
