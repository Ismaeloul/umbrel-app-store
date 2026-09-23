// nginx.conf de la 0.7.0 leída como bloques (scripts/lib/nginx-conf.mjs) y la
// pasarela falsa: las reglas de arquitectura §8 y los T-126 de siempre, sin
// Docker. La prueba contra el nginx real es scripts/test-nginx-docker.mjs.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createGateway,
  decide,
  parseList,
  SESSION_COOKIE,
} from '../local/fake-gateway/gateway.mjs';
import { ASSAULT_PAYLOADS, nginxNormalizedPath } from '../../scripts/lib/blindaje.mjs';
import {
  directiveArgs,
  findAll,
  location,
  locations,
  mapFunction,
  parseNginx,
  proxyHeaders,
  serverBlock,
  type Directive,
} from '../../scripts/lib/nginx-conf.mjs';
import {
  COMPOSE_TEMPLATE,
  LEGACY_RELEASE_DIR,
  NGINX_TEMPLATE,
  readCompose,
  readText,
} from './helpers.js';

const TEXT = readText(NGINX_TEMPLATE);
const TREE = parseNginx(TEXT);
const SERVER = serverBlock(TREE);
const LEGACY_TREE = parseNginx(readText(path.join(LEGACY_RELEASE_DIR, 'nginx.conf')));
const COMPOSE = readCompose(COMPOSE_TEMPLATE);
const STORAGE = COMPOSE.services.storage?.container_name ?? '';
const ENGINE = COMPOSE.services.acestream?.container_name ?? '';
const origin = mapFunction(TREE, '$ace_origin');
const badUri = mapFunction(TREE, '$ace_bad_uri');
const WHITELIST = parseList(COMPOSE.services.app_proxy?.environment?.PROXY_AUTH_WHITELIST);
const RULES = { authAdd: true, whitelist: WHITELIST, blacklist: [], session: 'sesion' };

const argsOf = (block: Directive[], name: string) =>
  directiveArgs(block, name).map((args) => args.join(' '));

/** La location tiene el "if ($ace_origin = native) { return 403; }". */
function rejectsNative(block: Directive[]): boolean {
  return block.some(
    (directive) =>
      directive.name === 'if' &&
      directive.args.join(' ') === '($ace_origin = native)' &&
      (directive.block ?? []).some((inner) => inner.name === 'return' && inner.args[0] === '403'),
  );
}

