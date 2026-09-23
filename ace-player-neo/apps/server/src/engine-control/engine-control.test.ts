/* engine_control 0.7.0 (plan E1.8): T-118 portado y lo nuevo (token vacío =
   401, comparación en tiempo constante). Docker es un servidor http falso
   en un pipe (Windows) o un socket unix temporal; el reloj, un FakeClock. */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_WATCHDOG } from '@ace/shared';
import { createTestCore, FakeClock, tempDir } from '../../test/helpers/index.js';
import { loopbackHost } from '../../test/fake-engine/test-utils.js';
import { ENGINE_CONTROL_PORT as BACKEND_CONTROL_PORT } from '../config/index.js';
import { requestEngineRestart } from '../modules/engine/control.js';
import { engineConfig } from '../modules/engine/test-support.js';
import {
  createServer,
  DEFAULT_ACESTREAM_CONTAINER,
  DOCKER_TIMEOUT_MS,
  ENGINE_CONTROL_PORT,
  FORCE_EXIT_MS,
  normalizeToken,
  optionsFromEnv,
  RESTART_COOLDOWN_MS,
  sanitizeContainer,
  startEngineControl,
  tokenValido,
  type EngineControlOptions,
} from './server.js';

const TOKEN = 'prueba-token';
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

function socketPath(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ace-docker-${randomUUID()}`
    : path.join(tempDir('ace-docker-'), 'docker.sock');
}

interface FakeDocker {
  readonly socket: string;
  readonly requests: { method: string; url: string }[];
  /** Resuelve cuando llega la siguiente petición. */
  next(): Promise<void>;
}

async function startDocker(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<FakeDocker> {
  const socket = socketPath();
  const requests: { method: string; url: string }[] = [];
  let waiting: (() => void) | null = null;
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '' });
    waiting?.();
    waiting = null;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  cleanups.push(() => closeServer(server));
  return {
    socket,
    requests,
    next: () =>
      new Promise<void>((resolve) => {
        waiting = resolve;
      }),
  };
}

async function startControl(options: Partial<EngineControlOptions> = {}) {
  const clock = new FakeClock();
  const host = await loopbackHost();
  const server = createServer({
    token: TOKEN,
    container: DEFAULT_ACESTREAM_CONTAINER,
    dockerSocket: socketPath(), // sin Docker salvo que el test ponga uno
    clock,
    ...options,
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  cleanups.push(() => closeServer(server));
  const { port } = server.address() as AddressInfo;
  const base = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  const call = async (url: string, init: { method?: string; token?: string } = {}) => {
    const res = await fetch(base + url, {
      method: init.method ?? 'POST',
      headers: init.token === undefined ? {} : { 'x-engine-token': init.token },
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as unknown };
  };
  return { clock, host, port, call };
}

describe('T-118 · engine-control exige el token compartido y el backend lo envia (B-229)', () => {
  it('401 sin token o con otro, 404 en otra ruta y, sin Docker, 502 restart_failed', async () => {
    const { call } = await startControl();
    const sin = await call('/restart');
    expect(sin.status).toBe(401);
    expect(sin.body).toEqual({ error: 'unauthorized' });
    expect((await call('/restart', { token: 'otro' })).status).toBe(401);
    expect((await call('/otra', { token: TOKEN })).status).toBe(404);
    // con el token correcto llega hasta Docker; aquí no hay socket: falla el reinicio, no la autorización
    const bien = await call('/restart', { token: TOKEN });
    expect(bien.status).toBe(502);
    expect(bien.body).toEqual({ error: 'restart_failed' });
  });

  it('el backend manda x-engine-token y con Docker respondiendo 204 se reinicia', async () => {
    const docker = await startDocker((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const { host, port } = await startControl({ dockerSocket: docker.socket });
    const core = createTestCore();
    const config = engineConfig(core.config, { control: { host, port }, token: TOKEN });
    await expect(requestEngineRestart(config, core.clock)).resolves.toBeUndefined();
    expect(docker.requests).toEqual([
      { method: 'POST', url: `/containers/${DEFAULT_ACESTREAM_CONTAINER}/restart?t=2` },
    ]);
    // con otro token, el backend recibe 401 y lo da como restart_failed
    const wrong = engineConfig(core.config, { control: { host, port }, token: 'otro' });
    await expect(requestEngineRestart(wrong, core.clock)).rejects.toMatchObject({
      code: 'restart_failed',
    });
  });
});

describe('engine_control 0.7.0: falla cerrado y compara en tiempo constante', () => {
  it('con el token vacío rechaza TODO, también la cabecera vacía', async () => {
    const { call } = await startControl({ token: '' });
    expect((await call('/restart')).status).toBe(401);
    expect((await call('/restart', { token: '' })).status).toBe(401);
    expect((await call('/restart', { token: 'cualquiera' })).status).toBe(401);
  });

  it('tokenValido solo con el token exacto', () => {
    const req = (header?: string | string[]) => ({
      headers: header === undefined ? {} : { 'x-engine-token': header },
    });
    expect(tokenValido(req(TOKEN), TOKEN)).toBe(true);
    expect(tokenValido(req('prueba-tokeN'), TOKEN)).toBe(false); // misma longitud
    expect(tokenValido(req(`${TOKEN}x`), TOKEN)).toBe(false);
    expect(tokenValido(req('p'), TOKEN)).toBe(false);
    expect(tokenValido(req([TOKEN, TOKEN]), TOKEN)).toBe(false);
    expect(tokenValido(req(), TOKEN)).toBe(false);
    expect(tokenValido(req(''), '')).toBe(false);
  });

  it('respuestas JSON sin caché; GET, otra ruta o con consulta → 404', async () => {
    const { call } = await startControl();
    const res = await call('/restart', { method: 'GET', token: TOKEN });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call('/restart?x=1', { token: TOKEN })).status).toBe(404);
  });
});

describe('reinicio vía la API de Docker (engine-control.js:25-53)', () => {
  it('2xx de Docker → 200 { restarted: true } con el contenedor saneado', async () => {
    const docker = await startDocker((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const log = vi.fn();
    const { call } = await startControl({
      dockerSocket: docker.socket,
      container: 'mi contenedor/../x',
      log,
    });
    const res = await call('/restart', { token: TOKEN });
    expect(res).toMatchObject({ status: 200, body: { restarted: true } });
    expect(docker.requests[0]?.url).toBe('/containers/micontenedor..x/restart?t=2');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('reiniciado'));
  });

  it('Docker fuera de 2xx → 502; y el intento fallido también enfría 15 s', async () => {
    const docker = await startDocker((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"message":"No such container"}');
    });
    const { call, clock } = await startControl({ dockerSocket: docker.socket });
    expect(await call('/restart', { token: TOKEN })).toMatchObject({
      status: 502,
      body: { error: 'restart_failed' },
    });
    expect(await call('/restart', { token: TOKEN })).toMatchObject({
      status: 429,
      body: { error: 'restart_cooldown' },
    });
    clock.advance(RESTART_COOLDOWN_MS - 1);
    expect((await call('/restart', { token: TOKEN })).status).toBe(429);
    clock.advance(1);
    expect((await call('/restart', { token: TOKEN })).status).toBe(502);
    expect(docker.requests).toHaveLength(2);
  });

  it('Docker que no contesta en 7 s → 502 restart_failed', async () => {
    const docker = await startDocker(() => undefined);
    const { call, clock } = await startControl({ dockerSocket: docker.socket });
    const arrived = docker.next();
    const pending = call('/restart', { token: TOKEN });
    await arrived;
    clock.advance(DOCKER_TIMEOUT_MS);
    expect(await pending).toMatchObject({ status: 502, body: { error: 'restart_failed' } });
  });
});

describe('configuración y arranque (engine-control.js:1-14 y 74-84)', () => {
  it('sanea el contenedor y el token como la 0.6.59', () => {
    expect(sanitizeContainer('  otro_motor-1.a ')).toBe('otro_motor-1.a');
    expect(sanitizeContainer('$(rm -rf)')).toBe('rm-rf');
    expect(sanitizeContainer('')).toBe(DEFAULT_ACESTREAM_CONTAINER);
    expect(sanitizeContainer('***')).toBe(DEFAULT_ACESTREAM_CONTAINER);
    expect(sanitizeContainer('x'.repeat(300))).toHaveLength(128);
    expect(normalizeToken(`  ${'t'.repeat(300)} `)).toHaveLength(200);
    expect(normalizeToken(undefined)).toBe('');
    expect(optionsFromEnv({ ENGINE_CONTROL_TOKEN: ' s ', ACESTREAM_CONTAINER: 'c' })).toEqual({
      token: 's',
      container: 'c',
    });
  });

  it('las constantes coinciden con las del backend', () => {
    expect(RESTART_COOLDOWN_MS).toBe(ENGINE_WATCHDOG.manualRestartCooldownMs);
    expect(ENGINE_CONTROL_PORT).toBe(BACKEND_CONTROL_PORT);
    expect(DOCKER_TIMEOUT_MS).toBe(7_000);
    expect(FORCE_EXIT_MS).toBe(5_000);
  });

  it('escucha, avisa si no hay token y se cierra limpio con SIGTERM', async () => {
    const signals = new EventEmitter();
    let exited!: () => void;
    const closed = new Promise<void>((resolve) => {
      exited = resolve;
    });
    const exit = vi.fn(() => exited());
    const log = vi.fn();
    const running = startEngineControl(
      {},
      {
        port: 0,
        host: await loopbackHost(),
        signals: signals as unknown as NodeJS.Process,
        exit,
        log,
      },
    );
    cleanups.push(async () => {
      if (running.server.listening) await closeServer(running.server);
    });
    const port = await running.listening;
    expect(port).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('vacío'));
    signals.emit('SIGTERM');
    signals.emit('SIGINT'); // el segundo no hace nada
    await closed;
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('si el cierre limpio se atasca, sale con 1 a los 5 s', async () => {
    const docker = await startDocker(() => undefined);
    const signals = new EventEmitter();
    const exit = vi.fn();
    const clock = new FakeClock();
    const host = await loopbackHost();
    const running = startEngineControl(
      { ENGINE_CONTROL_TOKEN: TOKEN },
      {
        port: 0,
        host,
        signals: signals as unknown as NodeJS.Process,
        exit,
        log: () => undefined,
        dockerSocket: docker.socket,
        clock,
      },
    );
    cleanups.push(() => closeServer(running.server));
    const port = await running.listening;
    const arrived = docker.next();
    const hanging = fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}/restart`, {
      method: 'POST',
      headers: { 'x-engine-token': TOKEN },
    }).catch(() => null);
    await arrived;
    signals.emit('SIGINT');
    clock.advance(FORCE_EXIT_MS);
    expect(exit).toHaveBeenCalledWith(1);
    clock.advance(DOCKER_TIMEOUT_MS);
    await hanging;
  });
});
