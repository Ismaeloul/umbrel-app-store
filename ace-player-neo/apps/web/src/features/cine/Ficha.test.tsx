/* Ficha de una película o una serie (docs/vod.md §12.6, §10.3 y §13). */

import type { VodMovie, VodSeries } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import seriesFixture from '@fixtures/variantes/vodTitle.series.json';
import movieFixture from '@fixtures/web/v1/vodTitle.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { DEMO_VOD_IDS, resetDemoVod } from './demo-data.ts';
import { setHevcSupport } from './play.ts';
import './demo.ts';
import { demoRoutes, renderCine } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

const MOVIE = movieFixture as VodMovie;
const SERIES = seriesFixture as VodSeries;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  setHevcSupport(false);
});
afterEach(() => {
  net?.restore();
  resetToasts();
  resetMode();
  resetDemoVod();
  setHevcSupport(null);
  history.replaceState(null, '', '/');
});

const progressCalls = () => net.calls.filter((call) => call.url.endsWith('/progress'));

function serveTitle(
  title: VodMovie | VodSeries,
  extra: Record<string, (call: MockCall) => Response> = {},
) {
  net = mockFetch({
    [`GET /api/v1/vod/titles/${title.id}`]: () => json(title),
    [`POST /api/v1/vod/titles/${title.id}/progress`]: () => new Response(null, { status: 204 }),
    ...extra,
  });
  return renderCine({ search: `?vista=cine/${title.id}` });
}

describe('película', () => {
  it('cabecera, datos, técnica, «Continuar · quedan…», «Empezar desde el principio» y créditos', async () => {
    serveTitle(MOVIE);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune' })).toBeInTheDocument();
    expect(screen.getByText('2021 · 2 h 36 min · 8,0 · +12')).toBeInTheDocument();
    expect(screen.getByText('2160p · H.264 · Audio: Castellano, Inglés')).toHaveAttribute(
      'title',
      'Según el proveedor',
    );
    expect(screen.getByText('Castellano')).toBeInTheDocument();
    expect(screen.getByText('Ciencia ficción')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar · quedan 1 h 53 min' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Empezar desde el principio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sinopsis' })).toBeInTheDocument();
    expect(screen.getByText('Reparto')).toBeInTheDocument();
    expect(screen.getByText('Denis Villeneuve')).toBeInTheDocument();
  });

  it('reproducir dice «Próximamente» hasta que llegue el reproductor', async () => {
    serveTitle({ ...MOVIE, progress: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Reproducir' }));
    expect(
      await screen.findByText(
        'Próximamente: la reproducción de películas y series llega en la siguiente versión.',
      ),
    ).toBeInTheDocument();
  });

  it('«Marcar como vista» manda la marca y «Marcar como no vista» la quita', async () => {
    serveTitle(MOVIE);
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como vista' }));
    await waitFor(() => expect(progressCalls()).toHaveLength(1));
    expect(progressCalls()[0]?.body).toEqual({ posS: 0, durS: 0, event: 'mark' });
    net.restore();
    serveTitle({ ...MOVIE, progress: { posS: 9360, durS: 9360, watched: true } });
    fireEvent.click(
      await screen.findAllByRole('button', { name: 'Marcar como no vista' }).then((b) => b.at(-1)!),
    );
    await waitFor(() => expect(progressCalls()[0]?.body).toMatchObject({ event: 'unmark' }));
  });

  it('HEVC en un navegador que no lo decodifica: botón desactivado con el motivo', async () => {
    serveTitle({ ...MOVIE, playable: 'hevc', progress: null });
    const play = await screen.findByRole('button', { name: 'Reproducir' });
    expect(play).toBeDisabled();
    expect(
      screen.getByText('Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el iPhone.'),
    ).toBeInTheDocument();
  });

  it('un formato que no vale: «Este formato (AVI) no se puede reproducir en Ace Player.»', async () => {
    serveTitle({ ...MOVIE, playable: 'no', tech: { ...MOVIE.tech, container: 'avi' } });
    expect(
      await screen.findByText('Este formato (AVI) no se puede reproducir en Ace Player.'),
    ).toBeInTheDocument();
  });

  it('la ficha del proveedor falla: lo que se sabe, «Reintentar» y se puede reproducir', async () => {
    net = mockFetch(demoRoutes([DEMO_VOD_IDS.flakyMovie]));
    renderCine({ search: `?vista=cine/${DEMO_VOD_IDS.flakyMovie}` });
    expect(await screen.findByText('No se ha podido cargar la sinopsis.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Sinopsis' })).toBeInTheDocument();
    expect(screen.queryByText('No se ha podido cargar la sinopsis.')).toBeNull();
  });

  it('un título que ya no está: el aviso y «Volver a películas»', async () => {
    const gone = 'f'.repeat(40);
    net = mockFetch(demoRoutes([gone]));
    renderCine({ search: `?vista=cine/${gone}` });
    expect(
      await screen.findByRole('heading', { name: 'Este título ya no está en tu IPTV.', level: 2 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a películas' }));
    await waitFor(() => expect(location.search).toBe('?vista=cine'));
  });
});

describe('serie', () => {
  it.each([
    ['Ver T1:E1', 'start'],
    ['Reanudar T2:E3', 'resume'],
    ['Siguiente: T2:E4', 'next'],
    ['Volver a ver T1:E1', 'rewatch'],
  ] as const)('botón principal «%s» (%s)', async (label, action) => {
    serveTitle({ ...SERIES, main: { ...SERIES.main!, action, label } });
    expect(await screen.findByRole('button', { name: label })).toBeEnabled();
  });

  it('temporadas como chips («Especiales» al final), «N episodios» y cada episodio con su estado', async () => {
    serveTitle(SERIES);
    const seasons = await screen.findByRole('group', { name: 'Temporadas' });
    const chips = within(seasons).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(
      SERIES.seasons.map((season) => season.name),
    );
    const first = SERIES.seasons[0]!;
    const shown =
      SERIES.seasons.find((season) =>
        season.episodes.some((episode) => episode.id === SERIES.main?.episodeId),
      ) ?? first;
    expect(within(seasons).getByRole('button', { name: shown.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(
        `${shown.episodes.length} episodio${shown.episodes.length === 1 ? '' : 's'}`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(seasons).getByRole('button', { name: first.name }));
    expect(location.search).toContain(`temporada=${first.n}`);
    const episode = first.episodes[0]!;
    expect(
      screen.getByRole('button', { name: new RegExp(`^${episode.n}\\. `) }),
    ).toBeInTheDocument();
  });

  it('«Marcar hasta aquí como visto» desde el menú de un episodio', async () => {
    // En la demo: la marca la guarda demo-data.ts y la ficha se vuelve a pedir.
    resetMode();
    setMode('demo', 'param');
    net = mockFetch({});
    renderCine({ search: `?vista=cine/${DEMO_VOD_IDS.seriesStart}` });
    expect(await screen.findByRole('button', { name: 'Ver T1:E1' })).toBeInTheDocument();
    const more = screen.getAllByRole('button', { name: /^Más opciones: 3\. / })[0]!;
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Marcar hasta aquí como visto' }));
    expect(await screen.findByRole('button', { name: 'Siguiente: T1:E4' })).toBeInTheDocument();
    expect(screen.getAllByText('Visto')).toHaveLength(3);
  });
});