describe('nginx.conf: servidor', () => {
  it('sin versión en Server, 2 MiB de cuerpo (T6) y en el 80 (U4)', () => {
    expect(argsOf(SERVER, 'server_tokens')).toEqual(['off']);
    expect(argsOf(SERVER, 'client_max_body_size')).toEqual(['2m']);
    expect(argsOf(SERVER, 'listen')).toEqual(['80']);
  });

  it('los dos map van sobre la URI cruda ($request_uri), nunca sobre $uri', () => {
    const maps = TREE.filter((directive) => directive.name === 'map');
    expect(maps.map((map) => map.args)).toEqual([
      ['$request_uri', '$ace_origin'],
      ['$request_uri', '$ace_bad_uri'],
    ]);
  });

  it('capa 1: el 400 va en el server, antes de elegir location', () => {
    const index = SERVER.findIndex(
      (directive) => directive.name === 'if' && directive.args.join(' ') === '($ace_bad_uri)',
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(SERVER[index]?.block?.map((d) => [d.name, ...d.args])).toEqual([['return', '400']]);
    const firstLocation = SERVER.findIndex((directive) => directive.name === 'location');
    expect(index).toBeLessThan(firstLocation);
  });

  it('text/html no se repite en gzip_types (nginx lo comprime siempre y avisaría)', () => {
    expect(argsOf(SERVER, 'gzip')).toEqual(['on']);
    expect(argsOf(SERVER, 'gzip_types')[0]).not.toContain('text/html');
  });
});

describe('nginx.conf: blindaje de la ruta nativa (arquitectura §8.2)', () => {
  it.each([
    ['/native/..%2fapi/state', '1'],
    ['/native/..%2Fapi/state', '1'],
    ['/native/%2e%2e/api/state', '1'],
    ['/native/%2E%2E/api/state', '1'],
    ['/native/..%5capi/state', '1'],
    ['/native/..%5Capi/state', '1'],
    ['/native/..\\api/state', '1'],
    ['/native/../api/state', '1'],
    ['/assets/..%2f..%2fnginx.conf', '1'],
    // S-01 (docs/seguridad.md): "//" delante engaña a la pasarela (lo toma por host)
    ['//api/native/state', '1'],
    ['///api/native/state', '1'],
    ['//native/api/v1/bootstrap', '1'],
    ['/api/v1/search?q=//x', '0'],
    ['/api/v1/search?q=A%2FB', '0'],
    ['/api/v1/search?q=../..', '0'],
    ['/native/api/v1/bootstrap', '0'],
    ['/native/api/v1/video/SID/index.m3u8?t=abc', '0'],
    ['/assets/index-3f2a1b9c.js', '0'],
    ['/', '0'],
  ])('$ace_bad_uri(%s) = %s', (uri, expected) => {
    expect(badUri(uri)).toBe(expected);
  });

  it.each([
    ['/native/api/v1/bootstrap', 'native'],
    ['/native', 'native'],
    ['/native?x=1', 'native'],
    ['/NATIVE/api/state', 'native'],
    ['/native;/api/state', 'native'],
    ['/api/state', 'web'],
    ['//native/api/v1/bootstrap', 'web'],
    ['/assets/native/x.js', 'web'],
    ['/api/v1/search?q=/native/', 'web'],
  ])('$ace_origin(%s) = %s', (uri, expected) => {
    expect(origin(uri)).toBe(expected);
  });

  it('/native/ va al backend quitando el prefijo, con origen native fijo y sin buffer', () => {
    const block = location(TREE, '/native/');
    expect(argsOf(block, 'proxy_pass')).toEqual([`http://${STORAGE}:3000/`]);
    expect(proxyHeaders(block).get('x-ace-origin')).toBe('native');
    expect(proxyHeaders(block).get('x-request-id')).toBe('$request_id');
    expect(argsOf(block, 'proxy_buffering')).toEqual(['off']);
    expect(argsOf(block, 'gzip')).toEqual(['off']);
    expect(argsOf(block, 'proxy_read_timeout')).toEqual(['3600s']);
    // "/native" sin barra no redirige: 403.
    expect(location(TREE, '= /native').map((d) => [d.name, ...d.args])).toEqual([
      ['return', '403'],
    ]);
  });

  it('toda location que llega al backend pone X-Ace-Origin y X-Request-Id de nginx', () => {
    const toStorage = locations(TREE).filter((candidate) =>
      directiveArgs(candidate.block, 'proxy_pass').some((args) =>
        (args[0] ?? '').startsWith(`http://${STORAGE}:`),
      ),
    );
    expect(toStorage.map((candidate) => candidate.match).sort()).toEqual(
      ['/native/', '= /api/v1/events', '/api/', '/remux/'].sort(),
    );
    for (const candidate of toStorage) {
      const headers = proxyHeaders(candidate.block);
      const expected = candidate.match === '/native/' ? 'native' : '$ace_origin';
      expect(headers.get('x-ace-origin'), candidate.match).toBe(expected);
      expect(headers.get('x-request-id'), candidate.match).toBe('$request_id');
    }
  });

  it('capa 2: todas las demás location responden 403 al origen native', () => {
    for (const candidate of locations(TREE)) {
      if (candidate.match === '/native/' || candidate.match === '= /native') continue;
      expect(rejectsNative(candidate.block), candidate.match).toBe(true);
    }
  });

  it('SSE /api/v1/events: sin buffer, sin gzip, HTTP/1.1 y una hora de plazo', () => {
    const block = location(TREE, '= /api/v1/events');
    expect(argsOf(block, 'proxy_buffering')).toEqual(['off']);
    expect(argsOf(block, 'gzip')).toEqual(['off']);
    expect(argsOf(block, 'proxy_http_version')).toEqual(['1.1']);
    expect(proxyHeaders(block).get('connection')).toBe('');
    expect(argsOf(block, 'proxy_read_timeout')).toEqual(['3600s']);
  });

  it('cargas para romper el blindaje: nativa ⇒ 400 o origen native (simulado)', () => {
    for (const payload of ASSAULT_PAYLOADS.filter((candidate) => candidate.native)) {
      const blocked = badUri(payload.path) === '1' || origin(payload.path) === 'native';
      expect(blocked, payload.path).toBe(true);
    }
  });

  it('lo que la pasarela deja pasar sin login nunca acaba como web (simulado)', () => {
    for (const payload of ASSAULT_PAYLOADS) {
      if (decide(payload.path, undefined, RULES).decision !== 'pass') continue;
      const safe =
        badUri(payload.path) === '1' ||
        origin(payload.path) === 'native' ||
        nginxNormalizedPath(payload.path).startsWith('/native/');
      expect(safe, payload.path).toBe(true);
    }
  });
});

describe('nginx.conf: lo que se conserva de la 0.6.59', () => {
  it('T-126: ningún proxy_redirect usa $scheme y /ace/ reescribe a ruta relativa', () => {
    for (const directive of findAll(TREE, 'proxy_redirect')) {
      expect(directive.args.join(' ')).not.toContain('$scheme');
    }
    expect(argsOf(location(TREE, '/ace/'), 'proxy_redirect')).toEqual([
      '~^http://[^/]+/(ace|content)/(.*)$ /$1/$2',
    ]);
    expect(argsOf(location(TREE, '/content/'), 'proxy_redirect')).toEqual([
      '~^http://[^/]+/content/(.*)$ /content/$1',
    ]);
  });

  it('/ace/ y /content/ van al motor con los mismos sub_filter y ajustes que hoy', () => {
    for (const match of ['/ace/', '/content/']) {
      const block = location(TREE, match);
      const old = location(LEGACY_TREE, match);
      expect(argsOf(block, 'proxy_pass'), match).toEqual([`http://${ENGINE}:6878${match}`]);
      for (const name of [
        'proxy_pass',
        'sub_filter',
        'sub_filter_types',
        'sub_filter_once',
        'proxy_buffering',
        'proxy_request_buffering',
        'proxy_read_timeout',
        'proxy_send_timeout',
        'gzip',
      ]) {
        expect(argsOf(block, name), `${match} ${name}`).toEqual(argsOf(old, name));
      }
    }
  });

  it('/api/ y /remux/ con los plazos de hoy', () => {
    expect(argsOf(location(TREE, '/api/'), 'proxy_read_timeout')).toEqual(
      argsOf(location(LEGACY_TREE, '/api/'), 'proxy_read_timeout'),
    );
    for (const name of ['proxy_buffering', 'proxy_request_buffering', 'proxy_read_timeout']) {
      expect(argsOf(location(TREE, '/remux/'), name)).toEqual(
        argsOf(location(LEGACY_TREE, '/remux/'), name),
      );
    }
  });

  it('/assets/ inmutable y precomprimido; un asset que falta es un 404 de verdad (N2)', () => {
    const block = location(TREE, '/assets/');
    expect(argsOf(block, 'gzip_static')).toEqual(['on']);
    expect(argsOf(block, 'try_files')).toEqual(['$uri =404']);
    expect(argsOf(block, 'add_header')).toContain(
      'Cache-Control public, max-age=31536000, immutable',
    );
  });

  it('sw.js e index sin caché; manifiesto con su tipo; CSP de siempre en /', () => {
    expect(argsOf(location(TREE, '= /sw.js'), 'add_header')).toContain(
      'Cache-Control no-cache always',
    );
    const index = location(TREE, '/');
    expect(argsOf(index, 'add_header')).toContain('Cache-Control no-cache always');
    expect(argsOf(index, 'try_files')).toEqual(['$uri $uri/ /index.html']);
    const csp = (block: Directive[]) =>
      directiveArgs(block, 'add_header').find((args) => args[0] === 'Content-Security-Policy');
    expect(csp(index)).toEqual(csp(location(LEGACY_TREE, '/')));
    expect(argsOf(location(TREE, '= /manifest.webmanifest'), 'default_type')).toEqual([
      'application/manifest+json',
    ]);
  });

  it('nginx solo sirve /www (la web); nada de la release fuera de web/', () => {
    const roots = findAll(TREE, 'root').map((directive) => directive.args.join(' '));
    expect(roots.length).toBeGreaterThan(0);
    expect(new Set(roots)).toEqual(new Set(['/www']));
    expect(TEXT).not.toContain('/releases/');
  });

  it('texto con LF', () => {
    expect(TEXT).not.toContain('\r');
  });
});

describe('Pasarela falsa (deploy/local/fake-gateway)', () => {
  it.each([
    ['/native/..%2fapi/state', 'pass'],
    ['/native/..%5capi/state', 'pass'],
    ['/native/%2e%2e/api/state', 'login'],
    ['/native/..\\api/state', 'login'],
    ['/native/../api/state', 'login'],
    ['//native/api/v1/bootstrap', 'login'],
    ['/native/api/v1/bootstrap', 'pass'],
    ['/api/state', 'login'],
    ['/', 'login'],
  ])('decide como umbreld (arquitectura §8.3): %s → %s', (uri, expected) => {
    expect(decide(uri, undefined, RULES).decision).toBe(expected);
  });

  it('con sesión deja pasar todo; sin PROXY_AUTH_ADD, también', () => {
    expect(decide('/api/state', `${SESSION_COOKIE}=sesion`, RULES).decision).toBe('pass');
    expect(decide('/api/state', undefined, { ...RULES, authAdd: false }).decision).toBe('pass');
    expect(decide('/api/state', `${SESSION_COOKIE}=otra`, RULES).decision).toBe('login');
  });

  it('reenvía la URL CRUDA, sin normalizar, y corta sin sesión', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.end('ok');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const gateway = createGateway({
      appHost: '127.0.0.1',
      appPort: (upstream.address() as AddressInfo).port,
      rules: RULES,
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const port = (gateway.address() as AddressInfo).port;
    const get = (rawPath: string) =>
      new Promise<number>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          })
          .on('error', reject);
      });
    try {
      expect(await get('/native/..%2fapi/state')).toBe(200);
      expect(await get('/api/state')).toBe(401);
      expect(seen).toEqual(['/native/..%2fapi/state']);
    } finally {
      await new Promise((resolve) => gateway.close(resolve));
      await new Promise((resolve) => upstream.close(resolve));
    }
  });
});
