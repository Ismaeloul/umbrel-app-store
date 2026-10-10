/* Datos de Películas y series: el estado de la URL compartido, las marcas de
   progreso (204 sin cuerpo) y la dirección de los carteles. */

import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import listFixture from '@fixtures/web/v1/vodListGet.json';
import type { VodList } from '@ace/shared';
import {
  artSrc,
  invalidateAfterProgress,
  optimisticList,
  postVodProgress,
  resetCineState,
  setCineState,
  titleFromCard,
} from './data.ts';

const ID = '4b5c6d7e8f9012345678abcdef0123457a8b9c0d';
let net: ReturnType<typeof mockFetch> | null = null;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = null;
  resetMode();
  history.replaceState(null, '', '/');
  resetCineState();
});

describe('estado de la URL', () => {
  it('setCineState reemplaza la entrada (no llena el historial) y conserva lo demás', () => {
    history.replaceState({ aceDepth: 2 }, '', '/?vista=cine&flag=cine');
    const length = history.length;
    setCineState({ kind: 'series', tag: 'vose' });
    expect(location.search).toBe('?vista=cine&flag=cine&cine=series&cinetag=vose');
    expect(history.length).toBe(length);
    expect(history.state).toEqual({ aceDepth: 2 });
  });
});

describe('marcas de progreso (§10.2)', () => {
  it('POST con JSON y 204 sin cuerpo', async () => {
    net = mockFetch({
      [`POST /api/v1/vod/titles/${ID}/progress`]: () => new Response(null, { status: 204 }),
    });
    await postVodProgress(ID, { posS: 0, durS: 0, event: 'hide' });
    expect(net.calls[0]).toMatchObject({
      method: 'POST',
      body: { posS: 0, durS: 0, event: 'hide' },
    });
    expect(net.calls[0]?.headers.get('Content-Type')).toBe('application/json');
  });

  it('un error del servidor sale como ApiError con su código', async () => {
    net = mockFetch({
      [`POST /api/v1/vod/titles/${ID}/progress`]: () =>
        json(
          {
            error: {
              code: 'vod_not_found',
              message: 'Este título ya no está en tu IPTV.',
              requestId: 't',
            },
          },
          404,
        ),
    });
    const error = await postVodProgress(ID, { posS: 0, durS: 0, event: 'mark' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('vod_not_found');
  });

  it('tras una marca se invalidan la portada, las fichas y la rejilla', async () => {
    const client = new QueryClient();
    client.setQueryData(['v1', 'vodHome', null, null], {});
    client.setQueryData(['v1', 'vodTitle', { id: ID }], {});
    client.setQueryData(['v1', 'vodBrowse', null, { pages: true }], {});
    client.setQueryData(['v1', 'libraryGet', null, null], {});
    await invalidateAfterProgress(client);
    const invalid = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(invalid(['v1', 'vodHome', null, null])).toBe(true);
    expect(invalid(['v1', 'vodTitle', { id: ID }])).toBe(true);
    expect(invalid(['v1', 'vodBrowse', null, { pages: true }])).toBe(true);
    expect(invalid(['v1', 'libraryGet', null, null])).toBe(false);
  });
});

describe('carteles (§8)', () => {
  it('por id y sello en vodArt; en la demo, un SVG `data:`', () => {
    expect(artSrc(ID, 'backdrop', '8a7f3e21')).toBe(
      `/api/v1/vod/titles/${ID}/art/backdrop?v=8a7f3e21`,
    );
    resetMode();
    setMode('demo', 'param');
    expect(artSrc(ID, 'poster', '8a7f3e21', 'Dune')).toMatch(/^data:image\/svg\+xml/);
  });
});

describe('la ficha nace de la tarjeta', () => {
  it('con lo que se sabe y `info: pending`', () => {
    const title = titleFromCard({
      id: ID,
      kind: 'series',
      title: 'The Office',
      year: 2005,
      rating: 8.6,
      poster: null,
      tags: ['castellano'],
      adult: false,
      progress: null,
    });
    expect(title).toMatchObject({ kind: 'series', info: 'pending', seasons: [], main: null });
  });
});

describe('«Mi lista» optimista (0.9.1)', () => {
  const LIST = listFixture as VodList;
  const NOW = Date.parse('2026-10-04T20:00:00.000Z');

  it('añadir: arriba del todo con lo que se sabe; si ya estaba, igual', () => {
    const target = { id: 'c'.repeat(40), kind: 'movie' as const, title: 'Nueva', year: 2024 };
    const next = optimisticList(LIST, target, true, NOW);
    expect(next?.items[0]).toMatchObject({
      ...target,
      available: true,
      upTo: null,
      poster: null,
      addedAt: '2026-10-04T20:00:00.000Z',
    });
    expect(next?.items).toHaveLength(LIST.items.length + 1);
    const first = LIST.items[0];
    if (!first) throw new Error('el ejemplo trae títulos');
    expect(optimisticList(LIST, first, true, NOW)).toBe(LIST);
  });

  it('quitar: fuera; sin lista todavía, nada', () => {
    const first = LIST.items[0];
    if (!first) throw new Error('el ejemplo trae títulos');
    expect(optimisticList(LIST, first, false, NOW)?.items.map((item) => item.id)).not.toContain(
      first.id,
    );
    expect(optimisticList(undefined, first, false, NOW)).toBeUndefined();
  });
});
