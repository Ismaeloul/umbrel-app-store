import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture, json, mockFetch } from '../test/fetch.ts';
import { ApiError } from './errors.ts';
import { resetMode, setMode } from './mode.ts';
import { apiQuery, createQueryClient, invalidateRoute, routeKey, useApiQuery } from './query.ts';
import { realtimeStore } from './realtime-store.ts';

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
});

describe('claves por ruta', () => {
  it('[v1, ruta, params, query]', () => {
    expect(routeKey('engineStatus')).toEqual(['v1', 'engineStatus', null, null]);
    expect(routeKey('footballScan', { params: { id: 'x' } })).toEqual([
      'v1',
      'footballScan',
      { id: 'x' },
      null,
    ]);
    expect(apiQuery('search', { query: { q: 'a' } }).queryKey).toEqual([
      'v1',
      'search',
      null,
      { q: 'a' },
    ]);
  });
});

describe('QueryClient de la app', () => {
  it('no reintenta un 4xx y sí un fallo de red', () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (
      count: number,
      error: unknown,
    ) => boolean;
    expect(retry(0, new ApiError({ code: 'validation_error', status: 400 }))).toBe(false);
    expect(retry(0, new ApiError({ code: 'network' }))).toBe(true);
    expect(retry(2, new ApiError({ code: 'network' }))).toBe(false);
  });

  it('con el SSE abierto los datos no caducan solos ni se piden al volver a la pestaña', () => {
    const client = createQueryClient();
    const options = client.getDefaultOptions().queries ?? {};
    const staleTime = options.staleTime as () => number;
    const refetch = options.refetchOnWindowFocus as () => boolean;
    expect(staleTime()).toBe(30_000);
    expect(refetch()).toBe(true);
    realtimeStore.set((s) => ({ ...s, status: 'open' }));
    expect(staleTime()).toBe(Number.POSITIVE_INFINITY);
    expect(refetch()).toBe(false);
  });
});

function Motor() {
  const query = useApiQuery('engineStatus');
  return <p>{query.data ? `motor ${query.data.status}` : 'cargando'}</p>;
}

describe('useApiQuery', () => {
  it('pide la ruta, pasa la señal y guarda por su clave', async () => {
    const net = mockFetch({ 'GET /api/v1/engine/status': () => json(fixture('engineStatus')) });
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Motor />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('motor online')).toBeInTheDocument();
    expect(net.calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(client.getQueryData(routeKey('engineStatus'))).toMatchObject({ status: 'online' });
    await invalidateRoute('engineStatus', client);
    await waitFor(() => expect(net.calls.length).toBe(2));
    net.restore();
  });
});
