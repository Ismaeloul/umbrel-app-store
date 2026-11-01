/* «Desde fuera de casa» en Ajustes → Dispositivos (el dominio tv.ismaeloul.es): el interruptor de
   cada aparato con su caducidad y su último acceso, el bloque con los bloqueos y «Cerrar el
   dominio ya», y los avisos (también el de arriba de la web). */

import type { Device, RemoteView } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { renderSection } from '../health/test-utils.tsx';
import { DevicesSection } from './DevicesSection.tsx';
import { RemoteAlertBanner } from './RemoteAlertBanner.tsx';
import {
  eventText,
  expiryText,
  filterEvents,
  lastAccessText,
  remoteAlerts,
  shortDate,
} from './remote-model.ts';

const NOW = Date.now();
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const MIN = 60_000;

const IPHONE: Device = {
  id: 'dev_iphone01',
  name: 'iPhone de Isma',
  platform: 'ios',
  createdAt: iso(-30 * 24 * 60 * MIN),
  lastSeenAt: iso(-5 * MIN),
  revokedAt: null,
};
const IPAD: Device = { ...IPHONE, id: 'dev_ipad0001', name: 'iPad del salón', platform: 'ipados' };

let view: RemoteView;
let net: ReturnType<typeof mockFetch>;

function baseView(): RemoteView {
  return {
    domain: { configured: true, url: 'https://tv.example.org' },
    enabled: true,
    edge: { listening: true, peerResolved: true },
    devices: [
      {
        deviceId: IPHONE.id,
        enabled: true,
        enabledAt: iso(-60 * MIN),
        expiresAt: iso(30 * 24 * 60 * MIN),
        expired: false,
        lastAccess: { at: iso(-3 * MIN), ip: '198.51.100.23' },
      },
      {
        deviceId: IPAD.id,
        enabled: false,
        enabledAt: null,
        expiresAt: null,
        expired: false,
        lastAccess: null,
      },
    ],
    blocks: [
      {
        key: '203.0.113.9',
        label: '203.0.113.9',
        until: iso(15 * MIN),
        level: 1,
        firstAt: iso(-10 * MIN),
        lastAt: iso(-1 * MIN),
      },
      {
        key: '2a01:e0a:1:2::',
        label: '2a01:e0a:1:2::/64',
        until: iso(60 * MIN),
        level: 2,
        firstAt: iso(-10 * MIN),
        lastAt: iso(-1 * MIN),
      },
    ],
    events: [
      {
        at: iso(-2 * MIN),
        kind: 'denied-device',
        deviceId: IPAD.id,
        ip: '2001:db8::7',
        route: 'ping',
      },
      {
        at: iso(-3 * MIN),
        kind: 'ok-new-ip',
        deviceId: IPHONE.id,
        ip: '198.51.100.23',
        route: 'bootstrap',
      },
      { at: iso(-4 * MIN), kind: 'blocked', deviceId: null, ip: '203.0.113.9', route: null },
    ],
    last24h: { ok: 412, denied: 9, blocked: 12, ipUntrusted: 0 },
  };
}

function setup(search = '?vista=ajustes/dispositivos', ui = <DevicesSection />) {
  net = mockFetch({
    'GET /api/v1/devices': () => json({ devices: [IPHONE, IPAD] }),
    'GET /api/v1/remote': () => json(view),
    'PUT /api/v1/remote': (call: MockCall) => {
      view = { ...view, enabled: (call.body as { enabled: boolean }).enabled };
      return json(view);
    },
    [`PUT /api/v1/devices/${IPAD.id}/remote`]: (call: MockCall) => {
      const body = call.body as { enabled: boolean; expiresIn: string };
      view = {
        ...view,
        devices: view.devices.map((device) =>
          device.deviceId === IPAD.id
            ? {
                ...device,
                enabled: body.enabled,
                enabledAt: iso(0),
                expiresAt: iso(7 * 24 * 60 * MIN),
              }
            : device,
        ),
      };
      return json(view);
    },
    [`PUT /api/v1/devices/${IPHONE.id}/remote`]: () => {
      view = {
        ...view,
        devices: view.devices.map((device) =>
          device.deviceId === IPHONE.id ? { ...device, enabled: false, expiresAt: null } : device,
        ),
      };
      return json(view);
    },
    'DELETE /api/v1/remote/blocks/203.0.113.9': () => {
      view = { ...view, blocks: view.blocks.filter((block) => block.key !== '203.0.113.9') };
      return json({ removed: 1 });
    },
    'DELETE /api/v1/remote/blocks': () => {
      view = { ...view, blocks: [] };
      return json({ removed: 2 });
    },
  });
  return renderSection(ui, search);
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
  view = baseView();
  try {
    sessionStorage.clear();
  } catch {
    // jsdom siempre lo tiene.
  }
});
afterEach(() => {
  net?.restore();
  resetToasts();
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
});

