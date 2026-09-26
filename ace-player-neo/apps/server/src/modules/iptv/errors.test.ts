/* Qué fallos de la prueba rápida merecen un reintento (docs/iptv.md §16.8) y
   el motivo corto que va al registro. */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { failureDetail, isTransientSaveFailure, toIptvError } from './errors.js';
import { categoryOrder, hasUserInfo, streamCategoryId } from './xtream.js';

describe('isTransientSaveFailure (§16.8, D36)', () => {
  it('sí: 5xx, 429, cuerpo vacío, respuesta mala, sin user_info, cortes, DNS y redirecciones', () => {
    for (const error of [
      toIptvError(new AppError('http_502'), 'account'),
      toIptvError(new AppError('http_503'), 'account'),
      toIptvError(new AppError('http_520'), 'account'),
      toIptvError(new AppError('http_429'), 'account'),
      toIptvError(new AppError('http_200'), 'account'),
      toIptvError(new Error('bad_response'), 'account'),
      toIptvError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), 'account'),
      new AppError('iptv_unreachable', { detail: 'sin_user_info' }),
      toIptvError(new AppError('dns_failed'), 'account'),
      toIptvError(new AppError('redirect_limit'), 'account'),
      toIptvError(new AppError('redirect_loop'), 'list'),
      new AppError('iptv_bad_list'),
    ]) {
      expect(isTransientSaveFailure(error), `${error.code} ${error.detail ?? ''}`).toBe(true);
    }
  });

  it('no: auth 0, 401, 403, cuenta caducada, plazo agotado, 404 y lo demás', () => {
    for (const error of [
      new AppError('iptv_auth_failed'),
      toIptvError(new AppError('http_401'), 'account'),
      toIptvError(new AppError('http_403'), 'account'),
      new AppError('iptv_account_expired'),
      toIptvError(new AppError('fetch_timeout'), 'account'),
      toIptvError(new AppError('http_404'), 'account'),
      toIptvError(new AppError('http_404'), 'list'),
      toIptvError(new AppError('http_458'), 'account'),
      new AppError('iptv_empty'),
      new AppError('bad_url'),
      toIptvError(new AppError('private_url'), 'account'),
    ]) {
      expect(isTransientSaveFailure(error), `${error.code} ${error.detail ?? ''}`).toBe(false);
    }
  });

  it('failureDetail: código del catálogo, bad_response o fetch_failed con el código del sistema; nunca el mensaje', () => {
    expect(failureDetail(new AppError('http_502'))).toBe('http_502');
    expect(failureDetail(new Error('bad_response'))).toBe('bad_response');
    expect(
      failureDetail(
        Object.assign(new Error('connect ECONNREFUSED http://u:p@x/'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe('fetch_failed:ECONNREFUSED');
    expect(failureDetail(new Error('http://usuario:clave@x/'))).toBe('fetch_failed');
  });
});

describe('Xtream para la pestaña (§16.3) y user_info (§16.8)', () => {
  it('streamCategoryId: category_id o el primero de category_ids', () => {
    expect(streamCategoryId({ category_id: '5' })).toBe('5');
    expect(streamCategoryId({ category_id: 7 })).toBe('7');
    expect(streamCategoryId({ category_id: null, category_ids: [9, 3] })).toBe('9');
    expect(streamCategoryId({ category_ids: [] })).toBe('');
    expect(streamCategoryId({})).toBe('');
  });

  it('categoryOrder: el orden de get_live_categories, sin repetir nombres', () => {
    const map = new Map([
      ['3', 'ES | DAZN'],
      ['1', 'ES | DEPORTES'],
      ['9', 'ES | DAZN'],
      ['2', 'UK | SPORTS'],
    ]);
    expect(categoryOrder(map)).toEqual(['ES | DAZN', 'ES | DEPORTES', 'UK | SPORTS']);
  });

  it('hasUserInfo: solo un objeto user_info cuenta', () => {
    expect(hasUserInfo({ user_info: { auth: 1 } })).toBe(true);
    expect(hasUserInfo({ user_info: { auth: 0 } })).toBe(true);
    expect(hasUserInfo([])).toBe(false);
    expect(hasUserInfo({})).toBe(false);
    expect(hasUserInfo({ user_info: [] })).toBe(false);
    expect(hasUserInfo('<html>')).toBe(false);
  });
});
