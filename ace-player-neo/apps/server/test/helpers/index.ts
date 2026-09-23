/* Arnés de los tests del backend (plan 1.0: "reloj falso, repositorio
   temporal e inyección simulando el origen").

   - `createTestCore()`: config leída de un entorno de prueba (DATA_DIR en un
     temporal), FakeClock, bus y logger mudo. Nada lee el `process.env` real.
   - `createTestApp()`: la app de Fastify con los servicios de esqueleto y los
     que el test quiera sustituir.
   - `web()` / `native()`: cabeceras para simular por dónde entra la petición
     (nginx pone `X-Ace-Origin`, arquitectura §8.2).
   - `tempDir()`: carpeta temporal que se borra sola al terminar el test. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { loadConfig, type Env } from '../../src/config/index.js';
import { createDomainBus } from '../../src/core/bus.js';
import { FakeClock } from '../../src/core/clock.js';
import { createSilentLogger, type Logger } from '../../src/core/logger.js';
import type { CoreDeps } from '../../src/core/module.js';
import { createServices, type Services } from '../../src/services.js';

export { FakeClock } from '../../src/core/clock.js';

const pendingCleanups: (() => void)[] = [];

afterEach(() => {
  while (pendingCleanups.length) pendingCleanups.pop()?.();
});

/** Carpeta temporal propia del test; se borra en el `afterEach`. */
export function tempDir(prefix = 'ace-test-'): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  pendingCleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Entorno mínimo de prueba: sin internet, sin sincronización y con un secreto fijo. */
export function testEnv(overrides: Env = {}): Env {
  return {
    DATA_DIR: tempDir('ace-data-'),
    AUTO_SYNC: 'false',
    FOOTBALL_DEMO_ONLY: 'true',
    DEFAULT_WEB_SYNC_URL: 'https://example.com/default.m3u',
    ACE_SEED: 'semilla-de-prueba-0123456789',
    APP_VERSION: '0.7.0-test',
    ...overrides,
  };
}

export interface TestCore extends CoreDeps {
  readonly clock: FakeClock;
}

export function createTestCore(
  options: { readonly env?: Env; readonly logger?: Logger; readonly clock?: FakeClock } = {},
): TestCore {
  const { config } = loadConfig(testEnv(options.env));
  const logger = options.logger ?? createSilentLogger();
  return {
    config,
    clock: options.clock ?? new FakeClock(),
    logger,
    bus: createDomainBus({ logger }),
  };
}

export interface TestAppOptions extends Omit<BuildAppOptions, 'services'> {
  readonly env?: Env;
  readonly logger?: Logger;
  /** Servicios que sustituir por fakes (el resto, los de esqueleto). */
  readonly services?: Partial<Omit<Services, keyof CoreDeps>>;
}

export interface TestApp {
  readonly app: FastifyInstance;
  readonly services: Services;
  readonly core: TestCore;
}

/** La app lista para `inject`. Se cierra sola al terminar el test. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const core = createTestCore({
    ...(options.env ? { env: options.env } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const services = createServices(core, options.services ?? {});
  const app = await buildApp({
    services,
    ...(options.moduleRoutes === undefined ? {} : { moduleRoutes: options.moduleRoutes }),
    ...(options.register ? { register: options.register } : {}),
  });
  await app.ready();
  pendingCleanups.push(() => {
    void app.close();
  });
  return { app, services, core };
}

/** Cabeceras de una petición que pasó por el login de Umbrel. */
export function web(headers: Record<string, string> = {}): Record<string, string> {
  return { 'x-ace-origin': 'web', ...headers };
}

/** Cabeceras de la app iOS entrando por /native (con token si se da). */
export function native(
  token?: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    'x-ace-origin': 'native',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
}
