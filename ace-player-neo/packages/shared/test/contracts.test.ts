/* Contratos de /api/v1: la tabla de rutas es coherente, cada respuesta JSON
   tiene su ejemplo en fixtures/ y valida, y docs/openapi-v2.yaml está al día
   con la tabla (lo que se commitea es exactamente lo que genera el script). */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiErrorSchema,
  BootstrapResponseSchema,
  COMMON_V1_ERRORS,
  ERROR_CATALOG,
  HashSchema,
  IPTV_ERROR_CODES,
  IPTV_MAX_CANDIDATES,
  IPTV_REASONS,
  IPTV_BROWSE,
  IPTV_SEARCH,
  IptvBrowseChannelSchema,
  IptvBrowseQuerySchema,
  IptvBrowseResponseSchema,
  IptvCategorySchema,
  IptvChannelSchema,
  IptvChannelsQuerySchema,
  IptvChannelsResponseSchema,
  IptvFileSchema,
  IptvSaveBodySchema,
  IptvStatusSchema,
  IptvUpdateBodySchema,
  IptvViewSchema,
  LibraryViewSchema,
  NATIVE_PUBLIC_ROUTE_IDS,
  PairingCreateBodySchema,
  ResolutionCandidateSchema,
  ResolveQuerySchema,
  SSE_EVENT_TYPES,
  SearchResultSchema,
  SseEventSchema,
  StreamGrantSchema,
  V1_ROUTES,
  V1_ROUTE_IDS,
  VideoQuerySchema,
  WEB_ONLY_EVENT_TYPES,
  describeError,
  errorMessage,
  isErrorCode,
  listV1Routes,
  nativePath,
  toOpenApiPath,
} from '../src/index.js';
import {
  FIXTURES_DIR,
  NON_JSON_ROUTE_IDS,
  VARIANT_FIXTURES,
  WEB_FIXTURE_ROUTE_IDS,
  WEB_V1_FIXTURES,
  fixtureFiles,
  type JsonRouteId,
} from '../scripts/fixtures.js';
import { OPENAPI_FILE, renderOpenApi } from '../scripts/openapi.js';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES_DIR, rel), 'utf8'));

describe('tabla de rutas v1', () => {
  const routes = listV1Routes();

  it('no hay dos rutas con el mismo método y ruta', () => {
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todas cuelgan de /api/v1 y tienen su gemela en /native', () => {
    for (const route of routes) {
      expect(route.path.startsWith('/api/v1/')).toBe(true);
      expect(nativePath(route.path)).toBe(`/native${route.path}`);
    }
  });

  it('solo ping y el canje del código van sin credencial desde /native (arquitectura §5.12)', () => {
    expect([...NATIVE_PUBLIC_ROUTE_IDS].sort()).toEqual(['pairingClaim', 'ping']);
    expect(V1_ROUTES.ping.method).toBe('GET');
    expect(V1_ROUTES.pairingClaim.method).toBe('POST');
  });

  it('las mutaciones y los GET con efectos pasan por la regla anti-CSRF', () => {
    for (const route of routes) {
      if (route.method !== 'GET') expect(route.sideEffects, route.id).toBe(true);
    }
    expect(V1_ROUTES.channelStream.sideEffects).toBe(true);
    expect(V1_ROUTES.footballResolve.sideEffects).toBe(true);
  });

  it('los parámetros de la ruta coinciden con su esquema de params', () => {
    for (const route of routes) {
      const names = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      const shape = route.params
        ? Object.keys((route.params as unknown as { shape: object }).shape)
        : [];
      expect(shape.sort(), route.id).toEqual(names.sort());
    }
  });

  it('solo SSE, vídeo y los PNG de escudos y logos responden sin JSON', () => {
    const sinJson = routes.filter((route) => route.response === null).map((route) => route.id);
    expect(sinJson.sort()).toEqual([...NON_JSON_ROUTE_IDS].sort());
  });

  it('todos los errores citados existen en el catálogo', () => {
    for (const route of routes)
      for (const code of route.errors) expect(isErrorCode(code)).toBe(true);
    for (const code of COMMON_V1_ERRORS) expect(isErrorCode(code)).toBe(true);
  });

  it('toOpenApiPath convierte :param en {param}', () => {
    expect(toOpenApiPath('/api/v1/video/:sid/:file')).toBe('/api/v1/video/{sid}/{file}');
  });
});

