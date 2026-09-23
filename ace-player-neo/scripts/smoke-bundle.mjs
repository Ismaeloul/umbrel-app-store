// Prueba de humo del backend EMPAQUETADO (paso 1.3 de la Fase 1).
//
// Compila server.js con apps/server/build.mjs (lo mismo que va a la release)
// y lo arranca como en el NAS, pero contra dos motores AceStream falsos
// (test/fake-engine/cli.ts con tsx): el principal en [::1]:6878 (el puerto es
// fijo en el backend, como en la 0.6.59) y el comprobador en un puerto libre.
// Con DATA_DIR temporal, AUTO_SYNC=false y FOOTBALL_DEMO_ONLY=true no sale
// nada a internet. Comprueba:
//
//   1. que arranca en menos de 3 s (desde que se lanza el proceso hasta que
//      /api/v1/health/live contesta 200);
//   2. /api/health (forma 0.6.59, motor y comprobador en línea), /api/v1/health/live,
//      /api/v1/ping, /api/state y /api/football (agenda de demostración);
//   3. una reproducción de verdad: GET /api/v1/channels/<id>/stream?client=web
//      con un canal del catálogo del motor falso, un latido y el release, y
//      que el motor falso se queda SIN sesiones abiertas;
//   4. el apagado limpio: con un canal abierto, `shutdown` (por IPC: en
//      Windows no hay SIGTERM que se pueda capturar) → sale con 0 en menos de
//      5 s y para la sesión en el motor (T-111).
//
// Uso (desde ace-player-neo/): node scripts/smoke-bundle.mjs [--keep]
//   --keep deja la carpeta temporal (release y datos) para mirarla.
// Sale con 0 si todo va bien; si no, con 1 y el motivo.
import { fork, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MONOREPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(MONOREPO_DIR, 'apps', 'server');
const TSX_CLI = path.join(MONOREPO_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const FAKE_ENGINE_CLI = path.join(SERVER_DIR, 'test', 'fake-engine', 'cli.ts');
/** El backend siempre habla con el motor en el 6878 (server.js:2818; config ENGINE_PORT). */
const ENGINE_PORT = 6878;
/** Primer canal del catálogo por defecto del motor falso (`demoContentId(1)`). */
const CHANNEL_ID = `fa4ec0de${'1'.padStart(32, '0')}`;
const STARTUP_BUDGET_MS = 3000;
const SHUTDOWN_BUDGET_MS = 5000;

const keep = process.argv.includes('--keep');
const children = [];
const results = [];

function log(line) {
  process.stdout.write(`[humo] ${line}\n`);
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? 'OK  ' : 'FALLO'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Un puerto libre en esa dirección (el SO lo elige y se suelta enseguida). */
function freePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function portIsFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

/**
 * Petición HTTP con reintentos: en el PC de Isma el loopback IPv4 corta ~1 de
 * cada 6 conexiones (filtros de red); el backend escucha en 0.0.0.0 (IPv4).
 */
async function request(base, method, pathname, { body, headers = {}, attempts = 6 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const url = new URL(pathname, base);
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const req = http.request(
          url,
          {
            method,
            agent: false,
            headers: {
              'x-ace-origin': 'web',
              ...(payload ? { 'content-type': 'application/json' } : {}),
              ...headers,
            },
            timeout: 15_000,
          },
          (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              let json;
              try {
                json = text ? JSON.parse(text) : null;
              } catch {
                json = null;
              }
              resolve({ status: res.statusCode ?? 0, text, json });
            });
            res.on('error', reject);
          },
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end(payload ?? undefined);
      });
    } catch (error) {
      lastError = error;
      await sleep(50 * attempt);
    }
  }
  throw lastError;
}

