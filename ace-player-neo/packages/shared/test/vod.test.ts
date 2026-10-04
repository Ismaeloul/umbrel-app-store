/* Contrato de Películas y series (docs/vod.md §11 y §15.1 «Contratos»): las
   rutas nacen solo web, los 10 `vod_*` con su HTTP, nada del proveedor en
   los esquemas `Vod*`, lo que ve la app no cambia y el presupuesto de
   tiempos de `vodStream` (§9.12) cabe bajo nginx. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorSchema,
  BootstrapResponseSchema,
  ERROR_CATALOG,
  IPTV_ERROR_CODES,
  IptvStatusSchema,
  StreamSourceSchema,
  V1_ROUTES,
  V1_ROUTE_IDS,
  V2_FILES,
  VOD_ERROR_CODES,
  VOD_EXTENSIONS,
  VOD_LIMITS,
  VOD_PROGRESS,
  VOD_TAGS,
  VOD_TIMINGS,
  VOD_CLIENT,
  VOD_UNSUPPORTED_REASONS,
  VideoParamsSchema,
  VodBrowseQuerySchema,
  VodBrowseResponseSchema,
  VodCardSchema,
  VodDocSchema,
  VodEpisodeSchema,
  VodGrantSchema,
  VodHomeQuerySchema,
  VodHomeSchema,
  VodLanguagesBodySchema,
  VodLanguagesSchema,
  VodListFileSchema,
  VodListSchema,
  VodProgressBodySchema,
  VodStreamQuerySchema,
  VodTitleSchema,
  VOD_LANGS,
  isIptvErrorCode,
  isVodErrorCode,
  listV1Routes,
} from '../src/index.js';
import { OPENAPI_FILE } from '../scripts/openapi.js';
import {
  NON_JSON_ROUTE_IDS,
  VARIANT_FIXTURES,
  WEB_EVENT_FIXTURES,
  WEB_FIXTURE_ROUTE_IDS,
  WEB_V1_FIXTURES,
} from '../scripts/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NGINX_CONF = path.resolve(here, '../../../deploy/umbrel/nginx.conf');

/** Todas las claves de propiedades de un JSON Schema (anidadas incluidas). */
function keysOf(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const child of node) keysOf(child, found);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value && typeof value === 'object') {
        for (const name of Object.keys(value)) found.add(name);
      }
      keysOf(value, found);
    }
  }
  return found;
}

