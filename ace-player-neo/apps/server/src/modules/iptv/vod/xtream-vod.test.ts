/* Las llamadas VOD de `player_api.php` (docs/vod.md §4.2) con un transporte
   falso: parámetros en lista cerrada, categorías limpias (fallo 9), «sin
   VOD», el troceador con su tope y lo saltado, el paso al modo por
   categorías y los topes de las fichas, también con gzip (fallo 7). */

import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { VOD_LIMITS } from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import { createNetClient } from '../../net/index.js';
import { fakeTransport, tableResolver, type FakeReply } from '../../net/testing.js';
import { createTestCore } from '../../../../test/helpers/index.js';
import {
  shouldFallBackToCategories,
  xtreamVodApiUrl,
  xtreamVodCategories,
  xtreamVodInfo,
  xtreamVodList,
} from './xtream-vod.js';

const HOST = 'panel.example';
const CREDS = { server: `http://${HOST}`, username: 'usuario', password: 'clave larga&x=1' };
const OPTIONS = { policy: { lan: false } };

function rig(answer: (action: string, url: URL) => FakeReply | undefined) {
  const core = createTestCore();
  const transport = fakeTransport((request) => {
    const action = request.url.searchParams.get('action') ?? '';
    return answer(action, request.url) ?? { status: 404 };
  });
  const net = createNetClient({
    ...core,
    resolver: tableResolver({ [HOST]: [{ address: '93.184.216.34', family: 4 }] }),
    transport,
  });
  return { net, transport };
}

describe('xtreamVodApiUrl', () => {
  it('solo la acción y `category_id`, `vod_id` o `series_id` numéricos; las credenciales, codificadas', () => {
    const url = new URL(xtreamVodApiUrl(CREDS, 'get_vod_info', { vod_id: '42' }));
    expect(url.pathname).toBe('/player_api.php');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'action',
      'password',
      'username',
      'vod_id',
    ]);
    expect(url.searchParams.get('password')).toBe('clave larga&x=1');
    for (const bad of ['1&x=2', '-1', '1.5', '', '1234567890123']) {
      expect(() => xtreamVodApiUrl(CREDS, 'get_vod_streams', { category_id: bad }), bad).toThrow(
        AppError,
      );
    }
  });
});

describe('xtreamVodCategories (fallo 9)', () => {
  it('nombres sin HTML, entidades ni caracteres de control; ids como texto o número; lo vacío fuera', async () => {
    const { net } = rig((action) =>
      action === 'get_vod_categories'
        ? {
            body: JSON.stringify([
              { category_id: '1', category_name: '<b>ES</b> | PEL&Iacute;CULAS\u0007 &amp; más' },
              { category_id: 2, category_name: 'Series  nuevas  ' },
              { category_id: '3', category_name: '<span></span>' },
              { category_id: '4', category_name: null },
              { category_id: null, category_name: 'Sin id' },
              7,
              { category_id: '5', category_name: 'x'.repeat(300) },
            ]),
          }
        : undefined,
    );
    const map = await xtreamVodCategories(net, CREDS, 'movie', OPTIONS);
    expect([...map.entries()]).toEqual([
      ['1', 'ES | PELÍCULAS & más'],
      ['2', 'Series nuevas'],
      ['5', 'x'.repeat(120)],
    ]);
  });

  it('una respuesta que no es un array da un mapa vacío; un 401, el código IPTV', async () => {
    const { net } = rig(() => ({ body: '{}' }));
    expect((await xtreamVodCategories(net, CREDS, 'series', OPTIONS)).size).toBe(0);
    const denied = rig(() => ({ status: 401 }));
    await expect(xtreamVodCategories(denied.net, CREDS, 'series', OPTIONS)).rejects.toMatchObject({
      code: 'iptv_auth_failed',
    });
  });
});

