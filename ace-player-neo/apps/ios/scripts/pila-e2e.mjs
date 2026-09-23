#!/usr/bin/env node
// Pila E2E para las pruebas de interfaz de la app iOS (ServidorRealUITests):
// el motor AceStream falso y el backend DE VERDAD del monorepo, en local y
// sin Docker (el runner de macOS de la CI no lo tiene). Son las mismas piezas
// que la batería E2E de la web (apps/web/e2e/support: motores.ts y
// backend.ts), sin Vite: la app iOS habla directamente con el backend, que
// entiende el prefijo /native igual que detrás de nginx.
//
//   motor falso principal   127.0.0.1:6878 (control /__fake/* en ACE_E2E_PUERTO+2)
//   engine_control falso    127.0.0.1:3001
//   (en un PC con otro motor en el 6878: ACE_E2E_MOTOR_HOST=127.0.0.N)
//   motor del comprobador   [::]:ACE_E2E_PUERTO+1
//   backend                 [::]:ACE_E2E_PUERTO (18790 por defecto)
//
// El remux del iPhone necesita ffmpeg y ffprobe en el PATH (en la CI, brew).
// Los datos y los logs de cada pieza van a ACE_E2E_DIR (build/pila-e2e por
// defecto), que la CI sube como artefacto.
//
// Uso (desde apps/ios, con `pnpm install` hecho en el monorepo):
//   node scripts/pila-e2e.mjs
// Se queda en marcha hasta SIGINT/SIGTERM. Si una pieza se cae, lo dice y la
// vuelve a lanzar (como apps/web/e2e/support/stack.ts).

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO = path.resolve(AQUI, '..', '..', '..');
const WEB = path.join(MONOREPO, 'apps', 'web');
const SOPORTE = path.join(WEB, 'e2e', 'support');
const TSX = path.join(MONOREPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MAX_CAIDAS = 6;

const puertoBackend = Number(process.env.ACE_E2E_PUERTO ?? 18790);
/** En la CI, 127.0.0.1; en un PC con otro motor en el 6878, otra 127.0.0.N. */
const motorHost = process.env.ACE_E2E_MOTOR_HOST ?? '127.0.0.1';
const salida = path.resolve(process.env.ACE_E2E_DIR ?? path.join(AQUI, '..', 'build', 'pila-e2e'));
const datos = path.join(salida, 'data');
rmSync(datos, { recursive: true, force: true });
mkdirSync(datos, { recursive: true });

/** Lo que leen motores.ts y backend.ts (apps/web/e2e/support/puertos.ts). */
const puertos = {
  motorHost,
  web: 0,
  backend: puertoBackend,
  scanner: puertoBackend + 1,
  control: puertoBackend + 2,
};

const piezas = [];
let caidas = 0;
let cerrando = false;

function log(linea) {
  process.stdout.write(`[pila e2e iOS] ${linea}\n`);
}

function esperarA(url, plazoMs) {
  const inicio = Date.now();
  const intento = () =>
    new Promise((resolve) => {
      const peticion = http.get(url, { agent: false }, (respuesta) => {
        respuesta.resume();
        resolve((respuesta.statusCode ?? 500) < 500);
      });
      peticion.on('error', () => resolve(false));
      peticion.setTimeout(2000, () => peticion.destroy());
    });
  return (async () => {
    while (!(await intento())) {
      if (Date.now() - inicio > plazoMs) throw new Error(`${url} no contestó en ${plazoMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
}

function lanzar(pieza) {
  const fichero = path.join(salida, `${pieza.nombre}.log`);
  const destino = createWriteStream(fichero, { flags: 'a' });
  const hijo = spawn(process.execPath, [TSX, pieza.script], {
    cwd: WEB,
    env: pieza.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  hijo.stdout.pipe(destino);
  hijo.stderr.pipe(destino);
  pieza.hijo = hijo;
  hijo.once('exit', (codigo, senal) => {
    if (cerrando) return;
    caidas += 1;
    log(`${pieza.nombre} se cayó (${codigo ?? senal}); la relanzo (${caidas}/${MAX_CAIDAS}). Log: ${fichero}`);
    if (caidas > MAX_CAIDAS) {
      void cerrar(1);
      return;
    }
    setTimeout(() => {
      if (cerrando) return;
      lanzar(pieza);
      esperarA(pieza.lista, 60_000).then(
        () => log(`${pieza.nombre} de nuevo en marcha`),
        (error) => {
          log(`${pieza.nombre} no volvió: ${error}`);
          void cerrar(1);
        },
      );
    }, 500);
  });
}

async function arrancar(pieza) {
  piezas.push(pieza);
  lanzar(pieza);
  await esperarA(pieza.lista, 90_000);
}

async function cerrar(codigo) {
  if (!cerrando) {
    cerrando = true;
    for (const { hijo } of piezas) {
      if (hijo && hijo.exitCode === null) {
        if (hijo.connected) hijo.send('shutdown');
        else hijo.kill();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const { hijo } of piezas) if (hijo && hijo.exitCode === null) hijo.kill('SIGKILL');
  }
  process.exit(codigo);
}
process.once('SIGINT', () => void cerrar(0));
process.once('SIGTERM', () => void cerrar(0));

const entornoComun = { ...process.env, E2E_PORTS: JSON.stringify(puertos) };

try {
  log(`carpeta: ${salida}`);
  await arrancar({
    nombre: 'motores',
    script: path.join(SOPORTE, 'motores.ts'),
    env: entornoComun,
    lista: `http://${motorHost}:${puertos.control}/__fake/status`,
    hijo: null,
  });
  log(`motores falsos en ${motorHost}:6878 (control ${puertos.control}) y [::]:${puertos.scanner}`);

  await arrancar({
    nombre: 'backend',
    script: path.join(SOPORTE, 'backend.ts'),
    env: {
      ...entornoComun,
      PORT: String(puertos.backend),
      DATA_DIR: datos,
      AUTO_SYNC: 'false',
      FOOTBALL_DEMO_ONLY: 'true',
      ACESTREAM_HOST: motorHost,
      ACESTREAM_SCANNER_HOST: 'localhost',
      ACESTREAM_SCANNER_PORT: String(puertos.scanner),
      ACESTREAM_SCANNER_SUSTAIN_MS: '4000',
      ACESTREAM_SCANNER_MEDIA_PROBE_MS: '2500',
      ENGINE_CONTROL_HOST: motorHost,
      ENGINE_CONTROL_TOKEN: 'prueba',
      OLLAMA_BASE_URL: '',
      ACE_LOG_LEVEL: process.env.ACE_E2E_LOG_LEVEL ?? 'info',
    },
    lista: `http://127.0.0.1:${puertos.backend}/native/api/v1/ping`,
    hijo: null,
  });
  log(`backend en http://localhost:${puertos.backend} (la app entra por /native/api/v1)`);
  log('LISTA');
} catch (error) {
  log(`no arrancó: ${error instanceof Error ? error.message : String(error)}`);
  await cerrar(1);
}
