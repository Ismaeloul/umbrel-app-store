// Contraste del backend nuevo con la 0.6.59 (plan E1.4).
//
// Arranca, a la vez y con el MISMO entorno, el server.js ORIGINAL de la 0.6.59
// (ismaeloul-ace-player-neo/releases/0.6.59/server.js, sin dependencias) y el
// backend nuevo empaquetado (apps/server/build.mjs, lo mismo que va a la
// release). Cada uno sobre su copia (A y B) del mismo DATA_DIR sintético. Les
// lanza la misma secuencia de lecturas y mutaciones a TODAS las rutas antiguas
// de docs/api.md y compara las respuestas normalizadas (fechas relativas a la
// petición, ids aleatorios numerados por orden de aparición, decimales con
// tolerancia). Al final compara también los state.json de las dos copias, los
// reinicia a los dos (el estado tiene que sobrevivir igual) y repite las
// comprobaciones anti-SSRF con ALLOW_PRIVATE_SYNC_URLS=false.
//
// Sin motor (ACESTREAM_HOST apunta a un puerto cerrado), sin comprobador, sin
// engine-control, sin Ollama y con la agenda de demostración: nada sale a
// internet. Los directorios se bajan de un servidor HTTP local en [::1] (el
// loopback IPv4 de este PC corta conexiones de vez en cuando; los dos backends
// escuchan en 0.0.0.0, así que a ellos se les pide por 127.0.0.1 con
// reintentos SOLO si la conexión no llega a establecerse).
//
// Cualquier diferencia que no explique una fila de docs/compat.md es un fallo.
// Las diferencias permitidas están en ALLOWED (abajo), cada una con su fila.
//
// Uso (desde ace-player-neo/):
//   node scripts/contraste.mjs [--keep] [--md <fichero>] [--json <fichero>] [--solo <S01,S02>]
//     --keep   deja la carpeta temporal (datos A y B, logs de los dos servidores)
//     --md     escribe la tabla de pasos en Markdown (para docs/analisis/contraste-0659.md)
//     --json   vuelca todos los resultados normalizados
// Sale con 0 si no hay diferencias sin explicar; si no, con 1.
import { fork, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const MONOREPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(MONOREPO_DIR, '..');
const SERVER_DIR = path.join(MONOREPO_DIR, 'apps', 'server');
const LEGACY_SERVER_JS = path.join(
  REPO_DIR,
  'ismaeloul-ace-player-neo',
  'releases',
  '0.6.59',
  'server.js',
);

const { values: args } = parseArgs({
  options: {
    keep: { type: 'boolean', default: false },
    md: { type: 'string' },
    json: { type: 'string' },
    solo: { type: 'string' },
  },
});

/** Inicio de la ejecución: las fechas anteriores son de la semilla y se comparan tal cual. */
const RUN_START = Date.now();

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(/** @type {string} */ line) {
  process.stdout.write(`[contraste] ${line}\n`);
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

/** Hash de 40 hex a partir de un prefijo hex (relleno con ceros). */
const hx = (/** @type {string} */ prefix) => `${prefix}${'0'.repeat(40)}`.slice(0, 40);

const H = {
  f1: hx('f1dace'),
  f2: hx('f2dace'),
  f3: hx('f3dace'),
  ih1: hx('1f0001'),
  h1: hx('a1a1a1'),
  h2: hx('a2a2a2'),
  w1: hx('e1e1e1'),
  w2: hx('e2e2e2'),
  w3: hx('e3e3e3'),
  w4: hx('e4e4e4'),
  w5: hx('e5e5e5'),
  html1: hx('c1c1c1'),
  html2: hx('c2c2c2'),
  b1: hx('b1b1b1'),
  b2: hx('b2b2b2'),
  n1: hx('d1d1d1'),
  n2: hx('d2d2d2'),
  n3: hx('d3d3d3'),
  put1: hx('9a9a9a'),
  remux: hx('7e7e7e'),
  files: hx('7f7f7f'),
};

/** Ficheros de un remux "terminado" en DATA_DIR/remux (los dos servidores vacían la carpeta al arrancar). */
function writeRemuxFiles(/** @type {Ctx} */ ctx) {
  const dir = path.join(ctx.srv.dataDir, 'remux', H.files);
  mkdirSync(path.join(dir, 'sub'), { recursive: true });
  writeFileSync(
    path.join(dir, 'index.m3u8'),
    '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2.0,\nindex3.m4s\n',
  );
  writeFileSync(path.join(dir, 'init.mp4'), Buffer.from('0123456789'));
  writeFileSync(path.join(dir, 'index3.m4s'), Buffer.alloc(0));
  writeFileSync(path.join(dir, 'viejo.ts'), Buffer.from('G@ts'));
  writeFileSync(path.join(dir, 'otro.bin'), Buffer.from('bin'));
}

/** Lista M3U con los rótulos de la agenda de demostración (casan con la resolución). */
function m3uPrincipal() {
  return [
    '#EXTM3U',
    `#EXTINF:-1 tvg-id="DAZN LaLiga" group-title="Deportes",DAZN LaLiga 1080 --> NEW ERA`,
    `acestream://${H.w1}`,
    `#EXTINF:-1 group-title="Deportes",M+ Liga de Campeones --> ELCANO`,
    `acestream://${H.w2}`,
    `#EXTINF:-1 group-title="Generalistas",La 1 HD`,
    H.w3,
    `#EXTINF:-1,Oculto por el usuario`,
    `acestream://${H.w4}`,
    `#EXTINF:-1 tvg-id="GOL" group-title="Deportes",<b>GOL Play</b>&nbsp;FHD`,
    `http://visor.example/player?id=${H.w5}`,
    '',
  ].join('\r\n');
}

function htmlAgregador() {
  return [
    '<html><body>',
    `<a href="acestream://${H.html1}">DAZN 1 HD</a>`,
    `<a href='https://x.example/ver?content_id=${H.html2}'>Zapping <i>directo</i></a>`,
    `texto suelto acestream://${hx('c3c3c3')}`,
    '</body></html>',
  ].join('\n');
}

/** Lista M3U distinta para cada número (para llegar al tope de 8 directorios). */
function m3uNumero(/** @type {number} */ n) {
  return `#EXTM3U\n#EXTINF:-1 group-title="Lista ${n}",Canal ${n}\nacestream://${hx(`${n}${n}${n}ab`)}\n`;
}

/** Estado 0.6.x sintético (state.json) con casos que obligan a normalizar. */
function seedState(/** @type {string} */ listas) {
  return {
    favorites: [
      {
        id: H.f1,
        title: 'DAZN LaLiga 1080 --> NEW ERA',
        type: 'fav',
        category: 'Deportes',
        date: '2026-09-01T10:00:00.000Z',
        fromWebSync: false,
        ih: false,
      },
      {
        id: `acestream://${H.f2.toUpperCase()}`,
        title: '  M+   Liga de Campeones  ',
        category: 'Fútbol',
        date: '2026-09-02T10:00:00.000Z',
      },
      { hash: H.f3, name: '<b>La 1 HD</b>', date: '2026-09-03T10:00:00+02:00' },
      { id: 'sin-hash', title: 'roto' },
      { id: H.f1, title: 'Duplicado que se descarta' },
      {
        id: H.ih1,
        title: 'Infohash del buscador',
        ih: true,
        category: 'x'.repeat(60),
        date: '2026-09-04T10:00:00.000Z',
        alias: 'Infohash del buscador',
      },
    ],
    history: [
      { id: H.h1, title: 'GOL Play', type: 'recent', date: '2026-09-10T20:00:00.000Z' },
      {
        url: `https://visor.example/?content_id=${H.h2}`,
        title: 'Zapping --> Otro proveedor',
        date: '2026-09-11T20:00:00.000Z',
        type: 'fav',
      },
      { id: H.f1, title: 'DAZN LaLiga (historial)', date: '2026-09-12T20:00:00.000Z' },
    ],
    webSources: [
      {
        id: 'principal',
        name: 'Principal',
        url: `${listas}/principal.m3u`,
        type: 'm3u',
        streams: [
          {
            id: H.w1,
            title: 'DAZN LaLiga 1080 --> NEW ERA',
            alias: 'DAZN LaLiga',
            type: 'web',
            category: 'Deportes',
            date: '2026-09-20T08:00:00.000Z',
            fromWebSync: true,
          },
          {
            id: H.w2,
            title: 'M+ Liga de Campeones --> ELCANO',
            type: 'web',
            category: 'Deportes',
            date: '2026-09-20T08:00:00.000Z',
            fromWebSync: true,
          },
          { id: H.w3, title: 'La 1 HD', date: '2026-09-20T08:00:00.000Z', fromWebSync: true },
          { id: H.w4, title: 'Oculto', date: '2026-09-20T08:00:00.000Z', fromWebSync: true },
        ],
        renames: { [H.w3]: 'La 1 (renombrado)', 'no-hash': 'x' },
        hidden: [H.w4, 'no-hash', H.w4],
        syncedAt: '2026-09-20T08:00:00.000Z',
        lastErrorAt: null,
        lastError: null,
      },
      {
        id: 'agregador',
        name: '  Agregador   web ',
        url: `${listas}/agregador.html`,
        type: 'html',
        streams: [
          { id: H.html1, title: 'DAZN 1 HD', date: '2026-09-19T08:00:00.000Z', fromWebSync: true },
        ],
        syncedAt: '2026-09-19T08:00:00.000Z',
        lastErrorAt: '2026-09-20T09:00:00.000Z',
        lastError: 'HTTP_503!',
      },
      { id: 'ftp', name: 'No vale', url: 'ftp://x.example/lista.m3u', type: 'm3u' },
    ],
    activeWebSourceId: 'principal',
    preferences: {
      onboardingComplete: true,
      country: 'España',
      leagues: ['LaLiga', 'laliga', 'Champions League'],
      teams: ['Real Madrid', 'Atlético de Madrid'],
      nationalities: ['España'],
    },
    channelBindings: [
      {
        channel: 'DAZN LaLiga',
        id: H.b1,
        title: 'DAZN LaLiga (vínculo)',
        ih: false,
        updatedAt: '2026-09-15T10:00:00.000Z',
      },
      { channel: '***', id: H.b2, title: 'sin clave', updatedAt: '2026-09-15T10:00:00.000Z' },
    ],
    sourceReports: [
      {
        reportId: 'rep0000000000001',
        id: H.w2,
        title: 'M+ Liga',
        source: 'm3u',
        channel: 'M+ Liga de Campeones',
        matchId: 'demo-5',
        reason: 'stuttering',
        state: 'failed',
        checkReason: 'starved',
        reportCount: 2,
        reportedAt: '2026-09-18T10:00:00.000Z',
        lastCheckedAt: '2026-09-18T10:05:00.000Z',
        quarantineUntil: '2026-09-18T10:15:00.000Z',
      },
      {
        reportId: 'rep0000000000002',
        id: H.w1,
        title: 'DAZN',
        source: 'm3u',
        channel: 'DAZN LaLiga',
        matchId: 'demo-4',
        reason: 'not_starting',
        state: 'working',
        checkReason: 'playable_media',
        reportCount: 1,
        reportedAt: '2026-09-18T11:00:00.000Z',
        lastCheckedAt: '2026-09-18T11:05:00.000Z',
        quarantineUntil: null,
      },
    ],
    channelFeedback: [
      {
        id: H.w3,
        title: 'La 1',
        channel: 'La 1 HD',
        verdict: 'incorrect',
        reason: 'wrong_channel',
        corrections: 1,
        updatedAt: '2026-09-17T10:00:00.000Z',
      },
    ],
    sourceStats: {
      hashes: {
        [H.w1]: { intentos: 3, exitos: 2, caidas: 1, segundos: 3600, ultimo: 1789900000000 },
      },
      proveedores: {
        'new era': { intentos: 5, exitos: 4, caidas: 1, segundos: 7200, ultimo: 1789900000000 },
      },
    },
    nowPlaying: null,
  };
}

// ---------------------------------------------------------------------------
// Servidor local de directorios (M3U/HTML y errores), en [::1]
// ---------------------------------------------------------------------------

function startListas() {
  /** @type {Map<string, number>} */
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://listas');
    const route = url.pathname;
    hits.set(route, (hits.get(route) ?? 0) + 1);
    const send = (
      /** @type {number} */ status,
      /** @type {string} */ body,
      type = 'text/plain',
    ) => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
      res.end(body);
    };
    const numbered = /^\/lista-(\d+)\.m3u$/.exec(route);
    if (route === '/principal.m3u') return send(200, m3uPrincipal(), 'audio/x-mpegurl');
    if (route === '/agregador.html') return send(200, htmlAgregador(), 'text/html');
    if (numbered) return send(200, m3uNumero(Number(numbered[1])), 'audio/x-mpegurl');
    if (route === '/vacia.m3u') return send(200, '#EXTM3U\n# nada\n');
    if (route === '/404') return send(404, 'no');
    if (route === '/500') return send(500, 'no');
    if (route === '/429') return send(429, 'despacio');
    if (route === '/redir-ok') {
      res.writeHead(302, { location: '/principal.m3u' });
      return res.end();
    }
    if (route === '/bucle-a' || route === '/bucle-b') {
      res.writeHead(302, { location: route === '/bucle-a' ? '/bucle-b' : '/bucle-a' });
      return res.end();
    }
    const chain = /^\/cadena-(\d+)$/.exec(route);
    if (chain) {
      res.writeHead(302, { location: `/cadena-${Number(chain[1]) + 1}` });
      return res.end();
    }
    if (route === '/gzip.m3u') {
      res.writeHead(200, { 'content-type': 'audio/x-mpegurl', 'content-encoding': 'gzip' });
      return res.end(gzipSync(m3uPrincipal()));
    }
    if (route === '/grande.m3u') {
      const line = `#EXTINF:-1,Relleno\nacestream://${H.w1}\n`;
      return send(200, line.repeat(Math.ceil((2 * 1024 * 1024 + 10) / line.length)));
    }
    if (route === '/grande-sin-longitud.m3u') {
      res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
      const chunk = `#EXTINF:-1,Relleno\nacestream://${H.w1}\n`.repeat(2000);
      let sent = 0;
      const pump = () => {
        while (sent < 2 * 1024 * 1024 + 65536) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once('drain', pump);
        }
        res.end();
      };
      pump();
      return undefined;
    }
    if (route === '/corta') {
      req.socket.destroy();
      return undefined;
    }
    if (route === '/cuelga') return undefined; // no contesta nunca: fetch_timeout
    return send(404, 'no existe');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, hits, base: `http://[::1]:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Procesos
// ---------------------------------------------------------------------------

/** Un puerto libre en esa dirección (el SO lo elige y se suelta enseguida). */
function freePort(/** @type {string} */ host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * @typedef {{ status: number, headers: Record<string, string>, text: string, json: unknown, sentAt: number }} Resp
 * @typedef {{ method?: string, path: string, body?: unknown, raw?: string | Buffer, headers?: Record<string, string> }} Req
 */

/** Errores de conexión en los que la petición no llegó al servidor: se puede repetir. */
const RETRYABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']);

/**
 * Petición HTTP a 127.0.0.1 con la ruta CRUDA (sin normalizar: /api/%zz,
 * /remux/..%2f…). Solo reintenta si no se llegó a enviar la petición.
 * @param {number} port
 * @param {Req} req
 * @returns {Promise<Resp>}
 */
async function request(port, req, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let sent = false;
    try {
      return await new Promise((resolve, reject) => {
        const payload =
          req.raw !== undefined
            ? Buffer.from(req.raw)
            : req.body === undefined
              ? null
              : Buffer.from(JSON.stringify(req.body));
        const sentAt = Date.now();
        const r = http.request(
          {
            host: '127.0.0.1',
            port,
            path: req.path,
            method: req.method ?? 'GET',
            agent: false,
            headers: {
              ...(payload ? { 'content-type': 'application/json' } : {}),
              ...(req.headers ?? {}),
            },
            timeout: 60_000,
          },
          (res) => {
            const chunks = /** @type {Buffer[]} */ ([]);
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let json;
              try {
                json = text ? JSON.parse(text) : undefined;
              } catch {
                json = undefined;
              }
              /** @type {Record<string, string>} */
              const headers = {};
              for (const [key, value] of Object.entries(res.headers)) {
                headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
              }
              resolve({ status: res.statusCode ?? 0, headers, text, json, sentAt });
            });
            res.on('error', reject);
          },
        );
        r.on('socket', (socket) => socket.on('connect', () => (sent = true)));
        r.on('timeout', () => r.destroy(new Error('timeout')));
        r.on('error', reject);
        r.end(payload ?? undefined);
      });
    } catch (error) {
      lastError = error;
      const code = /** @type {{ code?: string }} */ (error).code ?? '';
      if (sent || !RETRYABLE.has(code)) throw error;
      await sleep(50 * attempt);
    }
  }
  throw lastError;
}

/**
 * @typedef {{ name: string, kind: 'old' | 'new', port: number, dataDir: string, child: import('node:child_process').ChildProcess, logFile: string, logText: () => string, exited: () => boolean }} Srv
 */

/**
 * Arranca uno de los dos servidores y espera a que conteste.
 * @param {'old' | 'new'} kind
 * @param {{ script: string, dataDir: string, env: Record<string, string>, logFile: string }} options
 * @returns {Promise<Srv>}
 */
async function startServer(kind, { script, dataDir, env, logFile }) {
  const port = await freePort('0.0.0.0');
  const fullEnv = { ...process.env, ...env, PORT: String(port), DATA_DIR: dataDir };
  /* El nuevo con canal IPC: en Windows su apagado limpio va por el mensaje
     `shutdown` (no hay SIGTERM que se pueda capturar). */
  const child =
    kind === 'new'
      ? fork(script, [], {
          cwd: path.dirname(script),
          env: fullEnv,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        })
      : spawn(process.execPath, [script], {
          cwd: path.dirname(script),
          env: fullEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk) => (output += chunk.toString('utf8')));
  let exited = false;
  child.once('exit', () => {
    exited = true;
    writeFileSync(logFile, output);
  });
  const probe = kind === 'new' ? '/api/v1/health/live' : '/api/playback';
  const started = Date.now();
  for (;;) {
    if (exited) throw new Error(`${kind}: salió al arrancar\n${output}`);
    if (Date.now() - started > 30_000) throw new Error(`${kind}: no arrancó en 30 s\n${output}`);
    try {
      const res = await request(port, { path: probe }, 1);
      if (res.status === 200) break;
    } catch {
      await sleep(50);
    }
  }
  return {
    name: kind === 'old' ? '0.6.59' : 'nuevo',
    kind,
    port,
    dataDir,
    child,
    logFile,
    logText: () => output,
    exited: () => exited,
  };
}

/** Apaga un servidor: el nuevo por IPC (apagado limpio), el viejo con kill. */
async function stopServer(/** @type {Srv} */ srv) {
  if (srv.exited()) return;
  const done = new Promise((resolve) => srv.child.once('exit', resolve));
  if (srv.kind === 'new' && srv.child.connected) srv.child.send('shutdown');
  else srv.child.kill();
  const result = await Promise.race([done.then(() => true), sleep(8000).then(() => false)]);
  if (!result) {
    srv.child.kill();
    await done;
  }
  writeFileSync(srv.logFile, srv.logText());
}

// ---------------------------------------------------------------------------
// Normalización y comparación
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DIR_ID_RE = /^directorio-[a-z0-9]+-[a-z0-9]{5}$/;
/** Token que genera el claim si no llega uno: `<dev>-<base36 de la hora>-<6 aleatorios>`. */
const CLAIM_TOKEN_RE = /^(.+)-[a-z0-9]{6,12}-[a-z0-9]{6}$/;

/** Minutos (redondeados) entre una marca y la hora en que se envió la petición. */
function relative(/** @type {number} */ ms, /** @type {number} */ base) {
  const minutes = Math.round((ms - base) / 60000);
  return `<t${minutes >= 0 ? '+' : ''}${minutes}m>`;
}

/**
 * Normaliza un valor de respuesta para comparar las dos implementaciones.
 * - Fechas ISO y marcas en ms posteriores al arranque de la prueba: relativas a
 *   la petición, en minutos (una cuarentena de 30 min sale igual en las dos).
 * - Ids aleatorios (directorios nuevos, reportId, tokens): numerados por orden
 *   de aparición en CADA servidor, así se conserva quién es quién.
 * @param {unknown} value
 * @param {{ sentAt: number, ids: Map<string, string> }} ctx
 * @param {string} [key]
 * @returns {unknown}
 */
function normalize(value, ctx, key = '') {
  if (Array.isArray(value)) return value.map((item) => normalize(item, ctx, key));
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const nk = mapId(k, ctx);
      out[nk] = normalize(v, ctx, k);
    }
    return out;
  }
  if (typeof value === 'string') {
    if (ISO_RE.test(value)) {
      const ms = Date.parse(value);
      return ms >= RUN_START - 60_000 ? relative(ms, ctx.sentAt) : value;
    }
    if (key === 'reportId' && !value.startsWith('rep000')) return idFor(value, 'informe', ctx);
    if (key === 'token' && /^[a-f0-9]{16}$/.test(value)) return '<token-remux>';
    if (key === 'token' && CLAIM_TOKEN_RE.test(value) && value.startsWith('movil-')) {
      return idFor(value, 'token-claim', ctx);
    }
    if (key === 'uptimeSeconds') return '<n>';
    return mapId(value, ctx);
  }
  if (typeof value === 'number') {
    if (key === 'uptimeSeconds') return '<n>';
    if (
      Number.isInteger(value) &&
      value > 1.5e12 &&
      value < 2.5e12 &&
      value >= RUN_START - 60_000
    ) {
      return `<ms${relative(value, ctx.sentAt)}>`;
    }
    return value;
  }
  return value;
}

function mapId(/** @type {string} */ value, /** @type {{ ids: Map<string, string> }} */ ctx) {
  return DIR_ID_RE.test(value) ? idFor(value, 'dir', ctx) : value;
}

function idFor(
  /** @type {string} */ value,
  /** @type {string} */ kind,
  /** @type {{ ids: Map<string, string> }} */ ctx,
) {
  const known = ctx.ids.get(value);
  if (known) return known;
  const count = [...ctx.ids.values()].filter((v) => v.startsWith(`<${kind}#`)).length + 1;
  const placeholder = `<${kind}#${count}>`;
  ctx.ids.set(value, placeholder);
  return placeholder;
}

