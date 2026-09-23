/* Acceso a la 0.6.59 ORIGINAL para los tests de contraste y para congelar
   tablas de referencia (T-088). Se carga el `server.js` de la release tal
   cual, sin copiarlo: si alguien tocara la release, el contraste lo notaría.

   Solo lo usan scripts/ y test/: nunca el código de producto. */

import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `ismaeloul-ace-player-neo/releases/0.6.59` del mismo repo (D2: el monorepo vive al lado). */
export const LEGACY_RELEASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../ismaeloul-ace-player-neo/releases/0.6.59',
);

/** Lo que usan los contrastes de las exportaciones de server.js (server.js:5181-5287). */
export interface LegacyServerModule {
  normalizeHash(value: unknown): string;
  normalizeChannelKey(value: unknown): string;
  channelMatchScore(left: unknown, right: unknown): number;
  esFamiliaDe(left: unknown, right: unknown): boolean;
  semanticChannelText(value: unknown): string;
  semanticNumbersCompatible(programChannel: unknown, candidateName: unknown): boolean;
  motivoDeFallo(error: unknown): string;
  RESOLUTION_EXACT_SCORE: number;
  SEMANTIC_MAX_SCORE: number;
}

export interface LegacyPlayerCore {
  clamp(value: number, min: number, max: number): number;
  readSeekWindow(media: unknown): { start: number; end: number; duration: number } | null;
  resolveLiveTarget(
    range: unknown,
    preferredTarget?: unknown,
    safetySeconds?: unknown,
  ): number | null;
}

const require = createRequire(import.meta.url);
let cachedServer: LegacyServerModule | null = null;

/**
 * Carga `server.js` como lo cargaban sus propios tests (comportamientos-tests
 * §1.3): DATA_DIR en un temporal, sin sincronización automática y con la
 * agenda de muestra, para que al requerirlo no toque nada real ni salga a
 * internet. Requerirlo no arranca el servidor (`require.main !== module`).
 */
export function loadLegacyServer(): LegacyServerModule {
  if (cachedServer) return cachedServer;
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ace-0659-'));
  process.env.AUTO_SYNC = 'false';
  process.env.FOOTBALL_DEMO_ONLY = 'true';
  process.env.DEFAULT_WEB_SYNC_URL = 'https://example.com/default.m3u';
  cachedServer = require(path.join(LEGACY_RELEASE_DIR, 'server.js')) as LegacyServerModule;
  return cachedServer;
}

/** `player-controller.js` es UMD: en Node exporta con module.exports. */
export function loadLegacyPlayerCore(): LegacyPlayerCore {
  return require(path.join(LEGACY_RELEASE_DIR, 'player-controller.js')) as LegacyPlayerCore;
}

export function readLegacyFile(name: string): string {
  return readFileSync(path.join(LEGACY_RELEASE_DIR, name), 'utf8');
}

/**
 * Extrae `function <nombre>(…) { … }` contando llaves, como hacían T-088 y
 * T-101 con index.html. Devuelve "" si no la encuentra, y quien la use debe
 * fallar entonces (un contraste vacío no puede pasar).
 */
export function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  let open = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') open += 1;
    if (source[index] === '}') {
      open -= 1;
      if (!open) return source.slice(start, index + 1);
    }
  }
  return '';
}

export function extractBlock(source: string, pattern: RegExp): string {
  return pattern.exec(source)?.[0] ?? '';
}

/**
 * Compila piezas extraídas de la 0.6.59 en una función de JS real. `prelude`
 * va antes (por ejemplo, un `S` falso con las preferencias) y `returns` es la
 * expresión que se devuelve. Lanza si falta alguna pieza.
 */
export function compileLegacyPieces<T>(
  pieces: readonly string[],
  returns: string,
  prelude = '',
): T {
  pieces.forEach((piece, index) => {
    if (!piece) throw new Error(`no se pudo extraer la pieza ${index} de la 0.6.59`);
  });
  return new Function(`${prelude}\n${pieces.join('\n')}\nreturn ${returns};`)() as T;
}

/** Los 16 nombres reales de T-088 (tests/server.test.js:1497-1502), en su orden. */
export const T088_CHANNEL_NAMES = [
  'M+ Liga de Campeones',
  'LIGA DE CAMPEONES --> ELCANO',
  'LIGA DE CAMPEONES 2 --> ELCANO',
  'M. Liga de Campeones',
  'DAZN',
  'DAZN 1',
  'DAZN 1 720p **',
  'LaLiga TV',
  'LALIGA TV Hypermotion',
  'M+ LALIGA',
  'M+ LALIGA 2',
  'LaLiga TV Bar',
  'LaLiga TV Bar HD',
  'Eurosport 1',
  'Eurosport 2',
  'GOL Play',
] as const;
