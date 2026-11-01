/* «Desde fuera de casa» en Ajustes → Dispositivos: el dominio de la app de iPhone,
   https://tv.ismaeloul.es (docs/acceso-remoto.md, «Por el dominio»).

   - En cada aparato (`DeviceRemote`): el interruptor «Acceso desde fuera de casa», con la
     caducidad al encenderlo (24 h, 7 días, 30 días —la propuesta— o sin caducidad), el último
     acceso desde fuera con su IP y cuándo caduca.
   - El bloque (`RemoteBlock`): el interruptor general y «Cerrar el dominio ya» (segundo toque),
     las IPs bloqueadas con «Desbloquear» (y «Desbloquear todas»), los últimos sucesos con filtro
     y el estado del dominio. Sin dominio configurado, solo explica cómo crearlo.
   - Los avisos de arriba (`RemoteNotices`): intentos bloqueados en 24 h y aparatos sin permiso
     que intentaron entrar («Permitir»).

   Todo lo de aquí es solo de la web: el iPhone no puede darse permiso a sí mismo. Datos: GET
   /api/v1/remote; el SSE `remote.changed` (sin datos, solo a la web) la invalida. */

import type { Device, RemoteDeviceView, RemoteExpiresIn, RemoteView } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, describeFailure, invalidateRoute, routeKey } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Switch } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { useSecondTap } from '../settings/second-tap.ts';
import {
  DEFAULT_EXPIRY,
  EVENT_FILTERS,
  EXPIRY_OPTIONS,
  blockedText,
  eventText,
  expiryText,
  filterEvents,
  lastAccessText,
  remoteAlerts,
  shortDate,
  type EventFilter,
} from './remote-model.ts';

/** Segundo toque para «Cerrar el dominio ya». */
export const CONFIRM_CLOSE_MS = 5000;

function useRemoteActions() {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<RemoteView | unknown>, ok: string) => {
    setBusy(key);
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'devices' in result) {
        client.setQueryData(routeKey('remoteGet'), result as RemoteView);
      }
      notify(ok, { tone: 'ok', icon: 'check' });
    } catch (error) {
      notify(`No se pudo. ${describeFailure(error)}`, { tone: 'err' });
    } finally {
      setBusy(null);
      void invalidateRoute('remoteGet', client);
    }
  };
  return {
    busy,
    setDevice: (
      device: Pick<Device, 'id' | 'name'>,
      enabled: boolean,
      expiresIn: RemoteExpiresIn,
    ) =>
      run(
        `dev:${device.id}`,
        () =>
          api('deviceRemoteUpdate', { params: { id: device.id }, body: { enabled, expiresIn } }),
        enabled
          ? `«${device.name}» ya puede entrar desde fuera de casa.`
          : `«${device.name}» ya no puede entrar desde fuera de casa.`,
      ),
    setEnabled: (enabled: boolean) =>
      run(
        'general',
        () => api('remoteUpdate', { body: { enabled } }),
        enabled
          ? 'Acceso desde fuera de casa abierto.'
          : 'Dominio cerrado: nadie entra desde fuera.',
      ),
    unblock: (key: string, label: string) =>
      run(
        `block:${key}`,
        () => api('remoteBlockDelete', { params: { key } }),
        `${label} desbloqueada.`,
      ),
    unblockAll: () => run('blocks', () => api('remoteBlocksClear'), 'Todas desbloqueadas.'),
  };
}

type Actions = ReturnType<typeof useRemoteActions>;

