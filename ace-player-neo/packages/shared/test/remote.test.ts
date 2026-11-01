// El dominio de fuera, tv.ismaeloul.es (docs/acceso-remoto.md, «Por el dominio»): la tabla de
// rutas decide qué pasa por él (`remote`) y de ahí salen las expresiones de Caddy.
import { describe, expect, it } from 'vitest';
import {
  DeviceRemoteBodySchema,
  REMOTE_BEARER_RE,
  REMOTE_BLOCK_KEY_RE,
  REMOTE_LIMITS,
  RemoteAccessFileSchema,
  RemoteIpSchema,
  V1_ROUTES,
  V1_ROUTE_IDS,
  assertRe2Safe,
  paramPattern,
  remoteBearerRouteIds,
  remoteCaddyPatterns,
  remoteVideoPattern,
  renderRemoteCaddyMatchers,
  type V1RouteDefinition,
  type V1RouteId,
} from '../src/index.js';
import { maxJsonBytes } from './remote-body-size.js';

const ROUTES = V1_ROUTE_IDS.map((id) => [id, V1_ROUTES[id] as V1RouteDefinition] as const);

/** Lo que el diseño deja pasar (docs/acceso-remoto.md): si cambia, que sea a propósito. */
const ALLOWED: readonly V1RouteId[] = [
  'ping',
  'bootstrap',
  'health',
  'events',
  'engineStatus',
  'engineRestart',
  'channelStream',
  'sessionHeartbeat',
  'sessionRelease',
  'playbackStatus',
  'video',
  'settingsGet',
  'iptvGet',
  'iptvChannels',
  'iptvBrowse',
  'iptvGuide',
  'iptvGuideProgrammes',
  'iptvGuideProgramme',
  'iptvGuideNow',
  'iptvGuideArt',
  'vodHome',
  'vodBrowse',
  'vodTitle',
  'vodArt',
  'vodStream',
  'vodDownload',
  'vodProgress',
  'vodLanguagesGet',
  'vodLanguagesUpdate',
  'vodListGet',
  'vodListAdd',
  'vodListRemove',
  'diagnosticsReport',
  'libraryGet',
  'libraryMutate',
  'preferencesGet',
  'preferencesUpdate',
  'directoriesGet',
  'footballSchedule',
  'footballResolve',
  'footballScan',
  'footballPreheat',
  'footballBind',
  'scores',
  'footballTeamCrest',
  'footballCompetitionLogo',
  'sourcesReport',
  'sourcesOutcome',
  'sourcesFeedback',
  'search',
];

describe('tabla de rutas: `remote` (el dominio de fuera)', () => {
  it('cada ruta lo decide: allow, allow-self o deny', () => {
    for (const [id, route] of ROUTES) {
      expect(['allow', 'allow-self', 'deny'], id).toContain(route.remote);
    }
  });

  it('la lista blanca es la del diseño; solo deviceRevoke es allow-self', () => {
    expect(ROUTES.filter(([, route]) => route.remote === 'allow').map(([id]) => id)).toEqual(
      ALLOWED,
    );
    expect(ROUTES.filter(([, route]) => route.remote === 'allow-self').map(([id]) => id)).toEqual([
      'deviceRevoke',
    ]);
  });

  it('toda ruta de sala (credential party) es deny: van por sala.ismaeloul.es', () => {
    const party = ROUTES.filter(([, route]) => route.credential === 'party');
    expect(party.length).toBeGreaterThan(5);
    for (const [id, route] of party) expect(route.remote, id).toBe('deny');
    for (const id of ['partyCreate', 'partyClose', 'partyEnd', 'partyList'] as const) {
      expect(V1_ROUTES[id].remote, id).toBe('deny');
    }
  });

  it('toda ruta solo web es deny (y las 5 nuevas del dominio, también)', () => {
    for (const [id, route] of ROUTES) {
      if (route.access === 'web') expect(route.remote, id).toBe('deny');
    }
    for (const id of [
      'remoteGet',
      'remoteUpdate',
      'deviceRemoteUpdate',
      'remoteBlockDelete',
      'remoteBlocksClear',
    ] as const) {
      expect(V1_ROUTES[id]).toMatchObject({ access: 'web', remote: 'deny', module: 'remote' });
    }
  });

  it('ni emparejar, ni administrar aparatos, ni cambiar ajustes ni directorios por el dominio', () => {
    for (const id of [
      'pairingClaim',
      'pairingCreate',
      'devicesList',
      'settingsUpdate',
      'diagnosticsList',
      'directoriesSync',
      'directoriesUpload',
      'directoriesActivate',
      'directoriesDelete',
      'healthLive',
    ] as const) {
      expect(V1_ROUTES[id].remote, id).toBe('deny');
    }
  });
});

