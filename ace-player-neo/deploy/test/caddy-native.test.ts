// El sitio de Caddy del dominio de la app de iPhone, tv.ismaeloul.es (deploy/umbrel/caddy/tv-on.caddy,
// docs/acceso-remoto.md «Por el dominio»), frente a la tabla de rutas v1. Sin Caddy: las
// expresiones se leen del fichero y se prueban con RegExp (RE2 y JS casan igual en lo que usan;
// packages/shared/test/remote.test.ts comprueba que no hay nada que RE2 no sepa hacer).
//
// En los dos sentidos: lo que la tabla permite (`remote: 'allow' | 'allow-self'`) pasa por el
// fichero, y lo que pasa por el fichero lo permite la tabla. La prueba con el Caddy de verdad
// (certificado, strict_sni_host, la IP real) es manual: docs/acceso-remoto.md.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REMOTE_LIMITS } from '../../packages/shared/src/constants/limits.js';
import {
  REMOTE_CADDY_BEGIN,
  REMOTE_CADDY_END,
  renderRemoteCaddyMatchers,
} from '../../packages/shared/src/remote-caddy.js';
import {
  V1_ROUTES,
  V1_ROUTE_IDS,
  type V1RouteDefinition,
  type V1RouteId,
} from '../../packages/shared/src/routes.js';
import { readText, UMBREL_DIR } from './helpers.js';

const TV = readText(path.join(UMBREL_DIR, 'caddy', 'tv-on.caddy'));
const TV_OFF = readText(path.join(UMBREL_DIR, 'caddy', 'tv-off.caddy'));
const CADDYFILE = readText(path.join(UMBREL_DIR, 'Caddyfile'));

interface Matcher {
  readonly method: string;
  readonly path: RegExp;
  readonly authorization: RegExp | null;
  readonly query: string | null;
}

/** Los `@nombre { … }` del fichero (method, path_regexp, header_regexp Authorization, query). */
function matchers(text: string): Map<string, Matcher> {
  const found = new Map<string, Matcher>();
  for (const block of text.matchAll(/^\t@([a-z]+) \{\n([\s\S]*?)\n\t\}$/gm)) {
    const body = block[2] ?? '';
    const method = /^\t\tmethod (\S+)$/m.exec(body)?.[1];
    const pathRe = /^\t\tpath_regexp `([^`]+)`$/m.exec(body)?.[1];
    if (!method || !pathRe) throw new Error(`@${block[1]} sin method o path_regexp`);
    const auth = /^\t\theader_regexp Authorization `([^`]+)`$/m.exec(body)?.[1];
    const query = /^\t\tquery (\S+)$/m.exec(body)?.[1] ?? null;
    found.set(block[1] ?? '', {
      method,
      path: new RegExp(pathRe),
      authorization: auth ? new RegExp(auth) : null,
      query,
    });
  }
  return found;
}

const MATCHERS = matchers(TV);
const PROXIED = ['get', 'post', 'put', 'delete', 'video'];

/**
 * Una cadena de CEL entre comillas tal y como la lee cel-go: dentro de las comillas invertidas
 * del Caddyfile no se quita ninguna barra, así que lo que hay en el fichero es lo que recibe CEL.
 * Un escape que CEL no conoce (`\.`, `\d`…) hace fallar el matcher al cargar y Caddy no
 * arranca (ni tv ni la sala): aquí lanza.
 */
