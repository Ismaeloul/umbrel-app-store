/* Pelis y series en escritorio (rediseño, pantalla 5): pestañas en la barra,
   el escaparate con «Seguir viendo» en grande (sin novedades ni estrenos),
   «Mi lista» con películas y series juntas y la ficha con «Seguir · T1 E3»,
   Mi lista / Ver juntos / Tráiler / Compartir y el siguiente episodio
   marcado. En el móvil nada de esto cambia (lo cubren los demás tests). */

import type { VodContinue } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { mockFetch } from '../../test/fetch.ts';
import { DEMO_VOD_IDS, resetDemoVod } from './demo-data.ts';
import { halfBadge, heroFollow, heroLine, splitSubtitle } from './Escaparate.tsx';
import { deskColumnsFor } from './model.ts';
import { demoRoutes, renderCine } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

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

const desk = { layout: { kind: 'desktop' as const } };

function entry(patch: Partial<VodContinue>): VodContinue {
  return {
    id: 'a'.repeat(40),
    kind: 'episode',
    seriesId: 'b'.repeat(40),
    title: 'La casa de papel',
    subtitle: 'T3 · E4 · Dame la mano',
    posS: 900,
    durS: 2760,
    isNext: false,
    art: null,
    updatedAt: '2026-09-23T10:00:00.000Z',
    ...patch,
  };
}

describe('textos del escaparate', () => {
  it('parte «T3 · E4 · Dame la mano» y escribe la línea, el botón y la cápsula', () => {
    expect(splitSubtitle('T3 · E4 · Dame la mano')).toEqual({
      code: 'T3 · E4',
      name: 'Dame la mano',
    });
    expect(splitSubtitle('Especial 2 · Gala')).toEqual({ code: 'Especial 2', name: 'Gala' });
    expect(splitSubtitle(null)).toEqual({ code: null, name: null });
    const episode = entry({});
    expect(heroLine(episode)).toBe('T3 · E4 «Dame la mano» · quedan 31 min');
    expect(heroFollow(episode)).toBe('Seguir · T3 E4');
    expect(halfBadge(episode)).toBe('T3 · E4');
    const next = entry({ isNext: true, posS: 0 });
    expect(heroLine(next)).toBe('Siguiente: T3 · E4 «Dame la mano»');
    const movie = entry({ kind: 'movie', seriesId: null, subtitle: null, posS: 4320, durS: 9960 });
    expect(heroLine(movie)).toBe('1:12 de 2:46 · quedan 1 h 34 min');
    expect(heroFollow(movie)).toBe('Seguir · 1:12:00');
    expect(halfBadge(movie)).toBe('1:12 de 2:46');
  });

  it('la rejilla de escritorio pone carteles de unos 150 px', () => {
    expect(deskColumnsFor(999)).toBe(5);
    expect(deskColumnsFor(1000)).toBe(6);
    expect(deskColumnsFor(400)).toBe(4);
  });
});

