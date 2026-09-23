/* Escritura atómica y recuperación de ficheros JSON (arquitectura §5.4;
   arregla backend-modulos §8.1.1-8.1.4).

   Escribir `destino` (con copia `.bak`):
     1. `destino.tmp` + fsync;
     2. si `destino` existe, se COPIA a `destino.bak.tmp` + fsync y se
        renombra a `.bak` (el `.bak` anterior sigue ahí hasta ese instante);
     3. `rename(destino.tmp → destino)`;
     4. fsync del directorio.
   Nunca hay un momento sin `destino` (la 0.6.59 lo movía a `.bak` y dejaba
   un hueco entre dos `rename`, server.js:1106-1107).

   Hay versión asíncrona (la cola de mutaciones: no bloquea el bucle) y
   síncrona (arranque y fachada de la 0.6.59, que era síncrona). */

import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { copyFile, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/* En Windows (solo desarrollo y tests) un antivirus o el indexador pueden
   tener el fichero abierto un instante: EPERM/EBUSY/EACCES en el rename. Se
   reintenta cediendo el turno, sin temporizadores. En Linux no pasa. */
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRIES = process.platform === 'win32' ? 20 : 0;

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function retrying<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= RETRIES || !RETRYABLE.has(errnoCode(error) ?? '')) throw error;
      await yieldTurn();
    }
  }
}

function retryingSync<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt >= RETRIES || !RETRYABLE.has(errnoCode(error) ?? '')) throw error;
    }
  }
}

export function isMissing(error: unknown): boolean {
  return errnoCode(error) === 'ENOENT';
}

// --- fsync ---

