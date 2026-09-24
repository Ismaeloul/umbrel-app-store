/* Revisión de seguridad (docs/seguridad.md): matriz de acceso de TODAS las
   rutas, sacada de las tablas de @ace/shared para que una ruta nueva no se
   quede fuera sin que nadie lo vea.

   - native sin token, con token manipulado y con token revocado → 401 en
     todas las rutas v1 salvo las dos `credential: 'none'` (ping y canje);
   - native con token válido en una ruta solo web → 403 origin_forbidden;
   - native (por cabecera o por prefijo /native) en cualquier ruta antigua →
     403 origin_forbidden, aunque el token sea bueno;
   - URLs de vídeo firmadas: otra sesión, otra clave, payload cambiado sin
     volver a firmar, reutilizar tras revocar, y rutas con ".." en :sid y
     :file (también codificadas) → nunca se sirve nada;
   - web: la regla anti-CSRF en todas las rutas con efectos.

   Los manejadores de los módulos no llegan a ejecutarse en ningún caso
   negativo: el acceso se decide antes. */

import { describe, expect, it } from 'vitest';
import {
  LEGACY_OPERATIONS,
  V1_ROUTES,
  V1_ROUTE_IDS,
  nativePath,
  type V1RouteDefinition,
} from '@ace/shared';
import { deriveKey, KEY_LABELS } from '../src/config/keys.js';
import { hmac } from '../src/modules/auth/crypto.js';
import { fakeState, memoryDevicesStore } from '../src/modules/auth/test-support.js';
import type { PlaybackService } from '../src/modules/playback/types.js';
import { createTestApp, native, web } from './helpers/index.js';

const SID = 's_SesionDeSeguridad01';
const HASH = 'a'.repeat(40);

/* Valores con forma válida para cada `:param` de la tabla v1. */
const PARAM_VALUES: Record<string, string> = {
  id: HASH,
  sid: SID,
  file: 'index.m3u8',
  matchId: 'partido-1',
  /* Escudos y logos (módulo teams): ids de TheSportsDB. */
  teamId: '133738',
  competitionId: '4335',
};

function concretePath(route: V1RouteDefinition): string {
  return route.path.replace(/:([A-Za-z]+)/g, (_all, name: string) => {
    const value = PARAM_VALUES[name];
    if (!value) throw new Error(`falta un valor de prueba para :${name} (${route.path})`);
    return value;
  });
}

function legacyPath(path: string): string {
  return path === '/remux/' ? `/remux/${HASH}/index.m3u8` : path;
}

/* playback solo hace falta para el "visor vivo" de las URLs de vídeo. */
function fakePlayback(): PlaybackService {
  return new Proxy({} as PlaybackService, {
    get(_target, property) {
      if (property === 'isViewerAlive') return () => false;
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw new Error(`fakePlayback.${String(property)} no debería llamarse`);
      };
    },
  });
}

async function setup() {
  const store = memoryDevicesStore();
  const test = await createTestApp({
    services: { state: fakeState(store), playback: fakePlayback() },
  });
  const { app } = test;
  const pair = async (name: string) => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/pairing', headers: web() });
    const { code } = created.json<{ code: string }>();
    const claimed = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(),
      payload: { code, name, platform: 'ios' },
    });
    expect(claimed.statusCode).toBe(201);
    return claimed.json<{ deviceId: string; token: string }>();
  };
  const good = await pair('iPhone bueno');
  const revoked = await pair('iPhone revocado');
  const revoke = await app.inject({
    method: 'DELETE',
    url: `/api/v1/devices/${revoked.deviceId}`,
    headers: web(),
  });
  expect(revoke.statusCode).toBe(200);
  return { ...test, good, revoked };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/* Las dos formas en que una petición native llega a Node: con el prefijo
   (nginx lo quita, pero el backend también lo entiende) y por cabecera. */
function nativeForms(path: string): string[] {
  return [nativePath(path), path];
}

async function send(
  s: Setup,
  method: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; code: string | undefined }> {
  const response = await s.app.inject({
    method: method as 'GET',
    url,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { payload: {} }),
  });
  let code: string | undefined;
  try {
    const body = response.json<{ error?: string | { code?: string } }>();
    code = typeof body.error === 'string' ? body.error : body.error?.code;
  } catch {
    code = undefined;
  }
  return { status: response.statusCode, code };
}

const V1 = V1_ROUTE_IDS.map((id) => [id, V1_ROUTES[id]] as const);