describe('rutas de Películas y series (docs/vod.md §11.1)', () => {
  it('las 11, en su orden, solo web con bearer; ninguna módulo nuevo', () => {
    const vod = listV1Routes().filter((route) => route.id.startsWith('vod'));
    expect(vod.map((route) => `${route.id} ${route.method} ${route.path} ${route.module}`)).toEqual(
      [
        'vodHome GET /api/v1/vod iptv',
        'vodBrowse GET /api/v1/vod/browse iptv',
        'vodTitle GET /api/v1/vod/titles/:id iptv',
        'vodArt GET /api/v1/vod/titles/:id/art/:art iptv',
        'vodStream GET /api/v1/vod/titles/:id/stream playback',
        'vodProgress POST /api/v1/vod/titles/:id/progress iptv',
        /* Los idiomas (§4.10). */
        'vodLanguagesGet GET /api/v1/vod/languages iptv',
        'vodLanguagesUpdate PUT /api/v1/vod/languages iptv',
        /* «Mi lista» (0.9.1). */
        'vodListGet GET /api/v1/vod/list iptv',
        'vodListAdd PUT /api/v1/vod/list/:id iptv',
        'vodListRemove DELETE /api/v1/vod/list/:id iptv',
      ],
    );
    for (const route of vod) {
      expect(route.access, route.id).toBe('web');
      expect(route.credential, route.id).toBe('bearer');
      expect(route.legacyTwin, route.id).toBeNull();
    }
  });

  it('solo abrir, guardar progreso, elegir idiomas y cambiar Mi lista tienen efectos (anti-CSRF); leer, no', () => {
    expect(V1_ROUTES.vodStream.sideEffects).toBe(true);
    expect(V1_ROUTES.vodProgress.sideEffects).toBe(true);
    expect(V1_ROUTES.vodLanguagesUpdate.sideEffects).toBe(true);
    expect(V1_ROUTES.vodListAdd.sideEffects).toBe(true);
    expect(V1_ROUTES.vodListRemove.sideEffects).toBe(true);
    for (const id of [
      'vodHome',
      'vodBrowse',
      'vodTitle',
      'vodArt',
      'vodLanguagesGet',
      'vodListGet',
    ] as const) {
      expect(V1_ROUTES[id].sideEffects, id).toBe(false);
    }
  });

  it('vodArt es binario y vodProgress un 204 sin cuerpo; las otras 4 tienen ejemplo en web/v1/', () => {
    expect(V1_ROUTES.vodArt).toMatchObject({ content: 'binary', response: null, status: 200 });
    expect(V1_ROUTES.vodProgress).toMatchObject({ content: 'empty', response: null, status: 204 });
    expect(NON_JSON_ROUTE_IDS).toEqual(expect.arrayContaining(['vodArt', 'vodProgress']));
    for (const id of ['vodHome', 'vodBrowse', 'vodTitle', 'vodStream'] as const) {
      expect(WEB_FIXTURE_ROUTE_IDS, id).toContain(id);
    }
    /* Ninguna otra ruta usa 204. */
    const empty = V1_ROUTE_IDS.filter((id) => V1_ROUTES[id].content === 'empty');
    expect(empty).toEqual(['vodProgress']);
  });

  it('errores propios: vodStream los vod_* de abrir y remux_busy; ningún iptv_* (no pasan a AceStream)', () => {
    expect([...V1_ROUTES.vodStream.errors].sort()).toEqual(
      [...VOD_ERROR_CODES.filter((code) => code !== 'vod_list_full'), 'remux_busy'].sort(),
    );
    expect(V1_ROUTES.vodBrowse.errors).toEqual(['empty_query']);
    expect(V1_ROUTES.vodTitle.errors).toEqual(['vod_not_found', 'vod_unavailable']);
    expect(V1_ROUTES.vodArt.errors).toEqual(['vod_not_found']);
    expect(V1_ROUTES.vodProgress.errors).toEqual(['vod_not_found']);
    expect(V1_ROUTES.vodListAdd.errors).toEqual([
      'vod_not_found',
      'vod_unavailable',
      'vod_list_full',
    ]);
    expect(V1_ROUTES.vodListRemove.errors).toEqual([]);
    for (const id of V1_ROUTE_IDS.filter((routeId) => routeId.startsWith('vod'))) {
      expect(
        V1_ROUTES[id].errors.filter((code) => isIptvErrorCode(code)),
        id,
      ).toEqual([]);
    }
  });

  it('openapi: vodArt documenta sus tres tipos de imagen y vodProgress su 204', () => {
    const doc = readFileSync(OPENAPI_FILE, 'utf8');
    const art = doc.slice(doc.indexOf('operationId: vodArt\n'));
    expect(art.slice(0, art.indexOf('operationId: ', 20))).toMatch(
      /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/,
    );
    const progress = doc.slice(doc.indexOf('operationId: vodProgress\n'));
    expect(progress.slice(0, progress.indexOf('operationId: ', 20))).toContain('"204":');
  });
});

describe('errores vod_* (docs/vod.md §11.3)', () => {
  it('10 códigos, públicos, sin estado antiguo y con el HTTP del diseño', () => {
    const statuses = Object.fromEntries(
      VOD_ERROR_CODES.map((code) => [code, ERROR_CATALOG[code].status]),
    );
    expect(statuses).toEqual({
      vod_unavailable: 503,
      vod_not_found: 404,
      vod_unsupported: 422,
      vod_busy: 503,
      vod_timeout: 504,
      vod_dropped: 502,
      vod_provider_error: 502,
      vod_disk_full: 507,
      vod_account: 403,
      vod_list_full: 409,
    });
    for (const code of VOD_ERROR_CODES) {
      expect(ERROR_CATALOG[code].public, code).toBe(true);
      expect(ERROR_CATALOG[code].legacyStatus, code).toBeNull();
      expect(isVodErrorCode(code)).toBe(true);
      expect(isIptvErrorCode(code)).toBe(false);
    }
  });

  it('los 16 iptv_* no cambian (T14)', () => {
    expect(IPTV_ERROR_CODES).toHaveLength(16);
  });

  it('ApiError.data: intentos, motivo de vod_unsupported o espera de vod_busy; nunca mezclados', () => {
    const base = { code: 'vod_unsupported', message: 'x', requestId: 'r' };
    const ok = (data: unknown) => ApiErrorSchema.safeParse({ error: { ...base, data } }).success;
    for (const reason of VOD_UNSUPPORTED_REASONS) expect(ok({ reason }), reason).toBe(true);
    expect(ok({ reason: 'otro' })).toBe(false);
    expect(ok({ retryAfterS: 30 })).toBe(true);
    expect(ok({ retryAfterS: 0 })).toBe(false);
    expect(ok({ attempts: 2 })).toBe(true);
    expect(ok({ attempts: 2, reason: 'hevc' })).toBe(false);
    expect(ok({})).toBe(false);
  });
});

