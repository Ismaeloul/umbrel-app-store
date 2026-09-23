import type { DirectoryView } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { makeLibrary, renderWithApp } from '../library/test-utils.tsx';
import { DirectoriesSection } from './DirectoriesSection.tsx';
import {
  DEFAULT_SYNC_URL,
  DEMO_DIRECTORY_MESSAGE,
  DIRECTORY_FALLBACK_ERROR,
  directoryErrorMessage,
  looksPrivateUrl,
  sourceMeta,
  syncFailureReason,
} from './model.ts';

let net: ReturnType<typeof mockFetch>;

function view(overrides: Partial<DirectoryView> = {}): DirectoryView {
  const { web, webSyncedAt, webSources, activeWebSourceId } = makeLibrary();
  return { web, webSyncedAt, webSources, activeWebSourceId, ...overrides };
}

const second = {
  id: 'extra',
  name: 'Extra',
  url: 'https://listas.example.org/extra.html',
  type: 'html' as const,
  count: 12,
  syncedAt: '2026-09-22T10:00:00.000Z',
  lastErrorAt: '2026-09-23T10:00:00.000Z',
  lastError: 'http_429',
};

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  resetToasts();
  resetMode();
});

describe('textos de las listas (§14)', () => {
  it('motivo corto del último fallo (motivoSync de la 0.6.59)', () => {
    expect(syncFailureReason('http_429')).toBe('el servidor limita las descargas (429)');
    expect(syncFailureReason('http_503')).toBe('el servidor respondió 503');
    expect(syncFailureReason('fetch_timeout')).toBe('el servidor no respondió a tiempo');
    expect(syncFailureReason('empty_directory')).toBe('la lista llegó vacía');
    expect(syncFailureReason('dns_failed')).toBe('no se resolvió el dominio');
    expect(syncFailureReason('ipfs_not_found')).toBe(
      'la lista ya no está en esa dirección de IPFS',
    );
    expect(syncFailureReason('ipfs_bad_block')).toBe('la red IPFS no entregó la lista');
    expect(syncFailureReason('raro')).toBe('no se pudo descargar la lista');
  });

  it('línea de la tarjeta, normal y con fallo', () => {
    expect(sourceMeta({ ...second, lastErrorAt: null })).toMatch(
      /^HTML · 12 canales · \d+ \S+, \d{2}:\d{2}$/,
    );
    expect(sourceMeta(second)).toMatch(
      /^HTML · 12 canales · el servidor limita las descargas \(429\) · se conserva la copia de /,
    );
    expect(sourceMeta({ ...second, syncedAt: null, lastErrorAt: null })).toBe(
      'HTML · 12 canales · sin sincronizar',
    );
  });

  it('errores del catálogo de @ace/shared, demo y respaldo', () => {
    expect(directoryErrorMessage(new ApiError({ code: 'private_url', status: 400 }))).toBe(
      'Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet.',
    );
    expect(directoryErrorMessage(new ApiError({ code: 'source_limit', status: 409 }))).toBe(
      'Ya tienes 8 directorios. Elimina uno antes de añadir otro.',
    );
    expect(directoryErrorMessage(new ApiError({ code: 'http_429', status: 502 }))).toBe(
      'Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.',
    );
    expect(directoryErrorMessage(new ApiError({ code: 'ipfs_bad_cid', status: 502 }))).toBe(
      'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
    );
    expect(directoryErrorMessage(new ApiError({ code: 'demo_unsupported', status: 409 }))).toBe(
      DEMO_DIRECTORY_MESSAGE,
    );
    expect(directoryErrorMessage(new ApiError({ code: 'internal_error', status: 500 }))).toBe(
      DIRECTORY_FALLBACK_ERROR,
    );
    expect(directoryErrorMessage(new Error('x'))).toBe(DIRECTORY_FALLBACK_ERROR);
  });

  it('pista de dirección de la red local (solo pista: decide el servidor)', () => {
    for (const url of [
      'http://192.168.1.10/l.m3u',
      'http://umbrel.local/x',
      'http://10.0.0.2',
      'http://[::1]:8080/',
      'http://nas/lista',
    ])
      expect(looksPrivateUrl(url)).toBe(true);
    for (const url of ['https://example.com/lista.m3u', 'https://ipfs.io/ipns/abc', 'no es url'])
      expect(looksPrivateUrl(url)).toBe(false);
  });
});

