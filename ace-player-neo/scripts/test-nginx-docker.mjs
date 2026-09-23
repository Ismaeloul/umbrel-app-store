// Prueba la nginx.conf de la 0.7.0 contra el nginx REAL (la imagen y el comando
// de deploy/umbrel/docker-compose.yml, por digest) y contra la pasarela falsa
// que imita la de umbreld. Es la matriz de arquitectura §8.3 y T-126.
//
// Va fuera de Vitest porque necesita Docker. Levanta, en una red propia:
//   - un backend de eco (Node) con los alias de storage y del motor: devuelve en
//     JSON lo que le llega (URL, X-Ace-Origin, X-Request-Id) y sirve un SSE, una
//     redirección absoluta del motor y una lista m3u8;
//   - nginx con la configuración completa (y la release de prueba montada como
//     en producción);
//   - nginx SIN la capa 1 (el return 400), para demostrar que la capa 2 (403 al
//     origen native fuera de /native/) aguanta sola;
//   - la pasarela falsa (deploy/local/fake-gateway) delante del nginx completo.
//
// Uso: node scripts/test-nginx-docker.mjs [--keep]
//   --keep deja los contenedores levantados para depurar.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parse } from 'yaml';
import { ASSAULT_PAYLOADS, judgeOutcome } from './lib/blindaje.mjs';

const MONOREPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = path.join(MONOREPO_DIR, 'deploy', 'umbrel', 'docker-compose.yml');
const NGINX_CONF = path.join(MONOREPO_DIR, 'deploy', 'umbrel', 'nginx.conf');
const GATEWAY_FILE = path.join(MONOREPO_DIR, 'deploy', 'local', 'fake-gateway', 'gateway.mjs');
const STORAGE_HOST = 'ismaeloul-ace-player-neo_storage_1';
const ENGINE_HOST = 'ismaeloul-ace-player-neo_acestream_1';
const NGINX_HOST = 'ismaeloul-ace-player-neo_nginx_1';
const SESSION = 'sesion-de-la-prueba-nginx';
const BACKEND_MARKER = 'NO-DEBE-SERVIRSE-backend-de-la-release';
const ASSET = 'assets/app-3f2a1b9c.js';

const keep = process.argv.includes('--keep');

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

/** @param {string[]} args */
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * @param {string} container
 * @param {number} port
 */
function hostPort(container, port) {
  const mapping = docker(['port', container, `${port}/tcp`]).split('\n')[0] ?? '';
  const match = /:(\d+)$/.exec(mapping);
  if (!match?.[1]) throw new Error(`Sin puerto publicado para ${container}:${port} (${mapping})`);
  return Number(match[1]);
}

/**
 * El comando de nginx del Compose, tal cual, partido como lo parte Compose:
 * sh -c "<script>".
 * @param {unknown} command
 */
function splitShCommand(command) {
  const text = String(command).trim();
  const match = /^sh -c "([\s\S]*)"$/.exec(text);
  if (!match?.[1]) throw new Error(`Comando de nginx inesperado en Compose: ${text}`);
  return ['sh', '-c', match[1].replace(/\s+/g, ' ').trim()];
}

// ---------------------------------------------------------------------------
// Peticiones crudas: node:http no normaliza la ruta (fetch sí lo haría).
// ---------------------------------------------------------------------------

/**
 * @typedef {object} RawResponse
 * @property {number} status
 * @property {http.IncomingHttpHeaders} headers
 * @property {string} body
 * @property {number} firstChunkMs
 * @property {number} totalMs
 */

/**
 * Petición cruda con reintentos SOLO de transporte. En Windows, el reenvío de
 * puertos de Docker Desktop corta de vez en cuando una conexión (ECONNRESET o
 * plazo agotado): medido el 23-sep, 7 de 400 peticiones por el puerto publicado
 * y 0 de 400 desde dentro de la red de Docker contra el mismo nginx. Un corte
 * no es una respuesta de nginx, así que se repite; cualquier respuesta HTTP, sea
 * la que sea, se devuelve tal cual y la juzga el caso.
 * @param {number} port
 * @param {string} rawPath
 * @param {{ method?: string, headers?: Record<string, string>, body?: Buffer }} [options]
 * @returns {Promise<RawResponse>}
 */
