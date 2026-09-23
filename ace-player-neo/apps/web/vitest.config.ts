/* Vitest de la web: jsdom + Testing Library. Reutiliza los plugins y alias de
   vite.config.ts (la tabla de rutas virtual y @fixtures) para que los tests
   compilen igual que la app. Sin red real: el cliente de la API se prueba con
   un fetch simulado (src/test/fetch.ts) y los ejemplos de packages/shared. */

import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      restoreMocks: true,
      testTimeout: 15_000,
    },
  }),
);
