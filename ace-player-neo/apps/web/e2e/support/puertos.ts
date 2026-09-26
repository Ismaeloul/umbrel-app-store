/* Puertos de la pila E2E. Los elige playwright.config.ts UNA vez (el
   proceso principal) y los deja en `E2E_PORTS`: los workers y la pila
   (stack.ts) heredan el entorno y leen los mismos.

   Fijos (no dependen de nosotros):
   - el motor principal: el backend lo busca SIEMPRE en el 6878 (como la
     0.6.59). En el PC de Isma el 6878 lo ocupa su instancia (en `::`), así que
     el motor falso escucha en otra dirección de bucle local (127.0.0.N:6878,
     la primera libre desde 127.0.0.40: otros agentes usan las primeras) y el
     backend va a ella con ACESTREAM_HOST=127.0.0.N;
   - engine_control: el 3001, en esa misma dirección. */

import net from 'node:net';

export const MOTOR_PORT = 6878;
export const ENGINE_CONTROL_PORT = 3001;
export const ENGINE_CONTROL_TOKEN = 'prueba';

export interface E2EPorts {
  /** Dirección de bucle local del motor principal y de engine_control. */
  readonly motorHost: string;
  /** Vite (web), en 127.0.0.1. */
  readonly web: number;
  /** Backend, en 0.0.0.0 (el backend siempre escucha en IPv4). */
  readonly backend: number;
  /** Motor falso del comprobador, en `::` (el backend va por `localhost`). */
  readonly scanner: number;
  /** API de control del motor principal (/__fake/*), en `motorHost`: sigue viva con el motor caído. */
  readonly control: number;
  /** Proveedor IPTV falso (apps/server/test/fake-iptv), en `::1`, con su control /__iptv/*. */
  readonly iptv: number;
}

function freePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** ¿Se puede escuchar en ese puerto y esa dirección? */
export function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

/** La primera 127.0.0.N con el 6878 y el 3001 libres. */
async function pickMotorHost(): Promise<string> {
  for (let n = 40; n < 250; n++) {
    const host = `127.0.0.${n}`;
    if ((await portIsFree(MOTOR_PORT, host)) && (await portIsFree(ENGINE_CONTROL_PORT, host))) {
      return host;
    }
  }
  throw new Error('No hay ninguna 127.0.0.N con el 6878 y el 3001 libres');
}

export async function pickPorts(): Promise<E2EPorts> {
  const motorHost = await pickMotorHost();
  const chosen = new Set<number>();
  const pick = async (host: string): Promise<number> => {
    for (;;) {
      const port = await freePort(host);
      /* Nunca los de la instancia de Isma ni uno repetido. */
      if (![3000, 3001, 5173, 6878].includes(port) && !chosen.has(port)) {
        chosen.add(port);
        return port;
      }
    }
  };
  return {
    motorHost,
    web: await pick('127.0.0.1'),
    backend: await pick('0.0.0.0'),
    scanner: await pick('::'),
    control: await pick(motorHost),
    iptv: await pick('::1'),
  };
}

export function readPorts(): E2EPorts {
  const raw = process.env.E2E_PORTS;
  if (!raw) throw new Error('Falta E2E_PORTS: las pruebas se lanzan con playwright.config.ts');
  return JSON.parse(raw) as E2EPorts;
}
