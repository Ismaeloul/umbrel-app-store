import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/* Vitest propio del motor falso. El de apps/server es de otro módulo y aquí
   solo interesan los tests del motor falso, que se lanzan con
   `vitest run --config test/fake-engine/vitest.config.ts` desde apps/server.
   La raíz es esta carpeta para que el `include` no dependa del directorio
   desde el que se lance; la caché va al temporal del sistema para no dejar
   un node_modules suelto dentro de test/fake-engine. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: path.join(tmpdir(), 'ace-player-neo-fake-engine-vitest'),
  test: {
    include: ['**/*.test.ts'],
    environment: 'node',
    // cada fichero de test levanta sus propios motores en puertos libres
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
