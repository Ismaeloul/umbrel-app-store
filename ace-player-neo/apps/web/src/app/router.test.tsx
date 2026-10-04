import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rememberedViewParams,
  rememberViewParam,
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
      <button onClick={() => navigate('buscar')}>ir a buscar</button>
      <button onClick={() => navigate('ajustes')}>ajustes</button>
      <button
        onClick={() => {
          // Un doble clic: el segundo llega antes de que la transición confirme la ruta.
          navigate({ vista: 'partido', id: 'm-2', canal: null });
          navigate({ vista: 'partido', id: 'm-2', canal: null });
        }}
      >
        doble
      </button>
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
    // Con el sentido: el armazón prepara con él el fundido de la vista que sale.
    expect(before).toHaveBeenCalledWith(
      { vista: 'agenda' },
      { vista: 'partido', id: 'm-1', canal: null },
      'adelante',
    );
  });

  it('ir dos veces seguidas al mismo sitio apila UNA entrada (atrás vuelve a donde estabas)', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    const length = history.length;
    fireEvent.click(screen.getByText('doble'));
    expect(screen.getByTestId('ruta')).toHaveTextContent('partido/m-2');
    expect(history.length).toBe(length + 1);
    expect(history.state).toMatchObject({ aceDepth: 1 });
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

  it('con View Transitions, la vuelta atrás se lanza al acabar el popstate (lleva fundido)', async () => {
    // React pinta SIN View Transition lo que se lanza dentro de un popstate:
    // la vuelta atrás tiene que salir del evento para fundirse como las demás.
    const doc = document as { startViewTransition?: unknown };
    doc.startViewTransition = vi.fn();
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Google Inc.');
    try {
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
      expect(screen.getByTestId('ruta')).toHaveTextContent('biblioteca');
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
      expect(screen.getByTestId('ruta')).toHaveTextContent('agenda');

      // Si en ese instante se navega a otra parte, manda la navegación nueva.
      history.replaceState({ aceDepth: 0 }, '', '/?vista=buscar');
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
        fireEvent.click(screen.getByText('ajustes'));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
      expect(screen.getByTestId('ruta')).toHaveTextContent('ajustes');
    } finally {
      delete doc.startViewTransition;
      vendor.mockRestore();
    }
  });

  it('en el acto en WebKit (su fundido es CSS) y tras el gesto de volver del móvil', () => {
    const doc = document as { startViewTransition?: unknown };
    doc.startViewTransition = vi.fn();
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    try {
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

      // Chrome con el gesto de volver (hasUAVisualTransition): el navegador ya lo animó.
      vendor.mockReturnValue('Google Inc.');
      fireEvent.click(screen.getByRole('button', { name: 'biblioteca' }));
      expect(screen.getByTestId('ruta')).toHaveTextContent('biblioteca');
      history.replaceState({ aceDepth: 0 }, '', '/?vista=agenda');
      act(() => {
        window.dispatchEvent(
          Object.assign(new PopStateEvent('popstate'), { hasUAVisualTransition: true }),
        );
      });
      expect(screen.getByTestId('ruta')).toHaveTextContent('agenda');
    } finally {
      delete doc.startViewTransition;
      vendor.mockRestore();
    }
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

  it('al cambiar de vista, la URL suelta los parámetros de la otra y los recupera al volver', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ir a buscar' }));
    fireEvent.click(screen.getByRole('button', { name: 'buscar' }));
    expect(location.search).toBe('?demo=1&vista=buscar&q=dazn');
    fireEvent.click(screen.getByRole('button', { name: 'ajustes' }));
    expect(location.search).toBe('?demo=1&vista=ajustes');
    expect(rememberedViewParams('buscar')).toBe('q=dazn');
    fireEvent.click(screen.getByRole('button', { name: 'ir a buscar' }));
    expect(location.search).toBe('?demo=1&vista=buscar&q=dazn');
    expect(screen.getByTestId('q')).toHaveTextContent('dazn');
    // Lo que se deja preparado para otra vista no toca la URL actual.
    rememberViewParam('biblioteca', 'pestana', 'listas');
    rememberViewParam('biblioteca', 'demo', '0');
    expect(location.search).toBe('?demo=1&vista=buscar&q=dazn');
    fireEvent.click(screen.getByRole('button', { name: 'biblioteca' }));
    expect(location.search).toBe('?demo=1&vista=biblioteca&pestana=listas');
  });

  it('atrás/adelante: la vista a la que se vuelve recuerda la URL de esa entrada', () => {
    render(
      <RouterProvider>
        <Probe />
      </RouterProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ir a buscar' }));
    history.replaceState({ aceDepth: 0 }, '', '/?demo=1&vista=buscar&q=clan');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(rememberedViewParams('buscar')).toBe('q=clan');
    fireEvent.click(screen.getByRole('button', { name: 'ajustes' }));
    expect(location.search).toBe('?demo=1&vista=ajustes');
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
