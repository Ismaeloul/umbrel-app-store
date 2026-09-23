// Pasarela falsa que imita la de umbreld (modules/app-gateway/app-gateway.ts)
// para demostrar en local que el blindaje de nginx aguanta el agujero real.
//
// Lo que se reproduce (hecho comprobado en umbreld, arquitectura §8.1):
// - Decide si una petición necesita login con new URL(req.url, base).pathname.
//   Esa ruta ya viene normalizada: resuelve "." y "..", también %2e%2e, y trata
//   "\" como "/", pero NO decodifica %2f. Una URL que empieza por "//" se toma
//   como otro host y la ruta es lo que va detrás.
// - PROXY_AUTH_WHITELIST ("/native/*") deja pasar sin login lo que casa.
// - Reenvía a nginx la URL CRUDA, tal cual llegó, no la normalizada.
// Así /native/..%2fapi/state pasa sin login y es nginx quien tiene que cortarla.
//
// El "login" es una cookie fija (UMBREL_PROXY_TOKEN). Para el navegador:
// /__pasarela/login la pone y /__pasarela/logout la quita. Sin sesión se
// responde 401 (umbreld redirige a su pantalla de login; aquí basta con saber
// que no pasa).
//
// Sin dependencias: corre con la imagen oficial de Node tal cual.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const SESSION_COOKIE = 'UMBREL_PROXY_TOKEN';
export const DEFAULT_SESSION = 'sesion-local-de-pruebas';
const BASE = 'http://pasarela.invalid';

/**
 * Lista de patrones separada por comas, como en el entorno de app_proxy.
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * "*" casa con cualquier cosa (también con "/"); el resto es literal.
 * @param {string} pattern
 */
export function patternToRegExp(pattern) {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`);
}

/**
 * La ruta con la que decide umbreld. null si la URL no se puede interpretar.
 * @param {string} rawUrl
 */
export function gatewayPathname(rawUrl) {
  try {
    return new URL(rawUrl, BASE).pathname;
  } catch {
    return null;
  }
}

/**
 * @param {string} pathname
 * @param {string[]} patterns
 */
export function pathMatches(pathname, patterns) {
  return patterns.some((pattern) => patternToRegExp(pattern).test(pathname));
}

/**
 * @param {string | undefined} cookieHeader
 * @param {string} session
 */
export function hasSession(cookieHeader, session) {
  return String(cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${SESSION_COOKIE}=${session}`);
}

/**
 * @typedef {object} GatewayRules
 * @property {boolean} authAdd       PROXY_AUTH_ADD
 * @property {string[]} whitelist    PROXY_AUTH_WHITELIST
 * @property {string[]} blacklist    PROXY_AUTH_BLACKLIST
 * @property {string} session        valor de la cookie de sesión válida
 */

/**
 * "pass" si la pasarela reenvía la petición a la app, "login" si exige sesión.
 * @param {string} rawUrl
 * @param {string | undefined} cookieHeader
 * @param {GatewayRules} rules
 * @returns {{ decision: 'pass' | 'login', pathname: string | null, reason: string }}
 */
export function decide(rawUrl, cookieHeader, rules) {
  const pathname = gatewayPathname(rawUrl);
  if (!rules.authAdd) return { decision: 'pass', pathname, reason: 'sin PROXY_AUTH_ADD' };
  if (pathname !== null) {
    const whitelisted = pathMatches(pathname, rules.whitelist);
    const blacklisted = pathMatches(pathname, rules.blacklist);
    if (whitelisted && !blacklisted) return { decision: 'pass', pathname, reason: 'lista blanca' };
  }
  if (hasSession(cookieHeader, rules.session))
    return { decision: 'pass', pathname, reason: 'sesión' };
  return { decision: 'login', pathname, reason: 'sin sesión' };
}

/**
 * @typedef {object} GatewayOptions
 * @property {string} appHost
 * @property {number} appPort
 * @property {GatewayRules} rules
 * @property {(line: string) => void} [log]
 */

/**
 * @param {GatewayOptions} options
 */
export function createGateway({ appHost, appPort, rules, log = () => {} }) {
  return http.createServer((req, res) => {
    const rawUrl = req.url ?? '/';

    if (rawUrl === '/__pasarela/login' || rawUrl === '/__pasarela/logout') {
      const cookie =
        rawUrl === '/__pasarela/login'
          ? `${SESSION_COOKIE}=${rules.session}; Path=/; HttpOnly; SameSite=Lax`
          : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
      res.writeHead(302, { Location: '/', 'Set-Cookie': cookie });
      res.end();
      return;
    }

    const { decision, pathname, reason } = decide(rawUrl, req.headers.cookie, rules);
    log(
      `[pasarela] ${req.method} ${rawUrl} -> ruta ${pathname ?? '(no válida)'} -> ${decision} (${reason})`,
    );
    if (decision === 'login') {
      res.writeHead(401, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Pasarela-Falsa': 'login',
      });
      res.end('Login de Umbrel necesario (pasarela falsa: abre /__pasarela/login)\n');
      return;
    }

    let upstream;
    try {
      // path: la URL CRUDA. Es justo lo que hace la pasarela real.
      upstream = http.request({
        host: appHost,
        port: appPort,
        method: req.method,
        path: rawUrl,
        headers: req.headers,
      });
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`URL que Node no sabe reenviar: ${error instanceof Error ? error.message : ''}\n`);
      return;
    }
    upstream.on('response', (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('La app no responde (pasarela falsa)\n');
    });
    // Si el cliente se va (un SSE que se cierra), se corta también hacia nginx.
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
}

function main() {
  const rules = {
    authAdd: String(process.env.PROXY_AUTH_ADD ?? 'true') === 'true',
    whitelist: parseList(process.env.PROXY_AUTH_WHITELIST),
    blacklist: parseList(process.env.PROXY_AUTH_BLACKLIST),
    session: process.env.FAKE_GATEWAY_SESSION || DEFAULT_SESSION,
  };
  const appHost = process.env.APP_HOST || 'ismaeloul-ace-player-neo_nginx_1';
  const appPort = Number(process.env.APP_PORT || 80);
  const port = Number(process.env.PORT || 7792);
  const server = createGateway({ appHost, appPort, rules, log: (line) => console.log(line) });
  server.listen(port, '0.0.0.0', () => {
    console.log(
      `[pasarela] escuchando en ${port} -> ${appHost}:${appPort}; lista blanca: ${rules.whitelist.join(', ') || '(vacía)'}`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