export function celUnescape(literal: string): string {
  let out = '';
  for (let index = 0; index < literal.length; index += 1) {
    const char = literal[index] ?? '';
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = literal[index + 1] ?? '';
    const simple: Record<string, string> = {
      '\\': '\\',
      '?': '?',
      '"': '"',
      "'": "'",
      '`': '`',
      a: '\x07',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
    };
    if (next in simple) {
      out += simple[next];
      index += 1;
      continue;
    }
    const hex = /^(?:[xX]([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))/.exec(
      literal.slice(index + 1),
    );
    if (hex) {
      out += String.fromCodePoint(parseInt(hex[1] ?? hex[2] ?? hex[3] ?? '', 16));
      index += hex[0].length;
      continue;
    }
    const octal = /^[0-3][0-7]{2}/.exec(literal.slice(index + 1));
    if (octal) {
      out += String.fromCharCode(parseInt(octal[0], 8));
      index += 3;
      continue;
    }
    throw new Error(`escape de CEL no válido: \\${next} (en ${literal})`);
  }
  return out;
}

/** La línea `@raro` del fichero, cruda (sin tocar ni una barra). */
function raroLine(text: string): string {
  const line = /^\t@raro expression .*$/m.exec(text)?.[0];
  if (!line) throw new Error('sin @raro');
  return line;
}

/** La expresión `@raro` como la ve el regex de Caddy: primero CEL quita su nivel de escapes. */
function raro(text: string): RegExp {
  const literal = /`\{http\.request\.orig_uri\.path\}\.matches\("(.+)"\)`$/.exec(
    raroLine(text),
  )?.[1];
  if (!literal) throw new Error('@raro sin .matches("…")');
  const source = celUnescape(literal);
  if (!source.startsWith('(?i)')) throw new Error('@raro sin (?i)');
  return new RegExp(source.slice('(?i)'.length), 'i');
}
const RARO = raro(TV);

const GOOD_AUTH = `Bearer dev_iphone01.${'A'.repeat(43)}`;

/** Lo que haría el sitio tv con una petición: 400, 404 o «al backend» (3002). */
function tv(
  method: string,
  url: string,
  authorization: string | null = GOOD_AUTH,
): 400 | 404 | 'backend' {
  const mark = url.indexOf('?');
  const rawPath = mark < 0 ? url : url.slice(0, mark);
  const query = new URLSearchParams(mark < 0 ? '' : url.slice(mark + 1));
  if (RARO.test(rawPath)) return 400;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return 404;
  }
  for (const name of PROXIED) {
    const matcher = MATCHERS.get(name);
    if (!matcher || matcher.method !== method || !matcher.path.test(decoded)) continue;
    if (matcher.authorization && !(authorization && matcher.authorization.test(authorization))) {
      continue;
    }
    if (matcher.query) {
      const key = matcher.query.split('=')[0] ?? '';
      if (!query.has(key)) continue;
    }
    return 'backend';
  }
  return 404;
}

const PARAMS: Record<string, string> = {
  id: 'a'.repeat(40),
  sid: 's_Q2FuYWxEZVBydWViYQ',
  file: 'index.m3u8',
  art: 'poster',
  ref: 'c12',
  matchId: 'epg-1234',
  teamId: '133738',
  competitionId: '4335',
  /* Los de la sala, los mismos que caddy-allowlist.test.ts. */
  code: 'k3J9xQ2mZpL8wR4t',
  key: 'k'.repeat(32),
  artId: 'a'.repeat(40),
};
const BY_ROUTE: Partial<Record<V1RouteId, Record<string, string>>> = {
  iptvGuideProgramme: { id: '12.345' },
  footballScan: { id: '0123456789abcdef01234567' },
  deviceRevoke: { id: 'dev_iphone01' },
  deviceRemoteUpdate: { id: 'dev_iphone01' },
  remoteBlockDelete: { key: '203.0.113.9' },
};

function concrete(id: V1RouteId): string {
  const route: V1RouteDefinition = V1_ROUTES[id];
  return route.path.replace(/:([A-Za-z]+)/g, (_all, name: string) => {
    const value = BY_ROUTE[id]?.[name] ?? PARAMS[name];
    if (!value) throw new Error(`falta un valor de prueba para :${name} (${route.path})`);
    return value;
  });
}

const ROUTES = V1_ROUTE_IDS.map((id) => [id, V1_ROUTES[id] as V1RouteDefinition] as const);

function routeUrl(id: V1RouteId, route: V1RouteDefinition): string {
  return `/native${concrete(id)}${route.credential === 'video-token' ? '?t=abc.def' : ''}`;
}