/**
 * Diferencias entre dos valores normalizados (rutas tipo `body.web[2].title`).
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} at
 * @param {{ path: string, old: unknown, new: unknown }[]} out
 */
function diff(a, b, at, out) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) {
      out.push({ path: at, old: a, new: b });
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${at}.length`, old: a.length, new: b.length });
    }
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diff(a[i], b[i], `${at}[${i}]`, out);
    return out;
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ra = /** @type {Record<string, unknown>} */ (a);
    const rb = /** @type {Record<string, unknown>} */ (b);
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (!(k in ra)) out.push({ path: `${at}.${k}`, old: '<no está>', new: rb[k] });
      else if (!(k in rb)) out.push({ path: `${at}.${k}`, old: ra[k], new: '<no está>' });
      else diff(ra[k], rb[k], `${at}.${k}`, out);
    }
    return out;
  }
  if (a !== b) out.push({ path: at, old: a, new: b });
  return out;
}

/** Cabeceras que se comparan (el resto, como X-Request-Id, es nuevo a propósito: compat 1.4). */
const COMPARED_HEADERS = [
  'content-type',
  'cache-control',
  'x-content-type-options',
  'content-range',
  'accept-ranges',
];

/**
 * Lo que se compara de una respuesta.
 * @param {Resp} res
 * @param {Map<string, string>} ids
 */
function view(res, ids) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const name of COMPARED_HEADERS) {
    const value = res.headers[name];
    if (value !== undefined) headers[name] = value.toLowerCase().replace(/\s+/g, '');
  }
  /* Longitud solo de los ficheros servidos (200/206 que no son JSON); en las
     respuestas sin cuerpo la 0.6.59 no la ponía y es solo el encuadre HTTP. */
  const isFile =
    (res.status === 200 || res.status === 206) && !res.headers['content-type']?.includes('json');
  if (isFile && res.headers['content-length'] !== undefined) {
    headers['content-length'] = res.headers['content-length'];
  }
  const body =
    res.json !== undefined
      ? normalize(res.json, { sentAt: res.sentAt, ids })
      : res.text || '<vacío>';
  return { status: res.status, headers, body };
}

// ---------------------------------------------------------------------------
// Diferencias permitidas (cada una con su fila de docs/compat.md)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ path: string, old: unknown, new: unknown }} Diff
 * @typedef {{ compat: string, why: string, steps?: RegExp, path: RegExp, check: (d: Diff) => boolean }} Allow
 */

/** @type {Allow[]} */
const ALLOWED = [
  {
    compat: '1.3',
    why: 'PUT /api/state con cuerpo null: la 0.6.59 daba 500, la nueva lo trata como {} (devuelve el estado)',
    steps: /^S06$/,
    path: /^(status|body.*)$/,
    check: (d) =>
      (d.path === 'status' && d.old === 500 && d.new === 200) ||
      (d.path === 'body.error' && d.old === 'internal_error' && d.new === '<no está>') ||
      (d.path.startsWith('body.') && d.old === '<no está>'),
  },
  {
    compat: '1.3',
    why: 'POST /api/remux/stop con cuerpo null: tratado como {} → 400 bad_request (la 0.6.59 daba 500)',
    steps: /^S62d$/,
    path: /^(status|body\.error)$/,
    check: (d) =>
      (d.path === 'status' && d.old === 500 && d.new === 400) ||
      (d.path === 'body.error' && d.old === 'internal_error' && d.new === 'bad_request'),
  },
  {
    compat: '1.8',
    why: 'las respuestas sin cuerpo de /remux/ llevan también no-store y nosniff',
    steps: /^S6[34][a-z]$/,
    path: /^headers\.(cache-control|x-content-type-options)$/,
    check: (d) => d.old === '<no está>' && (d.new === 'no-store' || d.new === 'nosniff'),
  },
  {
    compat: '8.10',
    why: '/api/health dice la versión de la release que corre',
    steps: /^(S52|S77)$/,
    path: /^body\.version$/,
    check: (d) => d.old === '0.6.59' && typeof d.new === 'string' && /^\d+\.\d+\.\d+$/.test(d.new),
  },
  {
    compat: '6.13',
    why: 'cuerpo null en /api/streams/*: 400 bad_url / source_not_found en vez de 500',
    steps: /^S(7[0-9]n|73c|74c)$/,
    path: /^(status|body\.error)$/,
    check: (d) =>
      (d.path === 'status' && d.old === 500 && d.new === 400) ||
      (d.path === 'body.error' &&
        d.old === 'internal_error' &&
        (d.new === 'bad_url' || d.new === 'source_not_found')),
  },
  {
    compat: '1.2',
    why: 'escape roto en /remux/: 404 en vez de 500',
    steps: /^S63f$/,
    path: /^(status|body\.error|headers\..*)$/,
    check: (d) =>
      (d.path === 'status' && d.old === 500 && d.new === 404) ||
      (d.path === 'body.error' && d.old === 'internal_error' && d.new === 'not_found') ||
      d.path.startsWith('headers.'),
  },
  {
    compat: '2.1',
    why: '/api/engine/status sale de la caché del vigilante: 200 {online:false, raw:""} con el motor caído',
    steps: /^S54$/,
    path: /^(status|body.*)$/,
    check: (d) =>
      (d.path === 'status' && [400, 500].includes(Number(d.old)) && d.new === 200) ||
      (d.path === 'body.error' && d.new === '<no está>') ||
      (d.path === 'body.online' && d.old === '<no está>' && d.new === false) ||
      (d.path === 'body.raw' && d.old === '<no está>' && d.new === ''),
  },
  {
    compat: '4.9',
    why: 'sin comprobador, un informe queda en reported (no en checking para siempre)',
    path: /^body\.(report|sourceReports\[\d+\])\.state$/,
    check: (d) => d.old === 'checking' && d.new === 'reported',
  },
  {
    compat: '5.7',
    why: 'la salud cuenta la agenda de demostración como ready con sus 10 partidos',
    steps: /^(S52|S77)$/,
    path: /^body\.components\.agenda\.(status|matches|generatedAt)$/,
    check: (d) =>
      (d.path.endsWith('.status') && d.old === 'warming' && d.new === 'ready') ||
      (d.path.endsWith('.matches') && d.old === 0 && d.new === 10) ||
      (d.path.endsWith('.generatedAt') && d.old === null && typeof d.new === 'string'),
  },
  {
    compat: '6.2',
    why: 'nombres de una sola etiqueta y .lan: private_url (antes se intentaba resolverlos)',
    steps: /^P2-ssrf-(acestream|lan)$/,
    path: /^body\.error$/,
    check: (d) => d.new === 'private_url',
  },
  {
    compat: '6.3',
    why: 'con ALLOW_PRIVATE_SYNC_URLS=true un nombre que no existe da dns_failed (antes 500)',
    steps: /^S70-dns$/,
    path: /^(status|body\.error)$/,
    check: (d) =>
      (d.path === 'status' && d.old === 500 && d.new === 400) ||
      (d.path === 'body.error' && d.old === 'internal_error' && d.new === 'dns_failed'),
  },
  {
    compat: '7.1',
    why: 'state.json lleva schemaVersion 2',
    steps: /^state\.json$/,
    path: /^body\.schemaVersion$/,
    check: (d) => d.old === '<no está>' && d.new === 2,
  },
];

// ---------------------------------------------------------------------------
// La secuencia
// ---------------------------------------------------------------------------

/**
 * @typedef {{ vars: Record<string, string>, srv: Srv }} Ctx
 * @typedef {{ id: string, title: string, req: Req | ((ctx: Ctx) => Req), after?: (res: Resp, ctx: Ctx) => void, before?: (ctx: Ctx) => void }} Step
 */

const CROSS = { 'sec-fetch-site': 'cross-site' };
const BIG = `{"action":"favorite-upsert","item":{"id":"${H.n3}","title":"${'x'.repeat(2 * 1024 * 1024)}"}}`;

/** Recuerda el id del directorio activo (los nuevos tienen id aleatorio). */
const rememberActive =
  (/** @type {string} */ name) => (/** @type {Resp} */ res, /** @type {Ctx} */ ctx) => {
    const body = /** @type {{ activeWebSourceId?: string }} */ (res.json ?? {});
    if (body.activeWebSourceId) ctx.vars[name] = body.activeWebSourceId;
  };

/** @param {string} listas @returns {Step[]} */
function steps(listas) {
  const sync = (/** @type {Record<string, unknown>} */ body) => ({
    method: 'POST',
    path: '/api/streams/sync',
    body,
  });
  const lib = (/** @type {Record<string, unknown>} */ body, headers = {}) => ({
    method: 'POST',
    path: '/api/library',
    body,
    headers,
  });
  /** @type {Step[]} */
  const list = [
    // --- Estado y enrutado exacto ---
    { id: 'S01', title: 'GET /api/state (semilla normalizada)', req: { path: '/api/state' } },
    { id: 'S02', title: 'GET /api/playback', req: { path: '/api/playback' } },
    { id: 'S03a', title: 'GET /api/state?x=1 → 404', req: { path: '/api/state?x=1' } },
    { id: 'S03b', title: 'GET /api/state/ → 404', req: { path: '/api/state/' } },
    { id: 'S03c', title: 'HEAD /api/state → 405', req: { method: 'HEAD', path: '/api/state' } },
    {
      id: 'S03d',
      title: 'OPTIONS /api/state → 405',
      req: { method: 'OPTIONS', path: '/api/state' },
    },
    { id: 'S03e', title: 'DELETE /api/state → 405', req: { method: 'DELETE', path: '/api/state' } },
    { id: 'S03f', title: 'GET /nada → 404', req: { path: '/nada' } },
    {
      id: 'S03g',
      title: 'POST /api/nada → 404',
      req: { method: 'POST', path: '/api/nada', body: {} },
    },
    {
      id: 'S03h',
      title: 'POST /api/nada cross-site → 403',
      req: { method: 'POST', path: '/api/nada', body: {}, headers: CROSS },
    },
    { id: 'S03i', title: 'OPTIONS /api/nada → 404', req: { method: 'OPTIONS', path: '/api/nada' } },
    { id: 'S03j', title: 'GET /api/%73tate → 404', req: { path: '/api/%73tate' } },
    {
      id: 'S04',
      title: 'PUT /api/state (compatibilidad 0.6.8)',
      req: {
        method: 'PUT',
        path: '/api/state',
        body: {
          favorites: [
            { id: H.put1, title: 'Nuevo por PUT' },
            { id: H.f1, title: 'No pisa' },
          ],
          history: [
            { id: H.h1, title: 'No pisa el historial' },
            { id: H.n1, title: 'Nuevo historial' },
          ],
          nowPlaying: { id: H.h1, dev: 'tv-salon', token: 'tok-put', title: 'GOL', at: 1 },
          otraCosa: true,
        },
      },
    },
    {
      id: 'S05',
      title: 'PUT /api/state JSON roto → 400',
      req: { method: 'PUT', path: '/api/state', raw: '{roto' },
    },
    {
      id: 'S06',
      title: 'PUT /api/state null',
      req: { method: 'PUT', path: '/api/state', raw: 'null' },
    },
    {
      id: 'S06b',
      title: 'PUT /api/state vacío',
      req: { method: 'PUT', path: '/api/state', raw: '' },
    },
    // --- Biblioteca ---
    {
      id: 'S07',
      title: 'library favorite-upsert',
      req: lib({
        action: 'favorite-upsert',
        item: { id: H.n1, title: 'Eurosport 1', category: 'Deportes' },
      }),
    },
    {
      id: 'S08',
      title: 'library history-upsert (infohash, HTML)',
      req: lib({ action: 'history-upsert', item: { hash: H.n2, name: '<i>DAZN 2</i>', ih: true } }),
    },
    {
      id: 'S08b',
      title: 'library history-upsert de uno que ya está',
      req: lib({ action: 'history-upsert', item: { id: H.h1, title: 'GOL Play (otra vez)' } }),
    },
    {
      id: 'S09',
      title: 'library rename favorites',
      req: lib({
        action: 'rename',
        collection: 'favorites',
        id: H.f2,
        title: '  <b>M+</b>  Campeones  ',
      }),
    },
    {
      id: 'S09b',
      title: 'library rename de un id que no está',
      req: lib({ action: 'rename', collection: 'history', id: H.n3, title: 'Nada' }),
    },
    {
      id: 'S10',
      title: 'library delete history',
      req: lib({ action: 'delete', collection: 'history', id: H.h2 }),
    },
    {
      id: 'S11',
      title: 'library rename web (activo)',
      req: lib({ action: 'rename', collection: 'web', id: H.w1, title: 'DAZN (mío)' }),
    },
    {
      id: 'S12',
      title: 'library delete web (activo)',
      req: lib({ action: 'delete', collection: 'web', id: H.w2 }),
    },
    {
      id: 'S13',
      title: 'library rename web con sourceId',
      req: lib({
        action: 'rename',
        collection: 'web',
        sourceId: 'agregador',
        id: H.html1,
        title: 'DAZN 1 (agregador)',
      }),
    },
    {
      id: 'S13b',
      title: 'library rename web de uno oculto (lo saca de ocultos)',
      req: lib({ action: 'rename', collection: 'web', id: H.w4, title: 'Ya no oculto' }),
    },
    { id: 'S14a', title: 'library bad_action', req: lib({ action: 'otra' }) },
    {
      id: 'S14b',
      title: 'library bad_collection',
      req: lib({ action: 'rename', collection: 'otra', id: H.f1, title: 'x' }),
    },
    {
      id: 'S14c',
      title: 'library bad_title',
      req: lib({ action: 'rename', collection: 'favorites', id: H.f1, title: '<b> </b>' }),
    },
    {
      id: 'S14d',
      title: 'library bad_request (item sin hash)',
      req: lib({ action: 'favorite-upsert', item: { id: 'x', title: 'y' } }),
    },
    {
      id: 'S14e',
      title: 'library source_not_found',
      req: lib({ action: 'delete', collection: 'web', sourceId: 'nope', id: H.w1 }),
    },
    { id: 'S14f', title: 'library sin cuerpo', req: { method: 'POST', path: '/api/library' } },
    {
      id: 'S15',
      title: 'library cuerpo de más de 2 MiB → 413',
      req: { method: 'POST', path: '/api/library', raw: BIG },
    },
    {
      id: 'S16a',
      title: 'library cross-site → 403',
      req: lib({ action: 'favorite-upsert', item: { id: H.n3, title: 'x' } }, CROSS),
    },
    {
      id: 'S16b',
      title: 'library con Origin de otro host → 403',
      req: lib(
        { action: 'favorite-upsert', item: { id: H.n3, title: 'x' } },
        { origin: 'http://malo.example' },
      ),
    },
    {
      id: 'S16c',
      title: 'library same-origin → 200',
      req: lib(
        { action: 'favorite-upsert', item: { id: H.n3, title: 'Mismo origen' } },
        { 'sec-fetch-site': 'same-origin', origin: 'http://malo.example' },
      ),
    },
    {
      id: 'S16d',
      title: 'library Origin = X-Forwarded-Host → 200',
      req: lib(
        { action: 'history-upsert', item: { id: H.n3, title: 'Proxy' } },
        { origin: 'http://umbrel.local:7792', 'x-forwarded-host': 'umbrel.local:7792, otro' },
      ),
    },
    // --- Mando ---
    { id: 'S17', title: 'GET /api/playback tras el PUT', req: { path: '/api/playback' } },
    {
      id: 'S17b',
      title: 'POST /api/playback → 405',
      req: { method: 'POST', path: '/api/playback', body: {} },
    },
    {
      id: 'S18',
      title: 'claim con token',
      req: {
        method: 'POST',
        path: '/api/playback/claim',
        body: { id: H.f1, dev: 'pc-oficina', title: 'DAZN LaLiga', token: 'tok-pc-1' },
      },
    },
    {
      id: 'S19',
      title: 'claim sin token (lo genera)',
      req: {
        method: 'POST',
        path: '/api/playback/claim',
        body: { id: `acestream://${H.f2}`, dev: 'movil-isma' },
      },
    },
    {
      id: 'S20',
      title: 'claim sin dev → 400',
      req: { method: 'POST', path: '/api/playback/claim', body: { id: H.f1 } },
    },
    {
      id: 'S20b',
      title: 'claim con token que queda vacío → 400',
      req: {
        method: 'POST',
        path: '/api/playback/claim',
        body: { id: H.f1, dev: 'x', token: '***' },
      },
    },
    {
      id: 'S21',
      title: 'release con token que no coincide',
      req: {
        method: 'POST',
        path: '/api/playback/release',
        body: { id: H.f2, dev: 'movil-isma', token: 'otro' },
      },
    },
    {
      id: 'S22',
      title: 'release que suelta',
      req: { method: 'POST', path: '/api/playback/release', body: { id: H.f2, dev: 'movil-isma' } },
    },
    {
      id: 'S23',
      title: 'release de otro (deja lápida)',
      req: {
        method: 'POST',
        path: '/api/playback/release',
        body: { id: H.f1, dev: 'pc-oficina', token: 'tok-pc-1' },
      },
    },
    {
      id: 'S24',
      title: 'claim con token liberado → ignored',
      req: {
        method: 'POST',
        path: '/api/playback/claim',
        body: { id: H.f1, dev: 'pc-oficina', token: 'tok-pc-1' },
      },
    },
    {
      id: 'S24b',
      title: 'release sin id → 400',
      req: { method: 'POST', path: '/api/playback/release', body: { dev: 'x' } },
    },
    { id: 'S25', title: 'GET /api/playback', req: { path: '/api/playback' } },
    // --- Preferencias ---
    {
      id: 'S26',
      title: 'preferences completas con duplicados y basura',
      req: {
        method: 'POST',
        path: '/api/preferences',
        body: {
          onboardingComplete: true,
          country: '<b>Francia</b>',
          leagues: [
            'LaLiga',
            'LALIGA',
            'Lalíga',
            'Premier League',
            ...Array.from({ length: 14 }, (_, i) => `Liga ${i}`),
          ],
          teams: ['Real Madrid', ''],
          nationalities: 'no es lista',
        },
      },
    },
    {
      id: 'S27',
      title: 'preferences vacías → por defecto',
      req: { method: 'POST', path: '/api/preferences', body: {} },
    },
    {
      id: 'S27b',
      title: 'preferences de nuevo',
      req: {
        method: 'POST',
        path: '/api/preferences',
        body: {
          onboardingComplete: true,
          country: 'Spain',
          leagues: ['LaLiga'],
          teams: ['Real Madrid'],
          nationalities: ['España'],
        },
      },
    },
    // --- Agenda ---
    { id: 'S28', title: 'GET /api/football (demo)', req: { path: '/api/football' } },
    { id: 'S29', title: 'GET /api/football?x=1', req: { path: '/api/football?refresh=1' } },
    {
      id: 'S30',
      title: 'resolve por canal y partido',
      req: { path: '/api/football/resolve?channel=DAZN%20LaLiga&match=demo-4&client=pc-oficina' },
    },
    {
      id: 'S31',
      title: 'resolve con los canales del programa',
      req: { path: '/api/football/resolve?match=demo-5' },
    },
    {
      id: 'S31b',
      title: 'resolve con varios canales y variantes',
      req: {
        path: '/api/football/resolve?channel=La%201%20HD&channel=La%201%20FHD&channel=GOL%20Play',
      },
    },
    {
      id: 'S32',
      title: 'resolve research=1 con current',
      req: { path: `/api/football/resolve?channel=La%201%20HD&research=1&current=${H.w3}` },
    },
    {
      id: 'S33',
      title: 'resolve sin canal → channel_required',
      req: { path: '/api/football/resolve' },
    },
    {
      id: 'S33b',
      title: 'resolve con partido que no existe y sin canal',
      req: { path: '/api/football/resolve?match=nope' },
    },
    {
      id: 'S34',
      title: 'resolve cross-site → 403',
      req: { path: '/api/football/resolve?channel=DAZN', headers: CROSS },
    },
    {
      id: 'S35a',
      title: 'football/scan de un trabajo que no existe',
      req: { path: '/api/football/scan?id=0123456789abcdef01234567' },
    },
    {
      id: 'S35b',
      title: 'football/scan con id mal formado',
      req: { path: '/api/football/scan?id=xyz' },
    },
    { id: 'S35c', title: 'football/scan sin query', req: { path: '/api/football/scan' } },
    {
      id: 'S36',
      title: 'football/preheat de un partido',
      req: { path: '/api/football/preheat?match=demo-1' },
    },
    {
      id: 'S37',
      title: 'football/bind',
      req: {
        method: 'POST',
        path: '/api/football/bind',
        body: { channel: 'GOL Play', id: `acestream://${H.b2}`, title: 'GOL', ih: false },
      },
    },
    {
      id: 'S37b',
      title: 'football/bind que sustituye (misma clave)',
      req: {
        method: 'POST',
        path: '/api/football/bind',
        body: { channel: 'DAZN LaLiga HD', id: H.w1 },
      },
    },
    {
      id: 'S38a',
      title: 'football/bind sin clave → bad_binding',
      req: { method: 'POST', path: '/api/football/bind', body: { channel: '***', id: H.b2 } },
    },
    {
      id: 'S38b',
      title: 'football/bind sin hash → bad_binding',
      req: { method: 'POST', path: '/api/football/bind', body: { channel: 'X' } },
    },
    {
      id: 'S39',
      title: 'GET /api/scores (demo, sin partidos en ventana)',
      req: { path: '/api/scores' },
    },
    { id: 'S39b', title: 'GET /api/scores?x → 404', req: { path: '/api/scores?x=1' } },
    // --- Fuentes ---
    {
      id: 'S40',
      title: 'sources/report stuttering',
      req: {
        method: 'POST',
        path: '/api/sources/report',
        body: {
          id: H.w1,
          reason: 'stuttering',
          channel: 'DAZN LaLiga',
          matchId: 'demo-4',
          title: 'DAZN',
          source: 'm3u',
        },
      },
    },
    {
      id: 'S41',
      title: 'sources/report wrong_channel (canal del partido)',
      req: {
        method: 'POST',
        path: '/api/sources/report',
        body: { id: H.w3, reason: 'wrong_channel', matchId: 'demo-3' },
      },
    },
    {
      id: 'S42',
      title: 'sources/report repetido (suma)',
      req: {
        method: 'POST',
        path: '/api/sources/report',
        body: { id: H.w1, reason: 'stuttering', channel: 'DAZN LaLiga', matchId: 'demo-4' },
      },
    },
    {
      id: 'S43a',
      title: 'sources/report motivo desconocido → not_starting',
      req: {
        method: 'POST',
        path: '/api/sources/report',
        body: { id: H.n1, reason: 'otra cosa', ih: true },
      },
    },
    {
      id: 'S43b',
      title: 'sources/report sin hash → 400',
      req: { method: 'POST', path: '/api/sources/report', body: { reason: 'audio' } },
    },
    {
      id: 'S44',
      title: 'sources/outcome arranco',
      req: {
        method: 'POST',
        path: '/api/sources/outcome',
        body: {
          id: H.w1,
          resultado: 'arranco',
          segundos: 30,
          title: 'DAZN LaLiga 1080 --> NEW ERA',
        },
      },
    },
    {
      id: 'S45',
      title: 'sources/outcome cayo 120 s',
      req: {
        method: 'POST',
        path: '/api/sources/outcome',
        body: { id: H.w1, resultado: 'cayo', segundos: 120, listaId: 'principal' },
      },
    },
    {
      id: 'S46',
      title: 'sources/outcome fallo',
      req: {
        method: 'POST',
        path: '/api/sources/outcome',
        body: { id: H.w2, resultado: 'fallo', source: 'acestream', segundos: 999999 },
      },
    },
    {
      id: 'S47',
      title: 'sources/outcome sigue (no escribe)',
      req: { method: 'POST', path: '/api/sources/outcome', body: { id: H.w1, resultado: 'sigue' } },
    },
    {
      id: 'S48',
      title: 'sources/outcome bad_outcome',
      req: { method: 'POST', path: '/api/sources/outcome', body: { id: H.w1, resultado: 'otro' } },
    },
    {
      id: 'S49',
      title: 'sources/feedback correct (limpia wrong_channel)',
      req: {
        method: 'POST',
        path: '/api/sources/feedback',
        body: { id: H.w3, verdict: 'correct', channel: 'La 1 HD', title: 'La 1', corrections: 50 },
      },
    },
    {
      id: 'S50',
      title: 'sources/feedback incorrect por channelKey',
      req: {
        method: 'POST',
        path: '/api/sources/feedback',
        body: { id: H.w1, verdict: 'incorrect', channelKey: 'gol play', reason: 'audio' },
      },
    },
    {
      id: 'S51',
      title: 'sources/feedback bad_feedback',
      req: {
        method: 'POST',
        path: '/api/sources/feedback',
        body: { id: H.w1, verdict: 'quizá', channel: 'x' },
      },
    },
    // --- Salud y motor ---
    { id: 'S52', title: 'GET /api/health', req: { path: '/api/health' } },
    { id: 'S53', title: 'GET /api/health?t=1 → 404', req: { path: '/api/health?t=1' } },
    {
      id: 'S54',
      title: 'GET /api/engine/status (motor caído)',
      req: { path: '/api/engine/status' },
    },
    {
      id: 'S55',
      title: 'POST /api/restart-engine (engine-control caído)',
      req: { method: 'POST', path: '/api/restart-engine' },
    },
    {
      id: 'S56',
      title: 'POST /api/restart-engine otra vez → 429',
      req: { method: 'POST', path: '/api/restart-engine' },
    },
    {
      id: 'S57',
      title: 'POST /api/restart-engine cross-site → 403',
      req: { method: 'POST', path: '/api/restart-engine', headers: CROSS },
    },
    { id: 'S57b', title: 'GET /api/restart-engine → 405', req: { path: '/api/restart-engine' } },
    // --- Buscador y remux sin motor ---
    { id: 'S58a', title: 'search de 1 carácter → empty_query', req: { path: '/api/search?q=a' } },
    {
      id: 'S58b',
      title: 'search solo espacios → empty_query',
      req: { path: '/api/search?q=%20%20%20' },
    },
    { id: 'S58c', title: 'GET /api/search sin query', req: { path: '/api/search' } },
    { id: 'S59', title: 'search sin motor', req: { path: '/api/search?q=dazn%20laliga' } },
    { id: 'S60a', title: 'remux sin hash → 400', req: { path: '/api/remux?id=xyz' } },
    { id: 'S60b', title: 'GET /api/remux exacto', req: { path: '/api/remux' } },
    {
      id: 'S61',
      title: 'remux sin motor ni ffmpeg',
      req: { path: `/api/remux?id=${H.remux}&dev=pc-oficina` },
    },
    {
      id: 'S61b',
      title: 'remux cross-site → 403',
      req: { path: `/api/remux?id=${H.remux}`, headers: CROSS },
    },
    {
      id: 'S62a',
      title: 'remux/stop sin sesión',
      req: { method: 'POST', path: '/api/remux/stop', body: { id: H.remux } },
    },
    {
      id: 'S62b',
      title: 'remux/stop con dev, token y keepAlive',
      req: {
        method: 'POST',
        path: '/api/remux/stop',
        body: { id: H.remux, dev: 'pc', token: 'abc123', keepAlive: true },
      },
    },
    {
      id: 'S62c',
      title: 'remux/stop sin hash → 400',
      req: { method: 'POST', path: '/api/remux/stop', body: {} },
    },
    {
      id: 'S62d',
      title: 'remux/stop null',
      req: { method: 'POST', path: '/api/remux/stop', raw: 'null' },
    },
    {
      id: 'S62e',
      title: 'remux/stop?x → 404',
      req: { method: 'POST', path: '/api/remux/stop?x=1', body: {} },
    },
    {
      id: 'S63a',
      title: 'GET /remux/<hash>/index.m3u8 sin sesión → 404',
      req: { path: `/remux/${H.remux}/index.m3u8` },
    },
    {
      id: 'S63b',
      title: 'HEAD /remux/<hash>/index.m3u8 → 404',
      req: { method: 'HEAD', path: `/remux/${H.remux}/index.m3u8` },
    },
    {
      id: 'S63c',
      title: 'POST /remux/<hash>/x → 405',
      req: { method: 'POST', path: `/remux/${H.remux}/x` },
    },
    { id: 'S63d', title: '/remux/abc/index.m3u8 → 403', req: { path: '/remux/abc/index.m3u8' } },
    { id: 'S63e', title: '/remux/<hash> (un segmento) → 403', req: { path: `/remux/${H.remux}` } },
    { id: 'S63f', title: '/remux/<hash>/%zz', req: { path: `/remux/${H.remux}/%zz` } },
    {
      id: 'S63g',
      title: '/remux/<hash>/..%2f..%2fstate.json → 403',
      req: { path: `/remux/${H.remux}/..%2f..%2fstate.json` },
    },
    { id: 'S63h', title: '/remux/<hash>/a%5cb → 403', req: { path: `/remux/${H.remux}/a%5cb` } },
    {
      id: 'S63i',
      title: 'POST /remux/x cross-site → 403',
      req: { method: 'POST', path: '/remux/x', headers: CROSS },
    },
    // Ficheros del remux escritos a mano en DATA_DIR/remux (sin motor no hay ffmpeg).
    {
      id: 'S64a',
      title: 'GET /remux/<hash>/index.m3u8 → 200',
      before: writeRemuxFiles,
      req: { path: `/remux/${H.files}/index.m3u8` },
    },
    {
      id: 'S64b',
      title: 'Range bytes=2-5 → 206',
      req: { path: `/remux/${H.files}/init.mp4`, headers: { range: 'bytes=2-5' } },
    },
    {
      id: 'S64c',
      title: 'Range bytes=-3 → 206',
      req: { path: `/remux/${H.files}/init.mp4`, headers: { range: 'bytes=-3' } },
    },
    {
      id: 'S64d',
      title: 'Range bytes=5- → 206',
      req: { path: `/remux/${H.files}/init.mp4`, headers: { range: 'bytes=5-' } },
    },
    {
      id: 'S64e',
      title: 'Range fuera del fichero → 416',
      req: { path: `/remux/${H.files}/init.mp4`, headers: { range: 'bytes=20-30' } },
    },
    {
      id: 'S64f',
      title: 'Range múltiple → 416',
      req: { path: `/remux/${H.files}/init.mp4`, headers: { range: 'bytes=0-1,3-4' } },
    },
    {
      id: 'S64g',
      title: 'HEAD init.mp4 → 200 sin cuerpo',
      req: { method: 'HEAD', path: `/remux/${H.files}/init.mp4` },
    },
    { id: 'S64h', title: 'segmento vacío → 200', req: { path: `/remux/${H.files}/index3.m4s` } },
    {
      id: 'S64i',
      title: 'segmento vacío con Range → 416',
      req: { path: `/remux/${H.files}/index3.m4s`, headers: { range: 'bytes=0-1' } },
    },
    { id: 'S64j', title: '.ts → video/mp2t', req: { path: `/remux/${H.files}/viejo.ts` } },
    {
      id: 'S64k',
      title: 'otra extensión → octet-stream',
      req: { path: `/remux/${H.files}/otro.bin` },
    },
    { id: 'S64l', title: 'una carpeta → 404', req: { path: `/remux/${H.files}/sub` } },
    { id: 'S64m', title: 'query ignorada', req: { path: `/remux/${H.files}/index.m3u8?t=1` } },
    {
      id: 'S64n',
      title: '".." que se queda dentro',
      req: { path: `/remux/${H.files}/../${H.files}/index.m3u8` },
    },
    {
      id: 'S64o',
      title: 'escapado (%2e) que se queda dentro',
      req: { path: `/remux/${H.files}/%69ndex.m3u8` },
    },
    // --- Directorios ---
    {
      id: 'S65',
      title: 'streams/sync directorio nuevo (m3u)',
      req: sync({ url: `${listas}/lista-2.m3u`, name: '  Lista   dos ' }),
      after: rememberActive('dir2'),
    },
    {
      id: 'S66',
      title: 'streams/sync misma URL otra vez (refresca el mismo)',
      req: sync({ url: `${listas}/lista-2.m3u`, type: 'm3u' }),
    },
    {
      id: 'S67',
      title: 'streams/sync principal (conserva renombres y ocultos)',
      req: sync({ url: `${listas}/principal.m3u`, sourceId: 'principal', type: 'm3u' }),
    },
    {
      id: 'S68',
      title: 'streams/sync agregador html',
      req: sync({ url: `${listas}/agregador.html`, sourceId: 'agregador', type: 'html' }),
    },
    {
      id: 'S69',
      title: 'streams/sync con redirección (sin nombre: hostname)',
      req: sync({ url: `${listas}/redir-ok`, type: 'otro' }),
      after: rememberActive('dirRedir'),
    },
    { id: 'S70a', title: 'sync http_404', req: sync({ url: `${listas}/404` }) },
    {
      id: 'S70b',
      title: 'sync http_500 sobre un directorio guardado (anota el fallo)',
      req: sync({ url: `${listas}/500`, sourceId: 'agregador', type: 'html' }),
    },
    { id: 'S70c', title: 'sync http_429', req: sync({ url: `${listas}/429` }) },
    { id: 'S70d', title: 'sync empty_directory', req: sync({ url: `${listas}/vacia.m3u` }) },
    { id: 'S70e', title: 'sync redirect_loop', req: sync({ url: `${listas}/bucle-a` }) },
    { id: 'S70f', title: 'sync redirect_limit', req: sync({ url: `${listas}/cadena-0` }) },
    { id: 'S70g', title: 'sync unsupported_encoding', req: sync({ url: `${listas}/gzip.m3u` }) },
    {
      id: 'S70h',
      title: 'sync response_too_large (con Content-Length)',
      req: sync({ url: `${listas}/grande.m3u` }),
    },
    {
      id: 'S70i',
      title: 'sync response_too_large (sin Content-Length)',
      req: sync({ url: `${listas}/grande-sin-longitud.m3u` }),
    },
    { id: 'S70j', title: 'sync conexión cortada → 500', req: sync({ url: `${listas}/corta` }) },
    { id: 'S70k', title: 'sync fetch_timeout (12 s)', req: sync({ url: `${listas}/cuelga` }) },
    { id: 'S70l', title: 'sync bad_url (ftp)', req: sync({ url: 'ftp://x.example/lista.m3u' }) },
    { id: 'S70m', title: 'sync bad_url (vacía)', req: sync({ url: '' }) },
    {
      id: 'S70n',
      title: 'sync null',
      req: { method: 'POST', path: '/api/streams/sync', raw: 'null' },
    },
    {
      id: 'S70o',
      title: 'sync source_not_found',
      req: sync({ url: `${listas}/lista-3.m3u`, sourceId: 'nope' }),
    },
    {
      id: 'S70p',
      title: 'sync con usuario y contraseña',
      req: sync({ url: `${listas.replace('http://', 'http://u:p@')}/lista-3.m3u` }),
    },
    {
      id: 'S70-dns',
      title: 'sync a un nombre que no existe (ALLOW=true)',
      req: sync({ url: 'http://no-existe.invalid/lista.m3u' }),
    },
    { id: 'S70q', title: 'GET /api/streams/sync → 405', req: { path: '/api/streams/sync' } },
  ];
  // Hasta el tope de 8 directorios y uno más (source_limit).
  for (let n = 3; n <= 6; n += 1) {
    list.push({
      id: `S71-${n}`,
      title: `streams/sync directorio ${n}`,
      req: sync({ url: `${listas}/lista-${n}.m3u`, name: `Lista ${n}` }),
      after: rememberActive(`dir${n}`),
    });
  }
  list.push(
    {
      id: 'S71-limite',
      title: 'streams/sync noveno → source_limit',
      req: sync({ url: `${listas}/lista-7.m3u` }),
    },
    {
      id: 'S71-limite-b',
      title: 'streams/sync noveno que falla → source_limit antes de bajar',
      req: sync({ url: `${listas}/404` }),
    },
    {
      id: 'S71-limite-c',
      title: 'streams/sync de uno guardado con el tope lleno (sí se puede)',
      req: (ctx) => sync({ url: `${listas}/lista-3.m3u`, sourceId: ctx.vars.dir3 }),
    },
    { id: 'S72', title: 'GET /api/state con 8 directorios', req: { path: '/api/state' } },
    {
      id: 'S73a',
      title: 'streams/activate',
      req: (ctx) => ({
        method: 'POST',
        path: '/api/streams/activate',
        body: { sourceId: ctx.vars.dir2 },
      }),
    },
    {
      id: 'S73b',
      title: 'streams/activate source_not_found',
      req: { method: 'POST', path: '/api/streams/activate', body: { sourceId: 'nope' } },
    },
    {
      id: 'S73c',
      title: 'streams/activate null',
      req: { method: 'POST', path: '/api/streams/activate', raw: 'null' },
    },
    {
      id: 'S73d',
      title: 'library rename web en el activo nuevo',
      req: lib({ action: 'rename', collection: 'web', id: hx('222ab'), title: 'Canal dos (mío)' }),
    },
    {
      id: 'S73e',
      title: 'streams/sync del activo (conserva el renombre)',
      req: (ctx) => sync({ url: `${listas}/lista-2.m3u`, sourceId: ctx.vars.dir2 }),
    },
    {
      id: 'S74a',
      title: 'streams/delete del activo (pasa al primero)',
      req: (ctx) => ({
        method: 'POST',
        path: '/api/streams/delete',
        body: { sourceId: ctx.vars.dir2 },
      }),
    },
    {
      id: 'S74b',
      title: 'streams/delete source_not_found',
      req: { method: 'POST', path: '/api/streams/delete', body: { sourceId: 'nope' } },
    },
    {
      id: 'S74c',
      title: 'streams/delete null',
      req: { method: 'POST', path: '/api/streams/delete', raw: 'null' },
    },
  );
  for (const name of ['dir3', 'dir4', 'dir5', 'dir6', 'dirRedir', 'agregador']) {
    list.push({
      id: `S74-${name}`,
      title: `streams/delete ${name}`,
      req: (ctx) => ({
        method: 'POST',
        path: '/api/streams/delete',
        body: { sourceId: ctx.vars[name] ?? name },
      }),
    });
  }
  list.push(
    {
      id: 'S74-ultimo',
      title: 'streams/delete del único → last_source',
      req: { method: 'POST', path: '/api/streams/delete', body: { sourceId: 'principal' } },
    },
    { id: 'S76', title: 'GET /api/state final', req: { path: '/api/state' } },
    { id: 'S77', title: 'GET /api/health final', req: { path: '/api/health' } },
    { id: 'S78', title: 'GET /api/playback final', req: { path: '/api/playback' } },
  );
  return list;
}

