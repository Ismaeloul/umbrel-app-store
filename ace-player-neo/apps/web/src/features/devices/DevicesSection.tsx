/* Ajustes → Dispositivos (arquitectura §5.12 y §7.3): emparejar la app de
   iPhone, iPad o Mac con un código de 6 dígitos y su QR, ver los que ya están
   y revocarlos. Piel «Palco» (plan fase 2, W10) en devices.css: tarjeta de
   empezar con el botón de oro, código grande en oro, QR en tarjeta blanca y
   punto verde en los que están conectados ahora mismo.

   - Emparejar: POST /api/v1/pairing → código grande (en dos grupos de 3) y el
     QR que dibuja el backend, con cuenta atrás de 5 min. Al caducar, «Crear
     otro código». Cuando el iPhone lo canjea, el aviso y la fila nueva.
   - La dirección que lleva el QR es la de esta página, así que aquí se explica
     en una línea qué implica (red de casa, Tailscale o, si es localhost, que
     no le sirve al iPhone).
   - Revocar pide un segundo toque (regla 31, sin confirm() nativo); también
     desde el menú contextual de la fila (clic derecho o pulsación larga).
     Revocar corta al momento su SSE, sus visores y sus URLs de vídeo (lo hace
     el backend).
   - Datos: GET /api/v1/devices. El SSE `devices.changed` la invalida
     (src/api/sse.ts); sin SSE se sondea cada 5 s solo con un código a la
     vista (usePairing). */

import type { Device } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  api,
  describeFailure,
  invalidateRoute,
  useApiQuery,
  useAppMode,
  useRealtimeStatus,
} from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Menu, useContextMenu } from '../../ui/Menu.tsx';
import { SkeletonRows } from '../../ui/Skeleton.tsx';
import { useNow } from '../health/useNow.ts';
import { useSecondTap } from '../settings/second-tap.ts';
import {
  isOnlineNow,
  lastSeenText,
  originKind,
  pairedText,
  PLATFORM_ICON,
  PLATFORM_LABEL,
  revokedText,
  splitDevices,
} from './model.ts';
import { PairingPanel } from './PairingPanel.tsx';
import { PAIRING_POLL_MS, usePairing } from './usePairing.ts';
import './devices.css';

/** Segundo toque para revocar: 5 s, como borrar una lista. */
export const CONFIRM_REVOKE_MS = 5000;

function DeviceRow({
  device,
  now,
  armed,
  busy,
  onRevoke,
}: {
  device: Device;
  now: number;
  armed: boolean;
  busy: boolean;
  onRevoke(): void;
}) {
  const { bind, menu } = useContextMenu();
  const online = isOnlineNow(device, now);
  return (
    <li className="disp-dev" data-online={online || undefined} {...bind}>
      <span className="disp-dev__icon" aria-hidden="true">
        <Icon name={PLATFORM_ICON[device.platform]} size={20} />
      </span>
      <div className="disp-dev__text">
        <span className="disp-dev__name">{device.name}</span>
        <span className="disp-dev__meta">
          {online ? <i className="disp-dev__dot" aria-hidden="true" /> : null}
          <span>
            {PLATFORM_LABEL[device.platform]} · {lastSeenText(device, now)}
          </span>
        </span>
        <span className="disp-dev__meta disp-dev__meta--soft">{pairedText(device)}</span>
      </div>
      <Button
        size="sm"
        variant={armed ? 'danger' : 'quiet'}
        busy={busy}
        onClick={onRevoke}
        aria-label={
          armed ? `¿Revocar? Pulsa otra vez para revocar ${device.name}` : `Revocar ${device.name}`
        }
        className="disp-dev__act"
      >
        {armed ? '¿Revocar? Pulsa otra vez' : 'Revocar'}
      </Button>
      <Menu
        open={menu.open}
        anchor={menu.anchor}
        onClose={menu.onClose}
        label={`Opciones de ${device.name}`}
        items={[
          {
            id: 'revocar',
            label: armed ? 'Revocar ya' : 'Revocar el acceso',
            icon: 'x',
            danger: true,
            onSelect: onRevoke,
          },
        ]}
      />
    </li>
  );
}

