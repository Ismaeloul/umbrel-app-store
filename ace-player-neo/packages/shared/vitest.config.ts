import { defineConfig } from 'vitest/config';

/* Vitest de @ace/shared: funciones puras, tabla de rutas, ejemplos y OpenAPI.
   Los contrastes cargan la 0.6.59 original (require de su server.js), que
   tarda algo más en Windows; por eso el plazo es holgado. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
