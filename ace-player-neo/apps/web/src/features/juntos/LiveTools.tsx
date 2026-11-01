/* Lo de la sala en directo que tira de la agenda y las fuentes de casa
   (docs/ver-juntos.md §14): el «Cambio automático si se cae» y las pestañas
   Fuentes y Partidos. Solo en casa (`liveTools`): la sala lo carga aparte
   (React.lazy), así la página del invitado no se baja la agenda, los partidos
   ni las listas. */

import type { PartyRoom } from '@ace/shared';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { canControl, type PartyClient } from './client.ts';
import { LiveMatches, LiveSources, useRoomMatch } from './LivePanels.tsx';
import { nextSource, useLiveSources } from './live.ts';
import type { PlayerView, RoomPlayer } from './player.ts';

/** «Cambio automático si se cae»: como mucho un salto cada 30 s y 3 seguidos sin que suene ninguna. */
const AUTO_SWITCH_GAP_MS = 30_000;
const AUTO_SWITCH_MAX = 3;

/**
 * «Cambio automático si se cae» (§14): si el vídeo de la sala falla y quien lo
 * nota manda (el líder, o quien controle si el líder no está), salta a la
 * siguiente fuente que la sala no haya probado aún. Sin pintar nada.
 *
 * Con freno: un salto cada `AUTO_SWITCH_GAP_MS` como mucho y
 * `AUTO_SWITCH_MAX` seguidos sin que ninguna llegue a sonar. Con el motor
 * del NAS caído, todas fallan igual y saltar no arregla nada (en local se
 * comía las siete fuentes en un minuto).
 */
export function LiveAutoSwitch({
  room,
  client,
  player,
}: {
  room: PartyRoom;
  client: PartyClient;
  player: RoomPlayer;
}) {
  const match = useRoomMatch(room);
  const sources = useLiveSources(match, true);
  const view: PlayerView = useSyncExternalStore(player.subscribe, player.getView);
  const tried = useRef(new Set<string>());
  /* Saltos seguidos sin que ninguna suene y cuándo fue el último. */
  const streak = useRef({ count: 0, at: Number.NEGATIVE_INFINITY });
  /* Para volver a mirar cuando se cumple el hueco entre saltos. */
  const [tick, setTick] = useState(0);
  const live = room.live;
  const selfId = client.credential.id;
  const leader = room.members.find((member) => member.id === room.leaderId);
  const decides = selfId === room.leaderId || (!leader?.online && canControl(room, selfId));
  if (live) tried.current.add(live.hash);
  /* Una que suena de verdad: vuelve a valer todo. 'ready' no basta: llega con la concesión,
     antes de que suene nada, y con un fallo después de ella el freno no se aplicaba nunca. */
  if (view.sounded && streak.current.count > 0) {
    streak.current = { count: 0, at: streak.current.at };
    tried.current = new Set(live ? [live.hash] : []);
  }
  /* Un error solo de este aparato (no decodifica el códec, `localError`) no es un canal caído:
     otro lo puede estar viendo bien, y cambiarlo sería cambiárselo a todos. */
  const failed = (view.phase === 'error' && !view.localError) || room.interrupted === 'failed';
  useEffect(() => {
    if (!live?.auto || !decides || !failed || room.interrupted === 'taken') return;
    const now = Date.now();
    if (streak.current.count >= AUTO_SWITCH_MAX) return;
    const wait = AUTO_SWITCH_GAP_MS - (now - streak.current.at);
    if (wait > 0) {
      /* Demasiado pronto: se vuelve a mirar al cumplirse el hueco (nada más lo haría). */
      const timer = setTimeout(() => setTick((n) => n + 1), wait);
      return () => clearTimeout(timer);
    }
    const next = nextSource(sources.data ?? [], live, tried.current);
    if (!next) return;
    tried.current.add(next.choice.hash);
    streak.current = { count: streak.current.count + 1, at: now };
    void client.control({ action: 'live', live: next.choice }).catch(() => undefined);
  }, [live, decides, failed, room.interrupted, sources.data, client, tick]);
  return null;
}

/** Las pestañas Fuentes (del partido que suena, buscado en la agenda de casa) y Partidos. */
export function LivePanel({
  which,
  room,
  client,
}: {
  which: 'fuentes' | 'partidos';
  room: PartyRoom;
  client: PartyClient;
}) {
  return which === 'fuentes' ? (
    <LiveSourcesHere room={room} client={client} />
  ) : (
    <LiveMatches room={room} client={client} />
  );
}

function LiveSourcesHere({ room, client }: { room: PartyRoom; client: PartyClient }) {
  const match = useRoomMatch(room);
  return <LiveSources room={room} client={client} match={match} />;
}
