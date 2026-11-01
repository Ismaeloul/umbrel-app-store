/* El aviso de arriba de la web cuando algo pasa por el dominio de fuera (tv.ismaeloul.es,
   docs/acceso-remoto.md): «12 intentos bloqueados desde fuera en las últimas 24 h · Ver» y «Tu
   iPhone de Isma intentó entrar desde fuera y no tiene permiso · Permitir». Los dos llevan a
   Ajustes → Dispositivos, donde está el detalle y el botón de verdad.

   Solo con el servidor de verdad (en la demo no hay dominio) y solo si hay algo que decir. Se
   puede cerrar: vuelve a salir cuando cambia lo que dice (otro recuento u otro aparato). La lista
   la refresca el SSE `remote.changed`; sin SSE, cada 5 minutos. */

import { useState } from 'react';
import { useApiQuery, useAppMode } from '../../api/index.ts';
import { useNavigate, useRoute } from '../../app/router.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { useNow } from '../health/useNow.ts';
import { blockedText, remoteAlerts } from './remote-model.ts';
import './remote-alert.css';

const DISMISS_KEY = 'aceneo.remote-alert.dismissed';

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function RemoteAlertBanner() {
  const mode = useAppMode();
  const route = useRoute();
  const navigate = useNavigate();
  const now = useNow();
  const live = mode === 'live';
  const remote = useApiQuery('remoteGet', undefined, {
    enabled: live,
    staleTime: 60_000,
    refetchInterval: live ? 5 * 60_000 : false,
  });
  const devices = useApiQuery('devicesList', undefined, { enabled: live && Boolean(remote.data) });
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  if (!live || !remote.data?.domain.configured) return null;
  /* En Ajustes → Dispositivos ya se ve todo. */
  if (route.vista === 'ajustes' && route.seccion === 'dispositivos') return null;
  const alerts = remoteAlerts(remote.data, devices.data?.devices ?? [], now);
  const parts: string[] = [];
  if (alerts.blocked > 0) parts.push(blockedText(alerts.blocked));
  const first = alerts.denied[0];
  if (first) parts.push(`Tu «${first.name}» intentó entrar desde fuera y no tiene permiso`);
  if (parts.length === 0) return null;
  const signature = `${alerts.blocked}|${alerts.denied.map((d) => d.deviceId).join(',')}`;
  if (dismissed === signature) return null;

  return (
    <div className="remote-alert" role="status">
      <Icon name="aviso" size={18} />
      <span className="remote-alert__text">{parts.join(' · ')}</span>
      <button
        type="button"
        className="remote-alert__go press"
        onClick={() => navigate({ vista: 'ajustes', seccion: 'dispositivos' })}
      >
        {first && alerts.blocked === 0 ? 'Permitir' : 'Ver'}
      </button>
      <button
        type="button"
        className="remote-alert__close press"
        aria-label="Cerrar el aviso"
        onClick={() => {
          setDismissed(signature);
          try {
            sessionStorage.setItem(DISMISS_KEY, signature);
          } catch {
            // Sin almacenamiento: se cierra solo hasta recargar.
          }
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