/** Valores con la forma válida de cada `:param` (los de deploy/test/caddy-allowlist.test.ts y más). */
const SAMPLE: Record<string, string> = {
  id: 'a'.repeat(40),
  sid: 's_Q2FuYWxEZVBydWViYQ',
  file: 'index.m3u8',
  art: 'poster',
  ref: 'c12',
  matchId: 'epg-1234',
  teamId: 'Real_Madrid',
  competitionId: 'laliga',
};
const SAMPLE_BY_ROUTE: Partial<Record<V1RouteId, Record<string, string>>> = {
  iptvGuideProgramme: { id: '12.345' },
  footballScan: { id: '0123456789abcdef01234567' },
  deviceRevoke: { id: 'dev_iphone01' },
};

function concrete(id: V1RouteId): string {
  const route: V1RouteDefinition = V1_ROUTES[id];
  return `/native${route.path}`.replace(/:([A-Za-z]+)/g, (_all, name: string) => {
    const value = SAMPLE_BY_ROUTE[id]?.[name] ?? SAMPLE[name];
    if (!value) throw new Error(`falta un valor de prueba para :${name}`);
    return value;
  });
}

describe('expresiones de Caddy (src/remote-caddy.ts)', () => {
  const patterns = remoteCaddyPatterns();
  const compiled = Object.fromEntries(
    Object.entries(patterns).map(([method, source]) => [
      method,
      source ? new RegExp(source) : null,
    ]),
  ) as Record<string, RegExp | null>;
  const video = new RegExp(remoteVideoPattern());

  function passes(method: string, url: string): boolean {
    return compiled[method]?.test(url) === true || (method === 'GET' && video.test(url));
  }

  it('son RE2 (sin lookaround ni referencias) y sin PATCH', () => {
    for (const source of Object.values(patterns)) if (source) assertRe2Safe(source);
    assertRe2Safe(remoteVideoPattern());
    assertRe2Safe(REMOTE_BEARER_RE);
    expect(Object.keys(patterns)).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
  });

  it('toda ruta allow/allow-self casa con su método, y con ningún otro', () => {
    for (const [id, route] of ROUTES) {
      if (route.remote === 'deny') continue;
      const url = concrete(id);
      expect({ id, pasa: passes(route.method, url) }).toEqual({ id, pasa: true });
      for (const other of ['GET', 'POST', 'PUT', 'DELETE']) {
        if (other === route.method) continue;
        /* Mismo camino y otro método: solo si otra ruta permitida lo usa (library GET/POST…). */
        const twin = ROUTES.some(
          ([, candidate]) =>
            candidate.remote !== 'deny' &&
            candidate.method === other &&
            candidate.path === route.path,
        );
        expect({ id, other, pasa: passes(other, url) }).toEqual({ id, other, pasa: twin });
      }
    }
  });

  it('ninguna ruta deny casa (salvo que comparta camino y método con una permitida)', () => {
    for (const [id, route] of ROUTES) {
      if (route.remote !== 'deny') continue;
      let url: string;
      try {
        url = concrete(id);
      } catch {
        url = `/native${route.path.replace(/:[A-Za-z]+/g, 'p1')}`;
      }
      const shared = ROUTES.some(
        ([, other]) =>
          other.remote !== 'deny' && other.method === route.method && other.path === route.path,
      );
      expect({ id, pasa: passes(route.method, url) }).toEqual({ id, pasa: shared });
    }
  });

  it('sin el prefijo /native, con otra versión o con algo detrás, no casa', () => {
    expect(passes('GET', '/api/v1/ping')).toBe(false);
    expect(passes('GET', '/native/api/v2/ping')).toBe(false);
    expect(passes('GET', '/native/api/v1/ping/')).toBe(false);
    expect(passes('GET', '/native/api/v1/pingx')).toBe(false);
    expect(passes('GET', '/NATIVE/api/v1/ping')).toBe(false);
    expect(passes('POST', '/native/api/v1/pairing/claim')).toBe(false);
    expect(passes('GET', `/native/api/v1/video/${SAMPLE.sid}/../../state`)).toBe(false);
  });

  it('cada :param acepta lo que acepta su esquema zod', () => {
    for (const [id, route] of ROUTES) {
      if (route.remote === 'deny' || !route.params) continue;
      const shape = (route.params as unknown as { shape: Record<string, never> }).shape;
      for (const [name, schema] of Object.entries(shape)) {
        const value = SAMPLE_BY_ROUTE[id]?.[name] ?? SAMPLE[name] ?? '';
        const re = new RegExp(`^${paramPattern(schema)}$`);
        expect({
          id,
          name,
          zod: (schema as { safeParse(v: unknown): { success: boolean } }).safeParse(value).success,
          caddy: re.test(value),
        }).toEqual({ id, name, zod: true, caddy: true });
        for (const bad of ['', 'a/b', 'x'.repeat(200)]) {
          const zodOk = (schema as { safeParse(v: unknown): { success: boolean } }).safeParse(
            bad,
          ).success;
          expect({ id, name, bad, caddy: re.test(bad) }).toEqual({
            id,
            name,
            bad,
            caddy: zodOk && !bad.includes('/'),
          });
        }
      }
    }
  });

  it('el Bearer: <deviceId>.<43 de base64url>, y nada más', () => {
    const re = new RegExp(REMOTE_BEARER_RE);
    expect(re.test(`Bearer dev_iphone01.${'A'.repeat(43)}`)).toBe(true);
    expect(re.test(`Bearer dev_iphone01.${'A'.repeat(42)}`)).toBe(false);
    expect(re.test(`bearer dev_iphone01.${'A'.repeat(43)}`)).toBe(false);
    expect(re.test(`Bearer dev.iphone.${'A'.repeat(43)}`)).toBe(false);
    expect(re.test(`Basic dXNlcjpwYXNz`)).toBe(false);
  });

  it('el trozo de tv-on.caddy sale entero y con las marcas', () => {
    const text = renderRemoteCaddyMatchers();
    expect(text).toContain('@get {');
    expect(text).toContain('@video {');
    expect(text).toContain('query t=*');
    expect(text).not.toContain('@patch');
    expect(remoteBearerRouteIds()).not.toContain('video');
  });
});