describe('PairingCreateBodySchema (0.8.1: varias direcciones en el QR)', () => {
  const ok = (body: unknown) => PairingCreateBodySchema.safeParse(body).success;

  it('acepta sin nada, con baseUrl y con hasta dos alternativas', () => {
    expect(ok({})).toBe(true);
    expect(ok({ baseUrl: 'http://umbrel.local:7792' })).toBe(true);
    expect(
      ok({
        baseUrl: 'http://umbrel.local:7792',
        alternateBaseUrls: ['https://umbrel.tail1234.ts.net', 'http://192.168.1.10:7792'],
      }),
    ).toBe(true);
  });

  it('rechaza 3 alternativas, una con ruta o con ? y un campo de más', () => {
    const base = 'http://umbrel.local:7792';
    expect(ok({ baseUrl: base, alternateBaseUrls: ['http://a', 'http://b', 'http://c'] })).toBe(
      false,
    );
    expect(ok({ baseUrl: base, alternateBaseUrls: ['http://a/b'] })).toBe(false);
    expect(ok({ baseUrl: base, alternateBaseUrls: ['http://a?x=1'] })).toBe(false);
    expect(ok({ baseUrl: base, extra: true })).toBe(false);
  });
});

describe('catálogo de errores', () => {
  it('cada código tiene HTTP de error y mensaje en español', () => {
    for (const [code, definition] of Object.entries(ERROR_CATALOG)) {
      expect(definition.status, code).toBeGreaterThanOrEqual(400);
      expect(definition.message.length, code).toBeGreaterThan(0);
      if (definition.legacyStatus !== null)
        expect(definition.legacyStatus, code).toBeGreaterThanOrEqual(400);
    }
  });

  it('http_NNN: 400 en las rutas antiguas y 502 en v1 (api.md §2.6)', () => {
    expect(describeError('http_429')).toMatchObject({ status: 502, legacyStatus: 400 });
    expect(describeError('http_abc')).toBeNull();
    expect(errorMessage('no_existe')).toBe(ERROR_CATALOG.internal_error.message);
  });
});

