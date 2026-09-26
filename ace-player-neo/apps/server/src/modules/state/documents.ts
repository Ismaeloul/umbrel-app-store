/* Documentos JSON de `data/v2/` (devices.json, settings.json, sessions.json)
   con su propia cola y escritura atómica (arquitectura §5.4). La 0.6.59 no
   los mira: una vuelta atrás ni los pisa ni los necesita.

   - Se leen una vez (en el `load()` del estado) y se validan con su esquema
     de @ace/shared.
   - `update(mutator)`: en orden, sobre una copia; se valida con el esquema y
     se persiste ANTES de resolver. Si no valida, no se escribe nada.
   - Ilegible o fuera de esquema: se aparta como `<fichero>.corrupt-<fecha>`
     (5 como mucho), se prueba la copia `.bak` y, si tampoco vale, se empieza
     con el documento por defecto. Nunca se borra nada en silencio. */

import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { AppError } from '../../core/errors.js';
import type { Clock } from '../../core/clock.js';
import type { Logger } from '../../core/logger.js';
import type { JsonDocumentStore } from './types.js';
import {
  corruptStamp,
  quarantineSync,
  readJsonObjectSync,
  removeIfExists,
  writeAtomic,
  writeAtomicSync,
} from './storage.js';

/** Apartados que se guardan por fichero (como state.json). */
export const QUARANTINE_KEEP = 5;

export type DocumentLoadStatus = 'ready' | 'recovered' | 'degraded' | 'fresh';

export interface DocumentStoreOptions<T> {
  readonly name: string;
  readonly file: string;
  readonly schema: z.ZodType<T>;
  readonly defaults: () => T;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Aviso de documento ilegible y apartado (el servicio lo manda a diagnóstico, paso 1.3). */
  readonly onUnreadable?: (document: string, moved: string | null) => void;
  /**
   * Permisos del fichero y de su `.bak` (0o600 para la IPTV, docs/iptv.md
   * §2.1). Sin él, los de siempre.
   */
  readonly fileMode?: number;
}

export interface ManagedDocumentStore<T> extends JsonDocumentStore<T> {
  /** Lee (y recupera) el fichero. Idempotente. */
  loadSync(): DocumentLoadStatus;
  /** Sustituye el documento fuera de la cola (solo al arrancar). */
  replaceSync(value: T): void;
  /** Espera a que no quede nada en la cola. */
  flush(): Promise<void>;
  /**
   * Borra la copia `.bak`, los restos `.tmp` y las copias apartadas como
   * ilegibles (`<fichero>.corrupt-*`), en la cola (docs/iptv.md §5.3:
   * «Eliminar» la IPTV borra también esto). El documento vigente no se toca.
   */
  purge(): Promise<void>;
}

/** Congela en profundidad: lo que se entrega a los demás módulos es de solo lectura. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function createDocumentStore<T>(options: DocumentStoreOptions<T>): ManagedDocumentStore<T> {
  const { name, file, schema, clock, logger } = options;
  const backup = `${file}.bak`;
  const mode = options.fileMode === undefined ? {} : { mode: options.fileMode };
  let current: T | null = null;
  let status: DocumentLoadStatus | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const serialize = (value: T): string => JSON.stringify(value, null, 2);

  function validate(value: unknown): T | null {
    const result = schema.safeParse(value);
    return result.success ? result.data : null;
  }

  /* Al arrancar, un disco que no deja escribir no impide seguir en memoria. */
  function persistAtLoad(text: string): void {
    try {
      writeAtomicSync(file, text, { backup: null, ...mode });
    } catch (error) {
      logger.error(
        { err: error, document: name },
        'no se pudo guardar el documento v2 al arrancar',
      );
    }
  }

  function loadSync(): DocumentLoadStatus {
    if (status) return status;
    const stamp = corruptStamp(clock.date());
    let existed = false;
    for (const [candidate, suffix] of [
      [file, ''],
      [backup, 'bak'],
    ] as const) {
      const outcome = readJsonObjectSync(candidate);
      if (outcome.kind === 'missing') continue;
      existed = true;
      const value = outcome.kind === 'ok' ? validate(outcome.value) : null;
      if (value !== null) {
        current = deepFreeze(value);
        const text = serialize(value);
        if (candidate !== file || outcome.kind !== 'ok' || outcome.text !== text) {
          persistAtLoad(text);
        }
        status = candidate === file ? 'ready' : 'recovered';
        if (status === 'recovered')
          logger.warn({ document: name }, 'documento v2 recuperado de .bak');
        return status;
      }
      const moved = quarantineSync(candidate, file, stamp, suffix, QUARANTINE_KEEP);
      logger.error(
        { document: name, apartado: moved, errorCode: 'state_unreadable' },
        'documento v2 ilegible o fuera de esquema: apartado',
      );
      options.onUnreadable?.(name, moved);
    }
    const value = options.defaults();
    current = deepFreeze(value);
    persistAtLoad(serialize(value));
    status = existed ? 'degraded' : 'fresh';
    return status;
  }

  function ensure(): T {
    if (current === null) loadSync();
    return current as T;
  }

  return {
    loadSync,
    read: ensure,
    replaceSync(value) {
      const parsed = validate(value);
      if (parsed === null) throw new AppError('internal_error', { detail: `${name} no válido` });
      ensure();
      writeAtomicSync(file, serialize(parsed), { backup, ...mode });
      current = deepFreeze(parsed);
    },
    update<R>(mutator: (draft: T) => R | Promise<R>): Promise<R> {
      const job = async (): Promise<R> => {
        const draft = structuredClone(ensure());
        const result = await mutator(draft);
        const parsed = schema.safeParse(draft);
        if (!parsed.success) {
          throw new AppError('internal_error', {
            detail: `${name} no cumple su esquema tras el cambio`,
            data: parsed.error.issues.slice(0, 5).map((issue) => ({
              path: issue.path.map(String).join('.'),
              message: issue.message,
            })),
          });
        }
        await writeAtomic(file, serialize(parsed.data), { backup, ...mode });
        current = deepFreeze(parsed.data);
        return result;
      };
      const promise = chain.then(job);
      chain = promise.catch(() => undefined);
      return promise;
    },
    async flush() {
      await chain;
    },
    purge() {
      const job = async (): Promise<void> => {
        for (const leftover of [backup, `${backup}.tmp`, `${file}.tmp`]) {
          await removeIfExists(leftover).catch(() => undefined);
        }
        const dir = path.dirname(file);
        const prefix = `${path.basename(file)}.corrupt-`;
        let names: string[] = [];
        try {
          names = (await readdir(dir)).filter((entry) => entry.startsWith(prefix));
        } catch {}
        for (const entry of names) {
          await rm(path.join(dir, entry), { force: true, recursive: true }).catch(() => undefined);
        }
      };
      const promise = chain.then(job);
      chain = promise.catch(() => undefined);
      return promise;
    },
  };
}
