/* Ajustes → IPTV pintado (docs/iptv.md §1): formulario M3U / Xtream,
   guardado con prueba rápida, estado que llega después, tarjeta con sus
   acciones, «Cambiar datos» sin reescribir la contraseña y «Eliminar» con
   segundo toque. Y la higiene: la contraseña no queda en el DOM ni pasa por
   useApiMutation. Sin red: fetch simulado (el cliente valida con zod). */

import { errorMessage, type IptvProviderView, type IptvView } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { renderWithApp } from '../library/test-utils.tsx';
import { IptvSection } from './IptvSection.tsx';

const toasts = () => toastStore.get().map((t) => t.text);
const SECRET = 'contraseña-muy-secreta';

const provider: IptvProviderView = {
  kind: 'xtream',
  name: 'Casa',
  enabled: true,
  host: 'proveedor.example:8080',
  origin: 'http://proveedor.example:8080',
  hasUrl: false,
  hasUsername: true,
  hasPassword: true,
  status: 'ok',
  channels: 812,
  updatedAt: '2026-09-26T18:30:00.000Z',
  error: null,
  staleSince: null,
  account: {
    status: 'active',
    expiresAt: '2026-12-03T00:00:00.000Z',
    maxConnections: 1,
    activeConnections: 0,
    ours: 0,
  },
  guide: {
    available: true,
    channelsWithGuide: 640,
    updatedAt: '2026-09-26T12:00:00.000Z',
    failedAt: null,
  },
};
const view = (p: IptvProviderView | null): IptvView => ({ provider: p, refreshHours: 6 });

let net: ReturnType<typeof mockFetch>;
const calls = (method: string) =>
  net.calls.filter((call) => call.method === method && call.url.startsWith('/api/v1/iptv'));

function setup(initial: IptvView, routes: Record<string, unknown> = {}) {
  net = mockFetch({ 'GET /api/v1/iptv': initial, ...(routes as Record<string, never>) });
  return renderWithApp(<IptvSection />, { search: '?vista=ajustes/iptv' });
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  resetToasts();
  resetMode();
});