/** Fase 2: tras reiniciar los dos con ALLOW_PRIVATE_SYNC_URLS=false. */
function stepsPhase2(/** @type {string} */ listas) {
  const ssrf = (/** @type {string} */ id, /** @type {string} */ url) => ({
    id: `P2-ssrf-${id}`,
    title: `sync ${url} (anti-SSRF)`,
    req: { method: 'POST', path: '/api/streams/sync', body: { url } },
  });
  return [
    { id: 'P2-state', title: 'GET /api/state tras reiniciar', req: { path: '/api/state' } },
    {
      id: 'P2-playback',
      title: 'GET /api/playback tras reiniciar',
      req: { path: '/api/playback' },
    },
    ssrf('local', `${listas}/principal.m3u`),
    ssrf('127', 'http://127.0.0.1:9/lista.m3u'),
    ssrf('localhost', 'http://localhost/lista.m3u'),
    ssrf('10', 'http://10.1.2.3/lista.m3u'),
    ssrf('192', 'http://192.168.1.10/lista.m3u'),
    ssrf('mapped', 'http://[::ffff:127.0.0.1]/lista.m3u'),
    ssrf('dotlocal', 'http://nas.local/lista.m3u'),
    ssrf('internal', 'http://nas.internal/lista.m3u'),
    ssrf('homearpa', 'http://nas.home.arpa/lista.m3u'),
    ssrf('0', 'http://0.0.0.0/lista.m3u'),
    ssrf('dns', 'http://no-existe.invalid/lista.m3u'),
    ssrf('acestream', 'http://acestream:6878/lista.m3u'),
    ssrf('lan', 'http://nas.lan/lista.m3u'),
    { id: 'P2-state-final', title: 'GET /api/state final', req: { path: '/api/state' } },
  ];
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, title: string, old: unknown, new: unknown, diffs: Diff[], allowed: { diff: Diff, compat: string }[], unexplained: Diff[] }} Result
 */

