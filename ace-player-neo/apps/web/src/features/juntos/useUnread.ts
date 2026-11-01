/* Los mensajes sin leer de la pestaña Chat (directo §14): los de otros que han
   llegado mientras se miraba otra pestaña (Fuentes, Partidos, Gente). Los
   avisos de la sala no cuentan, ni lo que ya había al entrar. */

import type { PartyChatMessage } from '@ace/shared';
import { useEffect, useRef, useState } from 'react';

/** Lo que se cuenta: mensajes de chat de otros posteriores a `seen`. */
export function unreadCount(
  messages: readonly PartyChatMessage[],
  selfId: string,
  seen: number,
): number {
  let count = 0;
  for (const message of messages) {
    if (message.id > seen && message.kind === 'chat' && message.memberId !== selfId) count += 1;
  }
  return count;
}

function lastId(messages: readonly PartyChatMessage[]): number {
  return messages.reduce((max, message) => Math.max(max, message.id), 0);
}

/** Cuántos sin leer; con `reading` (el chat a la vista), todo queda leído. */
export function useUnread(
  messages: readonly PartyChatMessage[],
  selfId: string,
  reading: boolean,
): number {
  /* Lo que había al entrar ya está leído. */
  const [seen, setSeen] = useState(() => lastId(messages));
  const latest = useRef(seen);
  latest.current = lastId(messages);
  useEffect(() => {
    if (reading) setSeen((before) => Math.max(before, latest.current));
  }, [reading, messages]);
  return reading ? 0 : unreadCount(messages, selfId, seen);
}