describe('sin IPTV: «Conectar tu IPTV»', () => {
  it('formulario M3U por defecto, con la nota de privacidad', async () => {
    setup(view(null));
    expect(await screen.findByRole('heading', { name: 'Conectar tu IPTV' })).toBeInTheDocument();
    const kind = screen.getByRole('radiogroup', { name: 'Tipo de IPTV' });
    expect(within(kind).getByRole('radio', { name: 'Lista M3U' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('Nombre')).toHaveAttribute(
      'placeholder',
      'Nombre, por ejemplo: Casa',
    );
    expect(screen.getByLabelText('Dirección de la lista')).toHaveAttribute(
      'placeholder',
      'https://…/lista.m3u',
    );
    expect(
      screen.getByText(
        'Tus credenciales se guardan cifradas en tu Umbrel y no salen de él: ni al navegador, ni al iPhone, ni a los registros.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar IPTV' })).toBeInTheDocument();
  });

  it('guardar Xtream: prueba rápida, «Descargando…», y el recuento cuando llega', async () => {
    const { client } = setup(view(null), {
      'PUT /api/v1/iptv': () => json(view({ ...provider, status: 'syncing', channels: 0 })),
    });
    await screen.findByRole('heading', { name: 'Conectar tu IPTV' });
    fireEvent.click(screen.getByRole('radio', { name: 'Xtream Codes' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Casa' } });
    fireEvent.change(screen.getByLabelText('Servidor'), {
      target: { value: 'http://proveedor.example:8080' },
    });
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'isma' } });
    const password = screen.getByLabelText('Contraseña');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'off');
    expect(password).toHaveAttribute('data-1p-ignore');
    expect(password).toHaveAttribute('data-lpignore', 'true');
    expect(password).toHaveAttribute('data-bwignore');
    fireEvent.change(password, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar IPTV' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(calls('PUT')[0]?.body).toEqual({
      kind: 'xtream',
      name: 'Casa',
      server: 'http://proveedor.example:8080',
      username: 'isma',
      password: SECRET,
    });
    expect(
      await screen.findByText('Conexión correcta. Descargando los canales de «Casa»…'),
    ).toBeInTheDocument();
    // La contraseña ya no está en el DOM (ni en un campo ni en ningún texto).
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    // Llega el recuento (por SSE `iptv.status`, que vuelve a pedir iptvGet).
    act(() => client.setQueryData(routeKey('iptvGet'), view(provider)));
    expect(
      await screen.findByText('«Casa»: 812 canales. Se actualiza sola cada 6 h.'),
    ).toBeInTheDocument();
    expect(toasts()).toContain('IPTV guardada: 812 canales');
  });

  it('campos vacíos: aviso y sin petición; una dirección que no es http(s), bajo su campo', async () => {
    setup(view(null));
    await screen.findByRole('heading', { name: 'Conectar tu IPTV' });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar IPTV' }));
    expect(toasts()).toContain('Escribe la dirección de la lista');
    expect(screen.getByLabelText('Dirección de la lista')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Dirección de la lista'), {
      target: { value: 'lista.m3u' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar IPTV' }));
    expect(await screen.findByText(errorMessage('bad_url'))).toBeInTheDocument();
    expect(calls('PUT')).toHaveLength(0);
  });

  it('red local: la misma pista que «Listas»', async () => {
    setup(view(null));
    await screen.findByRole('heading', { name: 'Conectar tu IPTV' });
    fireEvent.change(screen.getByLabelText('Dirección de la lista'), {
      target: { value: 'http://192.168.1.20/lista.m3u' },
    });
    expect(
      screen.getByText(
        'Parece una dirección de tu red local: por seguridad el servidor las bloquea salvo que se hayan permitido al instalar.',
      ),
    ).toBeInTheDocument();
  });

  it('si la prueba rápida falla, no se guarda y lo dice con el mensaje del catálogo', async () => {
    setup(view(null), {
      'PUT /api/v1/iptv': () =>
        json(
          {
            error: {
              code: 'iptv_bad_list',
              message: 'La dirección respondió, pero no es una lista M3U con canales en directo.',
              requestId: 'r1',
            },
          },
          422,
        ),
    });
    await screen.findByRole('heading', { name: 'Conectar tu IPTV' });
    fireEvent.change(screen.getByLabelText('Dirección de la lista'), {
      target: { value: 'https://listas.example/lista.m3u' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar IPTV' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'La dirección respondió, pero no es una lista M3U con canales en directo.',
    );
    expect(toasts()).toContain(
      'No se pudo guardar la IPTV. La dirección respondió, pero no es una lista M3U con canales en directo.',
    );
    // El formulario sigue ahí para corregir.
    expect(screen.getByRole('heading', { name: 'Conectar tu IPTV' })).toBeInTheDocument();
  });
});

describe('con IPTV: tarjeta y acciones', () => {
  it('estado, host sin credenciales, cuenta y guía', async () => {
    const { container } = setup(view(provider));
    expect(await screen.findByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByText(/^Xtream · 812 canales · actualizada/)).toBeInTheDocument();
    expect(container.querySelector('.iptv-card__host')).toHaveTextContent(
      'proveedor.example:8080 · usuario y contraseña guardados',
    );
    expect(
      screen.getByText('Cuenta activa hasta el 3 dic · 1 conexión a la vez'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Guía: 640 canales con programación/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Usar la IPTV' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('pausar con el interruptor', async () => {
    setup(view(provider), {
      'PATCH /api/v1/iptv': () => json(view({ ...provider, enabled: false, status: 'disabled' })),
    });
    fireEvent.click(await screen.findByRole('switch', { name: 'Usar la IPTV' }));
    await waitFor(() => expect(calls('PATCH')[0]?.body).toEqual({ enabled: false }));
    expect(await screen.findByText('En pausa')).toBeInTheDocument();
    expect(toasts()).toContain('IPTV en pausa: todo sale de AceStream');
  });

  it('«Actualizar» lanza la sincronización y avisa cuando llega el recuento', async () => {
    const { client } = setup(view(provider), {
      'POST /api/v1/iptv/sync': () => json(view({ ...provider, status: 'syncing' })),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(await screen.findByText('Actualizando la lista de «Casa»…')).toBeInTheDocument();
    act(() => client.setQueryData(routeKey('iptvGet'), view({ ...provider, channels: 820 })));
    await waitFor(() => expect(toasts()).toContain('Lista de la IPTV actualizada: 820 canales'));
  });

  it('«Cambiar datos»: la contraseña no vuelve y, vacía, no se manda', async () => {
    setup(view(provider), {
      'PUT /api/v1/iptv': () => json(view({ ...provider, name: 'Salón', status: 'syncing' })),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar datos' }));
    expect(
      screen.getByRole('heading', { name: 'Cambiar los datos de tu IPTV' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Servidor')).toHaveValue('http://proveedor.example:8080');
    expect(screen.getByLabelText('Usuario')).toHaveValue('');
    expect(screen.getByLabelText('Usuario')).toHaveAttribute(
      'placeholder',
      'Guardado · escríbelo solo para cambiarlo',
    );
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute(
      'placeholder',
      'Guardada · escríbela solo para cambiarla',
    );
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Salón' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    // El servidor sin tocar tampoco va: el guardado puede llevar una ruta base.
    expect(calls('PUT')[0]?.body).toEqual({ kind: 'xtream', name: 'Salón' });
  });

  it('«Cambiar datos» con otro servidor pide el usuario y la contraseña antes de mandar', async () => {
    setup(view(provider));
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar datos' }));
    fireEvent.change(screen.getByLabelText('Servidor'), {
      target: { value: 'http://otro.example:8080' },
    });
    expect(screen.getByLabelText('Contraseña')).not.toHaveAttribute(
      'placeholder',
      'Guardada · escríbela solo para cambiarla',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(toasts()).toContain('Escribe el usuario');
    expect(calls('PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Cambiar datos' })).toBeInTheDocument();
  });

  it('«Eliminar» con segundo toque, la nota y el aviso', async () => {
    setup(view(provider), { 'DELETE /api/v1/iptv': () => json(view(null)) });
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Casa' }));
    expect(screen.getByText('Eliminar la IPTV borra sus datos de tu Umbrel.')).toBeInTheDocument();
    expect(calls('DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar: eliminar Casa y sus datos' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Conectar tu IPTV' })).toBeInTheDocument();
    expect(toasts()).toContain('IPTV eliminada');
  });

  it('cuenta con todas las conexiones en uso fuera y copia anterior tras un fallo', async () => {
    setup(
      view({
        ...provider,
        staleSince: '2026-09-26T18:30:00.000Z',
        error: { code: 'iptv_unreachable', message: 'Tu proveedor de IPTV no responde.' },
        account: { ...provider.account!, activeConnections: 1 },
      }),
    );
    expect(await screen.findByText('Con fallos')).toBeInTheDocument();
    expect(
      screen.getByText('Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^No se pudo actualizar: tu proveedor de IPTV no responde\./),
    ).toBeInTheDocument();
  });
});

describe('higiene', () => {
  it('no usa useApiMutation (TanStack guardaría las credenciales en su caché) ni console', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const code = readFileSync(path.join(dir, 'IptvSection.tsx'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(code).not.toMatch(/useApiMutation\(/);
    expect(code).not.toMatch(/console\./);
  });

  it('ninguna llamada al servidor manda un secreto vacío', async () => {
    const seen: MockCall[] = [];
    setup(view(provider), {
      'PUT /api/v1/iptv': (call: MockCall) => {
        seen.push(call);
        return json(view(provider));
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar datos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(Object.keys(seen[0]?.body as object)).toEqual(['kind', 'name']);
  });
});
