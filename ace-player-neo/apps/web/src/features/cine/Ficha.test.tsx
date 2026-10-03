/* Ficha de una película o una serie (docs/vod.md §12.6, §10.3 y §13). */

import type { VodMovie, VodSeries } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import seriesAviFixture from '@fixtures/variantes/vodTitle.episodio-avi.json';
import seriesFixture from '@fixtures/variantes/vodTitle.series.json';
import movieFixture from '@fixtures/web/v1/vodTitle.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { DEMO_VOD_IDS, resetDemoVod } from './demo-data.ts';
import { episodeName } from './EpisodeList.tsx';
import { setHevcSupport } from './play.ts';
import './demo.ts';
import { demoRoutes, renderCine } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

const MOVIE = movieFixture as VodMovie;
const SERIES = seriesFixture as VodSeries;
const SERIES_AVI = seriesAviFixture as VodSeries;

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
  it('cabecera con el cartel, datos, «Seguir viendo desde 43:12», lo que queda y los detalles', async () => {
    serveTitle(MOVIE);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune' })).toBeInTheDocument();
    // El cartel también en el móvil (antes se escondía por debajo de 1024 px).
    expect(document.querySelector('.cine-hero__poster .cine-art--poster')).not.toBeNull();
    expect(document.querySelector('.cine-hero')).toHaveAttribute('data-bg', 'backdrop');
    // «Película · VOD | 4K»: cada parte con su separador (que se recorta si empieza línea).
    const parts = [...document.querySelectorAll('.cine-hero__kicker-part')];
    expect(parts.map((part) => part.textContent)).toEqual(['Película', '·VOD | 4K']);
    for (const sep of document.querySelectorAll('.cine-hero__sep'))
      expect(sep).toHaveAttribute('aria-hidden', 'true');
    const meta = document.querySelector('.cine-hero__meta');
    expect(meta?.textContent).toContain('2021');
    expect(meta?.textContent).toContain('2 h 36 min');
    expect(meta?.textContent).toContain('Nota 8,0');
    expect(meta?.textContent).toContain('+12');
    expect(screen.getByText('Castellano')).toBeInTheDocument();
    expect(screen.getByText('Ciencia ficción')).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Seguir viendo desde 43:12' });
    expect(play).toBeEnabled();
    expect(play).toHaveAccessibleDescription(/^Quedan 1 h 53 min · Termina a las \d{2}:\d{2}$/);
    expect(screen.getByRole('progressbar', { name: 'Visto: 28 %' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empezar desde el principio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sinopsis' })).toBeInTheDocument();
    // Detalles: lo que da el proveedor, con nombre.
    const details = screen.getByRole('heading', { name: 'Detalles' }).closest('section')!;
    expect(within(details).getByText('Reparto')).toBeInTheDocument();
    expect(within(details).getByText('Denis Villeneuve')).toBeInTheDocument();
    expect(within(details).getByText('15 de septiembre de 2021')).toBeInTheDocument();
    expect(within(details).getByText('2160p · H.264').closest('div')).toHaveAttribute(
      'title',
      'Según el proveedor',
    );
    expect(within(details).getByText('MKV')).toBeInTheDocument();
    // El título original es el mismo: no se repite.
    expect(within(details).queryByText('Título original')).toBeNull();
  });

  it('el tráiler abre YouTube en otra pestaña; sin tráiler, no hay botón', async () => {
    const first = serveTitle(MOVIE);
    const trailer = await screen.findByRole('link', { name: /^Tráiler de Dune/ });
    expect(trailer).toHaveAttribute('href', 'https://www.youtube.com/watch?v=Dune2021Tra');
    expect(trailer).toHaveAttribute('target', '_blank');
    expect(trailer).toHaveAttribute('rel', 'noopener noreferrer');
    first.unmount();
    net.restore();
    serveTitle({ ...MOVIE, trailer: null });
    await screen.findByRole('heading', { level: 1, name: 'Dune' });
    expect(screen.queryByRole('link', { name: /^Tráiler/ })).toBeNull();
  });

  it('sin fondo, el cartel desenfocado (nunca estirado); sin nada, el color del título', async () => {
    const first = serveTitle({ ...MOVIE, backdrop: null });
    await screen.findByRole('heading', { level: 1, name: 'Dune' });
    expect(document.querySelector('.cine-hero')).toHaveAttribute('data-bg', 'blur');
    expect(document.querySelector('.cine-hero__bg .cine-art--poster')).not.toBeNull();
    first.unmount();
    net.restore();
    serveTitle({ ...MOVIE, backdrop: null, poster: null });
    await screen.findByRole('heading', { level: 1, name: 'Dune' });
    expect(document.querySelector('.cine-hero')).toHaveAttribute('data-bg', 'tone');
  });

  it('una película pobre (sin nada del proveedor): sin huecos, solo lo que hay', async () => {
    net = mockFetch(demoRoutes([DEMO_VOD_IDS.moviePoor]));
    renderCine({ search: `?vista=cine/${DEMO_VOD_IDS.moviePoor}` });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'El último verano' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Sinopsis' })).toBeNull();
    expect(document.querySelector('.cine-hero__meta')).toBeNull();
    expect(screen.queryByText('Reparto')).toBeNull();
    expect(screen.queryByText('Dirección')).toBeNull();
    expect(screen.queryByRole('link', { name: /Tráiler/ })).toBeNull();
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
  it('el nombre de un episodio: «3. El plan»; sin título del proveedor, «Episodio 3» a secas', () => {
    expect(episodeName({ n: 3, title: 'El plan' })).toBe('3. El plan');
    expect(episodeName({ n: 3, title: 'Episodio 3' })).toBe('Episodio 3');
    expect(episodeName({ n: 3, title: '  ' })).toBe('Episodio 3');
  });

  // El episodio del botón principal del ejemplo es T2 · E6 («La pelea»).
  it.each([
    ['Ver T2 · E6', 'start', 'Empieza aquí'],
    ['Continuar T2 · E6', 'resume', 'Continuar'],
    ['Siguiente capítulo: T2 · E6', 'next', 'Siguiente'],
    ['Volver a ver T2 · E6', 'rewatch', null],
  ] as const)('botón principal «%s» (%s) y su episodio resaltado', async (label, action, badge) => {
    serveTitle({ ...SERIES, main: { ...SERIES.main!, action, label: 'del servidor' } });
    const play = await screen.findByRole('button', { name: label });
    expect(play).toBeEnabled();
    expect(play).toHaveAccessibleDescription('La pelea · 22 min');
    const main = document.querySelector('.cine-episode[data-main]');
    if (badge) expect(main?.querySelector('.cine-episode__badge')?.textContent).toBe(badge);
    else expect(main).toBeNull();
  });

  it('datos de la serie: temporadas, nota, «Episodios de unos 22 min» y estreno', async () => {
    serveTitle(SERIES);
    await screen.findByRole('heading', { level: 1, name: 'The Office' });
    expect(document.querySelector('.cine-hero__meta')?.textContent).toContain('2 temporadas');
    const details = screen.getByRole('heading', { name: 'Detalles' }).closest('section')!;
    expect(within(details).getByText('Episodios de unos 22 min')).toBeInTheDocument();
    expect(within(details).getByText('24 de marzo de 2005')).toBeInTheDocument();
    // Lo que vod-catalogo trae de más en una serie: título original y edad…
    expect(document.querySelector('.cine-hero__original')?.textContent).toBe('The Office (US)');
    expect(within(details).getByText('The Office (US)')).toBeInTheDocument();
    expect(document.querySelector('.cine-hero__meta')?.textContent).toContain('+12');
    // …y, en la temporada 1, su resumen y la emisión y la nota de cada episodio.
    fireEvent.click(screen.getByRole('button', { name: 'Temporada 1' }));
    expect(await screen.findByText(/le graba un equipo de documentales/)).toBeInTheDocument();
    const pilot = document.querySelector('.cine-episode .cine-episode__meta');
    expect(pilot?.textContent).toContain('24 mar 2005');
    expect(pilot?.textContent).toContain('7,4');
    // Las temporadas y los episodios, ANTES de los detalles.
    const episodes = screen.getByRole('heading', { name: 'Episodios' });
    expect(
      episodes.compareDocumentPosition(screen.getByRole('heading', { name: 'Detalles' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('«Season 2» del proveedor se ve como «Temporada 2»; con más de 8, un desplegable', async () => {
    const first = serveTitle({
      ...SERIES,
      seasons: SERIES.seasons.map((season) => ({ ...season, name: `Season ${season.n}` })),
    });
    const seasons = await screen.findByRole('group', { name: 'Temporadas' });
    expect(
      within(seasons)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Temporada 1', 'Temporada 2']);
    first.unmount();
    net.restore();
    const base = SERIES.seasons[0]!;
    serveTitle({
      ...SERIES,
      main: null,
      seasons: Array.from({ length: 12 }, (_, i) => ({
        ...base,
        n: i + 1,
        name: `Season ${i + 1}`,
        episodes: base.episodes.map((episode) => ({
          ...episode,
          id: `${(i + 1).toString(16)}${episode.id.slice(1)}`,
        })),
      })),
    });
    const picker = await screen.findByRole('button', { name: 'Elegir temporada: Temporada 1' });
    expect(screen.queryByRole('group', { name: 'Temporadas' })).toBeNull();
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /^Temporada 12 · / }));
    expect(location.search).toContain('temporada=12');
  });

  it('una temporada sin ningún fotograma: la lista compacta con el número', async () => {
    serveTitle({
      ...SERIES,
      seasons: SERIES.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => ({ ...episode, still: null })),
      })),
    });
    await screen.findByRole('heading', { level: 1, name: 'The Office' });
    expect(document.querySelector('.cine-episodes--compact')).not.toBeNull();
    // T2: el 5 ya visto (la marca en vez del número) y el 6, por su número.
    const numbers = [...document.querySelectorAll('.cine-episode__num')];
    expect(numbers.map((n) => n.textContent)).toEqual(['', '6']);
    expect(numbers[0]?.querySelector('svg')).not.toBeNull();
  });

  it('un fotograma que carga o falla deja ver el número del episodio, no un monograma', async () => {
    serveTitle(SERIES);
    await screen.findByRole('heading', { level: 1, name: 'The Office' });
    // T2: el 5 sin fotograma (su número) y el 6 con fotograma (su número debajo).
    const still = document.querySelector('.cine-episode .cine-art--still');
    expect(still?.querySelector('.cine-episode__big')?.textContent).toBe('6');
    expect(still?.querySelector('.cine-art__mono')).toBeNull();
    fireEvent.error(still!.querySelector('img')!);
    expect(still?.querySelector('.cine-episode__big')?.textContent).toBe('6');
  });

  it('una categoría desde una serie: la serie siguiente abre en SU temporada (arreglo 3)', async () => {
    resetMode();
    setMode('demo', 'param');
    net = mockFetch({});
    renderCine({ search: `?vista=cine/${DEMO_VOD_IDS.series}&temporada=1` });
    await screen.findByRole('heading', { level: 1, name: 'The Office' });
    expect(location.search).toContain('temporada=1');
    // «Categoría» lleva a la rejilla de su categoría…
    fireEvent.click(screen.getByRole('button', { name: /^COMEDIA/ }));
    await waitFor(() => expect(location.search).toMatch(/^\?vista=cine&/));
    expect(location.search).not.toContain('temporada');
    // …y otra serie de ahí abre en la temporada por la que va (o la primera).
    fireEvent.click(await screen.findByRole('link', { name: /^Aquí no hay quien viva/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Aquí no hay quien viva' }),
    ).toBeInTheDocument();
    expect(location.search).not.toContain('temporada');
    const seasons = await screen.findByRole('group', { name: 'Temporadas' });
    expect(within(seasons).getByRole('button', { name: 'Temporada 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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

  it('un episodio que no se puede reproducir: su formato si se sabe; si no, un texto genérico', async () => {
    serveTitle(SERIES_AVI, {});
    expect(
      await screen.findAllByText('Este formato (AVI) no se puede reproducir en Ace Player.'),
    ).not.toHaveLength(0);
    net.restore();
    const unknown: VodSeries = {
      ...SERIES_AVI,
      seasons: SERIES_AVI.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map(({ container: _container, ...episode }) => episode),
      })),
    };
    serveTitle(unknown);
    expect(
      await screen.findAllByText('Este episodio no se puede reproducir en este navegador.'),
    ).not.toHaveLength(0);
    expect(screen.queryByText(/DESCONOCIDO/)).toBeNull();
  });

  it('«Marcar hasta aquí como visto» desde el menú de un episodio', async () => {
    // En la demo: la marca la guarda demo-data.ts y la ficha se vuelve a pedir.
    resetMode();
    setMode('demo', 'param');
    net = mockFetch({});
    renderCine({ search: `?vista=cine/${DEMO_VOD_IDS.seriesStart}` });
    expect(await screen.findByRole('button', { name: 'Ver T1 · E1' })).toBeInTheDocument();
    const more = screen.getAllByRole('button', { name: /^Más opciones: 3\. / })[0]!;
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Marcar hasta aquí como visto' }));
    expect(
      await screen.findByRole('button', { name: 'Siguiente capítulo: T1 · E4' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Visto')).toHaveLength(3);
  });
});
