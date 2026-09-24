/* Consola · estado de interfaz del iPhone: hojas abiertas (Reportar, Pegar,
   menú de acciones) fuera del simulador. */

import { useSyncExternalStore } from 'react';
import type { ActionItem } from './ui';

export type PhoneSheet =
  | { type: 'report'; kind: 'match' | 'channel'; id: string; sourceId: string }
  | { type: 'paste'; kind: 'match' | 'channel'; id: string }
  | { type: 'actions'; title?: string; items: ActionItem[] }
  | { type: 'rename'; id: string; title: string }
  | { type: 'addList' }
  | null;

let sheet: PhoneSheet = null;
const listeners = new Set<() => void>();

export function useSheet(): PhoneSheet {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sheet,
    () => sheet,
  );
}

export function openSheet(s: PhoneSheet) {
  sheet = s;
  for (const l of listeners) l();
}

export function closeSheet() {
  openSheet(null);
}