describe('ejemplos de fixtures/ (reparto de docs/iptv.md §5.7)', () => {
  const files = fixtureFiles();
  const namesIn = (sub: string) =>
    readdirSync(path.join(FIXTURES_DIR, sub)).map((file) => file.replace(/\.json$/, ''));
  const webRoutes: readonly string[] = WEB_FIXTURE_ROUTE_IDS;
  const jsonRoutes = V1_ROUTE_IDS.filter((id) => !NON_JSON_ROUTE_IDS.includes(id));
  /** Carpeta del ejemplo de una ruta JSON. */
  const fixtureOf = (id: string) =>
    webRoutes.includes(id) ? `web/v1/${id}.json` : `v1/${id}.json`;
  const eventOf = (type: string) =>
    WEB_ONLY_EVENT_TYPES.has(type as never) ? `web/events/${type}.json` : `events/${type}.json`;

  it('v1/ = rutas JSON menos las solo web con ejemplo aparte; web/v1/ = esas; ninguno sobra', () => {
    expect(namesIn('v1').sort()).toEqual(jsonRoutes.filter((id) => !webRoutes.includes(id)).sort());
    expect(namesIn('web/v1').sort()).toEqual([...webRoutes].sort());
    /* Las de web/v1/ son rutas JSON solo web (la app no las llama). */
    for (const id of webRoutes) {
      expect(jsonRoutes, id).toContain(id);
      expect(V1_ROUTES[id as JsonRouteId].access, id).toBe('web');
    }
  });

  it('events/ = eventos menos los solo web; web/events/ = los solo web; ninguno sobra', () => {
    const shared = SSE_EVENT_TYPES.filter((type) => !WEB_ONLY_EVENT_TYPES.has(type));
    expect(namesIn('events').sort()).toEqual([...shared].sort());
    expect(namesIn('web/events').sort()).toEqual([...WEB_ONLY_EVENT_TYPES].sort());
  });

  it('lo que hay en disco es lo que genera scripts/fixtures.ts', () => {
    for (const [rel, value] of files) {
      expect(existsSync(path.join(FIXTURES_DIR, rel)), rel).toBe(true);
      expect(readJson(rel), rel).toEqual(JSON.parse(JSON.stringify(value)));
    }
    /* Y no hay variantes de más en disco. */
    const variants = [...files.keys()].filter((rel) => rel.startsWith('variantes/'));
    expect(
      namesIn('variantes')
        .map((name) => `variantes/${name}.json`)
        .sort(),
    ).toEqual(variants.sort());
  });

  it('cada respuesta de ejemplo valida con el esquema de su ruta', () => {
    for (const id of jsonRoutes) {
      const schema = V1_ROUTES[id as JsonRouteId].response;
      const result = schema.safeParse(readJson(fixtureOf(id)));
      expect(result.success ? 'ok' : result.error.message, id).toBe('ok');
    }
  });

  it('cada variante valida con el esquema de la ruta que va antes del primer punto', () => {
    const names = namesIn('variantes');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const id = name.split('.')[0] ?? '';
      expect(jsonRoutes, name).toContain(id);
      const schema = V1_ROUTES[id as JsonRouteId].response;
      const result = schema.safeParse(readJson(`variantes/${name}.json`));
      expect(result.success ? 'ok' : result.error.message, name).toBe('ok');
    }
  });

  it('cada evento de ejemplo valida con el esquema SSE', () => {
    for (const type of SSE_EVENT_TYPES) {
      const result = SseEventSchema.safeParse(readJson(eventOf(type)));
      expect(result.success ? 'ok' : result.error.message, type).toBe('ok');
    }
  });

  it('lo que ve la app no cambia con la IPTV: bootstrap, footballResolve y channelStream', () => {
    const bootstrap = readJson('v1/bootstrap.json') as { features: Record<string, unknown> };
    expect(Object.keys(bootstrap.features).sort()).toEqual(['ai', 'demoSchedule', 'scanner']);
    const resolve = readJson('v1/footballResolve.json') as {
      candidates: { source: string; iptv?: unknown }[];
      checked: string[];
    };
    expect(resolve.checked).not.toContain('iptv');
    for (const candidate of resolve.candidates) {
      expect(candidate.source).not.toBe('iptv');
      expect(candidate).not.toHaveProperty('iptv');
    }
    expect(readJson('v1/channelStream.json')).not.toHaveProperty('source');
  });

  it('el error de ejemplo valida', () => {
    expect(ApiErrorSchema.safeParse(readJson('errors/api-error.json')).success).toBe(true);
  });
});

