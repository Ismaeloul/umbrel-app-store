#!/usr/bin/env node
/* Comprueba que la migración 1 → 2 de state.json (0.7.0) no pierde nada de
   un state.json REAL, sin escribir nada: lo lee, lo migra EN MEMORIA con el
   código del módulo `state` (compilado al vuelo con tsx) y compara recuentos
   y claves con el original.

   Uso (desde ace-player-neo/):
     node scripts/check-migration-prod.mjs <ruta/a/state.json>

   Solo LEE el fichero. Imprime SOLO recuentos y sí/no: nunca títulos,
   hashes, URLs ni ningún otro dato del estado (son datos privados).
   Sale con 0 si todo cuadra y con 1 si hay alguna diferencia. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const file = process.argv[2];
if (!file) {
  console.error('uso: node scripts/check-migration-prod.mjs <ruta/a/state.json>');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(here, '../apps/server/src/modules/state');
const load = (name) => tsImport(pathToFileURL(path.join(stateDir, name)).href, import.meta.url);
const { migrateStateText } = await load('migrations.ts');
const shared = await tsImport(
  '@ace/shared',
  pathToFileURL(path.join(stateDir, 'migrations.ts')).href,
);
const { STATE_V1_KEYS } = shared;

/* Lo mismo que harían la config y el reloj del servidor, sin tocar nada:
   las fechas "ahora" solo aparecerían si faltaran en el original (y se verían
   como diferencia). */
const ctx = {
  nowIso: () => new Date().toISOString(),
  defaultWebSyncUrl:
    'https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u',
  footballCountry: 'Spain',
  randomHex: () => 'x',
};

const text = readFileSync(file, 'utf8');
const original = JSON.parse(text);
const migrated = migrateStateText(text, ctx);
const again = migrateStateText(migrated.text, ctx);
const file2 = JSON.parse(migrated.text);

const count = (value) =>
  Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? Object.keys(value).length
      : value == null
        ? 0
        : 1;

function counts(state) {
  const sources = Array.isArray(state.webSources) ? state.webSources : [];
  return {
    favorites: count(state.favorites),
    history: count(state.history),
    web: count(state.web),
    webSources: sources.length,
    'webSources[].streams': sources.map((source) => count(source?.streams)),
    'webSources[].renames': sources.map((source) => count(source?.renames)),
    'webSources[].hidden': sources.map((source) => count(source?.hidden)),
    channelBindings: count(state.channelBindings),
    sourceReports: count(state.sourceReports),
    channelFeedback: count(state.channelFeedback),
    'sourceStats.hashes': count(state.sourceStats?.hashes),
    'sourceStats.proveedores': count(state.sourceStats?.proveedores),
    preferencesKeys: count(state.preferences),
    nowPlaying: state.nowPlaying ? 1 : 0,
  };
}

/* Mismas claves (y en el mismo orden) en cada objeto, recorriendo todo. */
function sameKeys(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameKeys(x, b[i]))
    );
  }
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameKeys(a[k], b[k]));
  }
  return true;
}

const before = counts(original);
const after = counts(migrated.state);
const keyReport = {};
let ok = true;
for (const key of STATE_V1_KEYS) {
  const equal = JSON.stringify(original[key]) === JSON.stringify(migrated.state[key]);
  keyReport[key] = {
    igual: equal ? 'sí' : 'NO',
    mismasClaves: sameKeys(original[key], migrated.state[key]) ? 'sí' : 'NO',
  };
  if (!equal) ok = false;
}
const topBefore = Object.keys(original).filter((key) => key !== 'schemaVersion');
const topAfter = Object.keys(file2).filter((key) => key !== 'schemaVersion');
const topLevelSame = JSON.stringify(topBefore) === JSON.stringify(topAfter);
const idempotent = again.text === migrated.text;
if (!topLevelSame || !idempotent || JSON.stringify(before) !== JSON.stringify(after)) ok = false;

console.log(
  'schemaVersion antes:',
  migrated.schemaVersionBefore,
  '→ después:',
  file2.schemaVersion,
);
console.log(
  'claves de primer nivel (sin schemaVersion):',
  topBefore.length,
  '→',
  topAfter.length,
  topLevelSame ? '(mismas)' : '(DISTINTAS)',
);
console.log('claves ajenas a v1 conservadas:', Object.keys(migrated.extras).length);
console.log('recuentos antes:  ', JSON.stringify(before));
console.log('recuentos después:', JSON.stringify(after));
console.log('por clave v1 (valor idéntico / mismas claves):');
for (const [key, value] of Object.entries(keyReport))
  console.log(`  ${key}: ${value.igual} / ${value.mismasClaves}`);
console.log('idempotente (migrar lo migrado da lo mismo):', idempotent ? 'sí' : 'NO');
console.log('caracteres: original', text.length, '→ migrado', migrated.text.length);
console.log(ok ? 'RESULTADO: la migración no pierde nada' : 'RESULTADO: HAY DIFERENCIAS');
process.exit(ok ? 0 : 1);
