import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { completarEsquema, ESQUEMA } from './esquema';

// Todo vive en un solo fichero SQLite. El esquema se crea solo al arrancar y
// es idempotente: no hay migraciones que lanzar a mano.

let instancia: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instancia) return instancia;

  mkdirSync(config.datos, { recursive: true });
  const conexion = new DatabaseSync(join(config.datos, 'saldo.db'));

  // WAL para que leer no bloquee escribir; claves foraneas para que borrar una
  // cuenta se lleve por delante lo suyo y nada mas.
  conexion.exec('PRAGMA journal_mode = WAL');
  conexion.exec('PRAGMA foreign_keys = ON');
  conexion.exec('PRAGMA busy_timeout = 5000');
  conexion.exec(ESQUEMA);
  completarEsquema(conexion);

  instancia = conexion;
  return conexion;
}

export { dbEnMemoria } from './esquema';
