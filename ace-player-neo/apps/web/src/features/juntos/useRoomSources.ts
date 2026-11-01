/* Las fuentes de la sala en directo (directo §14): `partyLiveSources` (la
   ruta de la sala, también por el enlace de invitado) y, mientras el
   comprobador sigue, su trabajo cada `ROOM_SCAN_POLL_MS`. Lo que se pinta lo
   decide `roomSourcesModel` (liveSources.ts). */

import type { PartyLiveSourcesResponse, PartyRoom } from '@ace/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.ts';
import { useNow } from '../agenda/data.ts';
import type { PartyClient } from './client.ts';
import {
  canSwitchLive,
  roomEntries,
  roomScreen,
  roomSourcesModel,
  scanRunning,
  type RoomSourcesModel,
} from './liveSources.ts';

/** Cada cuánto se mira el comprobador de la sala mientras no acaba. */
export const ROOM_SCAN_POLL_MS = 2_500;

export interface RoomSources {
  readonly model: RoomSourcesModel | null;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly scanning: boolean;
  readonly researching: boolean;
  retry(): void;
  /** «Buscar más fuentes»: otra pasada, sin la caché de la sala. */
  research(): Promise<void>;
}

export function useRoomSources(room: PartyRoom, client: PartyClient): RoomSources {
  const live = room.live;
  const enabled = canSwitchLive(room, client.credential.id);
  const what = live ? (live.matchId ?? `c:${live.hash}`) : null;
  const queryClient = useQueryClient();
  const baseKey = useMemo(
    () => ['juntos-room-sources', client.code, what] as const,
    [client.code, what],
  );
  const base = useQuery({
    queryKey: baseKey,
    enabled: enabled && what !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: ({ signal }) =>
      api('partyLiveSources', {
        params: { code: client.code },
        query: { t: client.credential.token },
        signal,
      }),
  });
  const jobId = base.data?.scan?.id ?? null;
  const job = useQuery<PartyLiveSourcesResponse>({
    queryKey: ['juntos-room-scan', client.code, jobId],
    enabled: enabled && jobId !== null && scanRunning(base.data?.scan),
    refetchInterval: (query) =>
      scanRunning(query.state.data?.scan ?? base.data?.scan) ? ROOM_SCAN_POLL_MS : false,
    retry: 1,
    queryFn: ({ signal }) =>
      api('partyLiveSources', {
        params: { code: client.code },
        query: { t: client.credential.token, ...(jobId ? { job: jobId } : {}) },
        signal,
      }),
  });
  const [researching, setResearching] = useState(false);
  const now = useNow();
  /* Si otro (u otra caducidad) ha relanzado la resolución, el servidor contesta al sondeo con
     el trabajo nuevo: se adopta, para que el sondeo pase a él y la lista reciba sus fuentes y
     veredictos. Sin esto, la foto vieja se quedaba en «Comprobando…». */
  const adopt = job.data && job.data.scan?.id !== jobId ? job.data : null;
  useEffect(() => {
    if (adopt) queryClient.setQueryData(baseKey, adopt);
  }, [adopt, queryClient, baseKey]);
  const data: PartyLiveSourcesResponse | undefined = job.data ?? base.data;
  const interrupted = room.interrupted;
  const model = useMemo(() => {
    if (!live || !data) return null;
    const entries = roomEntries(data.candidates, data.scan, live, now);
    return roomSourcesModel(
      entries,
      live,
      roomScreen({ live, interrupted }),
      data.scan !== null,
      now,
    );
  }, [live, data, interrupted, now]);
  const research = useCallback(async () => {
    setResearching(true);
    try {
      const fresh = await api('partyLiveSources', {
        params: { code: client.code },
        query: { t: client.credential.token, research: '1' },
      });
      queryClient.setQueryData(baseKey, fresh);
    } finally {
      setResearching(false);
    }
  }, [client, queryClient, baseKey]);
  return {
    model,
    isPending: base.isPending && enabled,
    isError: base.isError,
    scanning: scanRunning(data?.scan),
    researching,
    retry: () => void base.refetch(),
    research,
  };
}