async function raw(port, rawPath, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await rawOnce(port, rawPath, options);
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      const message = error instanceof Error ? error.message : '';
      const transport = code === 'ECONNRESET' || message.startsWith('Plazo agotado');
      if (!transport || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

/**
 * @param {number} port
 * @param {string} rawPath
 * @param {{ method?: string, headers?: Record<string, string>, body?: Buffer }} [options]
 * @returns {Promise<RawResponse>}
 */
function rawOnce(port, rawPath, options = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: rawPath,
        method: options.method ?? 'GET',
        headers: { Connection: 'close', ...options.headers },
        timeout: 10_000,
        // Una conexión nueva por petición: el agente por defecto de Node reutiliza
        // sockets y, si nginx ya cerró el anterior, la petición acaba en ECONNRESET
        // sin que nginx haya llegado a verla.
        agent: false,
      },
      (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let firstChunkMs = -1;
        response.on('data', (chunk) => {
          if (firstChunkMs < 0) firstChunkMs = performance.now() - started;
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            firstChunkMs,
            totalMs: performance.now() - started,
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error(`Plazo agotado: ${rawPath}`)));
    request.on('error', reject);
    request.end(options.body);
  });
}

/** @param {string} body */
function echoOf(body) {
  try {
    return /** @type {{ service?: string, url?: string, headers?: Record<string, string> }} */ (
      JSON.parse(body)
    );
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Ficheros de la prueba
// ---------------------------------------------------------------------------

const ECHO_BACKEND = `"use strict";
// Backend de eco: storage (3000) y motor (6878) a la vez.
const http = require("http");
const echo = (service) => (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service, method: req.method, url: req.url, headers: req.headers, bytes: Buffer.concat(chunks).length }));
  });
};
const storageEcho = echo("storage");
http.createServer((req, res) => {
  if (req.url.startsWith("/api/v1/events")) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
      "X-Eco-Origin": String(req.headers["x-ace-origin"] || ""), "X-Eco-Request-Id": String(req.headers["x-request-id"] || "") });
    res.write("event: uno\\ndata: " + "x".repeat(2048) + "\\n\\n");
    setTimeout(() => { res.write("event: dos\\ndata: {}\\n\\n"); res.end(); }, 1500);
    return;
  }
  storageEcho(req, res);
}).listen(3000, "0.0.0.0");
const engineEcho = echo("motor");
http.createServer((req, res) => {
  if (req.url.startsWith("/ace/redirect")) {
    res.writeHead(302, { Location: "http://${ENGINE_HOST}:6878/ace/destino?x=1" });
    res.end();
    return;
  }
  if (req.url.startsWith("/ace/manifest.m3u8")) {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
    res.end("#EXTM3U\\n#EXTINF:2,\\nhttp://${ENGINE_HOST}:6878/ace/c/seg1.ts\\n#EXTINF:2,\\nhttp://127.0.0.1:6878/content/seg2.ts\\n");
    return;
  }
  engineEcho(req, res);
}).listen(6878, "0.0.0.0");
`;

/**
 * Release de prueba con la misma forma que la real: web/ y la nginx.conf.
 * @param {string} root
 * @param {string} version
 * @param {string} nginxConf
 */
function writeRelease(root, version, nginxConf) {
  const release = path.join(root, 'releases', version);
  mkdirSync(path.join(release, 'web', 'assets'), { recursive: true });
  writeFileSync(path.join(release, 'nginx.conf'), nginxConf);
  writeFileSync(path.join(release, 'server.js'), `// ${BACKEND_MARKER}\n`);
  writeFileSync(
    path.join(release, 'web', 'index.html'),
    '<!doctype html><html lang="es"><title>Ace Player Neo</title><p>index de prueba</p></html>\n',
  );
  writeFileSync(path.join(release, 'web', 'sw.js'), `const VERSION = "aceneo-${version}";\n`);
  writeFileSync(path.join(release, 'web', 'manifest.webmanifest'), '{"name":"Ace Player Neo"}\n');
  const asset = `console.log(${JSON.stringify('asset '.repeat(400))});\n`;
  writeFileSync(path.join(release, 'web', ASSET), asset);
  writeFileSync(path.join(release, 'web', `${ASSET}.gz`), gzipSync(asset));
  return path.join(root, 'releases');
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

/** @type {{ group: string, name: string, ok: boolean, detail: string }[]} */
const results = [];

/**
 * @param {string} group
 * @param {string} name
 * @param {() => Promise<string | true>} run  true si pasa; si no, el motivo
 */
async function check(group, name, run) {
  try {
    const outcome = await run();
    results.push({ group, name, ok: outcome === true, detail: outcome === true ? '' : outcome });
  } catch (error) {
    results.push({
      group,
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** @param {number} port @param {string} rawPath @param {number} expected @param {Record<string, string>} [headers] */
async function expectStatus(port, rawPath, expected, headers) {
  const response = await raw(port, rawPath, { headers });
  return response.status === expected ? true : `HTTP ${response.status}, se esperaba ${expected}`;
}

/**
 * La petición llega al backend con el origen y la URL esperados, y con un
 * X-Request-Id que pone nginx (32 hex), no el del cliente.
 * @param {number} port
 * @param {string} rawPath
 * @param {{ origin: string, url: string, headers?: Record<string, string> }} expected
 */
async function expectBackend(port, rawPath, expected) {
  const response = await raw(port, rawPath, { headers: expected.headers });
  if (response.status !== 200) return `HTTP ${response.status}`;
  const echo = echoOf(response.body);
  const got = echo.headers ?? {};
  if (echo.service !== 'storage') return `no llegó a storage (${response.body.slice(0, 80)})`;
  if (echo.url !== expected.url)
    return `URL en el backend ${echo.url}, se esperaba ${expected.url}`;
  if (got['x-ace-origin'] !== expected.origin) {
    return `X-Ace-Origin ${got['x-ace-origin']}, se esperaba ${expected.origin}`;
  }
  if (!/^[0-9a-f]{32}$/.test(String(got['x-request-id'] ?? ''))) {
    return `X-Request-Id no es el de nginx: ${got['x-request-id']}`;
  }
  return true;
}

/** @param {number} port @param {string} rawPath @param {string} origin @param {Record<string, string>} [headers] */
async function expectStreaming(port, rawPath, origin, headers) {
  const response = await raw(port, rawPath, { headers: { 'Accept-Encoding': 'gzip', ...headers } });
  if (response.status !== 200) return `HTTP ${response.status}`;
  if (response.headers['content-encoding'])
    return `comprimido (${response.headers['content-encoding']})`;
  if (response.headers['x-eco-origin'] !== origin)
    return `origen ${response.headers['x-eco-origin']}`;
  if (!/^[0-9a-f]{32}$/.test(String(response.headers['x-eco-request-id'] ?? ''))) {
    return 'sin X-Request-Id de nginx';
  }
  if (!response.body.includes('event: dos')) return 'no llegó el segundo evento';
  // El backend manda el primer evento al instante y el segundo 1,5 s después.
  if (response.firstChunkMs > 900) {
    return `el primer evento tardó ${Math.round(response.firstChunkMs)} ms (hay buffer)`;
  }
  return true;
}

/**
 * Aplica la regla del blindaje (judgeOutcome) a una petición cruda. Se manda
 * además X-Ace-Origin: web del cliente, para comprobar que nginx la pisa.
 * @param {number} port
 * @param {string} rawPath
 */
async function expectShielded(port, rawPath) {
  const response = await raw(port, rawPath, {
    headers: { 'X-Ace-Origin': 'web', 'X-Request-Id': 'puesto-por-el-cliente' },
  });
  const echo = echoOf(response.body);
  return judgeOutcome({
    status: response.status,
    gatewayLogin: response.headers['x-pasarela-falsa'] === 'login',
    service: echo.service,
    origin: echo.headers?.['x-ace-origin'],
  });
}

/**
 * @param {number} nginxPort
 * @param {number} bareNginxPort
 * @param {number} gatewayPort
 */
async function runMatrix(nginxPort, bareNginxPort, gatewayPort) {
  const N = 'nginx completo';
  const bad = [
    '/native/..%2fapi/state',
    '/native/..%2Fapi/state',
    '/native/%2e%2e/api/state',
    '/native/%2E%2E/api/state',
    '/native/..%5capi/state',
    '/native/..\\api/state',
    '/native/../api/state',
    '/api/..%2fapi/state',
    '/assets/..%2f..%2fnginx.conf',
  ];
  for (const rawPath of bad)
    await check(N, `${rawPath} -> 400`, () => expectStatus(nginxPort, rawPath, 400));

  await check(N, '/api/state con X-Ace-Origin: native falsificada -> el backend recibe web', () =>
    expectBackend(nginxPort, '/api/state', {
      origin: 'web',
      url: '/api/state',
      headers: { 'X-Ace-Origin': 'native', 'X-Request-Id': 'puesto-por-el-cliente' },
    }),
  );
  await check(N, '/native/api/v1/ping -> backend recibe native y /api/v1/ping', () =>
    expectBackend(nginxPort, '/native/api/v1/ping', { origin: 'native', url: '/api/v1/ping' }),
  );
  await check(N, '/native/api/v1/bootstrap con X-Ace-Origin: web -> nginx la pisa (native)', () =>
    expectBackend(nginxPort, '/native/api/v1/bootstrap?x=1', {
      origin: 'native',
      url: '/api/v1/bootstrap?x=1',
      headers: { 'X-Ace-Origin': 'web' },
    }),
  );
  await check(N, '/api/v1/search?q=A%2FB -> 200 (la query no cuenta)', () =>
    expectBackend(nginxPort, '/api/v1/search?q=A%2FB', {
      origin: 'web',
      url: '/api/v1/search?q=A%2FB',
    }),
  );
  await check(N, '/remux/x/index.m3u8 -> backend con origen web', () =>
    expectBackend(nginxPort, '/remux/x/index.m3u8', { origin: 'web', url: '/remux/x/index.m3u8' }),
  );
  await check(N, 'SSE /api/v1/events sin buffer ni gzip, con X-Request-Id', () =>
    expectStreaming(nginxPort, '/api/v1/events', 'web', { 'X-Ace-Origin': 'native' }),
  );
  await check(N, 'SSE /native/api/v1/events sin buffer ni gzip (origen native)', () =>
    expectStreaming(nginxPort, '/native/api/v1/events', 'native'),
  );
  for (const rawPath of ['/native', '/native?x=1']) {
    await check(N, `${rawPath} -> 403`, () => expectStatus(nginxPort, rawPath, 403));
  }
  await check(N, '/api (sin barra) -> 301 relativa a /api/ (absolute_redirect off)', async () => {
    const response = await raw(nginxPort, '/api');
    if (response.status !== 301) return `HTTP ${response.status}`;
    return response.headers.location === '/api/' ? true : `Location: ${response.headers.location}`;
  });
  await check(N, 'T-126: redirección absoluta del motor -> Location relativa', async () => {
    const response = await raw(nginxPort, '/ace/redirect');
    if (response.status !== 302) return `HTTP ${response.status}`;
    return response.headers.location === '/ace/destino?x=1'
      ? true
      : `Location: ${response.headers.location}`;
  });
  await check(N, 'sub_filter: la m3u8 del motor sale con rutas relativas', async () => {
    const response = await raw(nginxPort, '/ace/manifest.m3u8');
    if (response.status !== 200) return `HTTP ${response.status}`;
    if (response.body.includes('http://')) return `quedan URL absolutas: ${response.body}`;
    return response.body.includes('\n/ace/c/seg1.ts\n') &&
      response.body.includes('\n/content/seg2.ts\n')
      ? true
      : response.body;
  });
  await check(N, `/${ASSET}: caché inmutable y .gz precomprimido`, async () => {
    const response = await raw(nginxPort, `/${ASSET}`, { headers: { 'Accept-Encoding': 'gzip' } });
    if (response.status !== 200) return `HTTP ${response.status}`;
    if (!String(response.headers['cache-control']).includes('immutable')) {
      return `Cache-Control: ${response.headers['cache-control']}`;
    }
    return response.headers['content-encoding'] === 'gzip' ? true : 'sin Content-Encoding: gzip';
  });
  await check(N, '/assets/que-no-existe.js -> 404 de verdad, sin caché', async () => {
    const response = await raw(nginxPort, '/assets/que-no-existe.js');
    if (response.status !== 404) return `HTTP ${response.status}`;
    return response.headers['cache-control']
      ? `Cache-Control: ${response.headers['cache-control']}`
      : true;
  });
  await check(N, '/sw.js y / sin caché; / con CSP', async () => {
    const sw = await raw(nginxPort, '/sw.js');
    const index = await raw(nginxPort, '/');
    if (sw.headers['cache-control'] !== 'no-cache') return `sw.js: ${sw.headers['cache-control']}`;
    if (index.headers['cache-control'] !== 'no-cache')
      return `/: ${index.headers['cache-control']}`;
    return String(index.headers['content-security-policy']).includes("default-src 'self'")
      ? true
      : 'sin CSP';
  });
  await check(N, 'manifest.webmanifest con application/manifest+json', async () => {
    const response = await raw(nginxPort, '/manifest.webmanifest');
    return String(response.headers['content-type']).startsWith('application/manifest+json')
      ? true
      : `Content-Type: ${response.headers['content-type']}`;
  });
  await check(N, 'ni el backend ni nginx.conf se pueden descargar', async () => {
    for (const rawPath of ['/server.js', '/nginx.conf', '/releases/0.7.0/server.js']) {
      const response = await raw(nginxPort, rawPath);
      if (response.body.includes(BACKEND_MARKER) || response.body.includes('proxy_pass')) {
        return `${rawPath} expone la release`;
      }
    }
    return true;
  });
  await check(N, 'server_tokens off: Server sin versión', async () => {
    const response = await raw(nginxPort, '/');
    return response.headers.server === 'nginx' ? true : `Server: ${response.headers.server}`;
  });
  await check(N, 'cuerpo de más de 2 MiB -> 413', async () => {
    const response = await raw(nginxPort, '/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.alloc(2 * 1024 * 1024 + 1024, 0x61),
    });
    return response.status === 413 ? true : `HTTP ${response.status}`;
  });

  // Capa 2 sola: sin el return 400, nginx normaliza la URI nativa y la manda a
  // otra location; el origen, calculado sobre la URI cruda, sigue siendo native.
  const C2 = 'nginx sin capa 1';
  for (const rawPath of [
    '/native/..%2fapi/state',
    '/native/..%2fapi/v1/events',
    '/native/..%2fremux/x/index.m3u8',
    '/native/..%2face/getstream?id=x',
    '/native/..%2fcontent/x',
    `/native/..%2f${ASSET}`,
    '/native/..%2fsw.js',
    '/native/..%2fmanifest.webmanifest',
    '/native/..%2f',
  ]) {
    await check(C2, `${rawPath} -> 403 (sin tocar backend ni motor)`, async () => {
      const response = await raw(bareNginxPort, rawPath);
      if (response.status !== 403) return `HTTP ${response.status} ${response.body.slice(0, 60)}`;
      return response.body.includes('"service"') ? 'llegó al backend' : true;
    });
  }

  // A través de la pasarela falsa: el agujero real de umbreld.
  const G = 'pasarela falsa + nginx';
  const cookie = { Cookie: `UMBREL_PROXY_TOKEN=${SESSION}` };
  await check(
    G,
    '/native/..%2fapi/state sin login: la pasarela la deja pasar y nginx da 400',
    async () => {
      const response = await raw(gatewayPort, '/native/..%2fapi/state');
      if (response.headers['x-pasarela-falsa'] === 'login')
        return 'la pasarela pidió login (no reproduce el agujero)';
      return response.status === 400 ? true : `HTTP ${response.status}`;
    },
  );
  await check(G, '/native/..%5capi/state sin login -> 400 (nginx)', () =>
    expectStatus(gatewayPort, '/native/..%5capi/state', 400),
  );
  for (const rawPath of [
    '/native/%2e%2e/api/state',
    '/native/../api/state',
    '/native/..\\api/state',
    '//native/api/v1/bootstrap',
    '/api/state',
  ]) {
    await check(G, `${rawPath} sin login -> 401 (pasarela)`, () =>
      expectStatus(gatewayPort, rawPath, 401),
    );
  }
  await check(G, '/native/api/v1/ping sin login -> backend recibe native', () =>
    expectBackend(gatewayPort, '/native/api/v1/ping', { origin: 'native', url: '/api/v1/ping' }),
  );
  await check(G, '/api/state con login y X-Ace-Origin: native -> backend recibe web', () =>
    expectBackend(gatewayPort, '/api/state', {
      origin: 'web',
      url: '/api/state',
      headers: { ...cookie, 'X-Ace-Origin': 'native' },
    }),
  );
  await check(G, 'SSE con login a través de la pasarela, sin buffer', () =>
    expectStreaming(gatewayPort, '/api/v1/events', 'web', cookie),
  );
  await check(G, 'T-126 a través de la pasarela', async () => {
    const response = await raw(gatewayPort, '/ace/redirect', { headers: cookie });
    return response.headers.location === '/ace/destino?x=1'
      ? true
      : `Location: ${response.headers.location}`;
  });
  await check(G, '/ace/ desde native sin login -> 401 en la pasarela', () =>
    expectStatus(gatewayPort, '/ace/getstream?id=x', 401),
  );

  // Cargas para romper el blindaje (scripts/lib/blindaje.mjs): o 400/403, o
  // login de la pasarela, o el backend las recibe como native. Nunca como web.
  // Directo a nginx (sin pasarela) solo las que empiezan por /native: las demás
  // son rutas web normales, que sin pasarela delante no tienen login que saltar.
  const nativePayloads = ASSAULT_PAYLOADS.filter((candidate) => candidate.native);
  /** @type {[string, number, typeof ASSAULT_PAYLOADS][]} */
  const assaults = [
    ['asalto: nginx directo', nginxPort, nativePayloads],
    ['asalto: nginx sin capa 1', bareNginxPort, nativePayloads],
    ['asalto: pasarela sin login', gatewayPort, ASSAULT_PAYLOADS],
  ];
  for (const [group, port, payloads] of assaults) {
    for (const payload of payloads) {
      await check(group, `${payload.path} (${payload.why})`, () =>
        expectShielded(port, payload.path),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/** @param {string} label @param {() => Promise<unknown>} probe */
async function waitFor(label, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      await probe();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`${label} no arrancó a tiempo (${lastError})`);
}

async function main() {
  try {
    docker(['version', '--format', '{{.Server.Version}}']);
  } catch {
    console.error('test-nginx-docker: Docker no responde. Arranca Docker Desktop y repite.');
    process.exitCode = 2;
    return;
  }

  const compose = parse(readFileSync(COMPOSE_FILE, 'utf8'));
  const services = compose.services;
  const nginxImage = services.nginx.image;
  const nodeImage = services.storage.image;
  const nginxCommand = splitShCommand(services.nginx.command);
  const versionMatch = /\/releases\/(\d+\.\d+\.\d+)\//.exec(String(services.nginx.command));
  if (!versionMatch?.[1]) throw new Error('No se encuentra la versión en el comando de nginx');
  const version = versionMatch[1];
  const whitelist = String(services.app_proxy.environment.PROXY_AUTH_WHITELIST ?? '');

  const nginxConf = readFileSync(NGINX_CONF, 'utf8').replace(/\r\n?/g, '\n');
  const bareConf = nginxConf.replace(/\n\s*if \(\$ace_bad_uri\) \{\s*return 400;\s*\}\n/, '\n');
  if (bareConf === nginxConf)
    throw new Error('No se encuentra el bloque "if ($ace_bad_uri)" en nginx.conf');

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'aceneo-nginx-'));
  const id = randomBytes(4).toString('hex');
  const network = `aceneo-nginx-prueba-${id}`;
  const names = {
    backend: `aceneo-prueba-eco-${id}`,
    nginx: `aceneo-prueba-nginx-${id}`,
    bare: `aceneo-prueba-nginx-sin-capa1-${id}`,
    gateway: `aceneo-prueba-pasarela-${id}`,
  };

  const fullReleases = writeRelease(path.join(tmp, 'completo'), version, nginxConf);
  const bareReleases = writeRelease(path.join(tmp, 'sin-capa1'), version, bareConf);
  mkdirSync(path.join(tmp, 'eco'));
  writeFileSync(path.join(tmp, 'eco', 'eco.cjs'), ECHO_BACKEND);
  mkdirSync(path.join(tmp, 'pasarela'));
  cpSync(GATEWAY_FILE, path.join(tmp, 'pasarela', 'gateway.mjs'));

  console.log(`nginx ${nginxImage}\nnode ${nodeImage}\nversión ${version}; temporal ${tmp}\n`);
  try {
    docker(['network', 'create', network]);
    docker([
      'run',
      '-d',
      '--name',
      names.backend,
      '--network',
      network,
      '--network-alias',
      STORAGE_HOST,
      '--network-alias',
      ENGINE_HOST,
      '-v',
      `${path.join(tmp, 'eco')}:/eco:ro`,
      nodeImage,
      'node',
      '/eco/eco.cjs',
    ]);
    // nginx resuelve los upstream al arrancar: el backend ya tiene que existir.
    for (const [name, releases, alias] of [
      [names.nginx, fullReleases, true],
      [names.bare, bareReleases, false],
    ]) {
      docker([
        'run',
        '-d',
        '--name',
        String(name),
        '--network',
        network,
        ...(alias ? ['--network-alias', NGINX_HOST] : []),
        '-v',
        `${releases}:/releases:ro`,
        '-p',
        '127.0.0.1::80',
        nginxImage,
        ...nginxCommand,
      ]);
    }
    docker([
      'run',
      '-d',
      '--name',
      names.gateway,
      '--network',
      network,
      '-e',
      `APP_HOST=${NGINX_HOST}`,
      '-e',
      'APP_PORT=80',
      '-e',
      'PROXY_AUTH_ADD=true',
      '-e',
      `PROXY_AUTH_WHITELIST=${whitelist}`,
      '-e',
      `FAKE_GATEWAY_SESSION=${SESSION}`,
      '-v',
      `${path.join(tmp, 'pasarela')}:/pasarela:ro`,
      '-p',
      '127.0.0.1::7792',
      nodeImage,
      'node',
      '/pasarela/gateway.mjs',
    ]);

    const nginxPort = hostPort(names.nginx, 80);
    const barePort = hostPort(names.bare, 80);
    const gatewayPort = hostPort(names.gateway, 7792);
    await waitFor('nginx', async () => {
      const response = await raw(nginxPort, '/api/ping');
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    });
    await waitFor('nginx sin capa 1', () => raw(barePort, '/'));
    await waitFor('pasarela', () => raw(gatewayPort, '/__pasarela/login'));

    await runMatrix(nginxPort, barePort, gatewayPort);
  } catch (error) {
    results.push({
      group: 'arranque',
      name: 'levantar contenedores',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    for (const name of Object.values(names)) {
      try {
        console.error(`--- logs de ${name}\n${docker(['logs', '--tail', '20', name])}`);
      } catch {}
    }
  } finally {
    if (keep) {
      console.log(`--keep: se quedan ${Object.values(names).join(', ')} en la red ${network}`);
    } else {
      for (const name of Object.values(names)) {
        try {
          docker(['rm', '-f', name]);
        } catch {}
      }
      try {
        docker(['network', 'rm', network]);
      } catch {}
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  let currentGroup = '';
  for (const result of results) {
    if (result.group !== currentGroup) {
      currentGroup = result.group;
      console.log(`\n[${currentGroup}]`);
    }
    console.log(
      `  ${result.ok ? 'OK   ' : 'FALLO'} ${result.name}${result.ok ? '' : ` -> ${result.detail}`}`,
    );
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(
    `\n${results.length - failed} de ${results.length} casos bien${failed ? `, ${failed} mal` : ''}.`,
  );
  process.exitCode = failed === 0 && results.length > 0 ? 0 : 1;
}

await main();
