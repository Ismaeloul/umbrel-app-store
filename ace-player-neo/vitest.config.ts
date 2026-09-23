import { defineConfig } from 'vitest/config';

// Vitest de la raíz: SOLO los tests de empaquetado (deploy/ y scripts/). Cada
// paquete del workspace (apps/server, packages/shared, apps/web) tiene el suyo.
export default defineConfig({
  test: {
    include: ['deploy/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
    // Los tests del hook lanzan bash y, en Windows, cada proceso cuesta.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