describe('tv-on.caddy: la lista blanca sale de la tabla de rutas', () => {
  it('el trozo generado está al día (si falla: pnpm --filter @ace/shared caddy-tv)', () => {
    const begin = TV.indexOf(`\t${REMOTE_CADDY_BEGIN}`);
    const end = TV.indexOf(`\t${REMOTE_CADDY_END}`) + `\t${REMOTE_CADDY_END}`.length;
    expect(begin).toBeGreaterThan(0);
    expect(TV.slice(begin, end)).toBe(renderRemoteCaddyMatchers());
    expect([...MATCHERS.keys()].sort()).toEqual([...PROXIED].sort());
  });

  it('tabla → Caddy: toda ruta allow/allow-self llega al backend con su método', () => {
    const missing = ROUTES.filter(([, route]) => route.remote !== 'deny')
      .filter(([id, route]) => tv(route.method, routeUrl(id, route)) !== 'backend')
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it('Caddy → tabla: ninguna ruta deny llega (salvo que comparta método y camino con una permitida)', () => {
    const leaks = ROUTES.filter(([, route]) => route.remote === 'deny')
      .filter(([id, route]) => {
        const twin = ROUTES.some(
          ([, other]) =>
            other.remote !== 'deny' && other.method === route.method && other.path === route.path,
        );
        return !twin && tv(route.method, routeUrl(id, route)) === 'backend';
      })
      .map(([id]) => id);
    expect(leaks).toEqual([]);
    /* Las que más importan, una a una. */
    for (const id of [
      'pairingClaim',
      'pairingCreate',
      'devicesList',
      'settingsUpdate',
      'partyCreate',
      'partyJoin',
      'partyVideo',
      'remoteGet',
      'deviceRemoteUpdate',
      'iptvSave',
      'backupExport',
      'healthLive',
    ] as const) {
      const route: V1RouteDefinition = V1_ROUTES[id];
      expect({ id, tv: tv(route.method, routeUrl(id, route)) }).toEqual({ id, tv: 404 });
    }
  });

  it('cada camino permitido, con un método que la tabla no da para él: 404', () => {
    for (const [id, route] of ROUTES) {
      if (route.remote === 'deny') continue;
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        if (method === route.method) continue;
        const twin = ROUTES.some(
          ([, other]) =>
            other.remote !== 'deny' && other.method === method && other.path === route.path,
        );
        if (twin) continue;
        expect({ id, method, tv: tv(method, routeUrl(id, route)) }).toEqual({
          id,
          method,
          tv: 404,
        });
      }
    }
  });

  it('sin un Authorization con forma de token de dispositivo: 404 (sin huella de la app)', () => {
    for (const auth of [
      null,
      '',
      'Bearer',
      'Basic dXNlcjpwYXNz',
      `bearer dev_iphone01.${'A'.repeat(43)}`,
      `Bearer dev_iphone01.${'A'.repeat(42)}`,
      `Bearer ${'A'.repeat(43)}`,
    ]) {
      expect({ auth, tv: tv('GET', '/native/api/v1/ping', auth) }).toEqual({ auth, tv: 404 });
      expect(tv('GET', '/native/api/v1/bootstrap', auth)).toBe(404);
    }
  });

  it('el vídeo firmado: GET con ?t= y el fichero exacto; sin ?t=, con otro fichero o método, 404', () => {
    const base = `/native/api/v1/video/${PARAMS.sid}`;
    expect(tv('GET', `${base}/index.m3u8?t=abc.def`, null)).toBe('backend');
    expect(tv('GET', `${base}/index123.m4s?t=abc.def`, null)).toBe('backend');
    expect(tv('GET', `${base}/init_3.mp4?t=abc.def`, null)).toBe('backend');
    expect(tv('GET', `${base}/index.m3u8`, null)).toBe(404);
    expect(tv('GET', `${base}/segment.ts?t=abc.def`, null)).toBe(404);
    expect(tv('POST', `${base}/index.m3u8?t=abc.def`, null)).toBe(404);
    expect(tv('GET', `/native/api/v1/party/${PARAMS.code}/v/${PARAMS.key}/index.m3u8?t=x`)).toBe(
      404,
    );
  });

  it('ni la web, ni /api/*, ni /remux/, ni el motor, ni la sala, ni los estáticos', () => {
    for (const url of [
      '/',
      '/index.html',
      '/manifest.webmanifest',
      '/sw.js',
      '/assets/index-3f2a1b9c.js',
      '/invitado.html',
      `/s/${PARAMS.code}`,
      '/icon-192.png',
      '/api/v1/ping',
      '/api/v1/bootstrap',
      '/api/state',
      '/api/health',
      `/remux/${'a'.repeat(40)}/index.m3u8`,
      '/ace/getstream?id=x',
      '/content/x',
      `/api/v1/party/${PARAMS.code}/join`,
      `/native/api/v1/party/${PARAMS.code}`,
      '/native/',
      '/native',
      '/native/api/v1/',
      '/native/api/state',
      '/NATIVE/api/v1/ping',
      '/native/api/v1/ping/',
      '/native/api/v1/pingx',
    ]) {
      for (const method of ['GET', 'POST']) {
        expect({ url, method, tv: tv(method, url) }).toEqual({ url, method, tv: 404 });
      }
    }
  });

  it('@raro: %2f, %2e, %5c, "..", "\\" y "//" dan 400 antes de mirar nada', () => {
    for (const url of [
      '/native/api/v1/..%2fstate',
      '/native/api/v1/%2e%2e/state',
      '/native/api/v1/ping%5c',
      '/native/api/v1/../v1/ping',
      '/native\\api/v1/ping',
      '//native/api/v1/ping',
    ]) {
      expect({ url, tv: tv('GET', url) }).toEqual({ url, tv: 400 });
    }
  });
});

describe('tv-on.caddy: el resto del sitio', () => {
  it('su propio certificado (TLS-ALPN en el 8443, TLS 1.3) y un dominio por defecto que no es un comodín', () => {
    expect(TV).toMatch(/^\{\$NATIVE_DOMAIN:tv\.invalid\}:8443 \{$/m);
    expect(TV).toContain('protocols tls1.3');
    expect(TV).toContain('disable_http_challenge');
    expect(TV).toContain('alt_tlsalpn_port 8443');
  });

  it('cabeceras duras y sin Server', () => {
    for (const line of [
      '-Server',
      'Strict-Transport-Security "max-age=31536000"',
      'X-Content-Type-Options nosniff',
      'Referrer-Policy no-referrer',
      'X-Robots-Tag "noindex, nofollow"',
      'X-Frame-Options DENY',
      'Cross-Origin-Resource-Policy same-origin',
      `Content-Security-Policy "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"`,
    ]) {
      expect(TV, line).toContain(`\t\t${line}\n`);
    }
  });

  it('el cuerpo, con el mismo tope que el backend (REMOTE_LIMITS.maxBodyBytes)', () => {
    const size = /max_size (\d+)KiB/.exec(TV)?.[1];
    expect(Number(size) * 1024).toBe(REMOTE_LIMITS.maxBodyBytes);
  });

  it('borra lo que mande el cliente y pone la IP del par TCP; al 3002 del backend, nunca al 3000', () => {
    for (const header of [
      'X-Ace-Origin',
      'X-Ace-Via',
      'X-Ace-Client-Ip',
      'X-Forwarded-For',
      'X-Forwarded-Host',
      'X-Forwarded-Proto',
      'Forwarded',
      'X-Real-IP',
    ]) {
      expect(TV, header).toContain(`\t\trequest_header -${header}\n`);
    }
    expect(TV).toContain('header_up X-Ace-Client-Ip {http.request.remote.host}');
    expect(TV).not.toMatch(/^\s*trusted_proxies/m);
    expect(TV).not.toContain('client_ip_headers');
    expect(TV.match(/reverse_proxy (\S+)/g)).toEqual([
      'reverse_proxy ismaeloul-ace-player-neo_storage_1:3002',
    ]);
    expect(TV).not.toContain(':3000');
    expect(TV).not.toContain('X-Ace-Origin guest');
    /* La limpieza va antes que cualquier handle. */
    expect(TV.indexOf('request_header -X-Ace-Client-Ip')).toBeLessThan(TV.indexOf('handle @get'));
    expect(TV.indexOf('respond @raro 400')).toBeLessThan(TV.indexOf('handle @get'));
    expect(
      TV.trimEnd()
        .split('\n')
        .some((line) => line.trim() === 'respond 404'),
    ).toBe(true);
  });

  it('plazos al backend: 5 s para conectar y 60 s para la cabecera (lo que tarda en abrir un canal)', () => {
    expect(TV).toContain('dial_timeout 5s');
    expect(TV).toContain('response_header_timeout 60s');
    expect(TV).toContain('flush_interval -1');
  });

  it('el registro: ni token, ni ?t=, ni IP', () => {
    const log = TV.slice(TV.indexOf('\tlog {'));
    expect(log).toContain('request>headers delete');
    expect(log).toContain('replace t REDACTADO');
    expect(log).toContain('request>remote_ip delete');
    expect(log).toContain('request>client_ip delete');
  });

  it('la misma @raro que la sala, byte a byte (sin normalizar barras)', () => {
    expect(raroLine(TV)).toBe(raroLine(CADDYFILE));
  });

  it('@raro es CEL válido y llega al regex como dos puntos escapados y x5c (barra invertida)', () => {
    for (const text of [TV, CADDYFILE]) {
      const re = raro(text);
      /* RegExp.source escapa la «/». */
      expect(re.source).toBe('%(2f|2e|5c)|\\.\\.|\\x5c|^\\/\\/');
      expect(re.test('/a\\b')).toBe(true);
      expect(re.test('//x')).toBe(true);
      expect(re.test('/a.b')).toBe(false);
    }
  });

  it('celUnescape: como cel-go (lo que hizo caer la release con una sola barra)', () => {
    expect(celUnescape('\\\\.\\\\x5c')).toBe('\\.\\x5c');
    expect(celUnescape('\\x5c')).toBe('\\');
    expect(() => celUnescape('\\.\\.')).toThrow(/no válido/);
    expect(() => celUnescape('\\d')).toThrow(/no válido/);
  });
});

describe('Caddyfile: los dos sitios', () => {
  it('importa tv-on o tv-off según NATIVE_SITE (por defecto off); tv-off no tiene sitio', () => {
    expect(CADDYFILE).toMatch(/^import caddy\/tv-\{\$NATIVE_SITE:off\}\.caddy$/m);
    const code = TV_OFF.split('\n').filter(
      (line) => line.trim() !== '' && !line.trim().startsWith('#'),
    );
    expect(code).toEqual([]);
  });

  it('globales: strict_sni_host, cabeceras de 16 KB y plazo de cabecera, pero sin read_body ni write', () => {
    const global = CADDYFILE.slice(
      CADDYFILE.indexOf('{\n\tadmin off'),
      CADDYFILE.indexOf('{$PARTY_DOMAIN}'),
    );
    expect(global).toContain('strict_sni_host on');
    expect(global).toContain('read_header 10s');
    expect(global).toContain('idle 2m');
    expect(global).toContain('max_header_size 16KB');
    expect(global).not.toMatch(/^\s*read_body\b/m);
    expect(global).not.toMatch(/^\s*write\b/m);
  });

  it('la sala no cambia: sigue en el 3000 con X-Ace-Origin guest y sus tres listas', () => {
    expect(CADDYFILE).toContain('reverse_proxy @sala ismaeloul-ace-player-neo_storage_1:3000 {');
    expect(CADDYFILE).toContain('header_up X-Ace-Origin guest');
    expect(CADDYFILE).not.toContain(':3002');
    expect(CADDYFILE).not.toContain('/native');
  });
});
