/* Las 5 rutas de la Guía TV por HTTP (docs/iptv.md §20.6): sin IPTV, el
   contrato de «no hay guía»; con guía (una API de mentira con los ejemplos
   de fixtures/), los códigos, las cabeceras de caché, la imagen con su 304
   y su `Retry-After`, la validación y el 403 desde /native. */

import { describe, expect, it } from 'vitest';
import {
  IptvGuideNowResponseSchema,
  IptvGuideResponseSchema,
  demoGuide,
  demoGuideNow,
  demoGuideProgramme,
  demoGuideProgrammes,
  demoGuideStamp,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { FAKE_TOKEN, createTestApp, fakeAuth, native, web } from '../../../test/helpers/index.js';
import type { GuideApi } from './guide-api.js';
import type { GuideArtReply } from './guide-art.js';

const NOW = Date.UTC(2026, 9, 3, 18, 30);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

/** Una API de la guía de mentira: la de ejemplo de la demo (src/demo/guide.ts). */
function stubGuide(art: (ref: string, ifNoneMatch?: string) => GuideArtReply): GuideApi {
  const version = demoGuideStamp(NOW).version;
  const stale = (v: string) => {
    if (v !== version) throw new AppError('guide_stale');
  };
  const stub: Pick<GuideApi, 'channels' | 'programmes' | 'programme' | 'now' | 'art' | 'reset'> = {
    channels: (query) => Promise.resolve(demoGuide(query, NOW)),
    programmes: (query) => {
      stale(query.v);
      return demoGuideProgrammes(query, NOW);
    },
    programme: (id, v) => {
      stale(v);
      try {
        return demoGuideProgramme(id, { v }, NOW);
      } catch {
        throw new AppError('not_found');
      }
    },
    now: (query) => demoGuideNow(query, NOW),
    art: (ref, v, ifNoneMatch) => {
      stale(v);
      return Promise.resolve(art(ref, ifNoneMatch));
    },
    reset: () => undefined,
  };
  return stub as GuideApi;
}

async function appWith(guide?: GuideApi) {
  const created = await createTestApp();
  if (guide) (created.services.iptv as unknown as { tvGuide: GuideApi }).tvGuide = guide;
  return created.app;
}

describe('rutas de la Guía TV', () => {
  it('sin IPTV: estado inactive y «ahora» vacío (200); programas, ficha e imagen, 409 guide_unavailable', async () => {
    const app = await appWith();
    const guide = await app.inject({ method: 'GET', url: '/api/v1/iptv/guide', headers: web() });
    expect(guide.statusCode).toBe(200);
    expect(IptvGuideResponseSchema.parse(guide.json())).toMatchObject({
      state: 'inactive',
      version: '',
      channels: [],
    });
    const now = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/now?ids=${'a'.repeat(40)}`,
      headers: web(),
    });
    expect(now.statusCode).toBe(200);
    expect(IptvGuideNowResponseSchema.parse(now.json())).toEqual({
      available: false,
      version: '',
      items: [],
    });
    for (const url of [
      '/api/v1/iptv/guide/programmes?v=abc&ch=1,2&from=0&to=3600000',
      '/api/v1/iptv/guide/programmes/1.29000000?v=abc',
      '/api/v1/iptv/guide/art/c1?v=abc',
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: web() });
      expect(response.statusCode, url).toBe(409);
      expect(response.json().error.code, url).toBe('guide_unavailable');
    }
  });

  it('consultas mal formadas: 400; desde /native: 403 origin_forbidden', async () => {
    const app = await appWith();
    for (const url of [
      '/api/v1/iptv/guide?scope=deportes',
      '/api/v1/iptv/guide?limit=5000',
      '/api/v1/iptv/guide/programmes?v=abc&ch=0&from=0&to=1',
      '/api/v1/iptv/guide/programmes?v=abc&from=0&to=1',
      '/api/v1/iptv/guide/programmes/1-2?v=abc',
      '/api/v1/iptv/guide/now?ids=nada',
      '/api/v1/iptv/guide/art/https%3A%2F%2Fevil.example%2Fa.png?v=abc',
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: web() });
      expect(response.statusCode, url).toBe(400);
      expect(response.json().error.code, url).toBe('validation_error');
    }
    /* Desde el iPhone: con un dispositivo emparejado, 403 (solo web); sin él, ni siquiera entra. */
    const phone = await createTestApp({ services: { auth: fakeAuth() } });
    const fromPhone = await phone.app.inject({
      method: 'GET',
      url: '/native/api/v1/iptv/guide',
      headers: native(FAKE_TOKEN),
    });
    expect(fromPhone.statusCode).toBe(403);
    expect(fromPhone.json().error.code).toBe('origin_forbidden');
    const anonymous = await app.inject({
      method: 'GET',
      url: '/native/api/v1/iptv/guide/programmes?v=abc&ch=1&from=0&to=1',
      headers: native(),
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('con guía: canales, un trozo con caché inmutable, la ficha y el sello viejo (409 guide_stale)', async () => {
    const app = await appWith(stubGuide(() => ({ status: 200, headers: {}, body: PNG })));
    const guide = await app.inject({
      method: 'GET',
      url: '/api/v1/iptv/guide?scope=all&limit=3',
      headers: web(),
    });
    expect(guide.statusCode).toBe(200);
    const body = IptvGuideResponseSchema.parse(guide.json());
    expect(body.channels).toHaveLength(3);
    const ch = body.channels.map((row) => row.guide).join(',');
    const from = NOW - 3_600_000;
    const slice = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/programmes?v=${body.version}&ch=${ch}&from=${from}&to=${from + 6 * 3_600_000}`,
      headers: web(),
    });
    expect(slice.statusCode).toBe(200);
    expect(slice.headers['cache-control']).toBe('private, max-age=86400, immutable');
    const programmes = slice.json().channels[0].programmes as { id: string }[];
    expect(programmes.length).toBeGreaterThan(0);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/programmes/${programmes[0]?.id}?v=${body.version}`,
      headers: web(),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(programmes[0]?.id);
    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/programmes/1.1?v=${body.version}`,
      headers: web(),
    });
    expect(missing.statusCode).toBe(404);
    const stale = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/programmes?v=viejo&ch=${ch}&from=${from}&to=${from + 3_600_000}`,
      headers: web(),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('guide_stale');
  });

  it('imagen: los bytes con sus cabeceras, el 304 y, con la cola llena, 503 guide_busy con Retry-After', async () => {
    const headers = {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=86400, immutable',
      etag: '"abc"',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    };
    const app = await appWith(
      stubGuide((ref, ifNoneMatch) => {
        if (ref === 'c9') throw new AppError('guide_busy');
        if (ref === 'c8') throw new AppError('not_found');
        return ifNoneMatch === '"abc"'
          ? { status: 304, headers }
          : { status: 200, headers, body: PNG };
      }),
    );
    const v = demoGuideStamp(NOW).version;
    const image = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/art/c1?v=${v}`,
      headers: web(),
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.rawPayload.equals(PNG)).toBe(true);
    const cached = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/art/c1?v=${v}`,
      headers: web({ 'if-none-match': '"abc"' }),
    });
    expect(cached.statusCode).toBe(304);
    const busy = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/art/c9?v=${v}`,
      headers: web(),
    });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('2');
    expect(busy.json().error.code).toBe('guide_busy');
    const none = await app.inject({
      method: 'GET',
      url: `/api/v1/iptv/guide/art/c8?v=${v}`,
      headers: web(),
    });
    expect(none.statusCode).toBe(404);
  });
});