describe('esquemas Vod* (docs/vod.md §11.2)', () => {
  it('ninguno lleva nada del proveedor (§11.2, prueba de fugas)', () => {
    const forbidden = [
      'url',
      'username',
      'password',
      'secret',
      'server',
      'stream_id',
      'streamId',
      'series_id',
      'episode_id',
      'container_extension',
      'direct_source',
      'stream_icon',
      'cover',
      'backdrop_path',
    ];
    for (const [name, schema] of [
      ['VodHome', VodHomeSchema],
      ['VodBrowseResponse', VodBrowseResponseSchema],
      ['VodTitle', VodTitleSchema],
      ['VodProgressBody', VodProgressBodySchema],
      ['VodDoc', VodDocSchema],
      ['VodList', VodListSchema],
      ['VodListFile', VodListFileSchema],
      ['IptvStatus', IptvStatusSchema],
    ] as const) {
      const keys = keysOf(z.toJSONSchema(schema, { io: 'output' }));
      expect(
        forbidden.filter((key) => keys.has(key)),
        name,
      ).toEqual([]);
    }
    /* La concesión sí lleva `url`: la del vídeo en /api/v1/video/, nunca la del proveedor. */
    const grantKeys = keysOf(z.toJSONSchema(VodGrantSchema.shape.vod, { io: 'output' }));
    expect(forbidden.filter((key) => grantKeys.has(key))).toEqual([]);
    expect(WEB_V1_FIXTURES.vodStream.url).toMatch(
      /^\/api\/v1\/video\/s_[A-Za-z0-9_-]+\/index\.m3u8$/,
    );
  });

  it('una tarjeta no acepta claves de más, ids que no son de 40 hex ni distintivos inventados', () => {
    const card = WEB_V1_FIXTURES.vodHome.newMovies[0]!;
    expect(VodCardSchema.safeParse(card).success).toBe(true);
    expect(VodCardSchema.safeParse({ ...card, stream_id: 123 }).success).toBe(false);
    expect(VodCardSchema.safeParse({ ...card, id: '123' }).success).toBe(false);
    expect(VodCardSchema.safeParse({ ...card, tags: ['8k'] }).success).toBe(false);
    expect(VodCardSchema.safeParse({ ...card, poster: 'https://x/y.jpg' }).success).toBe(false);
    expect(VOD_TAGS).toEqual(['castellano', 'latino', 'vose', 'multi', '4k']);
  });

  it('un episodio puede decir su formato (container): opcional y de hasta 8 letras', () => {
    const series = VARIANT_FIXTURES['vodTitle.series'];
    if (series.kind !== 'series') throw new Error('vodTitle.series no es una serie');
    const [withContainer, withoutContainer] = [
      series.seasons[0]!.episodes[0]!,
      series.seasons[1]!.episodes[1]!,
    ];
    expect(withContainer.container).toBe('mkv');
    expect(withoutContainer.container).toBeUndefined();
    expect(VodEpisodeSchema.safeParse(withContainer).success).toBe(true);
    expect(VodEpisodeSchema.safeParse(withoutContainer).success).toBe(true);
    expect(VodEpisodeSchema.safeParse({ ...withContainer, container: null }).success).toBe(false);
    expect(VodEpisodeSchema.safeParse({ ...withContainer, container: 'matroska' }).success).toBe(
      true,
    );
    expect(VodEpisodeSchema.safeParse({ ...withContainer, container: 'matroska2' }).success).toBe(
      false,
    );
    /* La variante: el episodio que no se puede reproducir nombra su formato. */
    const avi = VARIANT_FIXTURES['vodTitle.episodio-avi'];
    if (avi.kind !== 'series') throw new Error('vodTitle.episodio-avi no es una serie');
    const blocked = avi.seasons
      .flatMap((season) => season.episodes)
      .filter((e) => e.playable === 'no');
    expect(blocked.map((e) => e.container)).toEqual(['avi']);
    expect(VodTitleSchema.safeParse(avi).success).toBe(true);
  });

  it('VodBrowseQuery: por defecto películas, todas, por novedades y 60; nada más', () => {
    expect(VodBrowseQuerySchema.parse({})).toEqual({
      kind: 'movie',
      cat: 'all',
      sort: 'added',
      limit: 60,
    });
    expect(VodBrowseQuerySchema.safeParse({ kind: 'series', cat: '9a1b2c3d4e5f' }).success).toBe(
      true,
    );
    expect(VodBrowseQuerySchema.safeParse({ kind: 'episode' }).success).toBe(false);
    expect(VodBrowseQuerySchema.safeParse({ cat: 'ES | ESTRENOS' }).success).toBe(false);
    expect(VodBrowseQuerySchema.safeParse({ tag: '8k' }).success).toBe(false);
    expect(VodBrowseQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(VodBrowseQuerySchema.safeParse({ cursor: 'no+vale/=' }).success).toBe(false);
    expect(VodBrowseQuerySchema.safeParse({ category_id: '12' }).success).toBe(false);
  });

  it('VodStreamQuery: cliente y visor obligatorios; start, audio y hevc con sus topes', () => {
    const base = { client: 'web', viewer: 'viewer_tab01' };
    expect(VodStreamQuerySchema.parse(base)).toEqual({ ...base, hevc: '0' });
    expect(VodStreamQuerySchema.parse({ ...base, start: '2587.5', audio: '1' })).toMatchObject({
      start: 2587.5,
      audio: 1,
    });
    expect(VodStreamQuerySchema.safeParse({ viewer: 'viewer_tab01' }).success).toBe(false);
    expect(VodStreamQuerySchema.safeParse({ ...base, start: '-1' }).success).toBe(false);
    expect(VodStreamQuerySchema.safeParse({ ...base, audio: '16' }).success).toBe(false);
    expect(VodStreamQuerySchema.safeParse({ ...base, hevc: 'si' }).success).toBe(false);
    /* De channelStream solo se hereda cliente, visor y aparato. */
    expect(VodStreamQuerySchema.safeParse({ ...base, kind: 'infohash' }).success).toBe(false);
  });

  it('VodProgressBody: un evento de la lista; posición y duración de 0 a 24 h', () => {
    expect(VodProgressBodySchema.parse({ event: 'mark' })).toEqual({
      event: 'mark',
      posS: 0,
      durS: 0,
    });
    expect(
      VodProgressBodySchema.safeParse({ event: 'tick', posS: 60, durS: 5400, audio: 'spa' })
        .success,
    ).toBe(true);
    expect(VodProgressBodySchema.safeParse({ event: 'play' }).success).toBe(false);
    expect(VodProgressBodySchema.safeParse({ event: 'tick', posS: 90_000 }).success).toBe(false);
  });

  it('las variantes cubren los estados de la portada, la búsqueda, la serie, la ficha fallida y HEVC', () => {
    expect(VARIANT_FIXTURES['vodHome.preparing'].state).toBe('preparing');
    expect(VARIANT_FIXTURES['vodHome.none'].state).toBe('none');
    expect(VARIANT_FIXTURES['vodHome.unsupported'].state).toBe('unsupported');
    expect(VARIANT_FIXTURES['vodBrowse.search'].otherKindTotal).toBe(1);
    expect(VARIANT_FIXTURES['vodBrowse.vacio'].items).toEqual([]);
    expect(VARIANT_FIXTURES['vodTitle.series'].kind).toBe('series');
    expect(VARIANT_FIXTURES['vodTitle.episodio-avi'].kind).toBe('series');
    expect(VARIANT_FIXTURES['vodTitle.info-failed'].info).toBe('failed');
    expect(VARIANT_FIXTURES['vodStream.hevc'].vod.video.codecs).toMatch(/^hvc1\./);
    /* La portada nunca enseña adultos en las filas (D-VOD7). */
    const home = WEB_V1_FIXTURES.vodHome;
    for (const card of [...home.newMovies, ...home.updatedSeries]) expect(card.adult).toBe(false);
  });
});

describe('lo que ve la app no cambia (docs/vod.md §17)', () => {
  it('StreamSourceSchema sigue siendo engine | iptv; la concesión VOD es source iptv', () => {
    expect(StreamSourceSchema.options).toEqual(['engine', 'iptv']);
    expect(WEB_V1_FIXTURES.vodStream.source).toBe('iptv');
    expect(VodGrantSchema.safeParse(WEB_V1_FIXTURES.vodStream).success).toBe(true);
  });

  it('VideoParamsSchema no admite todavía listas maestras ni subtítulos (§9.10, T16)', () => {
    const sid = 's_Q2FuYWxEZVBydWViYQ';
    expect(VideoParamsSchema.safeParse({ sid, file: 'index.m3u8' }).success).toBe(true);
    expect(VideoParamsSchema.safeParse({ sid, file: 'master.m3u8' }).success).toBe(false);
    expect(VideoParamsSchema.safeParse({ sid, file: 'sub0-3.vtt' }).success).toBe(false);
  });

  it('features.vod es opcional y solo de la web; iptv.status puede llevar vod', () => {
    const bootstrap = JSON.parse(
      readFileSync(path.resolve(here, '../fixtures/v1/bootstrap.json'), 'utf8'),
    ) as { features: object };
    expect(bootstrap.features).not.toHaveProperty('vod');
    const withVod = { ...bootstrap, features: { ...bootstrap.features, vod: true } };
    expect(BootstrapResponseSchema.safeParse(withVod).success).toBe(true);
    expect(IptvStatusSchema.safeParse(WEB_EVENT_FIXTURES['iptv.status']).success).toBe(true);
    expect(WEB_EVENT_FIXTURES['iptv.status'].vod?.state).toBe('ready');
  });
});

describe('v2/vod.json y ficheros (docs/vod.md §10.1 y §4.1)', () => {
  it('rutas bajo data/v2: el documento fuera de la carpeta IPTV; catálogo y carteles dentro', () => {
    expect(V2_FILES.vod).toBe('v2/vod.json');
    expect(V2_FILES.vodCatalog).toBe('v2/iptv/vod.enc');
    expect(V2_FILES.vodArt).toBe('v2/iptv/arte');
  });

  it('vacío, con progreso y preferencias; con topes y sin claves de más', () => {
    const empty = { v: 1, providerFp: null, catalog: null, progress: [], prefs: [] };
    expect(VodDocSchema.safeParse(empty).success).toBe(true);
    const entry = {
      id: '8f9012345678abcdef0123456789abcdd1e2f304',
      kind: 'episode',
      seriesId: '7e8f9012345678abcdef0123456789abc0d1e2f3',
      title: 'The Office',
      subtitle: 'T2 · E5 · Halloween',
      season: 2,
      episode: 5,
      posS: 1300,
      durS: 1320,
      watched: true,
      hidden: false,
      next: { id: '9012345678abcdef0123456789abcdefe2f30415', label: 'T2 · E6' },
      updatedAt: 1_758_659_400_000,
    };
    const doc = {
      v: 1,
      providerFp: '0123456789abcdef',
      catalog: {
        state: 'ready',
        movies: 48_213,
        series: 6_904,
        builtAt: '2026-09-23T04:10:00.000Z',
        truncated: false,
        skipped: 3,
      },
      progress: [entry],
      prefs: [{ id: entry.seriesId, audio: 'spa', subtitle: null, updatedAt: 1_758_659_400_000 }],
    };
    expect(VodDocSchema.safeParse(doc).success).toBe(true);
    expect(VodDocSchema.safeParse({ ...doc, providerFp: 'corto' }).success).toBe(false);
    expect(VodDocSchema.safeParse({ ...doc, progress: [{ ...entry, streamId: 1 }] }).success).toBe(
      false,
    );
    expect(
      VodDocSchema.safeParse({
        ...doc,
        progress: Array(VOD_PROGRESS.itemsMax + 1).fill(entry),
      }).success,
    ).toBe(false);
  });
});

describe('constantes (docs/vod.md §11.5)', () => {
  it('presupuesto de vodStream (§9.12): pasos ≤ tope del servidor ≤ plazo de la web − 10 s < nginx /api/', () => {
    const steps =
      VOD_TIMINGS.accountGateMs +
      VOD_TIMINGS.closePreviousMs +
      VOD_TIMINGS.socketReleaseMs +
      VOD_TIMINGS.indexMs;
    expect(steps).toBeLessThanOrEqual(VOD_TIMINGS.grantMs);
    expect(VOD_TIMINGS.grantMs).toBeLessThanOrEqual(VOD_CLIENT.streamMs - 10_000);
    /* El `proxy_read_timeout` de `location /api/` (no el de /api/v1/events ni el de vídeo). */
    const conf = readFileSync(NGINX_CONF, 'utf8');
    const block = /location \/api\/ \{([\s\S]*?)\n {2}\}/.exec(conf)?.[1] ?? '';
    const seconds = Number(/proxy_read_timeout (\d+)s;/.exec(block)?.[1]);
    expect(seconds).toBeGreaterThan(0);
    expect(VOD_CLIENT.streamMs).toBeLessThan(seconds * 1000);
  });

  it('extensiones y motivos en listas cerradas, sin repetidos', () => {
    expect(new Set(VOD_EXTENSIONS).size).toBe(VOD_EXTENSIONS.length);
    expect(VOD_EXTENSIONS).toEqual(['mp4', 'mkv', 'm4v', 'mov', 'avi', 'ts', 'webm']);
    expect(VOD_UNSUPPORTED_REASONS).toEqual(['formato', 'video', 'hevc', 'indice', 'sin_saltos']);
  });
});

describe('idiomas (docs/vod.md §4.10)', () => {
  it('castellano y latino son idiomas distintos, y el orden del selector está fijado', () => {
    expect(VOD_LANGS).toEqual([
      'castellano',
      'latino',
      'vose',
      'ingles',
      'frances',
      'italiano',
      'aleman',
      'portugues',
      'catalan',
      'otros',
    ]);
  });

  it('la tarjeta lleva sus idiomas (opcionales: un servidor anterior no los manda)', () => {
    const card = WEB_V1_FIXTURES.vodHome.newMovies[0];
    expect(VodCardSchema.safeParse(card).success).toBe(true);
    const { langs: _langs, ...old } = card as z.infer<typeof VodCardSchema>;
    expect(VodCardSchema.safeParse(old).success).toBe(true);
    expect(VodCardSchema.safeParse({ ...card, langs: ['klingon'] }).success).toBe(false);
  });

  it('el filtro va en la URL: `langs` solo con idiomas conocidos y `unknown` 0/1', () => {
    expect(VodHomeQuerySchema.parse({})).toEqual({});
    expect(VodHomeQuerySchema.parse({ langs: 'castellano,frances', unknown: '0' })).toEqual({
      langs: 'castellano,frances',
      unknown: '0',
    });
    expect(VodHomeQuerySchema.safeParse({ langs: 'es' }).success).toBe(false);
    expect(VodHomeQuerySchema.safeParse({ unknown: 'si' }).success).toBe(false);
    const browse = VodBrowseQuerySchema.parse({ kind: 'series', langs: 'latino', q: 'coco' });
    expect(browse.langs).toBe('latino');
    expect(browse.unknown).toBeUndefined();
  });

  it('la elección: sin elegir, elegida y el cuerpo de PUT', () => {
    expect(
      VodLanguagesSchema.safeParse(VARIANT_FIXTURES['vodLanguagesGet.sin-elegir']).success,
    ).toBe(true);
    expect(VodLanguagesSchema.safeParse(WEB_V1_FIXTURES.vodLanguagesGet).success).toBe(true);
    expect(VodLanguagesBodySchema.safeParse({ langs: [], unknown: true }).success).toBe(true);
    expect(
      VodLanguagesBodySchema.safeParse({ langs: ['castellano', 'latino'], unknown: false }).success,
    ).toBe(true);
    expect(VodLanguagesBodySchema.safeParse({ langs: ['es'], unknown: true }).success).toBe(false);
    expect(VodLanguagesBodySchema.safeParse({ langs: [] }).success).toBe(false);
    expect(V2_FILES.vodLanguages).toBe('v2/vod-idiomas.json');
  });

  it('«3 en latino · Ver»: lo que queda fuera por idioma valida', () => {
    const hidden = VARIANT_FIXTURES['vodBrowse.otros-idiomas'];
    expect(VodBrowseResponseSchema.safeParse(hidden).success).toBe(true);
    expect(hidden.otherLangs?.langs[0]).toEqual({ lang: 'latino', count: 3 });
  });
});

describe('topes del catálogo (M5)', () => {
  it('margen ×2 sobre el panel de Isma (181.210 películas y 48.797 series) y las listas caben', () => {
    expect(VOD_LIMITS.maxMovies).toBeGreaterThanOrEqual(2 * 181_210);
    expect(VOD_LIMITS.maxSeries).toBeGreaterThanOrEqual(2 * 48_797);
    /* Medido: 66,6 MB las películas y 50,6 MB las series. */
    expect(VOD_LIMITS.movies.maxBytes).toBeGreaterThan((VOD_LIMITS.maxMovies / 181_210) * 66.6e6);
    expect(VOD_LIMITS.series.maxBytes).toBeGreaterThan((VOD_LIMITS.maxSeries / 48_797) * 50.6e6);
  });
});
