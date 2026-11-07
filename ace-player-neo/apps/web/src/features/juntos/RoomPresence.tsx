/* Seguir en la sala mientras se elige en Pelis y series (docs/ver-juntos.md
   §11): con `?vista=cine&sala=<código>`, la vista de Pelis y series monta
   esto en vez de soltar la sala. Abre el SSE de la sala SIN reproductor (el
   PartyClient no lo necesita: el vídeo es cosa de Room/Theater), así quien
   elige sigue «conectado», no pierde la corona y ve cuántos mensajes le
   esperan. Al desmontarse, `stop()`: deja de escuchar, pero NO sale de la
   sala (`leave`), porque lo normal es volver a ella enseguida.

   Lo leen la barra de arriba (cine/RoomPicking.tsx) y las acciones de la
   ficha con `usePicking()`; fuera de una sala, null. */

import type { PartyChatMessage, PartyQueueMode, PartyRoom } from '@ace/shared';
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { canControl, PartyClient, savedCredential, type PartyState } from './client.ts';
import { unreadCount } from './useUnread.ts';

export interface Picking {
  readonly code: string;
  readonly client: PartyClient;
  /** null mientras llega la foto de la sala. */
  readonly room: PartyRoom | null;
  readonly selfId: string;
  readonly canControl: boolean;
  readonly queueMode: PartyQueueMode;
  /** Mensajes de otros que han llegado desde que se salió a elegir. */
  readonly unread: number;
  /** El nombre de quien la creó («la sala de Isma»), o null hasta saberlo. */
  readonly host: string | null;
  readonly closed: PartyState['closed'];
}

const PickingContext = createContext<Picking | null>(null);

/** La sala para la que se elige, o null (Pelis y series normal). */
export function usePicking(): Picking | null {
  return use(PickingContext);
}

/** Para los tests (y para quien ya tenga un `Picking` hecho). */
export const PickingProvider = PickingContext.Provider;

function lastId(messages: readonly PartyChatMessage[]): number {
  return messages.reduce((max, message) => Math.max(max, message.id), 0);
}

const NO_STATE = (): PartyState | null => null;
const NO_SUBSCRIBE = () => () => undefined;

/**
 * Mantiene el SSE de la sala `code` mientras está montado (con `code` null, nada). Sin credencial
 * guardada para esa sala (otro navegador, o se olvidó), tampoco: Pelis y series se ve como
 * siempre. Siempre pinta lo mismo por fuera, así sus hijos no se vuelven a montar al entrar o
 * salir de la sala.
 */
export function RoomPresence({ code, children }: { code: string | null; children: ReactNode }) {
  const credential = useMemo(() => (code ? savedCredential(code) : null), [code]);
  const credentialId = credential?.id ?? null;
  const token = credential?.token ?? null;
  const client = useMemo(
    () =>
      code && credentialId && token ? new PartyClient(code, { id: credentialId, token }) : null,
    [code, credentialId, token],
  );
  useEffect(() => {
    if (!client) return;
    client.start();
    return () => client.stop();
  }, [client]);
  const state = useSyncExternalStore(
    client?.subscribe ?? NO_SUBSCRIBE,
    client?.getState ?? NO_STATE,
    client?.getState ?? NO_STATE,
  );
  /* Lo que ya había en el chat al llegar la foto queda leído: solo cuenta lo nuevo. */
  const [seen, setSeen] = useState<{ client: PartyClient; id: number } | null>(null);
  const arrived = state?.room != null;
  useEffect(() => {
    if (!arrived || !client) return;
    setSeen((before) =>
      before?.client === client ? before : { client, id: lastId(client.getState().chat) },
    );
  }, [arrived, client]);
  /* Sin sala propia, la de fuera (si la hay): así se puede anidar y probar con `PickingProvider`. */
  const outer = use(PickingContext);
  const value = useMemo<Picking | null>(() => {
    if (!client || !code || !credentialId || !state) return outer;
    const room = state.room;
    const from = seen?.client === client ? seen.id : null;
    return {
      code,
      client,
      room,
      selfId: credentialId,
      canControl: canControl(room, credentialId),
      queueMode: room?.settings.queueMode ?? 'vote',
      unread: from === null ? 0 : unreadCount(state.chat, credentialId, from),
      host: room?.members.find((member) => member.host)?.name ?? null,
      closed: state.closed,
    };
  }, [code, client, credentialId, state, seen, outer]);
  return <PickingContext value={value}>{children}</PickingContext>;
}
