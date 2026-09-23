import type { PlaybackStatus, SessionSummary } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDeviceId } from '../../api/identity.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { applyToCache } from '../../api/sse.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { renderWithApp } from '../library/test-utils.tsx';
import { WherePlayingSection } from './WherePlayingSection.tsx';

let net: ReturnType<typeof mockFetch>;

/** El ejemplo de @ace/shared (un ordenador y un iPhone) con el ordenador = este navegador. */
function sharedSession(): SessionSummary {
  const status = fixture<PlaybackStatus>('playbackStatus');
  const session = status.sessions[0] as SessionSummary;
  return {
    ...session,
    viewers: session.viewers.map((viewer) =>
      viewer.platform === 'web' ? { ...viewer, deviceId: getDeviceId() } : viewer,
    ),
  };
}

function setup(sessions: SessionSummary[] | 'error') {
  net = mockFetch({
    'GET /api/v1/playback': () =>
      sessions === 'error'
        ? json({ error: { code: 'internal', message: 'Algo ha fallado.', requestId: 't' } }, 500)
        : json({ ...fixture<PlaybackStatus>('playbackStatus'), sessions }),
  });
  return renderWithApp(<WherePlayingSection />, { search: '?vista=ajustes/donde' });
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  resetMode();
});

describe('Ajustes → Dónde se está reproduciendo', () => {
  it('enseña el canal y los dispositivos, con «Este dispositivo» y si reproduce o está en pausa', async () => {
    setup([sharedSession()]);
    const list = await screen.findByRole('list', { name: 'Reproducciones en curso' });
    expect(within(list).getByText('DAZN 1')).toBeInTheDocument();
    expect(within(list).getByText(/2 dispositivos · HLS compartido/)).toBeInTheDocument();

    const devices = within(list).getByRole('list', { name: 'Dispositivos que ven DAZN 1' });
    const rows = within(devices).getAllByRole('listitem');
    /* Este navegador va primero. */
    expect(rows[0]).toHaveTextContent('Chrome · Windows');
    expect(rows[0]).toHaveTextContent('Este dispositivo');
    expect(rows[0]).toHaveTextContent('Ordenador · Web');
    expect(rows[0]).toHaveTextContent('Reproduciendo');
    expect(rows[1]).toHaveTextContent('iPhone de Isma');
    expect(rows[1]).not.toHaveTextContent('Este dispositivo');
    expect(rows[1]).toHaveTextContent('Móvil · App Ace Neo');
    expect(rows[1]).toHaveTextContent('En pausa');
    expect(screen.getByText('«DAZN 1» en 2 dispositivos.')).toHaveAttribute('aria-live', 'polite');
  });

  it('vacío: «No se está reproduciendo nada» y la salida a la agenda', async () => {
    setup([]);
    expect(await screen.findByText('No se está reproduciendo nada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir la agenda' }));
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent('agenda'));
  });

  it('en tiempo real: playback.sessions por SSE cambia la lista sin volver a pedirla', async () => {
    const { client } = setup([]);
    await screen.findByText('No se está reproduciendo nada');
    const calls = net.calls.length;
    act(() => applyToCache(client, 'playback.sessions', { sessions: [sharedSession()] }));
    expect(await screen.findByText('DAZN 1')).toBeInTheDocument();
    act(() => applyToCache(client, 'playback.sessions', { sessions: [] }));
    expect(await screen.findByText('No se está reproduciendo nada')).toBeInTheDocument();
    expect(net.calls.length).toBe(calls);
    expect(client.getQueryData(routeKey('playbackStatus'))).toMatchObject({ sessions: [] });
  });

  it('una sesión recién abierta sin visores no sale', async () => {
    setup([{ ...sharedSession(), viewers: [] }]);
    expect(await screen.findByText('No se está reproduciendo nada')).toBeInTheDocument();
  });

  it('si falla la petición, lo dice y deja reintentar', async () => {
    setup('error');
    expect(
      await screen.findByText('No se pudo saber qué se está reproduciendo'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
