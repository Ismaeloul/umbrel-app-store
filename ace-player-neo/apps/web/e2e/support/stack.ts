/* La pila de las pruebas E2E, entera y en local. La lanza el `webServer` de
   playwright.config.ts con tsx y aquí solo se vigila: cada pieza va en su
   proceso y, si uno se cae, se vuelve a lanzar en el mismo puerto.

   1. motores.ts: motor AceStream falso principal en 127.0.0.N:6878
      (puertos.ts) con su API de control /__fake/*, el motor falso del
      comprobador y engine_control falso en 127.0.0.N:3001;
   2. backend.ts: el backend con DATA_DIR temporal, AUTO_SYNC=false y la
      agenda de demostración (no sale nada a internet);
   3. la web con Vite (vite.e2e.config.ts: sin HMR): proxy de /api al
      backend y de /ace/ y /content/ al motor (VITE_ENGINE), como nginx en
      el NAS.

   Por qué vigilar: en el PC de Isma los filtros de red de Windows (VPN y
   bloqueador) tumban a veces un proceso de Node que abre muchas conexiones
   locales con 0xC0000409 (apps/server/test/fake-engine/README.md). Pasa
   también sin nada de nuestro código; relanzar la pieza deja que la batería
   siga (el reproductor reconecta solo, como tras un corte de verdad). Cada
   caída queda en el log de la pieza y en la salida de la pila.

   Los puertos llegan en E2E_PORTS (puertos.ts). Al cerrarse (Playwright
   mata el árbol de procesos al acabar), apaga todo y borra los datos. */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_CONTROL_PORT,
  ENGINE_CONTROL_TOKEN,
  MOTOR_PORT,
  portIsFree,
  readPorts,
} from './puertos.ts';
import { cacheDelMotorS } from './catalogo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, '../..');
const MONOREPO_DIR = path.resolve(WEB_DIR, '../..');
const TSX_CLI = path.join(MONOREPO_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VITE_CLI = path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
/** Caídas que se toleran en toda la batería antes de rendirse. */
const MAX_RESTARTS = 6;

const ports = readPorts();
const MOTOR_HOST = ports.motorHost;
/* En Windows Playwright cierra la pila matando el árbol de procesos (sin
   SIGTERM), así que el borrado de `shutdown` casi nunca llega a correr. Cada
   pila, al arrancar, barre las carpetas de pilas anteriores que tengan más de
   una hora (una batería entera dura ~10 min). */
const UNA_HORA_MS = 60 * 60 * 1000;
if (!process.env.E2E_KEEP_DATA) {
  for (const name of readdirSync(os.tmpdir())) {
    if (!name.startsWith('ace-e2e-')) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      if (Date.now() - statSync(dir).mtimeMs > UNA_HORA_MS) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {}
  }
}
const work = mkdtempSync(path.join(os.tmpdir(), 'ace-e2e-'));
const dataDir = path.join(work, 'data');

interface Piece {
  readonly name: string;
  readonly args: string[];
  readonly env: NodeJS.ProcessEnv;
  /** URL que contesta cuando la pieza está lista. */
  readonly ready: string;
  child: ChildProcess | null;
}

const pieces: Piece[] = [];
let restarts = 0;
let shuttingDown = false;

function log(line: string): void {
  process.stderr.write(`[pila e2e] ${line}\n`);
}

async function shutdown(code: number): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true;
    for (const piece of pieces) {
      const child = piece.child;
      if (child && child.exitCode === null) {
        if (child.connected) child.send('shutdown');
        else child.kill();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const piece of pieces) if (piece.child?.exitCode === null) piece.child.kill();
    if (!process.env.E2E_KEEP_DATA) rmSync(work, { recursive: true, force: true });
  }
  process.exit(code);
}
process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