function OriginNote({ origin, hostname }: { origin: string; hostname: string }) {
  const kind = originKind(hostname);
  if (kind === 'local') {
    return (
      <p className="disp-origin disp-origin--warn" role="note">
        <Icon name="aviso" size={18} />
        <span>
          Has abierto esta página como <strong>{origin}</strong> y esa dirección solo existe en este
          ordenador. Ábrela con la del Umbrel (por ejemplo,{' '}
          <strong>http://umbrel.local:7792</strong>) antes de crear el código.
        </span>
      </p>
    );
  }
  return (
    <p className="disp-origin" role="note">
      <Icon name={kind === 'tailscale' ? 'check' : 'info'} size={18} />
      <span>
        El QR lleva la dirección de esta página, <strong>{origin}</strong>.{' '}
        {kind === 'tailscale'
          ? 'Es la de Tailscale: el iPhone podrá conectarse en casa y fuera, con Tailscale activo.'
          : kind === 'lan'
            ? 'Es la de tu red de casa: fuera de ella no llegará. Para usarlo también fuera, abre esta página por Tailscale (tu nombre …ts.net o la IP 100.x) y crea el código desde ahí.'
            : 'El iPhone tiene que poder abrirla tal cual.'}
      </span>
    </p>
  );
}

export function DevicesSection() {
  const client = useQueryClient();
  const mode = useAppMode();
  const realtime = useRealtimeStatus();
  const now = useNow();
  const confirm = useSecondTap(CONFIRM_REVOKE_MS);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  // Antes de saber si hay código a la vista no se sabe si hay que sondear:
  // el intervalo se decide con el estado del emparejamiento (abajo).
  const [polling, setPolling] = useState(false);
  const list = useApiQuery('devicesList', undefined, {
    refetchOnMount: 'always',
    refetchInterval: polling ? PAIRING_POLL_MS : false,
  });
  const devices = list.data?.devices;
  const deviceIds = useMemo(() => (devices ? devices.map((d) => d.id) : null), [devices]);
  const pairing = usePairing({ deviceIds });
  const { active, revoked } = useMemo(() => splitDevices(devices ?? []), [devices]);

  // Sondeo de respaldo: solo con un código a la vista, en vivo y sin SSE.
  const shouldPoll = pairing.state.phase === 'code' && mode === 'live' && realtime !== 'open';
  if (shouldPoll !== polling) setPolling(shouldPoll);

  const pairedId = pairing.state.phase === 'paired' ? pairing.state.deviceId : null;
  const pairedName = pairedId ? (devices?.find((d) => d.id === pairedId)?.name ?? null) : null;

  const revoke = async (device: Device) => {
    setRevoking(device.id);
    try {
      await api('deviceRevoke', { params: { id: device.id } });
      notify(`«${device.name}» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez.`, {
        tone: 'ok',
        icon: 'check',
      });
    } catch (error) {
      notify(`No se pudo revocar «${device.name}». ${describeFailure(error)}`, { tone: 'err' });
    } finally {
      setRevoking(null);
      void invalidateRoute('devicesList', client);
    }
  };

  const origin = typeof location === 'undefined' ? '' : location.origin;
  const hostname = typeof location === 'undefined' ? '' : location.hostname;

  let listBody;
  if (list.isPending) {
    listBody = <SkeletonRows rows={2} label="Cargando los dispositivos…" />;
  } else if (list.isError && !devices) {
    listBody = (
      <div className="disp-inline disp-inline--err" role="alert">
        <Icon name="aviso" size={18} />
        <span>No se pudo leer la lista. {describeFailure(list.error)}</span>
        <Button size="sm" variant="quiet" icon="refresh" onClick={() => void list.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  } else if (active.length === 0) {
    listBody = (
      <p className="disp-inline">
        <Icon name="movil" size={18} />
        <span>
          Aún no hay ningún dispositivo emparejado. Empieza con «Emparejar un dispositivo».
        </span>
      </p>
    );
  } else {
    listBody = (
      <ul className="disp-list" aria-label="Dispositivos emparejados">
        {active.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            now={now}
            armed={confirm.armed === device.id}
            busy={revoking === device.id}
            onRevoke={() => confirm.tap(device.id, () => void revoke(device))}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="disp">
      <p className="disp-intro">
        Empareja la app de iPhone o iPad con este Ace Player Neo: ve la agenda y tus canales y
        reproduce desde el propio dispositivo. El código dura 5 minutos y solo sirve una vez.
      </p>

      <PairingPanel pairing={pairing} pairedName={pairedName} demo={mode === 'demo'} />
      <OriginNote origin={origin} hostname={hostname} />

      <section className="disp-block" aria-labelledby="disp-lista">
        <div className="disp-block__head">
          <h3 id="disp-lista" className="disp-block__title">
            Emparejados
          </h3>
          {devices ? <span className="disp-block__aside">{active.length}</span> : null}
        </div>
        {listBody}
        {revoked.length > 0 ? (
          <div className="disp-revoked">
            <Button
              size="sm"
              variant="ghost"
              icon="eye"
              aria-expanded={showRevoked}
              aria-controls="disp-revocados"
              onClick={() => setShowRevoked((open) => !open)}
            >
              {showRevoked ? 'Ocultar los revocados' : `Ver los revocados (${revoked.length})`}
            </Button>
            {showRevoked ? (
              <ul
                id="disp-revocados"
                className="disp-list disp-list--revoked"
                aria-label="Dispositivos revocados"
              >
                {revoked.map((device) => (
                  <li key={device.id} className="disp-dev disp-dev--revoked">
                    <span className="disp-dev__icon" aria-hidden="true">
                      <Icon name={PLATFORM_ICON[device.platform]} size={20} />
                    </span>
                    <div className="disp-dev__text">
                      <span className="disp-dev__name">{device.name}</span>
                      <span className="disp-dev__meta">
                        {PLATFORM_LABEL[device.platform]} · {revokedText(device)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