describe('xtreamVodList', () => {
  it('«sin VOD»: `[]`, `{}`, `user_info` o texto', async () => {
    for (const body of ['[]', '{}', JSON.stringify({ user_info: { auth: 1 } }), '"no"']) {
      const { net } = rig(() => ({ body }));
      const outcome = await xtreamVodList(net, CREDS, 'movie', () => true, OPTIONS);
      expect(outcome.state, body).toBe('none');
    }
  });

  it('objetos uno a uno; lo que no es objeto o es enorme cuenta como saltado (también al cortar por el tope)', async () => {
    const items = [
      { stream_id: 1, name: 'A' },
      5,
      'texto',
      { stream_id: 2, name: 'B', plot: 'x'.repeat(VOD_LIMITS.movies.maxObjectBytes) },
      { stream_id: 3, name: 'C' },
      { stream_id: 4, name: 'D' },
    ];
    const { net } = rig(() => ({ body: JSON.stringify(items) }));
    const seen: unknown[] = [];
    let onSkip = 0;
    const whole = await xtreamVodList(
      net,
      CREDS,
      'movie',
      (item) => {
        seen.push(item.stream_id);
        return true;
      },
      { ...OPTIONS, onSkip: () => (onSkip += 1) },
    );
    expect(whole).toMatchObject({ state: 'ok', objects: 3, skipped: 3, stopped: false });
    expect(seen).toEqual([1, 3, 4]);
    expect(onSkip).toBe(3);
    /* Cortada en el segundo objeto: lo saltado hasta ahí no se pierde. */
    const cut = rig(() => ({ body: JSON.stringify(items) }));
    let count = 0;
    const stopped = await xtreamVodList(cut.net, CREDS, 'movie', () => (count += 1) < 2, OPTIONS);
    expect(stopped).toMatchObject({ state: 'ok', stopped: true, skipped: 3, objects: 2 });
  });

  it('con `category_id` va en la URL; un 500 es `iptv_unreachable` y merece el modo por categorías', async () => {
    const { net, transport } = rig(() => ({ status: 500 }));
    const error = await xtreamVodList(net, CREDS, 'series', () => true, {
      ...OPTIONS,
      categoryId: '12',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'iptv_unreachable' });
    expect(shouldFallBackToCategories(error)).toBe(true);
    expect(transport.requests[0]?.url.searchParams.get('category_id')).toBe('12');
    expect(transport.requests[0]?.url.searchParams.get('action')).toBe('get_series');
  });

  it('modo por categorías: por tiempo, tamaño o 5xx; un 401 o un 404, no', () => {
    const app = (code: string, detail?: string) =>
      new AppError(code as never, detail === undefined ? {} : { detail });
    expect(shouldFallBackToCategories(app('iptv_timeout'))).toBe(true);
    expect(shouldFallBackToCategories(app('iptv_too_large'))).toBe(true);
    expect(shouldFallBackToCategories(app('iptv_unreachable', 'http_503'))).toBe(true);
    expect(shouldFallBackToCategories(app('iptv_unreachable', 'http_404'))).toBe(false);
    expect(shouldFallBackToCategories(app('iptv_auth_failed'))).toBe(false);
    expect(shouldFallBackToCategories(new Error('x'))).toBe(false);
  });
});

describe('xtreamVodInfo (fallo 7)', () => {
  it('la ficha de una película de 600 KiB pasa del tope de 512 KiB', async () => {
    const body = JSON.stringify({ info: { plot: 'x'.repeat(600 * 1024) } });
    const { net } = rig(() => ({ body }));
    await expect(xtreamVodInfo(net, CREDS, 'movie', 1, OPTIONS)).rejects.toMatchObject({
      code: 'iptv_too_large',
    });
  });

  it('con gzip, el tope vale DESCOMPRIMIDA: una serie de 9 MiB comprimida en poco no pasa', async () => {
    const big = JSON.stringify({ info: { plot: 'a'.repeat(9 * 1024 * 1024) } });
    const gz = gzipSync(Buffer.from(big));
    expect(gz.length).toBeLessThan(VOD_LIMITS.seriesInfo.maxBytes);
    const { net } = rig(() => ({ body: gz, headers: { 'content-encoding': 'gzip' } }));
    await expect(xtreamVodInfo(net, CREDS, 'series', 7, OPTIONS)).rejects.toMatchObject({
      code: 'iptv_too_large',
    });
    /* Una de 2 MiB (748 episodios, T6), comprimida, sí. */
    const fine = JSON.stringify({ info: { plot: 'b'.repeat(2 * 1024 * 1024) } });
    const ok = rig(() => ({
      body: gzipSync(Buffer.from(fine)),
      headers: { 'content-encoding': 'gzip' },
    }));
    await expect(xtreamVodInfo(ok.net, CREDS, 'series', 7, OPTIONS)).resolves.toMatchObject({
      info: { plot: expect.any(String) },
    });
  });
});
