// Prueba de punta a punta de la pila local (deploy/local/compose.local.yml)
// con el motor FALSO y la pasarela falsa, y el front de la 0.6.59 contra el
// backend nuevo (plan E1.12).
//
// 1. Release en una carpeta temporal con `scripts/release.mjs --out`, con la
//    web de la 0.6.59 (la v2 aún no existe; es justo lo que ve una pestaña
//    vieja abierta durante la actualización).
// 2. El motor falso empaquetado igual que en deploy/local/prepare.mjs.
// 3. Estado sembrado: favoritos con canales del catálogo del motor falso y el
//    asistente de preferencias ya hecho.
// 4. docker compose con el perfil `falso`, un proyecto propio
//    (aceneo-contraste) y un fichero de sustitución: puertos que elige Docker
//    (no chocan con la 0.6.59 local, que usa el 17792), las carpetas
//    temporales, la agenda de demostración y sin sincronización automática
//    (nada sale a internet salvo el `apk add ffmpeg` del contenedor).
// 5. Comprobaciones por la pasarela falsa (como en Umbrel) y por nginx:
//    /api/health, reproducción entera por /api/v1/channels/:id/stream + /ace/…
//    (llegan bytes de vídeo y el motor se queda sin sesiones al soltar),
//    /native/api/v1/ping sin login, /native/api/v1/state sin token → 401,
//    blindaje (/native/..%2fapi/state → 400), SSE por /api/v1/events y el
//    remux antiguo (/api/remux + /remux/…) si el contenedor tiene ffmpeg.
// 6. E1.12 con Playwright y el Chrome instalado: el index.html de la 0.6.59
//    carga sin errores de consola, pinta la agenda de demostración y la
//    biblioteca, y reproducir un canal del motor falso llena el <video>.
// 7. docker compose down y se borra la carpeta temporal (salvo --keep).
//
// Uso (desde ace-player-neo/, con Docker arrancado):
//   node scripts/test-compose-local.mjs [--keep] [--navegador chrome|chromium|no]
// Sale con 0 si todo va bien; si no, con 1 y el motivo.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const MONOREPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(MONOREPO_DIR, '..');
const COMPOSE_FILE = path.join(MONOREPO_DIR, 'deploy', 'local', 'compose.local.yml');
const FAKE_ENGINE_ENTRY = path.join(
  MONOREPO_DIR,
  'apps',
  'server',
  'test',
  'fake-engine',
  'cli.ts',
);
const LEGACY_RELEASE = path.join(REPO_DIR, 'ismaeloul-ace-player-neo', 'releases', '0.6.59');
/** Lo de la 0.6.59 que no es web (igual que prepare.mjs): nunca se sirve desde /www. */
const LEGACY_NOT_WEB = new Set(['server.js', 'engine-control.js', 'nginx.conf', '.complete']);
const PROJECT = 'aceneo-contraste';
/** Primer canal del catálogo por defecto del motor falso (`demoContentId(n)`): H.264 + AAC. */
const channelId = (/** @type {number} */ n) => `fa4ec0de${String(n).padStart(32, '0')}`;
const CHANNEL = channelId(1);
/**
 * Errores de mpegts.js (vendor de la 0.6.59) al destruir el reproductor con
 * MSE en un worker: Chrome cierra la MediaSource del worker mientras la
 * librería aún la toca. Salen de destroyPlayers() (traspaso o cierre de la
 * pestaña), una llamada que no pasa por el backend.
 */
const KNOWN_FRONT_NOISE = /Worker MediaSource attachment is closing/;

const { values: args } = parseArgs({
  options: {
    keep: { type: 'boolean', default: false },
    navegador: { type: 'string', default: 'chrome' },
  },
});

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const results = [];
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(/** @type {string} */ line) {
  process.stdout.write(`[compose] ${line}\n`);
}

/**
 * Anota una comprobación; si falla, corta la prueba.
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? 'OK   ' : 'FALLO'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

/**
 * @param {string[]} extra
 * @param {{ env?: Record<string, string>, allowFail?: boolean }} [options]
 */