/** Debajo de cada aparato: el interruptor, la caducidad y el último acceso desde fuera. */
export function DeviceRemote({
  device,
  view,
  now,
  actions,
}: {
  device: Device;
  view: RemoteDeviceView | undefined;
  now: number;
  actions: Actions;
}) {
  const [expiresIn, setExpiresIn] = useState<RemoteExpiresIn>(DEFAULT_EXPIRY);
  const enabled = view?.enabled ?? false;
  const busy = actions.busy === `dev:${device.id}`;
  return (
    <div className="disp-remote" data-on={enabled || undefined}>
      <Switch
        label="Acceso desde fuera de casa (tv.ismaeloul.es)"
        description={
          enabled
            ? `${expiryText(view ?? { expiresAt: null, expired: false }, now)}.`
            : 'Apagado: por el dominio este aparato recibe «no tiene permiso».'
        }
        checked={enabled}
        disabled={busy}
        onChange={(checked) => void actions.setDevice(device, checked, expiresIn)}
      />
      {!enabled ? (
        <label className="disp-remote__expiry">
          <span>Al encenderlo, caduca en</span>
          <select
            value={expiresIn}
            onChange={(event) => setExpiresIn(event.target.value as RemoteExpiresIn)}
            aria-label={`Caducidad del acceso desde fuera de ${device.name}`}
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="disp-dev__meta disp-dev__meta--soft">
        {lastAccessText(view ?? { lastAccess: null }, now)}
      </span>
    </div>
  );
}

export function RemoteNotices({
  view,
  devices,
  now,
  actions,
}: {
  view: RemoteView;
  devices: readonly Device[];
  now: number;
  actions: Actions;
}) {
  const alerts = remoteAlerts(view, devices, now);
  if (alerts.blocked === 0 && alerts.denied.length === 0) return null;
  return (
    <div className="disp-alerts">
      {alerts.blocked > 0 ? (
        <p className="disp-inline disp-inline--err" role="alert">
          <Icon name="aviso" size={18} />
          <span>{blockedText(alerts.blocked)}</span>
          <a className="disp-alerts__link" href="#disp-fuera">
            Ver
          </a>
        </p>
      ) : null}
      {alerts.denied.map((denied) => (
        <p key={denied.deviceId} className="disp-inline" role="status">
          <Icon name="candado" size={18} />
          <span>Tu «{denied.name}» intentó entrar desde fuera y no tiene permiso.</span>
          <Button
            size="sm"
            variant="quiet"
            busy={actions.busy === `dev:${denied.deviceId}`}
            onClick={() =>
              void actions.setDevice(
                { id: denied.deviceId, name: denied.name },
                true,
                DEFAULT_EXPIRY,
              )
            }
          >
            Permitir
          </Button>
        </p>
      ))}
    </div>
  );
}

export function RemoteBlock({
  view,
  devices,
  now,
  actions,
}: {
  view: RemoteView;
  devices: readonly Device[];
  now: number;
  actions: Actions;
}) {
  const confirm = useSecondTap(CONFIRM_CLOSE_MS);
  const [filter, setFilter] = useState<EventFilter>('all');
  const names = useMemo(
    () => new Map(devices.map((device) => [device.id, device.name])),
    [devices],
  );
  const events = filterEvents(view.events, filter);
  const armed = confirm.armed === 'cerrar';

  if (!view.domain.configured) {
    return (
      <section className="disp-block" id="disp-fuera" aria-labelledby="disp-fuera-t">
        <div className="disp-block__head">
          <h3 id="disp-fuera-t" className="disp-block__title">
            Desde fuera de casa
          </h3>
        </div>
        <p className="disp-inline">
          <Icon name="info" size={18} />
          <span>
            Sin dominio configurado: el iPhone solo entra desde casa o por Tailscale. Para usar la
            app fuera sin VPN hace falta un registro A (por ejemplo, <strong>tv</strong>) que apunte
            a la IP de casa y <code>NATIVE_PUBLIC_URL</code> en el Compose; los pasos están en
            docs/acceso-remoto.md, «Por el dominio».
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className="disp-block" id="disp-fuera" aria-labelledby="disp-fuera-t">
      <div className="disp-block__head">
        <h3 id="disp-fuera-t" className="disp-block__title">
          Desde fuera de casa
        </h3>
        <span className="disp-block__aside">{view.domain.url}</span>
      </div>
      <Switch
        label="Acceso desde fuera de casa"
        description={
          view.enabled
            ? 'Abierto para los aparatos que tengan permiso (abajo, en cada uno).'
            : 'Cerrado: todo lo que llega por el dominio recibe «apagado».'
        }
        checked={view.enabled}
        disabled={actions.busy === 'general'}
        onChange={(checked) => void actions.setEnabled(checked)}
      />
      {view.enabled ? (
        <Button
          variant="danger"
          size="sm"
          icon="candado"
          busy={actions.busy === 'general'}
          onClick={() => confirm.tap('cerrar', () => void actions.setEnabled(false))}
          aria-label={
            armed ? '¿Cerrar? Pulsa otra vez para cerrar el dominio' : 'Cerrar el dominio ya'
          }
        >
          {armed ? '¿Cerrar? Pulsa otra vez' : 'Cerrar el dominio ya'}
        </Button>
      ) : null}
      {!view.edge.listening || !view.edge.peerResolved ? (
        <p className="disp-inline disp-inline--err" role="note">
          <Icon name="aviso" size={18} />
          <span>
            {!view.edge.listening
              ? 'El puerto del dominio no está escuchando en el servidor: desde fuera no entra nadie.'
              : 'El servidor no encuentra el contenedor de Caddy (sala): desde fuera no entra nadie.'}
          </span>
        </p>
      ) : null}
      {view.last24h.ipUntrusted > 0 ? (
        <p className="disp-inline disp-inline--err" role="note">
          <Icon name="aviso" size={18} />
          <span>
            La IP real no llega: en las últimas 24 h, {view.last24h.ipUntrusted} peticiones llegaron
            con una IP de dentro (Docker o la Freebox). Así no se puede bloquear por IP; solo valen
            los límites por aparato.
          </span>
        </p>
      ) : null}
      <p className="disp-remote__stats">
        Últimas 24 h: {view.last24h.ok} correctas · {view.last24h.denied} rechazadas ·{' '}
        {view.last24h.blocked} bloqueadas
      </p>

      <h4 className="disp-remote__sub">IPs bloqueadas</h4>
      {view.blocks.length === 0 ? (
        <p className="disp-inline">
          <Icon name="check" size={18} />
          <span>Ninguna ahora mismo.</span>
        </p>
      ) : (
        <>
          <ul className="disp-list" aria-label="IPs bloqueadas">
            {view.blocks.map((block) => (
              <li key={block.key} className="disp-dev">
                <span className="disp-dev__icon" aria-hidden="true">
                  <Icon name="candado" size={20} />
                </span>
                <div className="disp-dev__text">
                  <span className="disp-dev__name">{block.label}</span>
                  <span className="disp-dev__meta">
                    Hasta {shortDate(block.until, now)} · nivel {block.level}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="quiet"
                  busy={actions.busy === `block:${block.key}`}
                  onClick={() => void actions.unblock(block.key, block.label)}
                  aria-label={`Desbloquear ${block.label}`}
                  className="disp-dev__act"
                >
                  Desbloquear
                </Button>
              </li>
            ))}
          </ul>
          {view.blocks.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              busy={actions.busy === 'blocks'}
              onClick={() => void actions.unblockAll()}
            >
              Desbloquear todas
            </Button>
          ) : null}
        </>
      )}

      <h4 className="disp-remote__sub">Últimos sucesos</h4>
      <div className="disp-remote__filters" role="group" aria-label="Filtrar los sucesos">
        {EVENT_FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? 'primary' : 'ghost'}
            pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {events.length === 0 ? (
        <p className="disp-inline">
          <span>Nada todavía.</span>
        </p>
      ) : (
        <ul className="disp-remote__events" aria-label="Sucesos desde fuera de casa">
          {events.map((event, index) => (
            <li key={`${event.at}-${index}`} data-kind={event.kind}>
              {eventText(event, names, now)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { useRemoteActions };
