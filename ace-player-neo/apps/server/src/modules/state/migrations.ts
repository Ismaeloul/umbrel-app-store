/* Migraciones de state.json (arquitectura §5.4, "Migraciones").

   - `schemaVersion` ausente (o que no es un entero >= 1) = 1.
   - Cada migración es una función pura `(n) → (n+1)` sobre el objeto leído.
   - La 1 → 2 NO cambia la forma de ninguna clave v1: solo añade
     `schemaVersion: 2`. Después se normaliza con las MISMAS tolerancias que
     la 0.6.59 (`web` sin `webSources`, fechas raras en `syncedAt`,
     estadísticas con decimales, `Item.date` válida sin reescribir, `alias`,
     `ih`, `fromWebSync`, `renames` y `hidden` conservados).
   - Es idempotente: migrar algo ya migrado da exactamente lo mismo. Si tras
     una vuelta atrás la 0.6.59 quita `schemaVersion`, se vuelve a aplicar sin
     perder nada.
   - Las claves de primer nivel que no son v1 (de una versión futura o
     puestas a mano) NO se tiran: se guardan aparte y se vuelven a escribir
     donde estaban (la 0.6.59 las descartaba, backend-modulos §2.8). */

import { SCHEMA_VERSION, STATE_V1_KEYS, type StateV1 } from '@ace/shared';
import { normalizeStateV1, type NormalizeContext } from './normalize.js';

type Loose = Record<string, unknown>;

const V1_KEY_SET: ReadonlySet<string> = new Set<string>(STATE_V1_KEYS);

/** Versión de esquema de un state.json leído: ausente o rara = 1. */
export function schemaVersionOf(raw: object): number {
  const value = (raw as Loose).schemaVersion;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}

type Migration = (file: Readonly<Loose>) => Loose;

/** Migraciones por versión de origen. La 1 → 2 solo marca la versión. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: (file) => ({ ...file, schemaVersion: 2 }),
};

/** Aplica las migraciones desde la versión del fichero hasta `SCHEMA_VERSION`. */
export function applyMigrations(raw: object): { readonly file: Loose; readonly before: number } {
  const before = schemaVersionOf(raw);
  let file: Loose = { ...(raw as Loose) };
  for (let version = before; version < SCHEMA_VERSION; version += 1) {
    const migration = MIGRATIONS[version];
    if (!migration) throw new Error(`falta la migración ${version} → ${version + 1}`);
    file = migration(file);
  }
  return { file, before };
}

export interface MigratedState {
  /** Las 12 claves v1, normalizadas como la 0.6.59. */
  readonly state: StateV1;
  /** Claves de primer nivel que no son v1 ni `schemaVersion`: se conservan tal cual. */
  readonly extras: Readonly<Loose>;
  readonly schemaVersionBefore: number;
}

/** Migra y normaliza un state.json ya parseado (tiene que ser un objeto). */
export function migrateStateObject(raw: object, ctx: NormalizeContext): MigratedState {
  const { file, before } = applyMigrations(raw);
  const extras: Loose = {};
  for (const [key, value] of Object.entries(file)) {
    if (!V1_KEY_SET.has(key) && key !== 'schemaVersion') extras[key] = value;
  }
  return { state: normalizeStateV1(file, ctx), extras, schemaVersionBefore: before };
}

/**
 * Texto de state.json: las 12 claves v1 en el orden de `writeState`
 * (server.js:1089-1102), las claves ajenas y `schemaVersion`. Con sangría de
 * 2 espacios como la 0.6.59 (server.js:1104).
 */
export function serializeStateFile(state: Readonly<StateV1>, extras: Readonly<Loose> = {}): string {
  const file: Loose = {};
  for (const key of STATE_V1_KEYS) file[key] = state[key];
  for (const [key, value] of Object.entries(extras)) {
    if (!V1_KEY_SET.has(key) && key !== 'schemaVersion') file[key] = value;
  }
  file.schemaVersion = SCHEMA_VERSION;
  return JSON.stringify(file, null, 2);
}

/**
 * Migración completa EN MEMORIA de un texto de state.json (la usa
 * scripts/check-migration-prod.mjs para comprobar el de producción sin
 * escribir nada). Lanza si no es JSON o no es un objeto.
 */
export function migrateStateText(
  text: string,
  ctx: NormalizeContext,
): MigratedState & { readonly text: string } {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('state.json no es un objeto');
  }
  const migrated = migrateStateObject(raw, ctx);
  return { ...migrated, text: serializeStateFile(migrated.state, migrated.extras) };
}