function compose(extra, options = {}) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      PROJECT,
      '-f',
      COMPOSE_FILE,
      ...composeOverride,
      '--profile',
      'falso',
      ...extra,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`docker compose ${extra.join(' ')}: ${result.stderr || result.stdout}`);
  }
  return `${result.stdout ?? ''}`.trim();
}
/** `-f <override>` una vez escrito el fichero de sustitución. */
let composeOverride = /** @type {string[]} */ ([]);

/** Puerto del PC que Docker ha dado a un servicio. */
function hostPort(/** @type {string} */ service, /** @type {number} */ port) {
  const line = compose(['port', service, String(port)]).split('\n')[0] ?? '';
  const match = /:(\d+)$/.exec(line);
  if (!match?.[1]) throw new Error(`sin puerto publicado para ${service}:${port} (${line})`);
  return Number(match[1]);
}

/** Métricas del motor falso, preguntadas desde dentro de su contenedor. */
function fakeMetrics() {
  const text = compose([
    'exec',
    '-T',
    'motor_falso',
    'wget',
    '-qO-',
    'http://127.0.0.1:6878/__fake/metrics',
  ]);
  return /** @type {{ sessionsOpen: number, stopsReceived: number }} */ (JSON.parse(text));
}

// ---------------------------------------------------------------------------
// HTTP crudo (node:http no normaliza la ruta: /native/..%2fapi/state llega tal cual)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer, text: string, json: any }} Resp
 */

/**
 * @param {number} port
 * @param {string} rawPath
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown, maxBytes?: number, timeoutMs?: number }} [options]
 * @returns {Promise<Resp>}
 */
async function request(port, rawPath, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    let connected = false;
    try {
      return await new Promise((resolve, reject) => {
        const payload =
          options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: rawPath,
            method: options.method ?? 'GET',
            agent: false,
            headers: {
              ...(payload ? { 'content-type': 'application/json' } : {}),
              ...(options.headers ?? {}),
            },
            timeout: options.timeoutMs ?? 30_000,
          },
          (res) => {
            const chunks = /** @type {Buffer[]} */ ([]);
            let size = 0;
            const done = () => {
              const body = Buffer.concat(chunks);
              const text = body.toString('utf8');
              let json;
              try {
                json = JSON.parse(text);
              } catch {
                json = undefined;
              }
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text, json });
            };
            res.on('data', (chunk) => {
              chunks.push(chunk);
              size += chunk.length;
              /* Un directo no termina nunca: basta con los primeros bytes. */
              if (options.maxBytes && size >= options.maxBytes) {
                res.destroy();
                done();
              }
            });
            res.on('end', done);
            res.on('error', () => undefined);
          },
        );
        req.on('socket', (socket) => socket.on('connect', () => (connected = true)));
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(payload ?? undefined);
      });
    } catch (error) {
      lastError = error;
      const code = /** @type {{ code?: string }} */ (error).code ?? '';
      /* Solo se repite si la conexión no llegó a abrirse (loopback IPv4 de este PC). */
      if (connected || !['ECONNREFUSED', 'ECONNRESET'].includes(code)) throw error;
      await sleep(100 * attempt);
    }
  }
  throw lastError;
}

/** Sigue redirecciones relativas (las del motor, reescritas por nginx) hasta un 200. */
async function follow(
  /** @type {number} */ port,
  /** @type {string} */ start,
  /** @type {Record<string, string>} */ headers,
  maxBytes = 64 * 1024,
) {
  let url = start;
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await request(port, url, { headers, maxBytes });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, 'http://pila.local');
      url = `${next.pathname}${next.search}`;
      continue;
    }
    return { res, url };
  }
  throw new Error(`demasiadas redirecciones desde ${start}`);
}

/** ¿Empieza por paquetes MPEG-TS (0x47 cada 188 bytes)? */
function looksLikeTs(/** @type {Buffer} */ bytes) {
  if (bytes.length < 188 * 3) return false;
  return bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47;
}

/**
 * Abre /api/v1/events y devuelve lo que llega mientras dura `during`.
 * @param {number} port
 * @param {Record<string, string>} headers
 * @param {() => Promise<void>} during
 * @param {(text: string) => boolean} until
 */