describe('cuerpos por el dominio', () => {
  it('cualquier cuerpo que admita una ruta permitida cabe en REMOTE_LIMITS.maxBodyBytes', () => {
    const sizes = ROUTES.filter(([, route]) => route.remote !== 'deny' && route.body).map(
      ([id, route]) => ({ id, bytes: maxJsonBytes(route.body as never) }),
    );
    expect(sizes.length).toBeGreaterThan(5);
    for (const { id, bytes } of sizes) {
      expect({ id, cabe: bytes <= REMOTE_LIMITS.maxBodyBytes }).toEqual({ id, cabe: true });
    }
  });
});

describe('esquemas del dominio', () => {
  it('la clave de un bloqueo: IPv4 o los 4 primeros grupos de una IPv6 con ::, sin barra', () => {
    expect(REMOTE_BLOCK_KEY_RE.test('92.184.12.7')).toBe(true);
    expect(REMOTE_BLOCK_KEY_RE.test('2a01:e0a:1:2::')).toBe(true);
    expect(REMOTE_BLOCK_KEY_RE.test('2a01:e0a:1:2::/64')).toBe(false);
    expect(REMOTE_BLOCK_KEY_RE.test('256.1.1.1')).toBe(false);
    expect(REMOTE_BLOCK_KEY_RE.test('2a01:e0a::')).toBe(false);
  });

  it('IPs en minúscula o `desconocida`', () => {
    expect(RemoteIpSchema.safeParse('2001:db8::7').success).toBe(true);
    expect(RemoteIpSchema.safeParse('desconocida').success).toBe(true);
    expect(RemoteIpSchema.safeParse('1.2.3.4; rm').success).toBe(false);
  });

  it('el permiso propone 30 días si no se dice nada', () => {
    expect(DeviceRemoteBodySchema.parse({ enabled: true })).toEqual({
      enabled: true,
      expiresIn: '30d',
    });
  });

  it('remote-access.json estricto: un campo de más no pasa (falla cerrado)', () => {
    expect(
      RemoteAccessFileSchema.safeParse({ schemaVersion: 1, enabled: true, devices: {} }).success,
    ).toBe(true);
    expect(
      RemoteAccessFileSchema.safeParse({ schemaVersion: 1, enabled: true, devices: {}, x: 1 })
        .success,
    ).toBe(false);
  });
});