/** Lanza un motor falso con tsx y espera a que diga que escucha. */
function startFakeEngine(port, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, FAKE_ENGINE_CLI, '--port', String(port), '--host', '::1'],
      { cwd: MONOREPO_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(child);
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`${label}: no arrancó en 20 s\n${output}`)),
      20_000,
    );
    const onData = (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('motor falso escuchando')) {
        clearTimeout(timer);
        resolve({ child, base: `http://[::1]:${port}` });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${label}: salió con ${code}\n${output}`));
    });
  });
}

async function fakeMetrics(engine) {
  const res = await request(engine.base, 'GET', '/__fake/metrics');
  if (res.status !== 200 || !res.json) throw new Error(`métricas del motor falso: ${res.status}`);
  return res.json;
}

async function main() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'ace-smoke-'));
  const releaseDir = path.join(work, 'release');
  const dataDir = path.join(work, 'data');
  log(`carpeta temporal: ${work}`);
  try {
    // --- 1. Compilar ---
    const { buildServer } = await import(pathToFileURL(path.join(SERVER_DIR, 'build.mjs')).href);
    const built = await buildServer({ outdir: releaseDir, log: () => undefined });
    const serverJs = path.join(releaseDir, 'server.js');
    const size = statSync(serverJs).size;
    check(
      'bundle compilado',
      size > 100_000,
      `server.js ${(size / 1048576).toFixed(2)} MiB, ${built.version}`,
    );

    // --- 2. Motores falsos ---
    const enginePortFree = await portIsFree(ENGINE_PORT, '::1');
    check(
      `el puerto ${ENGINE_PORT} de ::1 está libre para el motor falso`,
      enginePortFree,
      enginePortFree ? '' : 'otro proceso lo usa (¿un motor de verdad?)',
    );
    const scannerPort = await freePort('::1');
    const [engine, scanner] = await Promise.all([
      startFakeEngine(ENGINE_PORT, 'motor principal'),
      startFakeEngine(scannerPort, 'motor comprobador'),
    ]);
    log(`motores falsos en ${engine.base} y ${scanner.base}`);

    // --- 3. Arranque del backend empaquetado ---
    const port = await freePort('0.0.0.0');
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      AUTO_SYNC: 'false',
      FOOTBALL_DEMO_ONLY: 'true',
      /* "localhost" y no "::1": el saneado de ACESTREAM_HOST quita los ":" (como la 0.6.59). */
      ACESTREAM_HOST: 'localhost',
      ACESTREAM_SCANNER_HOST: 'localhost',
      ACESTREAM_SCANNER_PORT: String(scannerPort),
      ENGINE_CONTROL_HOST: 'localhost',
      ACE_SEED: randomBytes(24).toString('hex'),
      ACE_LOG_LEVEL: 'warn',
      OLLAMA_BASE_URL: '',
    };
    const startedAt = performance.now();
    const server = fork(serverJs, [], {
      cwd: releaseDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.push(server);
    let serverLog = '';
    server.stdout.on('data', (chunk) => (serverLog += chunk.toString('utf8')));
    server.stderr.on('data', (chunk) => (serverLog += chunk.toString('utf8')));
    let exited = null;
    const exitPromise = new Promise((resolve) => {
      server.once('exit', (code, signal) => {
        exited = { code, signal, at: performance.now() };
        resolve(exited);
      });
    });

    let startupMs = null;
    while (startupMs === null) {
      if (exited) throw new Error(`el backend salió al arrancar (${exited.code})\n${serverLog}`);
      if (performance.now() - startedAt > 20_000)
        throw new Error(`no arrancó en 20 s\n${serverLog}`);
      try {
        const live = await request(base, 'GET', '/api/v1/health/live', { attempts: 1 });
        if (live.status === 200) startupMs = Math.round(performance.now() - startedAt);
      } catch {
        await sleep(20);
      }
    }
    check(
      `arranca en menos de ${STARTUP_BUDGET_MS / 1000} s`,
      startupMs < STARTUP_BUDGET_MS,
      `${startupMs} ms`,
    );

    // --- 4. Rutas ---
    const live = await request(base, 'GET', '/api/v1/health/live');
    check('GET /api/v1/health/live', live.status === 200 && live.json?.ok === true, live.text);
    const ping = await request(base, 'GET', '/api/v1/ping');
    check(
      'GET /api/v1/ping',
      ping.status === 200 && ping.json?.version === built.version,
      `versión ${ping.json?.version}`,
    );

    /* El vigilante y el comprobador preguntan su get_version al arrancar: se espera a que lo tengan. */
    let health = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      health = await request(base, 'GET', '/api/health');
      const components = health.json?.components;
      if (components?.engine?.online && components?.scanner?.online) break;
      await sleep(100);
    }
    check(
      'GET /api/health (forma 0.6.59; motor y comprobador en línea)',
      health?.status === 200 &&
        health.json?.success === true &&
        health.json.components?.engine?.online === true &&
        health.json.components?.scanner?.online === true &&
        health.json.components?.ai?.status === 'disabled',
      JSON.stringify(health?.json?.components ?? health?.text),
    );
    const state = await request(base, 'GET', '/api/state');
    check(
      'GET /api/state',
      state.status === 200 &&
        Array.isArray(state.json?.favorites) &&
        Array.isArray(state.json?.history),
    );
    const football = await request(base, 'GET', '/api/football');
    const matches =
      football.json?.matches ?? football.json?.days?.flatMap?.((day) => day.matches) ?? [];
    check(
      'GET /api/football (agenda de demostración)',
      football.status === 200 && football.json?.success !== false && Array.isArray(matches),
      `${matches.length} partidos`,
    );

    // --- 5. Una reproducción de punta a punta ---
    const streamUrl = `/api/v1/channels/${CHANNEL_ID}/stream?client=web&viewer=humo-1&device=humo-pc`;
    const grant = await request(base, 'GET', streamUrl);
    check(
      'GET /api/v1/channels/<id>/stream?client=web',
      grant.status === 200 && typeof grant.json?.session?.id === 'string',
      `${grant.status} ${grant.json?.protocol ?? grant.text}`,
    );
    const sid = grant.json.session.id;
    let metrics = await fakeMetrics(engine);
    check(
      'el motor falso tiene UNA sesión abierta',
      metrics.sessionsOpen === 1,
      `${metrics.sessionsOpen}`,
    );
    const beat = await request(base, 'POST', `/api/v1/sessions/${sid}/heartbeat`, {
      body: { viewer: 'humo-1', playing: true },
    });
    check('latido', beat.status === 200 && beat.json?.url === grant.json.url, `${beat.status}`);
    const released = await request(base, 'POST', `/api/v1/sessions/${sid}/release`, {
      body: { viewer: 'humo-1', reason: 'user' },
    });
    check(
      'release',
      released.status === 200 && released.json?.sessionClosed === true,
      JSON.stringify(released.json),
    );
    metrics = await fakeMetrics(engine);
    check(
      'el motor falso se queda sin sesiones abiertas',
      metrics.sessionsOpen === 0 && metrics.stopsReceived >= 1,
      `abiertas ${metrics.sessionsOpen}, stops ${metrics.stopsReceived}`,
    );
    const scannerMetrics = await fakeMetrics(scanner);
    check('el comprobador tampoco deja sesiones', scannerMetrics.sessionsOpen === 0);

    // --- 6. Apagado limpio con un canal abierto (T-111) ---
    const second = await request(
      base,
      'GET',
      `/api/v1/channels/${CHANNEL_ID}/stream?client=web&viewer=humo-2&device=humo-pc`,
    );
    check('otro canal abierto antes de apagar', second.status === 200);
    const stopAt = performance.now();
    server.send('shutdown');
    const exit = await Promise.race([
      exitPromise,
      sleep(SHUTDOWN_BUDGET_MS + 2000).then(() => null),
    ]);
    const shutdownMs = Math.round(performance.now() - stopAt);
    check(
      `apagado limpio: sale con 0 en menos de ${SHUTDOWN_BUDGET_MS / 1000} s`,
      exit !== null && exit.code === 0 && shutdownMs < SHUTDOWN_BUDGET_MS,
      exit ? `código ${exit.code}, ${shutdownMs} ms` : 'no salió',
    );
    metrics = await fakeMetrics(engine);
    check(
      'al apagar se para la sesión en el motor',
      metrics.sessionsOpen === 0,
      `${metrics.sessionsOpen}`,
    );
    const errors = serverLog.split('\n').filter((line) => /"level":(50|60)/.test(line));
    check('sin errores en el log del backend', errors.length === 0, errors.slice(0, 3).join(' | '));

    log(
      `TODO BIEN · ${results.length} comprobaciones · arranque ${startupMs} ms · apagado ${shutdownMs} ms`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, startupMs, shutdownMs, checks: results.length })}\n`,
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await sleep(200);
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    log(`FALLO: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
