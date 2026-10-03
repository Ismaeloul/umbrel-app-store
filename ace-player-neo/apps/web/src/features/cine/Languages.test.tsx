/* Idiomas de Películas y series (docs/vod.md §4.10): el selector la primera
   vez, el botón de la cabecera para cambiarlos al vuelo, el filtro en todas
   las consultas, «3 en latino · Ver» y que nunca se queda uno atascado. */

import type { VodLanguages } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { resetDemoVod } from './demo-data.ts';
import { cardBadges } from './PosterCard.tsx';
import { demoRoutes, queryOf, renderCine } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

const homeCalls = () => net.calls.filter((call) => call.url.split('?')[0] === '/api/v1/vod');
const browseCalls = () => net.calls.filter((call) => call.url.startsWith('/api/v1/vod/browse'));
const puts = () => net.calls.filter((call) => call.method === 'PUT');

/** El servidor simulado con una elección de idiomas que se guarda (o falla). */
function serve(initial: VodLanguages | null, options: { failSave?: boolean } = {}) {
  let current = initial;
  const routes = demoRoutes();
  routes['GET /api/v1/vod/languages'] = () =>
    current
      ? json(current)
      : json({ error: { code: 'not_found', message: 'No existe.', requestId: 't' } }, 404);
  routes['PUT /api/v1/vod/languages'] = (call: MockCall) => {
    if (options.failSave)
      return json(
        { error: { code: 'internal_error', message: 'Ha fallado.', requestId: 't' } },
        500,
      );
    const body = call.body as { langs: VodLanguages['langs']; unknown: boolean };
    current = {
      chosen: true,
      langs: body.langs,
      unknown: body.unknown,
      updatedAt: '2026-10-03T18:00:00.000Z',
    };
    return json(current);
  };
  net = mockFetch(routes);
}

const NOT_CHOSEN: VodLanguages = { chosen: false, langs: [], unknown: true, updatedAt: null };
const ONLY_CASTELLANO: VodLanguages = {
  chosen: true,
  langs: ['castellano'],
  unknown: false,
  updatedAt: '2026-10-03T18:00:00.000Z',
};

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('vlist__row') ? 300 : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  net?.restore();
  resetToasts();
  resetMode();
  resetDemoVod();
  history.replaceState(null, '', '/');
});

