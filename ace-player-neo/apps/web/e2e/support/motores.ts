/* Los motores falsos de la pila E2E, en un proceso propio (stack.ts lo
   vigila y lo vuelve a lanzar si se cae):

   - el principal en <motorHost>:6878 con su API de control /__fake/* en un
     puerto aparte (sigue viva con el motor caído o reiniciando);
   - el del comprobador en `::` (otro contenedor en el NAS: si compartiera
     motor con el reproductor, cada sonda le quitaría la sesión);
   - engine_control falso en <motorHost>:3001: `POST /restart` con el token
     «reinicia» el motor principal (reinicio seguro, abajo) y `GET /restarts`
     dice cuántas veces.

   Reinicio SEGURO: el `restart()` del motor falso deja de escuchar un rato,
   y en el PC de Isma hay otro proceso escuchando en [::]:6878 (doble pila):
   mientras el nuestro no escucha, las conexiones a 127.0.0.N:6878 le llegan
   a ESE proceso, que contesta como un motor sano (el backend lo daba por
   «en línea» y el vídeo seguía saliendo de él). Así que aquí el reinicio es
   olvidar todas las sesiones (cortando los flujos) y dejar el motor caído
   con `down` global en modo `reset` (acepta y corta, sin soltar el puerto)
   durante RESTART_DOWN_MS. Para el backend es lo mismo: sesiones perdidas
   y motor sin responder un rato.

   Lo lanza stack.ts con tsx. Los puertos llegan en E2E_PORTS. */

import http from 'node:http';
import { createFakeEngine, type FakeEngine } from '../../../server/test/fake-engine/engine.js';
import { cacheDelMotorS, catalogoMotor } from './catalogo.ts';
import { ENGINE_CONTROL_PORT, ENGINE_CONTROL_TOKEN, MOTOR_PORT, readPorts } from './puertos.ts';

/** Cuánto está caído el motor cuando engine_control lo «reinicia». */
const RESTART_DOWN_MS = 2500;

const ports = readPorts();
const closers: (() => Promise<void>)[] = [];
let restarts = 0;

/** Reinicio seguro del motor (ver arriba): sesiones fuera y caído un rato sin soltar el puerto. */
async function reinicioSeguro(engine: FakeEngine, downMs: number): Promise<void> {
  await engine.control.reset({ sessions: true });
  await engine.control.setMode('*', { kind: 'down', how: 'reset' }, { forMs: downMs });
}

function startEngineControl(engine: FakeEngine): Promise<void> {
  const server = http.createServer((req, res) => {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/restarts') return reply(200, { restarts });
    if (req.method !== 'POST' || req.url !== '/restart') return reply(404, { error: 'not_found' });
    if (req.headers['x-engine-token'] !== ENGINE_CONTROL_TOKEN) {
      return reply(401, { error: 'unauthorized' });
    }
    req.resume();
    restarts += 1;
    reinicioSeguro(engine, RESTART_DOWN_MS).then(
      () => reply(200, { ok: true }),
      (error: unknown) => reply(500, { error: String(error) }),
    );
  });
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ENGINE_CONTROL_PORT, ports.motorHost, () => resolve());
  });
}

let closing = false;
async function close(): Promise<never> {
  if (!closing) {
    closing = true;
    await Promise.allSettled(closers.map((fn) => fn()));
  }
  process.exit(0);
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
process.on('message', (message: unknown) => {
  if (message === 'shutdown') void close();
});

const catalog = catalogoMotor();
const engine = await createFakeEngine({
  host: ports.motorHost,
  port: MOTOR_PORT,
  controlPort: ports.control,
  catalog,
  // La caché del motor al abrir un progresivo (catalogo.ts: por qué 15 s).
  burstSeconds: cacheDelMotorS(),
});
closers.push(() => engine.close());
const scanner = await createFakeEngine({ host: '::', port: ports.scanner, catalog });
closers.push(() => scanner.close());
await startEngineControl(engine);
process.stdout.write(
  `motores falsos: ${engine.url} (control ${engine.controlUrl}) y [::]:${ports.scanner}\n`,
);
