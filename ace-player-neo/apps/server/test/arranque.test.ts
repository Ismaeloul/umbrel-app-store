/* Orden del arranque de main.ts (B-226; server.js:5134-5135).

   Por qué (verificación del backend, 23-09-2026): B-226 dice que la carpeta
   `remux/` se borra entera al arrancar. `remux/service.test.ts` prueba que
   `cleanWorkDir` la vacía, pero nada probaba que el arranque la llame, ni que
   lo haga ANTES de arrancar los trabajos de fondo (en la 0.6.59, el
   `rmSync(REMUX_DIR)` va antes de `createServer()` y de los temporizadores).
   Aquí `startServices` corre sobre servicios falsos que apuntan cada llamada. */

import { describe, expect, it } from 'vitest';
import { createSilentLogger } from '../src/core/logger.js';
import { startServices } from '../src/main.js';
import { SERVICE_ORDER, type Services } from '../src/services.js';

/** Servicios de mentira: cualquier método apunta "servicio.método" y resuelve. */
function recordingServices(calls: string[]): Services {
  const logger = createSilentLogger();
  return new Proxy({} as Services, {
    get(_target, name) {
      if (name === 'logger') return logger;
      return new Proxy(
        {},
        {
          get(_inner, method) {
            if (typeof method !== 'string' || method === 'then') return undefined;
            return async () => {
              calls.push(`${String(name)}.${method}`);
              return method === 'load' ? { recovered: false } : undefined;
            };
          },
        },
      );
    },
  });
}

describe('main: orden del arranque (B-226)', () => {
  it('carga el estado, vacía remux/ y recupera huérfanos ANTES de arrancar ningún trabajo', async () => {
    const calls: string[] = [];
    await startServices(recordingServices(calls));
    expect(calls.slice(0, 3)).toEqual([
      'state.load',
      'remux.cleanWorkDir',
      'playback.recoverOrphans',
    ]);
    /* Después, cada servicio en el orden del grafo y una sola vez. */
    expect(calls.slice(3)).toEqual(SERVICE_ORDER.map((name) => `${name}.start`));
  });
});