describe('la primera vez: «¿En qué idiomas las quieres ver?»', () => {
  it('antes de la portada, con castellano y latino separados y cuántos hay de cada uno; al elegir, todo filtrado', async () => {
    serve(NOT_CHOSEN);
    renderCine();
    expect(
      await screen.findByRole('heading', { name: '¿En qué idiomas las quieres ver?' }),
    ).toBeInTheDocument();
    /* Ni portada ni buscador mientras tanto. */
    expect(screen.queryByRole('heading', { name: 'Novedades en películas' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    const group = screen.getByRole('group', { name: 'Idiomas' });
    const castellano = within(group).getByRole('button', {
      name: /^Castellano: Doblaje de España/,
    });
    const latino = within(group).getByRole('button', { name: /^Latino: Doblaje latinoamericano/ });
    /* Castellano viene marcado de entrada; latino, no: son dos idiomas. */
    expect(castellano).toHaveAttribute('aria-pressed', 'true');
    expect(latino).toHaveAttribute('aria-pressed', 'false');
    expect(castellano).toHaveAccessibleName(/32 películas · 9 series$/);
    expect(within(group).getByRole('button', { name: /^Francés/ })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Puedes cambiarlo cuando quieras con el botón del globo, junto al buscador.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: /^Francés/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver películas y series' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]?.body).toEqual({ langs: ['castellano', 'frances'], unknown: true });
    /* Ya filtrado: la portada y las filas piden esos idiomas. */
    expect(
      await screen.findByRole('heading', { name: 'Novedades en películas' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(homeCalls().some((call) => queryOf(call).langs === 'castellano,frances')).toBe(true),
    );
    await waitFor(() => expect(browseCalls().length).toBeGreaterThan(0));
    expect(browseCalls().every((call) => queryOf(call).langs === 'castellano,frances')).toBe(true);
    /* Las categorías sin nada en esos idiomas no salen. */
    expect(screen.queryByRole('heading', { level: 2, name: /^Pelis latino/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Idiomas: Castellano y Francés. Cambiar' }),
    ).toBeInTheDocument();
  });

  it('«Ahora no, ver todo»: se guarda «todos los idiomas» y no se vuelve a preguntar', async () => {
    serve(NOT_CHOSEN);
    renderCine();
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no, ver todo' }));
    await waitFor(() => expect(puts()[0]?.body).toEqual({ langs: [], unknown: true }));
    expect(
      await screen.findByRole('button', { name: 'Idiomas: Todos los idiomas. Cambiar' }),
    ).toBeInTheDocument();
    expect(homeCalls().at(-1)?.url).toBe('/api/v1/vod');
  });

  it('si guardar falla, se entra igual con lo elegido (en esta pestaña) y se avisa', async () => {
    serve(NOT_CHOSEN, { failSave: true });
    renderCine();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver películas y series' }));
    expect(await screen.findByText(/No se han podido guardar los idiomas/)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Idiomas: Castellano. Cambiar' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(homeCalls().some((call) => queryOf(call).langs === 'castellano')).toBe(true),
    );
  });

  it('un servidor que no sabe de idiomas: ni selector ni botón, y se ve todo', async () => {
    serve(null);
    renderCine();
    expect(
      await screen.findByRole('heading', { name: 'Novedades en películas' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Idiomas:/ })).toBeNull();
    expect(homeCalls().every((call) => !queryOf(call).langs)).toBe(true);
  });
});

describe('cambiarlos luego', () => {
  it('el botón de la cabecera abre la hoja: «cambio el idioma al francés y busco»', async () => {
    serve(ONLY_CASTELLANO);
    renderCine();
    fireEvent.click(await screen.findByRole('button', { name: 'Idiomas: Castellano. Cambiar' }));
    const sheet = await screen.findByRole('dialog', { name: 'Idiomas' });
    const group = within(sheet).getByRole('group', { name: 'Idiomas' });
    expect(within(group).getByRole('button', { name: /^Castellano/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    /* Con un idioma elegido, el interruptor de los que no lo indican. */
    expect(within(sheet).getByRole('switch', { name: /no indican idioma/ })).not.toBeChecked();
    fireEvent.click(within(group).getByRole('button', { name: /^Castellano/ }));
    fireEvent.click(within(group).getByRole('button', { name: /^Francés/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(puts()[0]?.body).toEqual({ langs: ['frances'], unknown: false }));
    expect(
      await screen.findByRole('button', { name: 'Idiomas: Francés. Cambiar' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar películas' }), {
      target: { value: 'amelie' },
    });
    await waitFor(() =>
      expect(
        browseCalls().some(
          (call) => queryOf(call).q === 'amelie' && queryOf(call).langs === 'frances',
        ),
      ).toBe(true),
    );
  });
});

describe('«3 en latino · Ver»', () => {
  it('una búsqueda sin nada en tus idiomas dice lo que hay en otros y deja verlo sin tocar lo elegido', async () => {
    serve(ONLY_CASTELLANO);
    renderCine({ search: '?vista=cine&cineq=coco' });
    expect(
      await screen.findByRole('heading', { name: 'Nada con «coco» en películas' }),
    ).toBeInTheDocument();
    const other = screen.getByRole('group', { name: 'En otros idiomas sí hay:' });
    fireEvent.click(within(other).getByRole('button', { name: '1 en latino · Ver' }));
    await waitFor(() => expect(location.search).toContain('cineidioma=latino'));
    expect(await screen.findByText('Viendo solo en latino.')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        browseCalls().some(
          (call) => queryOf(call).langs === 'latino' && queryOf(call).unknown === '0',
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole('link', { name: /^Coco/ })).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Volver a mis idiomas' }));
    await waitFor(() => expect(location.search).not.toContain('cineidioma'));
  });
});

describe('la cápsula de idioma de las tarjetas', () => {
  it('el idioma de la tarjeta, y nada si es el único que se ve', () => {
    const card = {
      tags: ['castellano' as const, '4k' as const],
      adult: false,
      langs: ['castellano' as const],
    };
    expect(cardBadges(card, ['castellano'])).toEqual(['4K']);
    expect(cardBadges(card, ['castellano', 'frances'])).toEqual(['Castellano', '4K']);
    expect(cardBadges({ tags: [], adult: true, langs: ['frances'] }, [])).toEqual([
      '+18',
      'Francés',
    ]);
    expect(cardBadges({ tags: ['multi'], adult: false, langs: [] }, [])).toEqual(['Multi']);
    /* Un servidor anterior (sin `langs`): el distintivo de lengua, como antes. */
    expect(cardBadges({ tags: ['vose', 'multi'], adult: false })).toEqual(['VOSE']);
  });
});