describe('Ajustes → Listas', () => {
  it('guarda una lista M3U con nombre y dirección y bloquea los botones mientras tanto', async () => {
    let release: (value: Response) => void = () => {};
    net = mockFetch({
      'GET /api/v1/directories': view(),
      'POST /api/v1/directories/sync': () =>
        new Promise<Response>((resolve) => (release = resolve)),
    });
    renderWithApp(<DirectoriesSection />);
    const url = await screen.findByRole('textbox', { name: 'Dirección de la lista' });
    // La dirección por defecto (IPNS) llega escrita si no está guardada.
    await waitFor(() => expect(url).toHaveValue(DEFAULT_SYNC_URL));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Mía' } });
    fireEvent.change(url, { target: { value: 'https://listas.example.org/mia.m3u' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar M3U' }));
    expect(await screen.findByText('Guardando y sincronizando la lista…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar HTML' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Actualizar' })[0]).toBeDisabled();
    expect(net.calls.find((c) => c.method === 'POST')?.body).toEqual({
      url: 'https://listas.example.org/mia.m3u',
      type: 'm3u',
      name: 'Mía',
    });
    await act(async () => release(json(view())));
    expect(
      await screen.findByText('«Principal»: 3 canales. Actualización automática cada 3 h.'),
    ).toBeInTheDocument();
    expect(toastStore.get().at(-1)?.text).toBe('Lista guardada: 3 canales');
    expect(new URLSearchParams(location.search).get('pestana')).toBe('listas');
  });

  it('una dirección sin http(s) se avisa sin mandarla; el fallo del servidor sale traducido', async () => {
    net = mockFetch({
      'GET /api/v1/directories': view(),
      'POST /api/v1/directories/sync': () =>
        json(
          {
            error: {
              code: 'private_url',
              message:
                'Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet.',
              requestId: 'r',
            },
          },
          400,
        ),
    });
    renderWithApp(<DirectoriesSection />);
    const url = await screen.findByRole('textbox', { name: 'Dirección de la lista' });
    fireEvent.change(url, { target: { value: 'ftp://lista' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar HTML' }));
    expect(
      await screen.findByText(
        'La dirección no es válida: tiene que empezar por http:// o https://.',
      ),
    ).toBeInTheDocument();
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.change(url, { target: { value: 'http://192.168.1.5/lista.html' } });
    expect(screen.getByText(/Parece una dirección de tu red local/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar HTML' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /las direcciones de tu red local están bloqueadas/,
    );
    expect(net.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ type: 'html' });
  });

  it('tarjetas: «En uso», motivo del fallo, usar y actualizar', async () => {
    const withTwo = view({ webSources: [...view().webSources, second] });
    net = mockFetch({
      'GET /api/v1/directories': withTwo,
      'POST /api/v1/directories/extra/activate': { ...withTwo, activeWebSourceId: 'extra' },
      'POST /api/v1/directories/sync': withTwo,
    });
    renderWithApp(<DirectoriesSection />);
    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]!).getByText('En uso')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('button', { name: 'Activo' })).toBeDisabled();
    expect(
      within(cards[1]!).getByText(
        /el servidor limita las descargas \(429\) · se conserva la copia de/,
      ),
    ).toBeInTheDocument();
    expect(
      within(cards[1]!).getByText(
        'Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(cards[1]!).getByRole('button', { name: 'Actualizar' }));
    await waitFor(() =>
      expect(net.calls.find((c) => c.url === '/api/v1/directories/sync')?.body).toEqual({
        url: second.url,
        type: 'html',
        name: 'Extra',
        sourceId: 'extra',
      }),
    );
    await waitFor(() =>
      expect(within(cards[1]!).getByRole('button', { name: 'Usar' })).toBeEnabled(),
    );
    fireEvent.click(within(cards[1]!).getByRole('button', { name: 'Usar' }));
    await waitFor(() => expect(toastStore.get().at(-1)?.text).toBe('Lista activa: Extra'));
  });

  it('borrar pide un segundo toque en 5 s, sin confirm() nativo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const withTwo = view({ webSources: [...view().webSources, second] });
    net = mockFetch({
      'GET /api/v1/directories': withTwo,
      'DELETE /api/v1/directories/extra': view(),
    });
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWithApp(<DirectoriesSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Extra' }));
    const armed = screen.getByRole('button', { name: 'Confirmar: eliminar Extra y su lista' });
    expect(armed).toHaveTextContent('¿Borrar?');
    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(screen.getByRole('button', { name: 'Eliminar Extra' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Extra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar: eliminar Extra y su lista' }));
    await waitFor(() => expect(net.calls.some((c) => c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(toastStore.get().at(-1)?.text).toBe('Lista eliminada'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('con 8 listas no deja añadir otra', async () => {
    const sources = Array.from({ length: 8 }, (_, i) => ({
      ...second,
      id: `l${i}`,
      name: `Lista ${i}`,
      lastErrorAt: null,
      lastError: null,
    }));
    net = mockFetch({
      'GET /api/v1/directories': view({ webSources: sources, activeWebSourceId: 'l0' }),
    });
    renderWithApp(<DirectoriesSection />);
    expect(
      await screen.findByText('Ya tienes 8 directorios. Elimina uno antes de añadir otro.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar M3U' })).toBeDisabled();
  });
});