describe('contrato de la IPTV (docs/iptv.md §5)', () => {
  const iptvResolve = VARIANT_FIXTURES['footballResolve.iptv'];
  const iptvCandidate = iptvResolve.candidates[0]!;

  it('una candidata IPTV es una candidata más: source iptv, id de 40 hex y su campo iptv', () => {
    expect(ResolutionCandidateSchema.safeParse(iptvCandidate).success).toBe(true);
    expect(HashSchema.safeParse(iptvCandidate.id).success).toBe(true);
    const bad = (iptv: unknown) =>
      ResolutionCandidateSchema.safeParse({ ...iptvCandidate, iptv }).success;
    expect(bad({ ...iptvCandidate.iptv, url: 'http://x' })).toBe(false);
    expect(bad({ ...iptvCandidate.iptv, quality: '8k' })).toBe(false);
    expect(bad({ ...iptvCandidate.iptv, provider: 'x'.repeat(41) })).toBe(false);
    /* Opcional: las candidatas de siempre no lo llevan. */
    const { iptv: _iptv, ...plain } = iptvCandidate;
    expect(ResolutionCandidateSchema.safeParse({ ...plain, source: 'm3u' }).success).toBe(true);
  });

  it('la variante de la resolución: IPTV primero (guía y nombre, un cartel por resolución, 4 como mucho) y luego AceStream', () => {
    const sources = iptvResolve.candidates.map((candidate) => candidate.source);
    expect(sources).toEqual(['iptv', 'iptv', 'iptv', 'm3u', 'acestream']);
    expect(sources.filter((source) => source === 'iptv').length).toBeLessThanOrEqual(
      IPTV_MAX_CANDIDATES,
    );
    expect(iptvResolve.candidates[0]?.iptv?.guide).toBe(true);
    expect(iptvResolve.candidates[1]?.iptv?.guide).toBe(false);
    /* Las variantes de resolución del mismo canal: 1080p y luego 720p (§17). */
    expect(iptvResolve.candidates.slice(1, 3).map((candidate) => candidate.iptv?.quality)).toEqual([
      'fhd',
      'hd',
    ]);
    expect(iptvResolve.candidate).toEqual(iptvResolve.candidates[0]);
    expect(iptvResolve.checked).toContain('iptv');
  });

  it('IptvSaveBody: ausente = el guardado; claves de más, tipos cruzados o secretos vacíos no pasan', () => {
    const ok = (body: unknown) => IptvSaveBodySchema.safeParse(body).success;
    expect(ok({ kind: 'm3u', name: 'Casa', url: 'https://proveedor.example/lista.m3u' })).toBe(
      true,
    );
    expect(ok({ kind: 'm3u' })).toBe(true);
    expect(
      ok({
        kind: 'xtream',
        name: 'Casa',
        server: 'http://proveedor.example:8080',
        username: 'usuario',
        password: 'clave',
      }),
    ).toBe(true);
    expect(ok({ kind: 'xtream', name: 'Otro nombre' })).toBe(true);
    expect(ok({ kind: 'xtream', url: 'https://proveedor.example/lista.m3u' })).toBe(false);
    expect(ok({ kind: 'm3u', password: 'clave' })).toBe(false);
    expect(ok({ kind: 'm3u', url: 'https://x', extra: true })).toBe(false);
    expect(ok({ kind: 'xtream', password: '' })).toBe(false);
    expect(ok({ kind: 'xtream', name: '   ' })).toBe(false);
    expect(ok({ kind: 'xtream', name: 'x'.repeat(41) })).toBe(false);
    expect(ok({ kind: 'rtmp' })).toBe(false);
    expect(IptvSaveBodySchema.parse({ kind: 'm3u', name: '  Casa  ' }).name).toBe('Casa');
  });

  it('IptvUpdateBody: solo enabled y name', () => {
    expect(IptvUpdateBodySchema.safeParse({ enabled: false }).success).toBe(true);
    expect(IptvUpdateBodySchema.safeParse({ name: 'Casa' }).success).toBe(true);
    expect(IptvUpdateBodySchema.safeParse({ enabled: true, password: 'x' }).success).toBe(false);
  });

  it('ninguna respuesta ni evento IPTV tiene un campo url, username ni password', () => {
    const forbidden = new Set(['url', 'username', 'password', 'secret', 'server']);
    const keysOf = (node: unknown, found: Set<string>): Set<string> => {
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
    };
    for (const [name, schema] of [
      ['IptvView', IptvViewSchema],
      ['IptvStatus', IptvStatusSchema],
      ['candidata', ResolutionCandidateSchema],
    ] as const) {
      const keys = keysOf(z.toJSONSchema(schema, { io: 'output' }), new Set());
      expect(
        [...keys].filter((key) => forbidden.has(key)),
        name,
      ).toEqual([]);
    }
  });

  it('iptv.status es un evento solo web (y el único)', () => {
    expect(SSE_EVENT_TYPES).toContain('iptv.status');
    expect([...WEB_ONLY_EVENT_TYPES]).toEqual(['iptv.status']);
  });

  it('7 rutas solo web del módulo iptv (las 5 de Ajustes, el buscador y la pestaña), sin iptvTest; video pasa a any con t opcional', () => {
    const iptv = listV1Routes().filter((route) => route.module === 'iptv');
    expect(iptv.map((route) => `${route.id} ${route.method} ${route.path}`)).toEqual([
      'iptvGet GET /api/v1/iptv',
      'iptvSave PUT /api/v1/iptv',
      'iptvUpdate PATCH /api/v1/iptv',
      'iptvSync POST /api/v1/iptv/sync',
      'iptvDelete DELETE /api/v1/iptv',
      'iptvChannels GET /api/v1/iptv/channels',
      'iptvBrowse GET /api/v1/iptv/browse',
    ]);
    for (const route of iptv) {
      expect(route.access, route.id).toBe('web');
      expect(route.credential, route.id).toBe('bearer');
    }
    expect(V1_ROUTE_IDS).not.toContain('iptvTest');
    expect(V1_ROUTES.video).toMatchObject({ access: 'any', credential: 'video-token' });
    expect(VideoQuerySchema.safeParse({}).success).toBe(true);
    expect(VideoQuerySchema.safeParse({ t: 'corto' }).success).toBe(false);
    for (const code of ['iptv_gone', 'iptv_disabled', 'iptv_removed'] as const) {
      expect(V1_ROUTES.channelStream.errors).toContain(code);
    }
  });

  it('16 códigos iptv_*, públicos, sin estado antiguo y con el HTTP del diseño', () => {
    expect(IPTV_ERROR_CODES).toHaveLength(16);
    const statuses = Object.fromEntries(
      IPTV_ERROR_CODES.map((code) => [code, ERROR_CATALOG[code].status]),
    );
    expect(statuses).toEqual({
      iptv_not_configured: 409,
      iptv_disabled: 409,
      iptv_removed: 410,
      iptv_credentials_required: 400,
      iptv_secret_unreadable: 409,
      iptv_auth_failed: 502,
      iptv_account_expired: 502,
      iptv_unreachable: 502,
      iptv_timeout: 504,
      iptv_busy: 503,
      iptv_gone: 404,
      iptv_dropped: 502,
      iptv_unsupported: 422,
      iptv_bad_list: 422,
      iptv_empty: 422,
      iptv_too_large: 502,
    });
    for (const code of IPTV_ERROR_CODES) {
      expect(ERROR_CATALOG[code].public, code).toBe(true);
      expect(ERROR_CATALOG[code].legacyStatus, code).toBeNull();
    }
  });

  it('motivos IPTV: códigos del catálogo y sin iptv_ready', () => {
    expect(IPTV_REASONS).not.toContain('iptv_ready');
    for (const reason of IPTV_REASONS) expect(isErrorCode(reason), reason).toBe(true);
  });

  it('campos opcionales nuevos: features.iptv, scope, source de la concesión', () => {
    const bootstrap = readJson('v1/bootstrap.json') as { features: object };
    const withIptv = { ...bootstrap, features: { ...bootstrap.features, iptv: true } };
    expect(BootstrapResponseSchema.safeParse(withIptv).success).toBe(true);
    expect(ResolveQuerySchema.safeParse({ channel: 'Antena 3', scope: 'channel' }).success).toBe(
      true,
    );
    expect(ResolveQuerySchema.safeParse({ scope: 'todo' }).success).toBe(false);
    const grant = VARIANT_FIXTURES['channelStream.iptv'];
    expect(grant).toMatchObject({ protocol: 'hls', source: 'iptv', remux: true });
    expect(grant.url).toMatch(/^\/api\/v1\/video\/s_[A-Za-z0-9_-]+\/index\.m3u8$/);
    expect(StreamGrantSchema.safeParse({ ...grant, source: 'otro' }).success).toBe(false);
  });

  it('v2/iptv.json: sin IPTV, con proveedor y sin listas de ids', () => {
    expect(IptvFileSchema.safeParse({ version: 1, provider: null }).success).toBe(true);
    const provider = {
      id: 'p_Ab3dE5gH',
      revision: 3,
      kind: 'xtream',
      name: 'Casa',
      enabled: true,
      host: 'proveedor.example:8080',
      origin: 'http://proveedor.example:8080',
      secret: { alg: 'A256GCM', iv: 'A'.repeat(16), tag: 'B'.repeat(22), data: 'Q2lmcmFkbw' },
      createdAt: '2026-09-23T18:30:00.000Z',
      updatedAt: '2026-09-23T18:30:00.000Z',
      lastSync: null,
      guide: null,
      account: null,
    };
    expect(IptvFileSchema.safeParse({ version: 1, provider }).success).toBe(true);
    expect(
      IptvFileSchema.safeParse({ version: 1, provider: { ...provider, retiredIds: [] } }).success,
    ).toBe(false);
    expect(
      IptvFileSchema.safeParse({ version: 1, provider: { ...provider, id: 'p_corto' } }).success,
    ).toBe(false);
  });
});

