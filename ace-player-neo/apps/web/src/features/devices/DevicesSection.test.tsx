import type { Device, DevicesListResponse } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { dispatchSse } from '../../api/sse.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { renderSection } from '../health/test-utils.tsx';
import DevicesSettings from './ajustes.tsx';
import { CONFIRM_REVOKE_MS, DevicesSection } from './DevicesSection.tsx';
import { demoQrSvg } from './demo.ts';
import { PAIRING_POLL_MS } from './usePairing.ts';

let net: ReturnType<typeof mockFetch>;
let devices: Device[];

const IPHONE = () => fixture<DevicesListResponse>('devicesList').devices[0] as Device;
const NEW_IPAD: Device = {
  id: 'dev_ipad0001',
  name: 'iPad del salón',
  platform: 'ipados',
  createdAt: new Date().toISOString(),
  lastSeenAt: null,
  revokedAt: null,
};

function mock(extra: Parameters<typeof mockFetch>[0] = {}) {
  net = mockFetch({
    'GET /api/v1/devices': () => json({ devices }),
    'POST /api/v1/pairing': () =>
      json({ ...fixture<object>('pairingCreate'), qrSvg: demoQrSvg('482913') }, 201),
    'DELETE /api/v1/devices/dev_iphone01': () => {
      const target = devices.find((d) => d.id === 'dev_iphone01') as Device;
      target.revokedAt = new Date().toISOString();
      return json({ device: target });
    },
    ...extra,
  });
}

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  mock(extra);
  return renderSection(<DevicesSection />, '?vista=ajustes/dispositivos');
}

const posts = () => net.calls.filter((c: MockCall) => c.method === 'POST');

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
  devices = [IPHONE()];
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  resetToasts();
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
});

