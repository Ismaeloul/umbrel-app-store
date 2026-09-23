/* Carga del server.js ORIGINAL de la 0.6.59 para los tests de contraste y
   de vuelta atrás del estado (arquitectura §11.3). Mismo truco que
   packages/shared/scripts/lib/legacy-0659.ts, pero con el DATA_DIR que
   diga el test: server.js lee el entorno al requerirse, así que se requiere
   de nuevo (sin caché) cada vez y se deja el entorno como estaba.

   No es código de producto: solo lo importan los *.test.ts de este módulo. */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceStats, StateV1 } from '@ace/shared';

export const LEGACY_SERVER_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../ismaeloul-ace-player-neo/releases/0.6.59/server.js',
);

/** Lo que usan los tests del estado de `module.exports` de server.js. */
export interface LegacyStateModule {
  readState(): StateV1;
  writeState(next: unknown): StateV1;
  normalizeItem(item: unknown, fallbackType?: string): unknown;
  normalizePreferences(value: unknown): unknown;
  normalizeChannelBinding(value: unknown): unknown;
  normalizeSourceReport(value: unknown): unknown;
  normalizeChannelFeedback(value: unknown): unknown;
  normalizeWebSource(
    source: unknown,
    index?: number,
    fallbackStreams?: unknown[],
    fallbackSyncedAt?: unknown,
  ): unknown;
  normalizeSourceStats(value: unknown): SourceStats;
  mutateLibrary(current: StateV1, body: unknown): unknown;
}

const require = createRequire(import.meta.url);

/**
 * Requiere server.js con `DATA_DIR=dataDir` y sin salir a internet
 * (`AUTO_SYNC=false`), como sus propios tests (comportamientos-tests §1.3).
 * Requerirlo no arranca el servidor (`require.main !== module`).
 */
export function loadLegacyServer(
  dataDir: string,
  defaultWebSyncUrl = 'https://example.com/default.m3u',
): LegacyStateModule {
  const env: Record<string, string | undefined> = {
    DATA_DIR: dataDir,
    AUTO_SYNC: 'false',
    FOOTBALL_DEMO_ONLY: 'true',
    DEFAULT_WEB_SYNC_URL: defaultWebSyncUrl,
    FOOTBALL_COUNTRY: undefined,
  };
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const resolved = require.resolve(LEGACY_SERVER_JS);
  delete require.cache[resolved];
  try {
    return require(resolved) as LegacyStateModule;
  } finally {
    delete require.cache[resolved];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
