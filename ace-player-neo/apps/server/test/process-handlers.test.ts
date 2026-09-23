/* Enganches del proceso de main.ts (T-111, B-028, B-247; server.js:5162-5176).

   Por qué (verificación del backend, 23-09-2026): el T-111 de la 0.6.59 solo
   miraba el TEXTO del fuente (`process.on("unhandledRejection"`,
   `process.once("SIGTERM"`…) y en la v2 nada probaba esos enganches: el test
   de integración demuestra que un comprobador roto no tumba las rutas, pero no
   que una promesa suelta no tumbe el proceso ni que el apagado salga con el
   código bueno. Aquí se prueban con un proceso falso (EventEmitter + `exit`
   espía) y el reloj falso para la salida forzada de 5 s. */

import { EventEmitter } from 'node:events';
import { SHUTDOWN_TIMINGS } from '@ace/shared';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../src/core/clock.js';
import { createSilentLogger } from '../src/core/logger.js';
import { installProcessHandlers } from '../src/main.js';

function fakeProcess(withIpc = false) {
  const proc = Object.assign(new EventEmitter(), {
    exit: vi.fn<(code: number) => void>(),
    ...(withIpc ? { send: () => true } : {}),
  });
  return proc;
}

function setup(options: { stop?: () => Promise<void>; ipc?: boolean } = {}) {
  const proc = fakeProcess(options.ipc ?? false);
  const clock = new FakeClock();
  const logger = createSilentLogger();
  const error = vi.spyOn(logger, 'error');
  const stop = vi.fn(options.stop ?? (async () => undefined));
  installProcessHandlers(proc, { logger, clock, stop });
  return { proc, clock, logger, error, stop };
}

async function turns(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('main: enganches del proceso (T-111, B-028, B-247)', () => {
  it('una promesa rechazada sin capturar se anota y el proceso sigue', async () => {
    const { proc, error, stop } = setup();
    proc.emit('unhandledRejection', new Error('drenador roto'), Promise.resolve());
    await turns();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'promesa rechazada sin capturar',
    );
    expect(proc.exit).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('SIGTERM apaga una sola vez (aunque llegue también SIGINT) y sale con 0', async () => {
    const { proc, stop } = setup();
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    await turns();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('SIGINT también apaga; si el apagado falla, sale con 1', async () => {
    const { proc, error } = setup({
      stop: async () => {
        throw new Error('no se pudo vaciar el estado');
      },
    });
    proc.emit('SIGINT');
    await turns();
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.anything(), 'apagado con errores');
  });

  it('si el apagado no termina en 5 s, salida forzada con 1', async () => {
    const { proc, clock } = setup({ stop: () => new Promise<void>(() => undefined) });
    proc.emit('SIGTERM');
    clock.advance(SHUTDOWN_TIMINGS.forceExitMs - 1);
    expect(proc.exit).not.toHaveBeenCalled();
    clock.advance(1);
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(SHUTDOWN_TIMINGS.forceExitMs).toBe(5000);
  });

  it('con canal IPC (como lo lanza scripts/smoke-bundle.mjs), el mensaje `shutdown` apaga', async () => {
    const { proc, stop } = setup({ ipc: true });
    proc.emit('message', 'otra cosa');
    await turns();
    expect(stop).not.toHaveBeenCalled();
    proc.emit('message', 'shutdown');
    await turns();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('sin canal IPC no se escuchan mensajes (en el NAS no hay IPC)', () => {
    const { proc } = setup();
    expect(proc.listenerCount('message')).toBe(0);
    expect(proc.listenerCount('unhandledRejection')).toBe(1);
  });
});