function readSse(port, headers, during, until) {
  return new Promise((resolve, reject) => {
    let text = '';
    let status = 0;
    let type = '';
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/events',
        agent: false,
        headers: { accept: 'text/event-stream', ...headers },
      },
      (res) => {
        status = res.statusCode ?? 0;
        type = String(res.headers['content-type'] ?? '');
        res.setEncoding('utf8');
        let started = false;
        res.on('data', (chunk) => {
          text += chunk;
          if (!started) {
            started = true;
            during().catch(reject);
          }
          if (until(text)) {
            req.destroy();
            resolve({ status, type, text });
          }
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ status, type, text });
    }, 15_000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => resolve({ status, type, text }));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------

/** Barras normales: así Docker Desktop entiende las rutas de Windows en el Compose. */
const dockerPath = (/** @type {string} */ p) => p.replace(/\\/g, '/');

/** @param {string} work @param {string} session */
function writeOverride(work, session) {
  const bind = (/** @type {string} */ source, /** @type {string} */ target, readOnly = false) =>
    [
      `      - type: bind`,
      `        source: "${dockerPath(source)}"`,
      `        target: ${target}`,
      ...(readOnly ? ['        read_only: true'] : []),
    ].join('\n');
  const releases = path.join(work, 'releases');
  const yaml = [
    '# Generado por scripts/test-compose-local.mjs: puertos que elige Docker y carpetas temporales.',
    'services:',
    '  pasarela:',
    '    environment:',
    `      FAKE_GATEWAY_SESSION: "${session}"`,
    '    ports: !override',
    '      - "127.0.0.1::7792"',
    '  nginx:',
    '    ports: !override',
    '      - "127.0.0.1::80"',
    '    volumes: !override',
    bind(releases, '/releases', true),
    '  storage:',
    '    environment:',
    '      AUTO_SYNC: "false"',
    '      FOOTBALL_DEMO_ONLY: "true"',
    '      OLLAMA_BASE_URL: ""',
    '    volumes: !override',
    bind(releases, '/releases', true),
    bind(path.join(work, 'data'), '/data'),
    bind(path.join(work, 'apk-cache'), '/etc/apk/cache'),
    '  motor_falso:',
    '    volumes: !override',
    bind(path.join(work, 'motor-falso'), '/motor', true),
    '',
  ].join('\n');
  const file = path.join(work, 'compose.override.yml');
  writeFileSync(file, yaml);
  return file;
}

/** Estado 0.6.x con canales del motor falso (favoritos) y el asistente hecho. */
function seedState() {
  const item = (/** @type {number} */ n, /** @type {string} */ title) => ({
    id: channelId(n),
    title,
    type: 'fav',
    category: 'Deportes',
    date: '2026-09-20T10:00:00.000Z',
    fromWebSync: false,
    ih: false,
  });
  return {
    favorites: [
      item(1, 'Canal Deportes 1 HD --> PROVEEDOR ALFA'),
      item(2, 'Canal Deportes 2 HD --> PROVEEDOR ALFA'),
      item(4, 'Canal Fútbol FHD --> PROVEEDOR BETA'),
    ],
    history: [{ ...item(5, 'Canal Motor HD --> PROVEEDOR GAMMA'), type: 'recent' }],
    webSources: [],
    preferences: {
      onboardingComplete: true,
      country: 'Spain',
      leagues: [],
      teams: [],
      nationalities: [],
    },
  };
}

async function prepare(/** @type {string} */ work) {
  // Web de la 0.6.59 (sin lo que no es web) y release con release.mjs --out.
  const web = path.join(work, 'web-0.6.59');
  cpSync(LEGACY_RELEASE, web, {
    recursive: true,
    filter: (source) => !LEGACY_NOT_WEB.has(path.basename(source)),
  });
  execFileSync(
    process.execPath,
    [
      path.join(MONOREPO_DIR, 'scripts', 'release.mjs'),
      '--out',
      path.join(work, 'releases'),
      '--web-dist',
      web,
    ],
    { cwd: MONOREPO_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Motor falso en un solo .mjs, como deploy/local/prepare.mjs.
  await build({
    entryPoints: [FAKE_ENGINE_ENTRY],
    outfile: path.join(work, 'motor-falso', 'fake-engine.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: {
      js: 'import { createRequire as __aceCreateRequire } from "node:module"; const require = __aceCreateRequire(import.meta.url);',
    },
    absWorkingDir: MONOREPO_DIR,
    logLevel: 'warning',
  });
  mkdirSync(path.join(work, 'data'), { recursive: true });
  mkdirSync(path.join(work, 'apk-cache'), { recursive: true });
  writeFileSync(path.join(work, 'data', 'state.json'), JSON.stringify(seedState(), null, 2));
}

// ---------------------------------------------------------------------------
// Comprobaciones HTTP (paso 2 del encargo)
// ---------------------------------------------------------------------------

/**
 * @param {{ gw: number, nginx: number, cookie: Record<string, string> }} ports
 */
async function httpChecks({ gw, nginx, cookie }) {
  // --- Pasarela: login y salud ---
  const noLogin = await request(gw, '/api/health');
  check(
    'pasarela: /api/health sin login → 401 (login de Umbrel)',
    noLogin.status === 401,
    `${noLogin.status}`,
  );

  /* El vigilante del motor tarda una vuelta (10 s) en verlo en línea. */
  let health = await request(gw, '/api/health', { headers: cookie });
  for (let i = 0; i < 40 && health.json?.components?.engine?.online !== true; i += 1) {
    await sleep(1000);
    health = await request(gw, '/api/health', { headers: cookie });
  }
  check(
    '/api/health → 200 por la pasarela (motor falso en línea)',
    health.status === 200 &&
      health.json?.success === true &&
      health.json?.components?.engine?.online === true,
    `${health.status} versión ${health.json?.version} motor ${health.json?.components?.engine?.status} agenda ${health.json?.components?.agenda?.status}`,
  );
  const direct = await request(nginx, '/api/health');
  check('/api/health → 200 por nginx directo', direct.status === 200, `${direct.status}`);
  const live = await request(gw, '/api/v1/health/live', { headers: cookie });
  check('/api/v1/health/live → 200', live.status === 200, live.text.slice(0, 80));

  const index = await request(gw, '/', { headers: cookie });
  check(
    'GET / sirve el index.html de la 0.6.59',
    index.status === 200 && index.text.includes('/api/playback/claim'),
    `${index.status} ${index.headers['content-type']}`,
  );

  // --- Reproducción de punta a punta: /api/v1/channels/:id/stream + /ace/… ---
  const viewer = 'visor-compose-1';
  const grant = await request(
    gw,
    `/api/v1/channels/${CHANNEL}/stream?client=web&viewer=${viewer}&device=pc-compose&title=Canal%20Deportes%201`,
    { headers: cookie, timeoutMs: 60_000 },
  );
  check(
    'GET /api/v1/channels/:id/stream → 200 con URL /ace/…',
    grant.status === 200 &&
      typeof grant.json?.url === 'string' &&
      grant.json.url.startsWith('/ace/'),
    `${grant.status} ${grant.json?.protocol ?? ''} ${grant.json?.url ?? grant.text.slice(0, 120)}`,
  );
  let metrics = fakeMetrics();
  check(
    'el motor falso tiene una sesión abierta',
    metrics.sessionsOpen === 1,
    `${metrics.sessionsOpen}`,
  );
  let videoBytes;
  if (grant.json.protocol === 'hls') {
    const { res: list } = await follow(gw, grant.json.url, cookie);
    const segment = list.text.split('\n').find((line) => line.trim() && !line.startsWith('#'));
    check(
      'lista HLS del motor por /ace/',
      list.status === 200 && Boolean(segment),
      `${list.status}`,
    );
    const segUrl = new URL(String(segment).trim(), `http://pila.local${grant.json.url}`);
    const { res: seg } = await follow(gw, `${segUrl.pathname}${segUrl.search}`, cookie);
    check(
      'segmento TS por /ace/',
      seg.status === 200 && looksLikeTs(seg.body),
      `${seg.body.length} bytes`,
    );
    videoBytes = seg.body.length;
  } else {
    const { res: ts, url } = await follow(gw, grant.json.url, cookie, 256 * 1024);
    check(
      'vídeo MPEG-TS por /ace/ → /content/ (llegan bytes de vídeo)',
      ts.status === 200 && looksLikeTs(ts.body),
      `${ts.body.length} bytes desde ${url.split('/').slice(0, 3).join('/')}/…`,
    );
    videoBytes = ts.body.length;
  }
  const sid = grant.json.session.id;
  const beat = await request(gw, `/api/v1/sessions/${sid}/heartbeat`, {
    method: 'POST',
    headers: cookie,
    body: { viewer, playing: true },
  });
  check(
    'latido de la sesión → 200',
    beat.status === 200,
    `${beat.status} visores ${beat.json?.viewers}`,
  );
  const released = await request(gw, `/api/v1/sessions/${sid}/release`, {
    method: 'POST',
    headers: cookie,
    body: { viewer, reason: 'user' },
  });
  check(
    'release → sesión cerrada',
    released.status === 200 && released.json?.sessionClosed === true,
    released.text.slice(0, 120),
  );
  for (let i = 0; i < 20; i += 1) {
    metrics = fakeMetrics();
    if (metrics.sessionsOpen === 0) break;
    await sleep(250);
  }
  check(
    'el motor falso se queda sin sesiones (stop enviado)',
    metrics.sessionsOpen === 0 && metrics.stopsReceived >= 1,
    `abiertas ${metrics.sessionsOpen}, stops ${metrics.stopsReceived}`,
  );

  // --- Ruta nativa y blindaje ---
  const ping = await request(gw, '/native/api/v1/ping');
  check(
    '/native/api/v1/ping sin login → 200',
    ping.status === 200 && typeof ping.json?.version === 'string',
    `${ping.status} ${ping.text.slice(0, 80)}`,
  );
  const state401 = await request(gw, '/native/api/v1/state');
  check(
    '/native/api/v1/state sin token → 401',
    state401.status === 401,
    `${state401.status} ${state401.text.slice(0, 80)}`,
  );
  const health401 = await request(gw, '/native/api/v1/health');
  check('/native/api/v1/health sin token → 401', health401.status === 401, `${health401.status}`);
  const legacyNative = await request(gw, '/native/api/state', {
    headers: { authorization: 'Bearer x.y' },
  });
  check(
    '/native/api/state (ruta antigua por la puerta nativa) → 403',
    legacyNative.status === 403,
    `${legacyNative.status}`,
  );
  const escape = await request(gw, '/native/..%2fapi/state');
  check('blindaje: /native/..%2fapi/state → 400', escape.status === 400, `${escape.status}`);
  const escapeDirect = await request(nginx, '/native/..%2fapi/state');
  check(
    'blindaje por nginx directo: /native/..%2fapi/state → 400',
    escapeDirect.status === 400,
    `${escapeDirect.status}`,
  );
  const spoof = await request(gw, '/api/state', {
    headers: { ...cookie, 'x-ace-origin': 'native' },
  });
  check(
    'X-Ace-Origin del cliente se pisa (web por la pasarela) → 200',
    spoof.status === 200,
    `${spoof.status}`,
  );

  // --- SSE ---
  const sse = /** @type {{ status: number, type: string, text: string }} */ (
    await readSse(
      gw,
      cookie,
      async () => {
        await sleep(300);
        await request(gw, '/api/preferences', {
          method: 'POST',
          headers: cookie,
          body: {
            onboardingComplete: true,
            country: 'Spain',
            leagues: ['LaLiga'],
            teams: [],
            nationalities: [],
          },
        });
      },
      (text) => text.includes('event: state.changed'),
    )
  );
  check(
    'SSE /api/v1/events por la pasarela: text/event-stream y llega state.changed',
    sse.status === 200 &&
      sse.type.startsWith('text/event-stream') &&
      sse.text.includes('retry:') &&
      sse.text.includes('event: state.changed'),
    `${sse.status} ${sse.type} ${JSON.stringify(sse.text.slice(0, 60))}`,
  );
  const sseNative = await request(gw, '/native/api/v1/events', { timeoutMs: 5000 });
  check(
    'SSE por la puerta nativa sin token → 401',
    sseNative.status === 401,
    `${sseNative.status}`,
  );

  // --- Rutas antiguas que usa la 0.6.59 ---
  const legacyState = await request(gw, '/api/state', { headers: cookie });
  check(
    'GET /api/state con la semilla',
    legacyState.status === 200 && legacyState.json?.favorites?.[0]?.id === CHANNEL,
    `${legacyState.status} favoritos ${legacyState.json?.favorites?.length}`,
  );
  const engine = await request(gw, '/api/engine/status', { headers: cookie });
  check(
    'GET /api/engine/status → online',
    engine.status === 200 && engine.json?.online === true,
    engine.text.slice(0, 120),
  );
  const football = await request(gw, '/api/football', { headers: cookie });
  const matches = (football.json?.days ?? []).flatMap(
    (/** @type {{ matches: unknown[] }} */ d) => d.matches,
  );
  check(
    'GET /api/football (demo)',
    football.status === 200 && football.json?.demo === true && matches.length === 10,
    `${matches.length} partidos`,
  );

  // --- Remux antiguo (iPhone 0.6.x), si el contenedor tiene ffmpeg ---
  const ffmpeg = compose(['exec', '-T', 'storage', 'sh', '-c', 'command -v ffmpeg || true']);
  let remux = 'sin ffmpeg en el contenedor (el apk add necesita red): no comprobado';
  if (ffmpeg) {
    const started = await request(gw, `/api/remux?id=${CHANNEL}&dev=iphone-compose`, {
      headers: cookie,
      timeoutMs: 60_000,
    });
    check(
      'GET /api/remux → 200 {url, token}',
      started.status === 200 &&
        /^\/remux\/[a-f0-9]{40}\/index\.m3u8$/.test(started.json?.url ?? ''),
      `${started.status} ${started.text.slice(0, 120)}`,
    );
    const list = await request(gw, started.json.url, { headers: cookie });
    check(
      'lista fMP4 del remux por /remux/',
      list.status === 200 && list.text.includes('#EXT-X-MAP'),
      `${list.status}`,
    );
    const base = started.json.url.replace(/index\.m3u8$/, '');
    const init = await request(gw, `${base}init.mp4`, { headers: cookie });
    check(
      'init.mp4 del remux (ftyp)',
      init.status === 200 && init.body.subarray(4, 8).toString('latin1') === 'ftyp',
      `${init.body.length} bytes`,
    );
    const stop = await request(gw, '/api/remux/stop', {
      method: 'POST',
      headers: cookie,
      body: { id: CHANNEL, dev: 'iphone-compose', token: started.json.token },
    });
    check(
      'POST /api/remux/stop → parado',
      stop.status === 200 && stop.json?.stopped === true,
      stop.text.slice(0, 120),
    );
    remux = 'comprobado';
  }
  log(`remux antiguo: ${remux}`);
  return { videoBytes, remux };
}

// ---------------------------------------------------------------------------
// E1.12: el front de la 0.6.59 contra el backend nuevo (paso 3 del encargo)
// ---------------------------------------------------------------------------

/**
 * @param {{ gw: number, session: string }} options
 */
async function frontChecks({ gw, session }) {
  const { chromium } = await import('@playwright/test');
  const base = `http://127.0.0.1:${gw}`;
  const browser = await chromium.launch({
    ...(args.navegador === 'chrome' ? { channel: 'chrome' } : {}),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const apiCalls = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'UMBREL_PROXY_TOKEN', value: session, url: base }]);
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/')) apiCalls.push(`${response.status()} ${url.pathname}`);
    });
    const loaded = await page.goto(`${base}/`, { waitUntil: 'load' });
    check('la página carga (200)', loaded?.status() === 200, `${loaded?.status()}`);

    // Agenda de demostración pintada.
    await page.waitForSelector('.match-row', { timeout: 30_000 });
    const matchRows = await page.locator('.match-row').count();
    const agendaText = await page.locator('.match-row').first().innerText();
    check(
      'la agenda de demostración se pinta',
      matchRows > 0,
      `${matchRows} partidos · "${agendaText.replace(/\s+/g, ' ').slice(0, 60)}"`,
    );

    // Biblioteca: los favoritos sembrados, sin el modo demo del propio front.
    await page.waitForSelector(`.ch-row[data-id="${CHANNEL}"]`, { timeout: 30_000 });
    const rows = await page.locator('#libBody .ch-row').count();
    const frontDemo = await page.evaluate('typeof S === "object" ? Boolean(S.demo) : null');
    check(
      'la biblioteca se ve (favoritos del backend)',
      rows >= 3 && frontDemo === false,
      `${rows} canales · demo del front ${frontDemo}`,
    );
    check(
      'el front habla con el backend nuevo',
      apiCalls.some((c) => c.startsWith('200 /api/state')) &&
        apiCalls.some((c) => c.startsWith('200 /api/football')),
      apiCalls.slice(0, 8).join(', '),
    );

    // Reproducir un canal del motor falso: el <video> recibe datos.
    await page.locator(`.ch-row[data-id="${CHANNEL}"] .ch-meta`).click();
    const playing = await page
      .waitForFunction(
        () => {
          const video = /** @type {any} */ (globalThis).document.querySelector('video');
          return Boolean(
            video &&
            video.readyState >= 2 &&
            video.buffered.length > 0 &&
            video.buffered.end(0) > 1,
          );
        },
        undefined,
        { timeout: 60_000 },
      )
      .then(() => true)
      .catch(() => false);
    const videoState = await page.evaluate(() => {
      const video = /** @type {any} */ (globalThis).document.querySelector('video');
      if (!video) return null;
      return {
        readyState: video.readyState,
        buffered: video.buffered.length ? Number(video.buffered.end(0).toFixed(1)) : 0,
        currentTime: Number(video.currentTime.toFixed(1)),
        width: video.videoWidth,
        height: video.videoHeight,
        paused: video.paused,
      };
    });
    check(
      'reproducir un canal del motor falso: el <video> recibe datos',
      playing,
      JSON.stringify(videoState),
    );
    /* El front arranca con 6 s en el búfer (modo Equilibrado, PB.balanced) y
       el motor falso manda una ráfaga de 2 s y luego en tiempo real. */
    const advanced = await page
      .waitForFunction(
        () => {
          const video = /** @type {any} */ (globalThis).document.querySelector('video');
          return Boolean(video && !video.paused && video.currentTime > 1);
        },
        undefined,
        { timeout: 45_000 },
      )
      .then(() =>
        page.evaluate(
          () => /** @type {any} */ (globalThis).document.querySelector('video')?.currentTime ?? 0,
        ),
      )
      .catch(() => 0);
    check('el vídeo se reproduce (avanza)', advanced > 1, `currentTime ${advanced.toFixed(1)} s`);
    const cookieHeader = { cookie: `UMBREL_PROXY_TOKEN=${session}` };
    const playback = await request(gw, '/api/playback', { headers: cookieHeader });
    check(
      'el mando 0.6.x queda en el backend (claim)',
      playback.json?.nowPlaying?.id === CHANNEL,
      JSON.stringify(playback.json?.nowPlaying ?? null),
    );

    // Traspaso 0.6.x: otro "dispositivo" (otro contexto, otro DEV_ID) pone otro
    // canal; la primera pestaña lo ve en su sondeo de /api/playback (5 s) y se aparta.
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await otherContext.addCookies([{ name: 'UMBREL_PROXY_TOKEN', value: session, url: base }]);
    const other = await otherContext.newPage();
    other.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`[otra pestaña] ${message.text()}`);
    });
    other.on('pageerror', (error) =>
      consoleErrors.push(`[otra pestaña] pageerror: ${error.message}`),
    );
    await other.goto(`${base}/`, { waitUntil: 'load' });
    const second = channelId(2);
    await other.waitForSelector(`.ch-row[data-id="${second}"]`, { timeout: 30_000 });
    await other.locator(`.ch-row[data-id="${second}"] .ch-meta`).click();
    const otherPlaying = await other
      .waitForFunction(
        () => {
          const video = /** @type {any} */ (globalThis).document.querySelector('video');
          return Boolean(video && video.readyState >= 2 && video.buffered.length > 0);
        },
        undefined,
        { timeout: 60_000 },
      )
      .then(() => true)
      .catch(() => false);
    check('otro dispositivo reproduce otro canal', otherPlaying);
    /* El aviso ("ha pasado a otro dispositivo") va a la capa del reproductor y
       dura unos segundos; lo que queda es el reproductor parado. Se sondea
       desde aquí con evaluate: waitForFunction con texto usa eval y la CSP de
       nginx (sin 'unsafe-eval') lo prohíbe; `S` es un const del script, no
       una propiedad de window. */
    let handedOff = false;
    for (let i = 0; i < 80 && !handedOff; i += 1) {
      handedOff = Boolean(
        await page.evaluate('typeof S === "object" && !S.playing && !S.connecting && !S.currentId'),
      );
      if (!handedOff) await sleep(250);
    }
    const afterHandoff = await request(gw, '/api/playback', { headers: cookieHeader });
    let metrics = fakeMetrics();
    for (let i = 0; i < 20 && metrics.sessionsOpen > 1; i += 1) {
      await sleep(250);
      metrics = fakeMetrics();
    }
    check(
      'traspaso 0.6.x: la primera pestaña se aparta y el motor solo tiene la sesión nueva',
      handedOff && afterHandoff.json?.nowPlaying?.id === second && metrics.sessionsOpen === 1,
      `primera pestaña parada ${handedOff} · mando ${afterHandoff.json?.nowPlaying?.id?.slice(-4)} · sesiones ${metrics.sessionsOpen}`,
    );

    // Al cerrar las pestañas el front manda el stop al motor (pagehide).
    await page.close({ runBeforeUnload: true });
    await other.close({ runBeforeUnload: true });
    await otherContext.close();
    metrics = fakeMetrics();
    for (let i = 0; i < 40 && metrics.sessionsOpen > 0; i += 1) {
      await sleep(250);
      metrics = fakeMetrics();
    }
    check(
      'al cerrar la pestaña, el motor falso se queda sin sesiones',
      metrics.sessionsOpen === 0,
      `abiertas ${metrics.sessionsOpen}`,
    );
    /* Ruido conocido del propio front 0.6.59 (KNOWN_FRONT_NOISE): mpegts.js
       al destruir su MediaSource del worker (al apartarse en el traspaso o al
       cerrar). Es del cliente y no depende del backend. */
    const unexpected = consoleErrors.filter((line) => !KNOWN_FRONT_NOISE.test(line));
    const known = consoleErrors.length - unexpected.length;
    check(
      'sin errores de consola',
      unexpected.length === 0,
      unexpected.length
        ? unexpected.slice(0, 5).join(' | ')
        : known
          ? `${known} avisos conocidos de mpegts.js al destruir el reproductor`
          : '',
    );
    await context.close();
  } finally {
    await browser.close();
  }
  return { consoleErrors, apiCalls };
}