function waitFor(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  const attempt = (): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.get(url, { agent: false }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => req.destroy());
    });
  return (async () => {
    while (!(await attempt())) {
      if (Date.now() - started > timeoutMs)
        throw new Error(`${url} no contestó en ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })();
}

function launch(piece: Piece): void {
  const logFile = path.join(work, `${piece.name}.log`);
  const out = createWriteStream(logFile, { flags: 'a' });
  const child = spawn(process.execPath, piece.args, {
    cwd: WEB_DIR,
    env: piece.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  piece.child = child;
  child.once('exit', (code) => {
    if (shuttingDown) return;
    restarts += 1;
    log(
      `${piece.name} se cayó (código ${code}); relanzo (${restarts}/${MAX_RESTARTS}). Log: ${logFile}`,
    );
    if (restarts > MAX_RESTARTS) {
      void shutdown(1);
      return;
    }
    setTimeout(() => {
      if (shuttingDown) return;
      launch(piece);
      waitFor(piece.ready, 60_000).then(
        () => log(`${piece.name} de nuevo en marcha`),
        (error: unknown) => {
          log(`${piece.name} no volvió: ${String(error)}`);
          void shutdown(1);
        },
      );
    }, 500);
  });
}

async function start(piece: Piece): Promise<void> {
  pieces.push(piece);
  launch(piece);
  await waitFor(piece.ready, 60_000);
}

try {
  log(`carpeta de trabajo: ${work}`);
  for (const [port, what] of [
    [MOTOR_PORT, 'motor principal'],
    [ENGINE_CONTROL_PORT, 'engine_control'],
  ] as const) {
    if (!(await portIsFree(port, MOTOR_HOST))) {
      throw new Error(`${MOTOR_HOST}:${port} está ocupado (${what})`);
    }
  }

  await start({
    name: 'motores',
    args: [TSX_CLI, path.join(HERE, 'motores.ts')],
    env: { ...process.env },
    ready: `http://${MOTOR_HOST}:${ports.control}/__fake/status`,
    child: null,
  });
  log(
    `motores falsos en ${MOTOR_HOST}:${MOTOR_PORT} (control ${ports.control}, caché ${cacheDelMotorS()} s) y [::]:${ports.scanner}`,
  );

  await start({
    name: 'backend',
    args: [TSX_CLI, path.join(HERE, 'backend.ts')],
    env: {
      ...process.env,
      PORT: String(ports.backend),
      DATA_DIR: dataDir,
      AUTO_SYNC: 'false',
      FOOTBALL_DEMO_ONLY: 'true',
      ACESTREAM_HOST: MOTOR_HOST,
      /* «localhost» y no «::1»: el saneado de los hosts quita los «:». */
      ACESTREAM_SCANNER_HOST: 'localhost',
      ACESTREAM_SCANNER_PORT: String(ports.scanner),
      /* Los mínimos que admite la config: el comprobador da su veredicto antes. */
      ACESTREAM_SCANNER_SUSTAIN_MS: '4000',
      ACESTREAM_SCANNER_MEDIA_PROBE_MS: '2500',
      ENGINE_CONTROL_HOST: MOTOR_HOST,
      ENGINE_CONTROL_TOKEN,
      OLLAMA_BASE_URL: '',
      ACE_LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'info',
    },
    ready: `http://[::1]:${ports.backend}/api/v1/health/live`,
    child: null,
  });
  log(`backend en http://[::1]:${ports.backend} (y 127.0.0.1)`);

  await start({
    name: 'web',
    args: [
      VITE_CLI,
      '--config',
      path.join(HERE, 'vite.e2e.config.ts'),
      '--host',
      '127.0.0.1',
      '--port',
      String(ports.web),
      '--strictPort',
    ],
    env: {
      ...process.env,
      /* backend.ts escucha en `::`: por ::1 el proxy no sufre los cortes de 127.0.0.1. */
      VITE_BACKEND: `http://[::1]:${ports.backend}`,
      /* /ace/ y /content/ van directos al motor, como con nginx en el NAS. */
      VITE_ENGINE: `http://${MOTOR_HOST}:${MOTOR_PORT}`,
    },
    ready: `http://127.0.0.1:${ports.web}/`,
    child: null,
  });
  log(`web en http://127.0.0.1:${ports.web}`);
} catch (error) {
  log(`no arrancó: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