/** Explica cada diferencia con una fila de compat.md o la deja sin explicar. */
function classify(/** @type {string} */ id, /** @type {Diff[]} */ diffs) {
  const allowed = [];
  const unexplained = [];
  for (const d of diffs) {
    const rule = ALLOWED.find(
      (r) => (!r.steps || r.steps.test(id)) && r.path.test(d.path) && r.check(d),
    );
    if (rule) allowed.push({ diff: d, compat: rule.compat });
    else unexplained.push(d);
  }
  return { allowed, unexplained };
}

/**
 * @param {Step[]} list
 * @param {Srv} oldSrv
 * @param {Srv} newSrv
 * @param {{ old: Ctx, new: Ctx }} ctxs
 * @param {{ old: Map<string, string>, new: Map<string, string> }} ids
 * @param {Result[]} results
 */
async function runSteps(list, oldSrv, newSrv, ctxs, ids, results) {
  const only = args.solo ? new Set(args.solo.split(',')) : null;
  for (const step of list) {
    if (only && !only.has(step.id)) continue;
    step.before?.(ctxs.old);
    step.before?.(ctxs.new);
    const reqOld = typeof step.req === 'function' ? step.req(ctxs.old) : step.req;
    const reqNew = typeof step.req === 'function' ? step.req(ctxs.new) : step.req;
    const [resOld, resNew] = await Promise.all([
      request(oldSrv.port, reqOld),
      request(newSrv.port, reqNew),
    ]);
    step.after?.(resOld, ctxs.old);
    step.after?.(resNew, ctxs.new);
    const vOld = view(resOld, ids.old);
    const vNew = view(resNew, ids.new);
    const diffs = diff(vOld, vNew, '', []).map((d) => ({ ...d, path: d.path.replace(/^\./, '') }));
    const { allowed, unexplained } = classify(step.id, diffs);
    results.push({
      id: step.id,
      title: step.title,
      old: vOld,
      new: vNew,
      diffs,
      allowed,
      unexplained,
    });
    const mark = unexplained.length ? 'DIFERENCIA' : allowed.length ? 'compat   ' : 'igual     ';
    log(
      `${mark} ${step.id} ${step.title} · ${resOld.status}/${resNew.status}` +
        (allowed.length
          ? ` · compat ${[...new Set(allowed.map((a) => a.compat))].join(', ')}`
          : ''),
    );
    for (const d of unexplained.slice(0, 12)) {
      log(
        `    ${d.path}: 0.6.59=${JSON.stringify(d.old)?.slice(0, 160)} · nuevo=${JSON.stringify(d.new)?.slice(0, 160)}`,
      );
    }
    if (unexplained.length > 12) log(`    … y ${unexplained.length - 12} más`);
  }
}

