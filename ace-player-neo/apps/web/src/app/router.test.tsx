import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RouterProvider,
  useBack,
  useNavigate,
  usePreviousRoute,
  useRoute,
  useSearchParam,
} from './router.tsx';
import { formatVista } from './routes.ts';

function Probe() {
  const route = useRoute();
  const previous = usePreviousRoute();
  const navigate = useNavigate();
  const back = useBack();
  const [q, setQ] = useSearchParam('q');
  return (
    <div>
      <p data-testid="ruta">{formatVista(route)}</p>
      <p data-testid="anterior">{previous ? formatVista(previous) : '-'}</p>
      <p data-testid="q">{q ?? '-'}</p>
      <button onClick={() => navigate({ vista: 'partido', id: 'm-1', canal: null })}>
        partido
      </button>
      <button onClick={() => navigate('biblioteca')}>biblioteca</button>
      <button onClick={() => setQ('dazn')}>buscar</button>
      <button onClick={() => back()}>atrás</button>
    </div>
  );
}

beforeEach(() => {
  history.replaceState(null, '', '/?demo=1');
});
afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('router', () => {
  it('navega con pushState, conserva los demás parámetros y recuerda la anterior', () => {
    const before = vi.fn();
    render(
      <RouterProvider onBeforeChange={before}>
        <Probe />
      </RouterProvider>,
    );
    expect(screen.getByTestId('ruta')).toHaveTextContent('agenda');
    fireEvent.click(screen.getByText('partido'));
    expect(screen.getByTestId('ruta')).toHaveTextContent('partido/m-1');
    expect(screen.getByTestId('anterior')).toHaveTextContent('agenda');
    expect(location.search).toBe('?demo=1&vista=partido/m-1');
    expect(history.state).toMatchObject({ aceDepth: 1 });
    expect(before).toHaveBeenCalledWith(
      { vista: 'agenda' },
      { vista: 'partido', id: 'm-1', canal: null },
    );
  });

  it('el botón atrás del navegador (popstate) vuelve', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByText('biblioteca'));
    history.replaceState({ aceDepth: 0 }, '', '/?vista=agenda');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('ruta')).toHaveTextContent('agenda');
  });

  it('atrás sin historial propio va a la ruta de respaldo reemplazando', () => {
    render(
      <RouterProvider initialSearch="?vista=partido/m-9">
        <Probe />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByText('atrás'));
    expect(screen.getByTestId('ruta')).toHaveTextContent('agenda');
  });

  it('useSearchParam escribe con replaceState sin cambiar de vista', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    const length = history.length;
    fireEvent.click(screen.getByText('buscar'));
    expect(screen.getByTestId('q')).toHaveTextContent('dazn');
    expect(location.search).toContain('q=dazn');
    expect(history.length).toBe(length);
  });
});
