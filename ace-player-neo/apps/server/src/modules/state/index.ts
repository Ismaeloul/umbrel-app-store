/* Fábrica del módulo `state` (almacén de state.json y de los ficheros v2).

   La implementación está en service.ts (carga, recuperación, migración y
   cola de mutaciones), normalize.ts (normalizadores portados de la 0.6.59),
   library.ts (biblioteca, preferencias y PUT de los clientes 0.6.8),
   projections.ts (formas públicas), migrations.ts, documents.ts (v2/) y
   storage.ts (escritura atómica y cuarentena). */

export type * from './types.js';
export { createStateService } from './service.js';
/* Escritura atómica, lectura y cuarentena de ficheros (storage.ts): las usa
   también `teams` para su índice y sus PNG en data/v2/teams/. */
export {
  corruptStamp,
  fileExists,
  isMissing,
  quarantineSync,
  readJsonObjectSync,
  removeIfExists,
  writeAtomic,
} from './storage.js';