describe('buscador: IPTV y AceStream juntos (docs/iptv.md §14.2)', () => {
  const keysOf = (node: unknown, found: Set<string>): Set<string> => {
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
  };

  it('iptvChannels: ruta web del módulo iptv con empty_query; la respuesta de ejemplo valida', () => {
    expect(V1_ROUTES.iptvChannels).toMatchObject({
      method: 'GET',
      path: '/api/v1/iptv/channels',
      access: 'web',
      module: 'iptv',
      errors: ['empty_query'],
    });
    expect(WEB_FIXTURE_ROUTE_IDS).toHaveLength(7);
    expect(WEB_FIXTURE_ROUTE_IDS).toContain('iptvChannels');
    const example = WEB_V1_FIXTURES.iptvChannels;
    expect(IptvChannelsResponseSchema.safeParse(example).success).toBe(true);
    expect(example.channels.length).toBeLessThanOrEqual(IPTV_SEARCH.limit);
  });

  it('IptvChannelsQuery: q por defecto vacía, limit de 1 a 50 y nada más', () => {
    expect(IptvChannelsQuerySchema.parse({})).toEqual({ q: '' });
    expect(IptvChannelsQuerySchema.parse({ q: 'tele', limit: '10' }).limit).toBe(10);
    expect(IptvChannelsQuerySchema.safeParse({ q: 'tele', limit: '51' }).success).toBe(false);
    expect(IptvChannelsQuerySchema.safeParse({ q: 'tele', limit: '0' }).success).toBe(false);
    expect(IptvChannelsQuerySchema.safeParse({ q: 'tele', grupo: 'x' }).success).toBe(false);
  });

  it('un canal IPTV del buscador no lleva nada del proveedor: ni url, ref, streamId, tvgId ni group', () => {
    const keys = keysOf(z.toJSONSchema(IptvChannelsResponseSchema, { io: 'output' }), new Set());
    for (const forbidden of [
      'url',
      'ref',
      'streamId',
      'stream_id',
      'tvgId',
      'group',
      'username',
      'password',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    const channel = WEB_V1_FIXTURES.iptvChannels.channels[0]!;
    expect(IptvChannelSchema.safeParse({ ...channel, url: 'http://x' }).success).toBe(false);
    expect(IptvChannelSchema.safeParse({ ...channel, group: 'ES | DEPORTES' }).success).toBe(false);
    expect(
      IptvChannelSchema.safeParse({ ...channel, library: Array(21).fill(channel.id) }).success,
    ).toBe(false);
  });

  it('iptvBrowse: ruta web del módulo iptv; el ejemplo de la raíz y las 3 variantes validan', () => {
    expect(V1_ROUTES.iptvBrowse).toMatchObject({
      method: 'GET',
      path: '/api/v1/iptv/browse',
      access: 'web',
      credential: 'bearer',
      module: 'iptv',
      sideEffects: false,
    });
    expect(WEB_FIXTURE_ROUTE_IDS).toContain('iptvBrowse');
    const root = WEB_V1_FIXTURES.iptvBrowse;
    expect(IptvBrowseResponseSchema.safeParse(root).success).toBe(true);
    expect(root.channels).toEqual([]);
    expect(root.categories?.length).toBeGreaterThan(0);
    for (const name of [
      'iptvBrowse.categoria',
      'iptvBrowse.inactiva',
      'iptvBrowse.categoria-perdida',
    ] as const) {
      expect(IptvBrowseResponseSchema.safeParse(VARIANT_FIXTURES[name]).success, name).toBe(true);
    }
    expect(VARIANT_FIXTURES['iptvBrowse.categoria'].nextCursor).not.toBe(null);
    expect(VARIANT_FIXTURES['iptvBrowse.inactiva'].active).toBe(false);
    expect(VARIANT_FIXTURES['iptvBrowse.categoria-perdida'].category).toBe(null);
  });

  it('IptvBrowseQuery: listas de 1 a 16, códigos con su forma, limit de 0 a 100 y nada más', () => {
    expect(IptvBrowseQuerySchema.parse({})).toEqual({ q: '' });
    expect(IptvBrowseQuerySchema.safeParse({ country: 'ES' }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ country: 'ES,UK,LAT,EXYU,none' }).success).toBe(true);
    const codes = Array.from({ length: 16 }, (_, i) => `A${String.fromCharCode(65 + i)}`);
    expect(IptvBrowseQuerySchema.safeParse({ country: codes.join(',') }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ country: [...codes, 'ZZ'].join(',') }).success).toBe(
      false,
    );
    expect(IptvBrowseQuerySchema.safeParse({ country: 'es' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ country: 'ES,' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ language: 'es,en,none' }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ language: 'ES' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ type: 'cine,none' }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ type: 'peliculas' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ sport: 'futbol,f1,futbol-americano' }).success).toBe(
      true,
    );
    expect(IptvBrowseQuerySchema.safeParse({ sport: 'none' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ quality: 'uhd,fhd,hd,sd,none' }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ quality: '4k' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.parse({ limit: '0' }).limit).toBe(0);
    expect(
      IptvBrowseQuerySchema.safeParse({ limit: String(IPTV_BROWSE.limitMax + 1) }).success,
    ).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ cursor: 'bWZ6M2sxYTAxLjM' }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ cursor: 'no+vale/=' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ category: 'none' }).success).toBe(true);
    expect(IptvBrowseQuerySchema.safeParse({ category: 'ES | DAZN' }).success).toBe(false);
    expect(IptvBrowseQuerySchema.safeParse({ grupo: 'x' }).success).toBe(false);
  });

  it('una fila o una categoría de la pestaña no lleva nada del proveedor: ni url, ref, streamId, tvgId ni group', () => {
    const keys = keysOf(z.toJSONSchema(IptvBrowseResponseSchema, { io: 'output' }), new Set());
    for (const forbidden of [
      'url',
      'ref',
      'streamId',
      'stream_id',
      'tvgId',
      'epg_channel_id',
      'group',
      'username',
      'password',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    const channel = VARIANT_FIXTURES['iptvBrowse.categoria'].channels[0]!;
    expect(IptvBrowseChannelSchema.safeParse({ ...channel, url: 'http://x' }).success).toBe(false);
    expect(IptvBrowseChannelSchema.safeParse({ ...channel, tvgId: 'DAZN1.es' }).success).toBe(
      false,
    );
    expect(IptvBrowseChannelSchema.safeParse({ ...channel, qualities: ['4k'] }).success).toBe(
      false,
    );
    expect(IptvCategorySchema.safeParse({ id: 'none', name: '', count: 0, url: 'x' }).success).toBe(
      false,
    );
  });

  it('ApiError puede decir cuántos intentos hizo el servidor (Guardar IPTV, §16.8); el ejemplo no lo lleva', () => {
    const base = { error: { code: 'iptv_unreachable', message: 'x', requestId: 'r' } };
    expect(ApiErrorSchema.safeParse(base).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { ...base.error, attempts: 2 } }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { ...base.error, attempts: 1 } }).success).toBe(false);
    expect(readJson('errors/api-error.json')).not.toHaveProperty('error.attempts');
  });

  it('SearchResult con y sin iptv; v1/search.json sigue sin iptv', () => {
    const plain = (readJson('v1/search.json') as { results: object[] }).results;
    for (const result of plain) {
      expect(result).not.toHaveProperty('iptv');
      expect(SearchResultSchema.safeParse(result).success).toBe(true);
    }
    const withIptv = VARIANT_FIXTURES['search.iptv'].results;
    expect(withIptv.filter((result) => 'iptv' in result)).toHaveLength(2);
    for (const result of withIptv) expect(SearchResultSchema.safeParse(result).success).toBe(true);
    expect(SearchResultSchema.safeParse({ ...withIptv[0], iptv: 'corto' }).success).toBe(false);
  });

  it('ResolveQuery con iptv y engine', () => {
    const iptv = WEB_V1_FIXTURES.iptvChannels.channels[0]!.id;
    expect(
      ResolveQuerySchema.safeParse({ channel: 'Telecinco', scope: 'channel', iptv, engine: '1' })
        .success,
    ).toBe(true);
    expect(ResolveQuerySchema.safeParse({ channel: 'x', engine: 'si' }).success).toBe(false);
    expect(ResolveQuerySchema.safeParse({ channel: 'x', iptv: 'no-es-un-hash' }).success).toBe(
      false,
    );
  });

  it('LibraryView con y sin iptvIds; v1/libraryGet.json sigue sin iptvIds', () => {
    const plain = readJson('v1/libraryGet.json');
    expect(plain).not.toHaveProperty('iptvIds');
    expect(LibraryViewSchema.safeParse(plain).success).toBe(true);
    const withIds = VARIANT_FIXTURES['libraryGet.iptv'];
    expect(LibraryViewSchema.safeParse(withIds).success).toBe(true);
    expect(Object.values(withIds.iptvIds ?? {}).sort()).toEqual(['iptv_gone', 'ok']);
    expect(
      LibraryViewSchema.safeParse({ ...withIds, iptvIds: { [firstFavoriteId(withIds)]: 'raro' } })
        .success,
    ).toBe(false);
  });

  it('la variante del canal solo de la IPTV: su IPTV primera y detrás AceStream del motor ≥ 92', () => {
    const resolution = VARIANT_FIXTURES['footballResolve.iptv-canal'];
    expect(resolution.candidates.map((candidate) => candidate.source)).toEqual([
      'iptv',
      'acestream',
      'acestream',
    ]);
    for (const candidate of resolution.candidates.slice(1)) {
      expect(candidate.score).toBeGreaterThanOrEqual(92);
    }
  });
});

/** Un id de favorito de la variante (para probar valores de iptvIds que no valen). */
function firstFavoriteId(view: { favorites: readonly { id: string }[] }): string {
  return view.favorites[0]!.id;
}

describe('docs/openapi-v2.yaml', () => {
  const onDisk = readFileSync(OPENAPI_FILE, 'utf8').replace(/\r\n/g, '\n');

  it('coincide con lo que genera scripts/openapi.ts (si falla: pnpm --filter @ace/shared openapi)', () => {
    expect(onDisk).toBe(renderOpenApi());
  });

  it('lleva todas las operaciones de la tabla', () => {
    for (const route of listV1Routes()) {
      expect(onDisk).toContain(`operationId: ${route.id}\n`);
    }
  });
});