describe('escritorio: pestañas y escaparate', () => {
  it('Inicio: «Seguir viendo» en grande, también a medias y Mi lista; nada de novedades', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pelis y series' })).toBeVisible();
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    expect(within(tabs).getByRole('button', { name: 'Inicio' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await within(tabs).findByRole('button', { name: 'Mi lista · 4' })).toBeVisible();
    const hero = await screen.findByRole('region', { name: 'Dune' });
    expect(within(hero).getByText('Seguir viendo · Película')).toBeVisible();
    expect(within(hero).getByRole('button', { name: /^Seguir · 43:12$/ })).toBeEnabled();
    expect(within(hero).getByRole('button', { name: 'Ver juntos' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'También a medias' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Mi lista' })).toBeVisible();
    expect(screen.queryByText('Novedades en películas')).toBeNull();
    expect(screen.queryByText('Series actualizadas')).toBeNull();
    // Sin el buscador de la portada: en escritorio está el de la barra (Ctrl K).
    expect(screen.queryByRole('searchbox', { name: 'Buscar películas' })).toBeNull();
  });

  it('una miniatura pone en grande otra cosa a medias, con su episodio', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    const picker = await screen.findByRole('group', { name: 'Cambiar lo destacado' });
    const casa = within(picker).getByRole('button', { name: /^La casa de papel\./ });
    fireEvent.click(casa);
    expect(casa).toHaveAttribute('aria-pressed', 'true');
    const hero = await screen.findByRole('region', { name: 'La casa de papel' });
    expect(within(hero).getByText('Seguir viendo · Serie')).toBeVisible();
    expect(within(hero).getByText(/^T1 · E3 «El plan» · quedan/)).toBeVisible();
    expect(within(hero).getByRole('button', { name: 'Seguir · T1 E3' })).toBeVisible();
    // Ya está en Mi lista: el botón lo dice (interruptor).
    expect(await within(hero).findByRole('button', { name: 'En mi lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Películas abre la rejilla con su buscador, filtros y orden; Inicio vuelve', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    const tabs = await screen.findByRole('group', { name: 'Secciones de Pelis y series' });
    fireEvent.click(within(tabs).getByRole('button', { name: 'Películas' }));
    await waitFor(() => expect(location.search).toContain('cinecat=all'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las películas' }),
    ).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Buscar películas' })).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'Orden' })).toBeVisible();
    expect(within(tabs).getByRole('button', { name: 'Películas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(tabs).getByRole('button', { name: 'Series' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las series' }),
    ).toBeVisible();
    expect(location.search).toContain('cine=series');
  });

  it('Mi lista: películas y series juntas, sin flecha', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    const tabs = await screen.findByRole('group', { name: 'Secciones de Pelis y series' });
    fireEvent.click(await within(tabs).findByRole('button', { name: 'Mi lista · 4' }));
    expect(await screen.findByText('4 títulos')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Volver a Películas y series' })).toBeNull();
    const list = screen.getByRole('list', { name: 'Mi lista' });
    expect(within(list).getByRole('link', { name: /^The Office/ })).toBeVisible();
    expect(within(list).getByRole('link', { name: /^Coco/ })).toBeVisible();
  });
});

describe('escritorio: ficha', () => {
  it('serie: «Seguir · T1 E3», Mi lista / Ver juntos / Tráiler / Compartir y el siguiente marcado', async () => {
    net = mockFetch(demoRoutes([DEMO_VOD_IDS.seriesParts]));
    renderCine({ ...desk, search: `?vista=cine/${DEMO_VOD_IDS.seriesParts}` });
    expect(await screen.findByRole('button', { name: 'Seguir · T1 E3' })).toBeVisible();
    expect(screen.getByText(/5 temporadas/i)).toBeVisible();
    const actions = screen.getByRole('group', { name: 'Más acciones' });
    for (const name of ['Ver juntos', 'Compartir'])
      expect(within(actions).getByRole('button', { name })).toBeVisible();
    expect(await within(actions).findByRole('button', { name: 'En mi lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(actions).getByText('Tráiler')).toBeVisible();
    // Sin «Añadir a mi lista» suelto junto al play: va en la fila de iconos.
    expect(screen.queryByRole('button', { name: 'Añadir a mi lista' })).toBeNull();
    const seasons = screen.getByRole('group', { name: 'Temporadas' });
    expect(within(seasons).getByRole('button', { name: /Parte 1/ })).toHaveTextContent('T1');
    const main = document.querySelector('.cine-episode[data-main]');
    expect(main?.querySelector('.cine-episode__lead')?.textContent).toBe('Continuar');
  });

  it('película a medias: «Seguir · 43:12» y Compartir copia el enlace', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const dune = (await import('./demo-data.ts'))
      .demoVodHome()
      .continue.find((item) => item.title === 'Dune');
    net = mockFetch(demoRoutes([dune!.id]));
    renderCine({ ...desk, search: `?vista=cine/${dune!.id}` });
    expect(await screen.findByRole('button', { name: 'Seguir · 43:12' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(location.href));
    expect(await screen.findByText('Enlace copiado: pégalo donde quieras.')).toBeVisible();
    vi.unstubAllGlobals();
  });
});
