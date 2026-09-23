import { defineConfig } from 'vitest/config';

/* Vitest del backend. Los tests de cada módulo viven junto a su código
   (src/<módulo>/*.test.ts) y los de integración en test/. El motor falso tiene su
   propio vitest.config.ts (test/fake-engine) y aquí se excluye: es de otro
   módulo y se lanza aparte. Cobertura con v8 (plan E1.x: cada módulo con su
   umbral en CI). */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/fake-engine/**'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