/** Compara los state.json de las dos copias (lo que verá una 0.6.x al volver atrás). */
function compareStateFiles(
  /** @type {Srv} */ oldSrv,
  /** @type {Srv} */ newSrv,
  /** @type {{ old: Map<string, string>, new: Map<string, string> }} */ ids,
  /** @type {Result[]} */ results,
  /** @type {string} */ label,
) {
  const read = (/** @type {Srv} */ srv) =>
    JSON.parse(readFileSync(path.join(srv.dataDir, 'state.json'), 'utf8'));
  const now = Date.now();
  const vOld = { body: normalize(read(oldSrv), { sentAt: now, ids: ids.old }) };
  const vNew = { body: normalize(read(newSrv), { sentAt: now, ids: ids.new }) };
  const diffs = diff(vOld, vNew, '', []).map((d) => ({ ...d, path: d.path.replace(/^\./, '') }));
  const { allowed, unexplained } = classify('state.json', diffs);
  results.push({
    id: label,
    title: 'state.json en disco (A frente a B)',
    old: vOld,
    new: vNew,
    diffs,
    allowed,
    unexplained,
  });
  log(
    `${unexplained.length ? 'DIFERENCIA' : allowed.length ? 'compat   ' : 'igual     '} ${label} state.json en disco`,
  );
  for (const d of unexplained.slice(0, 20)) {
    log(
      `    ${d.path}: 0.6.59=${JSON.stringify(d.old)?.slice(0, 160)} · nuevo=${JSON.stringify(d.new)?.slice(0, 160)}`,
    );
  }
}