describe('seguridad · matriz de acceso native (tabla de rutas)', () => {
  it('solo ping y el canje del código van sin credencial', () => {
    const open = V1.filter(([, route]) => route.credential === 'none').map(([id]) => id);
    expect(open.sort()).toEqual(['pairingClaim', 'ping']);
    /* Y ninguna de las dos es de administración. */
    for (const [, route] of V1.filter(([, r]) => r.credential === 'none')) {
      expect(route.access).toBe('any');
    }
  });

  it('sin token, con token manipulado o revocado: 401 en todas las rutas con credencial', async () => {
    const s = await setup();
    const [goodId, goodSecret] = s.good.token.split('.') as [string, string];
    const flipped = `${goodSecret.slice(0, -1)}${goodSecret.endsWith('A') ? 'B' : 'A'}`;
    const attempts: [string, Record<string, string>, string][] = [
      ['sin token', native(), 'unauthorized'],
      ['Bearer vacío', native(undefined, { authorization: 'Bearer ' }), 'unauthorized'],
      [
        'otro esquema',
        native(undefined, { authorization: `Basic ${s.good.token}` }),
        'unauthorized',
      ],
      ['secreto manipulado', native(`${goodId}.${flipped}`), 'unauthorized'],
      [
        'secreto de otro dispositivo',
        native(`${s.revoked.deviceId}.${goodSecret}`),
        'unauthorized',
      ],
      ['id inexistente', native(`dev_NoExisteNiExistio.${goodSecret}`), 'unauthorized'],
      ['token con un punto de más', native(`${s.good.token}.x`), 'unauthorized'],
      ['revocado', native(s.revoked.token), 'device_revoked'],
    ];
    const failures: string[] = [];
    for (const [id, route] of V1) {
      if (route.credential !== 'bearer') continue;
      for (const url of nativeForms(concretePath(route))) {
        for (const [label, headers, expected] of attempts) {
          const { status, code } = await send(s, route.method, url, headers);
          if (status !== 401 || code !== expected) {
            failures.push(`${id} ${route.method} ${url} (${label}): ${status} ${code}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('con token válido, las rutas solo web dan 403 origin_forbidden', async () => {
    const s = await setup();
    const failures: string[] = [];
    const webOnly = V1.filter(([, route]) => route.access === 'web');
    expect(webOnly.map(([id]) => id)).toEqual(
      expect.arrayContaining(['pairingCreate', 'devicesList', 'deviceRevoke', 'settingsUpdate']),
    );
    for (const [id, route] of webOnly) {
      for (const url of nativeForms(concretePath(route))) {
        const { status, code } = await send(s, route.method, url, native(s.good.token));
        if (status !== 403 || code !== 'origin_forbidden') {
          failures.push(`${id} ${route.method} ${url}: ${status} ${code}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('las rutas antiguas nunca son para native, ni con token bueno', async () => {
    const s = await setup();
    const failures: string[] = [];
    for (const operation of LEGACY_OPERATIONS) {
      const path = legacyPath(operation.path);
      for (const url of nativeForms(path)) {
        for (const headers of [native(), native(s.good.token)]) {
          const { status, code } = await send(s, operation.method, url, headers);
          /* /remux/ responde sin cuerpo en la 0.6.59; el código se mira en el resto. */
          if (status !== 403 || (code !== undefined && code !== 'origin_forbidden')) {
            failures.push(`${operation.method} ${url}: ${status} ${code}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('rutas v1 retorcidas: sin token, 401; con token, nunca 2xx de una ruta web', async () => {
    const s = await setup();
    const twisted = [
      '/native/api/v1/nope',
      '/native/api/v1/devices/',
      '/native/api/v1//devices',
      '/native/api/v1/%64evices',
      '/native/api/v1/devices?x=1',
      '/native/api/v1/DEVICES',
      '/native/api/v1/../v1/devices',
      '/native/api/v1/pairing/claim/../../devices',
      '/native/api/v1/ping/../devices',
    ];
    for (const url of twisted) {
      /* Fastify no resuelve ".." ni junta barras: ninguna casa con ping ni con
         el canje, así que todas piden token antes de decir si existen. */
      const anonymous = await send(s, 'GET', url, native());
      expect(anonymous.status, url).toBe(401);
      const withToken = await send(s, 'GET', url, native(s.good.token));
      expect(withToken.status, url).toBeGreaterThanOrEqual(400);
    }
    for (const url of ['/native/api/state', '/native/remux/x/index.m3u8', '/native/', '/native']) {
      const { status } = await send(s, 'GET', url, native(s.good.token));
      expect(status, url).toBe(403);
    }
  });

  it('X-Ace-Origin: web no convierte en web una petición con prefijo /native', async () => {
    const s = await setup();
    const { status, code } = await send(s, 'GET', '/native/api/v1/devices', {
      'x-ace-origin': 'web',
    });
    expect(status).toBe(401);
    expect(code).toBe('unauthorized');
    for (const value of ['Web ', 'WEB', 'web,native', 'native']) {
      const other = await send(s, 'GET', '/native/api/v1/devices', { 'x-ace-origin': value });
      expect(other.status, value).toBe(401);
    }
  });
});

describe('seguridad · URLs de vídeo firmadas', () => {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  it('manipular sid, dev o exp, otra clave, otra sesión o reutilizar tras revocar: 401', async () => {
    const s = await setup();
    const video = (t: string, sid = SID, file = 'index.m3u8') =>
      send(s, 'GET', `/native/api/v1/video/${sid}/${file}?t=${encodeURIComponent(t)}`, native());
    const good = s.services.auth.signVideoToken({ sessionId: SID, deviceId: s.good.deviceId });
    const [payload, signature] = good.split('.') as [string, string];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sid: string;
      dev: string;
      exp: number;
    };
    const otherKey = deriveKey('otra-semilla-de-otra-instalacion', KEY_LABELS.video);
    const signWith = (key: Buffer, body: unknown) => {
      const encoded = b64(body);
      return `${encoded}.${hmac(key, encoded).toString('base64url')}`;
    };
    const cases: [string, string, string][] = [
      [
        'exp alargado sin volver a firmar',
        `${b64({ ...decoded, exp: decoded.exp + 1e9 })}.${signature}`,
        SID,
      ],
      [
        'dev cambiado sin volver a firmar',
        `${b64({ ...decoded, dev: s.revoked.deviceId })}.${signature}`,
        SID,
      ],
      [
        'sid cambiado sin volver a firmar',
        `${b64({ ...decoded, sid: 's_OtraSesionDistinta' })}.${signature}`,
        's_OtraSesionDistinta',
      ],
      ['token bueno usado en otra sesión', good, 's_OtraSesionDistinta'],
      ['firmado con otra clave', signWith(otherKey, decoded), SID],
      [
        'firmado con la clave del emparejamiento',
        signWith(deriveKey('x'.repeat(32), KEY_LABELS.pairing), decoded),
        SID,
      ],
      ['campo de más', signWith(otherKey, { ...decoded, admin: true }), SID],
      ['sin firma', `${payload}.`, SID],
      ['solo firma', `.${signature}`, SID],
      ['alg none a lo JWT', `${b64({ alg: 'none' })}.${payload}.`, SID],
    ];
    for (const [label, t, sid] of cases) {
      const { status, code } = await video(t, sid);
      expect(status, label).toBe(401);
      expect(code, label).toBe('video_token_invalid');
    }
    /* Firmado para el dispositivo revocado: vale la firma, pero el dispositivo no. */
    const forRevoked = s.services.auth.signVideoToken({
      sessionId: SID,
      deviceId: s.revoked.deviceId,
    });
    expect(await video(forRevoked)).toEqual({ status: 401, code: 'device_revoked' });
    /* Revocar el bueno anula al momento la URL que ya tenía. */
    await s.app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${s.good.deviceId}`,
      headers: web(),
    });
    expect(await video(good)).toEqual({ status: 401, code: 'device_revoked' });
  });

  it('".." en :sid o :file (también codificado) nunca sirve un fichero', async () => {
    const s = await setup();
    const t = encodeURIComponent(
      s.services.auth.signVideoToken({ sessionId: SID, deviceId: s.good.deviceId }),
    );
    const paths = [
      `/native/api/v1/video/${SID}/..%2F..%2Fstate.json`,
      `/native/api/v1/video/${SID}/..%2f..%2fv2%2fdevices.json`,
      `/native/api/v1/video/${SID}/%2e%2e%2fstate.json`,
      `/native/api/v1/video/${SID}/..%5Cstate.json`,
      `/native/api/v1/video/${SID}/index.m3u8%00.txt`,
      `/native/api/v1/video/${SID}/ffmpeg.log`,
      `/native/api/v1/video/${SID}/index.m3u8/..`,
      `/native/api/v1/video/..%2F${HASH}/index.m3u8`,
      `/native/api/v1/video/${SID}/../${SID}/index.m3u8`,
    ];
    for (const path of paths) {
      const response = await s.app.inject({
        method: 'GET',
        url: `${path}?t=${t}`,
        headers: native(),
      });
      expect(response.statusCode, path).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, path).toBeLessThan(500);
      expect(response.body, path).not.toContain('schemaVersion');
    }
  });

  it('web no puede usar la ruta de vídeo firmada, ni native la de /remux/', async () => {
    const s = await setup();
    const t = s.services.auth.signVideoToken({ sessionId: SID, deviceId: s.good.deviceId });
    const fromWeb = await send(s, 'GET', `/api/v1/video/${SID}/index.m3u8?t=${t}`, web());
    expect(fromWeb).toEqual({ status: 403, code: 'origin_forbidden' });
  });
});

describe('seguridad · anti-CSRF de la web en todas las rutas con efectos', () => {
  it('cross-site, Origin ajeno (también otro puerto del mismo NAS) u Origin null → 403', async () => {
    const s = await setup();
    const hostile: [string, Record<string, string>][] = [
      ['Sec-Fetch-Site cross-site', web({ 'sec-fetch-site': 'cross-site' })],
      ['Origin de otra web', web({ origin: 'https://malo.example', host: 'umbrel.local:7792' })],
      [
        'otra app del mismo Umbrel (same-site, otro puerto)',
        web({
          'sec-fetch-site': 'same-site',
          origin: 'http://umbrel.local:8080',
          host: 'umbrel.local:7792',
        }),
      ],
      ['Origin null (iframe con sandbox)', web({ origin: 'null', host: 'umbrel.local:7792' })],
    ];
    const failures: string[] = [];
    const withEffects = [
      ...V1.filter(([, route]) => route.method !== 'GET' || route.sideEffects).map(
        ([id, route]) => [id, route.method, concretePath(route)] as const,
      ),
      ...LEGACY_OPERATIONS.filter(
        (operation) => operation.method !== 'GET' && operation.method !== 'HEAD',
      ).map((operation) => [operation.path, operation.method, operation.path] as const),
      ['GET /api/remux', 'GET', `/api/remux?id=${HASH}`] as const,
      ['GET /api/football/resolve', 'GET', '/api/football/resolve?channel=x'] as const,
    ];
    for (const [id, method, url] of withEffects) {
      for (const [label, headers] of hostile) {
        const { status, code } = await send(s, method, url, headers);
        if (status !== 403 || code !== 'cross_origin') {
          failures.push(`${id} ${method} ${url} (${label}): ${status} ${code}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /* S-03 (docs/seguridad.md): otra app del mismo Umbrel (mismo host, otro
     puerto: "same-site" para el navegador) puede poner un
     <img src="http://umbrel.local:7792/api/remux?id=…">. Ese GET lleva la
     cookie del login de Umbrel y NO lleva Origin, así que la regla de la
     0.6.59 ("sin Origin → sí") lo dejaba pasar. */
  it('S-03 · un GET con efectos same-site sin Origin (una <img> de otra app del NAS) → 403', async () => {
    const s = await setup();
    const sideEffectGets = [
      ...V1.filter(([, route]) => route.method === 'GET' && route.sideEffects).map(([, route]) =>
        concretePath(route),
      ),
      `/api/remux?id=${HASH}`,
      '/api/football/resolve?channel=x',
    ];
    expect(sideEffectGets.length).toBeGreaterThanOrEqual(4);
    const failures: string[] = [];
    for (const url of sideEffectGets) {
      const imgFromOtherApp = web({ 'sec-fetch-site': 'same-site', host: 'umbrel.local:7792' });
      const { status, code } = await send(s, 'GET', url, imgFromOtherApp);
      if (status !== 403 || code !== 'cross_origin') failures.push(`${url}: ${status} ${code}`);
    }
    expect(failures).toEqual([]);
  });

  it('S-03 · lo legítimo sigue pasando: same-origin, "none" (URL escrita a mano) y sin cabeceras', async () => {
    const s = await setup();
    for (const headers of [
      web({ 'sec-fetch-site': 'same-origin' }),
      web({ 'sec-fetch-site': 'none' }),
      web(),
      web({
        'sec-fetch-site': 'same-site',
        origin: 'http://umbrel.local:7792',
        host: 'umbrel.local:7792',
      }),
    ]) {
      const { code } = await send(s, 'GET', '/api/football/resolve?channel=x', headers);
      expect(code, JSON.stringify(headers)).not.toBe('cross_origin');
    }
  });
});