async function writeAndSync(file: string, text: string): Promise<void> {
  const handle = await open(file, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function writeAndSyncSync(file: string, text: string): void {
  const fd = openSync(file, 'w');
  try {
    writeSync(fd, text, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function syncFileSync(file: string): void {
  const fd = openSync(file, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/* fsync del directorio: que el `rename` sobreviva a un apagón. En Windows no
   se puede abrir un directorio así (EISDIR/EPERM): se ignora, igual que
   cualquier fallo aquí (el fichero ya está escrito y sincronizado). */
async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {}
}

function syncDirSync(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {}
}

export function fileExists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

// --- Escritura atómica ---

export interface AtomicWriteOptions {
  /** Ruta de la copia del contenido anterior (`<destino>.bak`); null = sin copia. */
  readonly backup: string | null;
}

/** Escritura atómica asíncrona (la cola de mutaciones). */
export async function writeAtomic(
  target: string,
  text: string,
  options: AtomicWriteOptions,
): Promise<void> {
  const tmp = `${target}.tmp`;
  await writeAndSync(tmp, text);
  if (options.backup) {
    const backupTmp = `${options.backup}.tmp`;
    let copied = true;
    try {
      await copyFile(target, backupTmp);
    } catch (error) {
      if (!isMissing(error)) throw error;
      copied = false; // primera escritura: no hay nada que copiar
    }
    if (copied) {
      await syncFile(backupTmp);
      await retrying(() => rename(backupTmp, options.backup as string));
    }
  }
  await retrying(() => rename(tmp, target));
  await syncDir(path.dirname(target));
}

/** Lo mismo, síncrono (arranque y fachada de la 0.6.59). */
export function writeAtomicSync(target: string, text: string, options: AtomicWriteOptions): void {
  const tmp = `${target}.tmp`;
  writeAndSyncSync(tmp, text);
  if (options.backup) {
    const backupTmp = `${options.backup}.tmp`;
    let copied = true;
    try {
      copyFileSync(target, backupTmp);
    } catch (error) {
      if (!isMissing(error)) throw error;
      copied = false;
    }
    if (copied) {
      syncFileSync(backupTmp);
      retryingSync(() => renameSync(backupTmp, options.backup as string));
    }
  }
  retryingSync(() => renameSync(tmp, target));
  syncDirSync(path.dirname(target));
}

/**
 * Copia que NUNCA pisa un fichero existente (`state.pre-0.7.0.json` es
 * intocable). Devuelve false si ya existía.
 */
export function copyOnceSync(source: string, target: string): boolean {
  try {
    copyFileSync(source, target, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') return false;
    throw error;
  }
  syncFileSync(target);
  syncDirSync(path.dirname(target));
  return true;
}

// --- Instantáneas rotadas (.1 … .N) ---

/** `<fichero>.1` … `<fichero>.<count>`, de la más nueva a la más vieja. */
export function rotatedPaths(file: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${file}.${index + 1}`);
}

/** Corre `.1 → .2 → … → .N` y copia el fichero actual a `.1`. */
export async function rotateSnapshots(file: string, count: number): Promise<void> {
  const paths = rotatedPaths(file, count);
  for (let index = paths.length - 1; index > 0; index -= 1) {
    try {
      await retrying(() => rename(paths[index - 1] as string, paths[index] as string));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const first = paths[0] as string;
  const tmp = `${first}.tmp`;
  await copyFile(file, tmp);
  await syncFile(tmp);
  await retrying(() => rename(tmp, first));
  await syncDir(path.dirname(file));
}

// --- Lectura para la recuperación ---

export type ReadOutcome =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ok'; readonly text: string; readonly value: object; readonly mtimeMs: number }
  | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * Lee y parsea un JSON. Solo vale un OBJETO: un JSON válido que no lo es
 * (`null`, `[]`, `42`) cuenta como ilegible (backend-modulos §8.1.3: la 0.6.59
 * lo perdía en silencio).
 */
export function readJsonObjectSync(file: string): ReadOutcome {
  let text: string;
  let mtimeMs: number;
  try {
    text = readFileSync(file, 'utf8');
    mtimeMs = statSync(file).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' };
    return { kind: 'unreadable', reason: errnoCode(error) ?? 'read_failed' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', reason: 'bad_json' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'unreadable', reason: 'not_an_object' };
  }
  return { kind: 'ok', text, value, mtimeMs };
}

// --- Cuarentena de ilegibles ---

/** Marca de tiempo de los apartados, como la 0.6.59 (server.js:1004). */
export function corruptStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Aparta un fichero ilegible como `<base>.corrupt-<fecha>[-<origen>]` (lo
 * mueve, no lo borra) y deja solo los `keep` apartados más recientes de
 * `<base>`. Devuelve el nombre del apartado o null si no se pudo mover.
 */
export function quarantineSync(
  file: string,
  base: string,
  stamp: string,
  suffix: string,
  keep: number,
): string | null {
  const dir = path.dirname(base);
  const prefix = `${path.basename(base)}.corrupt-`;
  let name = `${prefix}${stamp}${suffix ? `-${suffix}` : ''}`;
  for (let n = 2; fileExists(path.join(dir, name)); n += 1) {
    name = `${prefix}${stamp}${suffix ? `-${suffix}` : ''}-${n}`;
  }
  try {
    retryingSync(() => renameSync(file, path.join(dir, name)));
  } catch {
    return null;
  }
  pruneQuarantine(base, keep, name);
  return name;
}

/**
 * Deja los `keep` apartados más recientes (por nombre: la fecha ISO ordena).
 * `protect` (el que se acaba de apartar) no se borra nunca, aunque el reloj
 * del NAS vaya atrasado y su fecha parezca la más vieja.
 */
export function pruneQuarantine(base: string, keep: number, protect?: string): void {
  const dir = path.dirname(base);
  const prefix = `${path.basename(base)}.corrupt-`;
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith(prefix));
  } catch {
    return;
  }
  names.sort().reverse();
  if (protect && names.includes(protect)) {
    names = [protect, ...names.filter((name) => name !== protect)];
  }
  for (const name of names.slice(keep)) {
    try {
      rmSync(path.join(dir, name), { force: true, recursive: true });
    } catch {}
  }
}

/** Borra un fichero si existe (restos de `.tmp`). */
export async function removeIfExists(file: string): Promise<void> {
  await rm(file, { force: true });
}

export function removeIfExistsSync(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {}
}
