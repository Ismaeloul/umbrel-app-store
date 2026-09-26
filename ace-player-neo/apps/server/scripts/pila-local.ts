/* Pila local para probar a mano en el PC (docs/iptv.md §15, «Cómo probar tu propia lista en local»).

     corepack pnpm@10.18.2 exec tsx apps/server/scripts/pila-local.ts [--puerto 3100] [--datos .data/pila-local]
                                                                      [--registro <fichero>]

   Arranca en un solo proceso:
   - el motor AceStream FALSO (apps/server/test/fake-engine) en 127.0.0.N:6878, con engine_control falso en
     127.0.0.N:3001, y otro motor falso para el comprobador en `::` (puerto libre). Cualquier hash «suena»: sirve
     para el respaldo de la IPTV sin motor de verdad;
   - el backend REAL de la rama, con la red de verdad: agenda, listas de AceStream y tu IPTV. Escucha en `::` (doble
     pila), puerto 3100 por defecto, para que el proxy de Vite llegue por [::1] (en este PC las conexiones a
     127.0.0.1 se cortan a veces);
   - un interruptor para simular que se cae la red, en 127.0.0.N:3002 (solo en este PC):
       curl -X POST "http://127.0.0.N:3002/__red/cortar?host=rtve.es"   corta ese host (y sus subdominios); sin
                                                                          `host`, toda la red saliente
       curl -X POST "http://127.0.0.N:3002/__red/restaurar"             la devuelve
     Al cortar se rompen también las descargas que están en marcha, como si se fuera la conexión.

   Los datos van a `.data/pila-local` (ignorada por git). Sin ACE_SEED, la IPTV cifra con `v2/iptv/clave` dentro de
   esa carpeta. ffmpeg tiene que estar en el PATH para reproducir la IPTV. Los registros van en JSON (pino),
   igual de tapados que en el Umbrel, a `<datos>/registro.jsonl` (o a `--registro`); por la consola solo sale
   cómo abrir la web. Ctrl+C lo para todo. */

import { createWriteStream, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { createDomainBus } from '../src/core/bus.js';
import { createSystemClock } from '../src/core/clock.js';
import { createLogger } from '../src/core/logger.js';
import { startServices, stopServices } from '../src/main.js';
import { createNetClient } from '../src/modules/net/index.js';
import { nodeTransport } from '../src/modules/net/transport.js';
import type { NetTransport } from '../src/modules/net/types.js';
import { createServices } from '../src/services.js';
import { createFakeEngine, type FakeEngine } from '../test/fake-engine/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ENGINE_PORT = 6878;
const CONTROL_PORT = 3001;
const NETWORK_PORT = 3002;
const CONTROL_TOKEN = 'pila-local';

function option(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function freePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/* La primera 127.0.0.N con los puertos libres (otras pilas y las E2E usan las primeras). */
async function pickLocalHost(): Promise<string> {
  for (let n = 60; n < 250; n++) {
    const host = `127.0.0.${n}`;
    let free = true;
    for (const port of [ENGINE_PORT, CONTROL_PORT, NETWORK_PORT]) {
      if (!(await portIsFree(port, host))) free = false;
    }
    if (free) return host;
  }
  throw new Error('No hay ninguna 127.0.0.N con el 6878, el 3001 y el 3002 libres');
}

function listen(server: http.Server, port: number, host: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

/* engine_control falso: «reiniciar» el motor es olvidar sus sesiones. */
function engineControl(engine: FakeEngine): http.Server {
  return http.createServer((req, res) => {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/restart') return reply(404, { error: 'not_found' });
    if (req.headers['x-engine-token'] !== CONTROL_TOKEN)
      return reply(401, { error: 'unauthorized' });
    req.resume();
    engine.control.reset({ sessions: true }).then(
      () => reply(200, { ok: true }),
      (error: unknown) => reply(500, { error: String(error) }),
    );
  });
}

/* --- Red que se puede cortar ---------------------------------------------------------------- */

/** `null`: red normal; `''`: toda cortada; si no, el host (y sus subdominios) cortado. */
let cut: string | null = null;
const open = new Set<{ host: string; body: Readable }>();

const isCut = (host: string): boolean =>
  cut !== null && (cut === '' || host === cut || host.endsWith(`.${cut}`));

const transport: NetTransport = async (request) => {
  const host = request.url.hostname.toLowerCase();
  if (isCut(host)) {
    throw Object.assign(new Error('red cortada a mano (pila local)'), { code: 'ECONNRESET' });
  }
  const response = await nodeTransport(request);
  const item = { host, body: response.body };
  open.add(item);
  response.body.once('close', () => open.delete(item));
  return response;
};

function networkControl(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://pila.local');
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && url.pathname === '/__red/cortar') {
      cut = (url.searchParams.get('host') ?? '').trim().toLowerCase();
      let broken = 0;
      for (const item of open) {
        if (!isCut(item.host)) continue;
        item.body.destroy(Object.assign(new Error('red cortada a mano'), { code: 'ECONNRESET' }));
        broken += 1;
      }
      return reply(200, { cortada: cut || 'toda', descargasRotas: broken });
    }
    if (req.method === 'POST' && url.pathname === '/__red/restaurar') {
      cut = null;
      return reply(200, { cortada: null });
    }
    if (req.method === 'GET' && url.pathname === '/__red') return reply(200, { cortada: cut });
    return reply(404, { error: 'not_found' });
  });
}