const calls = (method: string) => net.calls.filter((call) => call.method === method);

describe('Dispositivos · desde fuera de casa', () => {
  it('cada aparato: interruptor, caducidad y último acceso con su IP', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    const [first, second] = within(list).getAllByRole('listitem');
    const iphone = within(first as HTMLElement);
    await waitFor(() =>
      expect(
        iphone.getByRole('switch', { name: 'Acceso desde fuera de casa (tv.ismaeloul.es)' }),
      ).toHaveAttribute('aria-checked', 'true'),
    );
    expect(first).toHaveTextContent(/Caduca el \d+ \w+/);
    expect(first).toHaveTextContent('Último acceso desde fuera: hace 3 min · 198.51.100.23');
    const ipad = within(second as HTMLElement);
    expect(ipad.getByRole('switch', { name: /Acceso desde fuera/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(second).toHaveTextContent('Último acceso desde fuera: nunca');
    /* Al encenderlo se elige la caducidad (30 días si no se toca). */
    const select = ipad.getByRole('combobox', { name: /Caducidad del acceso desde fuera/ });
    expect(select).toHaveValue('30d');
    fireEvent.change(select, { target: { value: '7d' } });
    fireEvent.click(ipad.getByRole('switch', { name: /Acceso desde fuera/ }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(calls('PUT')[0]).toMatchObject({
      url: `/api/v1/devices/${IPAD.id}/remote`,
      body: { enabled: true, expiresIn: '7d' },
    });
    expect(
      await screen.findByText('«iPad del salón» ya puede entrar desde fuera de casa.'),
    ).toBeInTheDocument();
  });

  it('apagar el de un aparato manda enabled: false', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    const iphone = within(within(list).getAllByRole('listitem')[0] as HTMLElement);
    const toggle = await iphone.findByRole('switch', { name: /Acceso desde fuera/ });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(calls('PUT')[0]?.body).toMatchObject({ enabled: false }));
  });

  it('IPs bloqueadas: desbloquear una y todas', async () => {
    setup();
    const blocks = await screen.findByRole('list', { name: 'IPs bloqueadas' });
    expect(blocks).toHaveTextContent('203.0.113.9');
    expect(blocks).toHaveTextContent('2a01:e0a:1:2::/64');
    expect(blocks).toHaveTextContent('nivel 2');
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear todas' }));
    await waitFor(() =>
      expect(calls('DELETE').map((call) => call.url)).toEqual(['/api/v1/remote/blocks']),
    );
  });

  it('desbloquear una sola', async () => {
    setup();
    const blocks = await screen.findByRole('list', { name: 'IPs bloqueadas' });
    fireEvent.click(within(blocks).getByRole('button', { name: 'Desbloquear 203.0.113.9' }));
    await waitFor(() =>
      expect(calls('DELETE').map((call) => call.url)).toEqual([
        '/api/v1/remote/blocks/203.0.113.9',
      ]),
    );
    expect(await screen.findByText('203.0.113.9 desbloqueada.')).toBeInTheDocument();
  });

  it('«Cerrar el dominio ya» pide un segundo toque y apaga el interruptor general', async () => {
    setup();
    const close = await screen.findByRole('button', { name: 'Cerrar el dominio ya' });
    fireEvent.click(close);
    expect(calls('PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /¿Cerrar\? Pulsa otra vez/ }));
    await waitFor(() =>
      expect(calls('PUT')[0]).toMatchObject({ url: '/api/v1/remote', body: { enabled: false } }),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Acceso desde fuera de casa' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
  });

  it('los avisos: intentos bloqueados en 24 h y el aparato sin permiso con «Permitir»', async () => {
    setup();
    expect(
      await screen.findByText('12 intentos bloqueados desde fuera en las últimas 24 h'),
    ).toBeInTheDocument();
    const denied = screen.getByText(/Tu «iPad del salón» intentó entrar desde fuera/);
    fireEvent.click(
      within(denied.closest('p') as HTMLElement).getByRole('button', { name: 'Permitir' }),
    );
    await waitFor(() =>
      expect(calls('PUT')[0]).toMatchObject({
        url: `/api/v1/devices/${IPAD.id}/remote`,
        body: { enabled: true, expiresIn: '30d' },
      }),
    );
  });

  it('los sucesos con filtro', async () => {
    setup();
    const events = await screen.findByRole('list', { name: 'Sucesos desde fuera de casa' });
    expect(within(events).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Accesos' }));
    expect(
      within(screen.getByRole('list', { name: 'Sucesos desde fuera de casa' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Sucesos desde fuera de casa' })).toHaveTextContent(
      'iPhone de Isma: entró desde una IP nueva · 198.51.100.23',
    );
  });

  it('«la IP real no llega» si hubo accesos con IP de dentro', async () => {
    view = { ...baseView(), last24h: { ...baseView().last24h, ipUntrusted: 5 } };
    setup();
    expect(await screen.findByText(/La IP real no llega/)).toBeInTheDocument();
  });

  it('sin dominio configurado: solo explica cómo crearlo, sin interruptores', async () => {
    view = { ...baseView(), domain: { configured: false, url: null } };
    setup();
    expect(await screen.findByText(/Sin dominio configurado/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Acceso desde fuera/ })).toBeNull();
  });

  it('en la demo no se pide nada del dominio', async () => {
    resetMode();
    setMode('demo', 'bootstrap');
    setup();
    await screen.findByText(/Empareja la app/);
    expect(net.calls.some((call) => call.url === '/api/v1/remote')).toBe(false);
  });
});

describe('aviso de arriba de la web', () => {
  it('dice cuántos intentos se bloquearon y lleva a Dispositivos; se puede cerrar', async () => {
    setup('?vista=agenda', <RemoteAlertBanner />);
    const text = await screen.findByText(/12 intentos bloqueados desde fuera en las últimas 24 h/);
    const banner = text.closest('.remote-alert') as HTMLElement;
    expect(banner).toHaveAttribute('role', 'status');
    await waitFor(() => expect(banner).toHaveTextContent('Tu «iPad del salón» intentó entrar'));
    fireEvent.click(within(banner).getByRole('button', { name: 'Cerrar el aviso' }));
    expect(document.querySelector('.remote-alert')).toBeNull();
  });

  it('sin nada que contar, no sale', async () => {
    view = { ...baseView(), events: [], last24h: { ok: 3, denied: 0, blocked: 0, ipUntrusted: 0 } };
    setup('?vista=agenda', <RemoteAlertBanner />);
    await waitFor(() => expect(net.calls.some((call) => call.url === '/api/v1/remote')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('.remote-alert')).toBeNull();
  });
});

describe('remote-model', () => {
  it('textos de caducidad y último acceso', () => {
    expect(expiryText({ expiresAt: null, expired: false })).toBe('Sin caducidad');
    expect(
      expiryText(
        { expiresAt: '2026-12-01T10:00:00.000Z', expired: false },
        Date.parse('2026-11-01T10:00:00Z'),
      ),
    ).toBe('Caduca el 1 dic');
    expect(
      expiryText(
        { expiresAt: '2026-12-01T10:00:00.000Z', expired: true },
        Date.parse('2026-12-20T10:00:00Z'),
      ),
    ).toBe('Caducó el 1 dic');
    expect(shortDate(new Date(NOW + 60 * MIN).toISOString(), NOW)).toMatch(
      /^(hoy|mañana) a las \d\d:\d\d$/,
    );
    expect(lastAccessText({ lastAccess: null })).toBe('Último acceso desde fuera: nunca');
  });

  it('los avisos no cuentan a quien ya tiene permiso ni a revocados', () => {
    const v = baseView();
    v.events.push({
      at: iso(-1 * MIN),
      kind: 'denied-device',
      deviceId: IPHONE.id,
      ip: '1.2.3.4',
      route: 'ping',
    });
    expect(remoteAlerts(v, [IPHONE, IPAD], NOW).denied).toEqual([
      { deviceId: IPAD.id, name: IPAD.name },
    ]);
    expect(remoteAlerts(v, [IPHONE, { ...IPAD, revokedAt: iso(0) }], NOW).denied).toEqual([]);
    expect(filterEvents(v.events, 'denied').map((e) => e.kind)).toEqual([
      'denied-device',
      'blocked',
      'denied-device',
    ]);
  });

  it('los bloqueos juntados de un minuto dicen cuántos, sin IP', () => {
    const names = new Map<string, string>();
    const at = iso(-2 * MIN);
    expect(
      eventText(
        { at, kind: 'blocked', deviceId: null, ip: null, route: null, count: 4995 },
        names,
        NOW,
      ),
    ).toMatch(/^4995 IPs más bloqueadas por demasiados fallos en un minuto · /);
    expect(
      eventText(
        { at, kind: 'blocked', deviceId: null, ip: null, route: null, count: 1 },
        names,
        NOW,
      ),
    ).toMatch(/^Otra IP bloqueada por demasiados fallos en un minuto · /);
    expect(
      eventText({ at, kind: 'blocked', deviceId: null, ip: '1.2.3.4', route: null }, names, NOW),
    ).toMatch(/^IP bloqueada por demasiados fallos · 1\.2\.3\.4 · /);
  });
});