describe('Dispositivos', () => {
  it('lista con nombre, plataforma y última vez; explica qué dirección lleva el QR', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    const row = within(list).getByRole('listitem');
    expect(row).toHaveTextContent('iPhone de prueba');
    expect(row).toHaveTextContent(/iPhone · (Conectado ahora mismo|Visto .+)/);
    expect(row).toHaveTextContent(/Emparejado el 23 sept 2026/);
    // jsdom sirve la página en localhost: el aviso de que al iPhone no le sirve.
    expect(screen.getByRole('note')).toHaveTextContent('solo existe en este ordenador');
  });

  it('emparejar: código grande en dos grupos, QR como imagen y cuenta atrás de 5 min', async () => {
    setup();
    await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    fireEvent.click(screen.getByRole('button', { name: 'Emparejar un dispositivo' }));
    expect(await screen.findByText('Código para emparejar')).toBeInTheDocument();
    // Manda la dirección de esta página para el QR.
    expect(posts()[0]?.body).toEqual({ baseUrl: location.origin });
    expect(screen.getByText('Código 4 8 2 9 1 3')).toBeInTheDocument();
    const qr = screen.getByRole('img', { name: /Código QR para emparejar/ });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^Caduca en (5:00|4:5\d)$/);
    expect(screen.getByText('Código listo. Caduca en 5 minutos.')).toBeInTheDocument();
  });

  it('a los 5 min caduca y se puede crear otro (que anula el anterior)', async () => {
    setup();
    await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: 'Emparejar un dispositivo' }));
    await screen.findByText('Código para emparejar');
    act(() => vi.advanceTimersByTime(60_000));
    // Con shouldAdvanceTime el reloj real también corre: con la máquina cargada
    // pueden pasar unos segundos más.
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^Caduca en (4:00|3:[45]\d)$/);
    act(() => vi.advanceTimersByTime(4 * 60_000 + 1000));
    expect(screen.getByText('El código ha caducado', { selector: 'p.disp-pair__title' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Código QR/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crear otro código' }));
    await screen.findByText('Código para emparejar');
    expect(posts()).toHaveLength(2);
  });

  it('cuando el iPhone canjea el código (SSE devices.changed): aviso y fila nueva', async () => {
    const { client } = setup();
    await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    fireEvent.click(screen.getByRole('button', { name: 'Emparejar un dispositivo' }));
    await screen.findByText('Código para emparejar');
    devices = [IPHONE(), NEW_IPAD];
    act(() => {
      dispatchSse('devices.changed', { reason: 'paired', deviceId: NEW_IPAD.id }, { id: '9', synthetic: false });
      void client.invalidateQueries({ queryKey: ['v1', 'devicesList'] });
    });
    expect(await screen.findByText('«iPad del salón» ya está emparejado')).toBeInTheDocument();
    await waitFor(() => expect(toastStore.get().at(-1)?.text).toBe('«iPad del salón» se ha emparejado'));
    const list = screen.getByRole('list', { name: 'Dispositivos emparejados' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Hecho' }));
    expect(screen.getByRole('button', { name: 'Emparejar un dispositivo' })).toBeInTheDocument();
  });

  it('sin SSE, la lista se sondea cada 5 s SOLO con un código a la vista', async () => {
    realtimeStore.set({ status: 'fallback', lastEventId: null, attempts: 3 });
    setup();
    await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    const lists = () => net.calls.filter((c) => c.method === 'GET' && c.url === '/api/v1/devices').length;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const idle = lists();
    await act(async () => {
      vi.advanceTimersByTime(PAIRING_POLL_MS * 3);
    });
    expect(lists()).toBe(idle);
    fireEvent.click(screen.getByRole('button', { name: 'Emparejar un dispositivo' }));
    await screen.findByText('Código para emparejar');
    const start = lists();
    devices = [IPHONE(), NEW_IPAD];
    await act(async () => {
      vi.advanceTimersByTime(PAIRING_POLL_MS + 50);
    });
    await waitFor(() => expect(lists()).toBeGreaterThan(start));
    // El dispositivo nuevo aparece en la lista: emparejado, y deja de sondear.
    expect(await screen.findByText('«iPad del salón» ya está emparejado')).toBeInTheDocument();
    const after = lists();
    await act(async () => {
      vi.advanceTimersByTime(PAIRING_POLL_MS * 3);
    });
    expect(lists()).toBe(after);
  });

  it('revocar pide un segundo toque (5 s) y avisa', async () => {
    setup();
    await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: 'Revocar iPhone de prueba' }));
    expect(screen.getByRole('button', { name: /^¿Revocar\? Pulsa otra vez/ })).toBeInTheDocument();
    expect(net.calls.some((c) => c.method === 'DELETE')).toBe(false);
    act(() => vi.advanceTimersByTime(CONFIRM_REVOKE_MS + 10));
    fireEvent.click(screen.getByRole('button', { name: 'Revocar iPhone de prueba' }));
    fireEvent.click(screen.getByRole('button', { name: /^¿Revocar\? Pulsa otra vez/ }));
    await waitFor(() =>
      expect(toastStore.get().at(-1)?.text).toBe(
        '«iPhone de prueba» ya no puede entrar. Si lo quieres de vuelta, emparéjalo otra vez.',
      ),
    );
    expect(net.calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/v1/devices/dev_iphone01');
    // Sale de la lista de activos; los revocados, plegados aparte.
    expect(await screen.findByText(/Aún no hay ningún dispositivo emparejado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver los revocados (1)' }));
    const revoked = screen.getByRole('list', { name: 'Dispositivos revocados' });
    expect(within(revoked).getByText(/Revocado el/)).toBeInTheDocument();
  });

  it('menú contextual (clic derecho): «Revocar el acceso» arma el segundo toque', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    fireEvent.contextMenu(within(list).getByRole('listitem'), { clientX: 20, clientY: 20 });
    const menu = await screen.findByRole('menu', { name: 'Opciones de iPhone de prueba' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Revocar el acceso' }));
    expect(await screen.findByRole('button', { name: /^¿Revocar\? Pulsa otra vez/ })).toBeInTheDocument();
    expect(net.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('si no se puede crear el código: el motivo y «Volver a intentarlo»', async () => {
    setup({
      'POST /api/v1/pairing': () =>
        json({ error: { code: 'internal_error', message: 'Algo falló en el servidor.', requestId: 'r' } }, 500),
    });
    await screen.findByRole('list', { name: 'Dispositivos emparejados' });
    fireEvent.click(screen.getByRole('button', { name: 'Emparejar un dispositivo' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo crear el código. Algo falló en el servidor.');
    expect(within(alert).getByRole('button', { name: 'Volver a intentarlo' })).toBeInTheDocument();
  });

  it('sin dispositivos: lo dice y señala la salida; si la lista falla, «Reintentar»', async () => {
    devices = [];
    setup();
    expect(await screen.findByText(/Aún no hay ningún dispositivo emparejado/)).toBeInTheDocument();
    net.restore();
    mock({
      'GET /api/v1/devices': () => json({ error: { code: 'internal_error', message: 'Uy.', requestId: 'r' } }, 500),
    });
    renderSection(<DevicesSettings route={{ vista: 'ajustes', seccion: 'dispositivos' }} active />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo leer la lista. Uy.');
  });
});