/* --- Arranque --------------------------------------------------------------------------------- */

const port = Number(option('puerto') ?? 3100);
const dataDir = path.resolve(ROOT, option('datos') ?? '.data/pila-local');
const localHost = await pickLocalHost();
const engine = await createFakeEngine({ host: localHost, port: ENGINE_PORT });
const scannerPort = await freePort('::');
const scanner = await createFakeEngine({ host: '::', port: scannerPort });
const control = await listen(engineControl(engine), CONTROL_PORT, localHost);
const network = await listen(networkControl(), NETWORK_PORT, localHost);

mkdirSync(dataDir, { recursive: true });
const logFile = path.resolve(ROOT, option('registro') ?? path.join(dataDir, 'registro.jsonl'));
const logStream = createWriteStream(logFile, { flags: 'a' });

const { config, warnings } = loadConfig({
  ...process.env,
  PORT: String(port),
  DATA_DIR: dataDir,
  ACESTREAM_HOST: localHost,
  ENGINE_CONTROL_HOST: localHost,
  ENGINE_CONTROL_TOKEN: CONTROL_TOKEN,
  /* «localhost» y no «::1»: el saneado de los hosts quita los «:». */
  ACESTREAM_SCANNER_HOST: 'localhost',
  ACESTREAM_SCANNER_PORT: String(scannerPort),
});
const logger = createLogger({
  level: config.logLevel,
  base: { version: config.appVersion },
  destination: logStream,
});
for (const warning of warnings) logger.warn(warning);
const clock = createSystemClock();
const bus = createDomainBus({ logger });
const core = { config, clock, logger, bus };
const services = createServices(core, { net: createNetClient({ ...core, transport }) });
await startServices(services);
const app = await buildApp({ services });
await app.listen({ host: '::', port });
process.stdout.write(
  [
    '',
    `Pila local lista: backend real en http://[::1]:${port}.`,
    `  Datos:     ${dataDir}`,
    `  Registros: ${logFile}`,
    `  Motor AceStream falso en ${localHost}:${ENGINE_PORT}; comprobador falso en [::]:${scannerPort}.`,
    '',
    'Web, en otra terminal de PowerShell, desde ace-player-neo\\apps\\web:',
    `  $env:VITE_BACKEND = "http://[::1]:${port}"; $env:VITE_ENGINE = "http://${localHost}:${ENGINE_PORT}"`,
    '  corepack pnpm@10.18.2 exec vite --host 127.0.0.1 --port 5174',
    '  y abre http://127.0.0.1:5174/?vista=ajustes/iptv',
    '',
    'Simular que se cae la red (PowerShell):',
    `  Invoke-RestMethod -Method Post "http://${localHost}:${NETWORK_PORT}/__red/cortar"          (toda)`,
    `  Invoke-RestMethod -Method Post "http://${localHost}:${NETWORK_PORT}/__red/cortar?host=<host>"`,
    `  Invoke-RestMethod -Method Post "http://${localHost}:${NETWORK_PORT}/__red/restaurar"`,
    '',
    'Ctrl+C para pararlo todo.',
    '',
  ].join('\n'),
);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void stopServices(services, app)
    .then(() => Promise.allSettled([engine.close(), scanner.close()]))
    .then(() =>
      Promise.all(
        [control, network].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      ),
    )
    .then(() => new Promise<void>((resolve) => logStream.end(() => resolve())))
    .finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', (message: unknown) => {
  if (message === 'shutdown') stop();
});