// ---------------------------------------------------------------------------

async function main() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'ace-compose-'));
  const session = randomBytes(12).toString('hex');
  log(`carpeta temporal: ${work}`);
  let up = false;
  try {
    await prepare(work);
    log('release (0.7.0 con la web de la 0.6.59) y motor falso preparados');
    composeOverride = ['-f', writeOverride(work, session)];
    compose(['down', '-v', '--remove-orphans'], { allowFail: true });
    const started = Date.now();
    up = true;
    compose(['up', '-d', '--wait', '--wait-timeout', '240']);
    log(`pila arriba en ${Math.round((Date.now() - started) / 1000)} s (proyecto ${PROJECT})`);
    const gw = hostPort('pasarela', 7792);
    const nginx = hostPort('nginx', 80);
    log(`pasarela en 127.0.0.1:${gw} · nginx en 127.0.0.1:${nginx}`);
    const cookie = { cookie: `UMBREL_PROXY_TOKEN=${session}` };

    const httpResult = await httpChecks({ gw, nginx, cookie });
    if (args.navegador !== 'no') await frontChecks({ gw, session });
    else log('E1.12 sin navegador (--navegador no)');

    const logs = compose(['logs', '--no-color', 'storage']);
    const errors = logs.split('\n').filter((line) => /"level":(50|60)/.test(line));
    check('sin errores en el log del backend', errors.length === 0, errors.slice(0, 3).join(' | '));
    log(
      `TODO BIEN · ${results.length} comprobaciones · ${httpResult.videoBytes} bytes de vídeo · remux ${httpResult.remux}`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, checks: results.length, remux: httpResult.remux })}\n`,
    );
    return true;
  } catch (error) {
    if (up) {
      const logs = compose(['logs', '--no-color', '--tail', '40'], { allowFail: true });
      log(`últimas líneas de la pila:\n${logs}`);
    }
    throw error;
  } finally {
    if (!args.keep) {
      compose(['down', '-v', '--remove-orphans'], { allowFail: true });
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      log('pila bajada y carpeta temporal borrada');
    } else {
      log(`--keep: la pila sigue arriba (docker compose -p ${PROJECT} … down para bajarla)`);
    }
  }
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (error) => {
    log(`FALLO: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
