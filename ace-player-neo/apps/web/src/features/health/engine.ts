/* Reinicio del motor desde el panel de salud (inventario §12.2; en la 0.6.59
   solo estaba en Ajustes → Motor, y ahí sigue).

   Mismo comportamiento que el botón de Ajustes:
   - segundo toque en vez de confirm() nativo (regla 31), 6 s para confirmar;
   - se ve al momento que el motor arranca (el estado en caché pasa a
     «restarting»), POST /api/v1/engine/restart y se vuelve a mirar a los 2,5 s;
   - el backend responde 409 `restart_cooldown` si se pulsa dos veces en 15 s:
     sale su mensaje en español, sin inventar otro.
   Los plazos son los de la 0.6.59 (index.html:5962 y 4267). Se definen aquí y
   no se importan de SettingsView para no cargar Ajustes entero en este trozo
   (ni en sus tests). */

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, describeFailure, invalidateRoute, routeKey } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';

export const CONFIRM_RESTART_MS = 6000;
export const RECHECK_AFTER_RESTART_MS = 2500;
export const RESTART_WARNING =
  'Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.';

/** Pide el reinicio y deja programada la comprobación. Devuelve si el backend lo aceptó. */
export async function restartEngine(
  client: QueryClient,
  schedule: (run: () => void, ms: number) => void = (run, ms) => void setTimeout(run, ms),
): Promise<boolean> {
  client.setQueryData(routeKey('engineStatus'), (old: unknown) =>
    old && typeof old === 'object'
      ? { ...(old as object), status: 'restarting', online: false }
      : old,
  );
  try {
    await api('engineRestart');
    notify('Reiniciando el motor AceStream…', { tone: 'info', icon: 'motor' });
    return true;
  } catch (error) {
    notify(`No se pudo reiniciar el motor. ${describeFailure(error)}`, { tone: 'err' });
    return false;
  } finally {
    schedule(() => {
      void invalidateRoute('engineStatus', client);
      void invalidateRoute('health', client);
    }, RECHECK_AFTER_RESTART_MS);
  }
}

/** El botón: ocupado mientras se pide y sin temporizadores vivos al desmontarse. */
export function useEngineRestart() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const restart = async () => {
    setBusy(true);
    try {
      await restartEngine(client, (run, ms) => {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          run();
        }, ms);
        timers.current.add(timer);
      });
    } finally {
      setBusy(false);
    }
  };

  return { busy, restart };
}