async function main() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'ace-contraste-'));
  log(`carpeta temporal: ${work}`);
  /** @type {Srv[]} */
  const running = [];
  /** @type {import('node:http').Server | null} */
  let listasServer = null;
  /** @type {Result[]} */
  const results = [];
  try {
    // 1. Compilar el backend nuevo (lo mismo que va a la release).
    const { buildServer } = await import(pathToFileURL(path.join(SERVER_DIR, 'build.mjs')).href);
    const built = await buildServer({ outdir: path.join(work, 'nuevo'), log: () => undefined });
    log(`backend nuevo ${built.version} compilado`);

    // 2. Servidor de listas y datos A/B.
    const listas =
      /** @type {{ server: import('node:http').Server, hits: Map<string, number>, base: string }} */ (
        await startListas()
      );
    listasServer = listas.server;
    const seedDir = path.join(work, 'semilla');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      path.join(seedDir, 'state.json'),
      JSON.stringify(seedState(listas.base), null, 2),
    );
    const dataA = path.join(work, 'datos-A-0.6.59');
    const dataB = path.join(work, 'datos-B-nuevo');
    cpSync(seedDir, dataA, { recursive: true });
    cpSync(seedDir, dataB, { recursive: true });

    const baseEnv = {
      AUTO_SYNC: 'false',
      FOOTBALL_DEMO_ONLY: 'true',
      FOOTBALL_COUNTRY: 'Spain',
      FOOTBALL_DAYS: '14',
      THESPORTSDB_API_KEY: '123',
      /* Motor y engine-control en puertos cerrados de este PC: "sin motor". */
      ACESTREAM_HOST: '127.0.0.1',
      ACESTREAM_SCANNER_HOST: '',
      ENGINE_CONTROL_HOST: '127.0.0.1',
      ENGINE_CONTROL_TOKEN: 'semilla-de-contraste-solo-pruebas',
      ACE_SEED: randomBytes(24).toString('hex'),
      OLLAMA_BASE_URL: '',
      DEFAULT_WEB_SYNC_URL: `${listas.base}/principal.m3u`,
      ACE_LOG_LEVEL: 'info',
    };
    const launch = async (/** @type {string} */ allowPrivate, /** @type {string} */ tag) => {
      const env = { ...baseEnv, ALLOW_PRIVATE_SYNC_URLS: allowPrivate };
      const [o, n] = await Promise.all([
        startServer('old', {
          script: LEGACY_SERVER_JS,
          dataDir: dataA,
          env,
          logFile: path.join(work, `log-0.6.59-${tag}.txt`),
        }),
        startServer('new', {
          script: path.join(work, 'nuevo', 'server.js'),
          dataDir: dataB,
          env,
          logFile: path.join(work, `log-nuevo-${tag}.txt`),
        }),
      ]);
      running.push(o, n);
      return { o, n };
    };

    // 3. Fase 1: directorios permitidos en el servidor local.
    let { o, n } = await launch('true', 'fase1');
    log(`0.6.59 en :${o.port} · nuevo en :${n.port} · listas en ${listas.base}`);
    /** @type {{ old: Ctx, new: Ctx }} */
    const ctxs = {
      old: { vars: { agregador: 'agregador' }, srv: o },
      new: { vars: { agregador: 'agregador' }, srv: n },
    };
    const ids = { old: new Map(), new: new Map() };
    await runSteps(steps(listas.base), o, n, ctxs, ids, results);
    compareStateFiles(o, n, ids, results, 'state.json-fase1');

    // 4. Fase 2: reinicio (el estado sobrevive igual) y anti-SSRF.
    await Promise.all([stopServer(o), stopServer(n)]);
    ({ o, n } = await launch('false', 'fase2'));
    ctxs.old.srv = o;
    ctxs.new.srv = n;
    await runSteps(stepsPhase2(listas.base), o, n, ctxs, ids, results);
    await Promise.all([stopServer(o), stopServer(n)]);
    compareStateFiles(o, n, ids, results, 'state.json-fase2');

    // 5. Logs: el nuevo no puede haber registrado errores (nivel 50/60).
    const newErrors = [n.logText(), readFileSync(path.join(work, 'log-nuevo-fase1.txt'), 'utf8')]
      .join('\n')
      .split('\n')
      .filter((line) => /"level":(50|60)/.test(line));
    for (const line of newErrors.slice(0, 5)) log(`log del nuevo: ${line.slice(0, 300)}`);

    // 6. Resumen.
    const failing = results.filter((r) => r.unexplained.length);
    /** @type {Map<string, number>} */
    const usedCompat = new Map();
    for (const r of results) {
      for (const a of r.allowed) usedCompat.set(a.compat, (usedCompat.get(a.compat) ?? 0) + 1);
    }
    const stepsWithCompat = results.filter((r) => r.allowed.length && !r.unexplained.length).length;
    log(
      `${results.length} comparaciones · ${results.length - failing.length} sin diferencias fuera de compat.md` +
        ` (${stepsWithCompat} con diferencias de compat.md: ${[...usedCompat.keys()].join(', ') || 'ninguna'})` +
        ` · ${failing.length} con diferencias sin explicar · ${newErrors.length} errores en el log del nuevo`,
    );
    if (args.md) writeFileSync(args.md, markdown(results));
    if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));
    const ok = failing.length === 0 && newErrors.length === 0;
    process.stdout.write(
      `${JSON.stringify({ ok, comparisons: results.length, unexplained: failing.map((r) => r.id), compat: Object.fromEntries(usedCompat) })}\n`,
    );
    return ok;
  } finally {
    for (const srv of running) {
      if (!srv.exited()) srv.child.kill();
    }
    listasServer?.close();
    listasServer?.closeAllConnections();
    await sleep(300);
    if (!args.keep) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** Tabla de pasos para el informe. */
function markdown(/** @type {Result[]} */ results) {
  const rows = results.map((r) => {
    const o = /** @type {{ status?: number }} */ (r.old);
    const n = /** @type {{ status?: number }} */ (r.new);
    const status = o.status !== undefined ? `${o.status} / ${n.status}` : '—';
    const verdict = r.unexplained.length
      ? `**diferencia** (${r.unexplained.map((d) => `\`${d.path}\``).join(', ')})`
      : r.allowed.length
        ? `igual salvo compat ${[...new Set(r.allowed.map((a) => a.compat))].join(', ')}`
        : 'igual';
    return `| ${r.id} | ${r.title.replace(/\|/g, '\\|')} | ${status} | ${verdict} |`;
  });
  return [
    '| Paso | Qué | HTTP 0.6.59 / nuevo | Resultado |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (error) => {
    log(`FALLO: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  },
);
