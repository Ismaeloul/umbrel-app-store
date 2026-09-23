/* Apoyo de los tests de `auth`: un v2/devices.json en memoria con la misma
   semántica que el de state (lectura congelada, cola en orden, validación
   con el esquema antes de "persistir") y que guarda cada versión escrita,
   para comprobar que el token en claro no llega nunca al fichero. */

import { DevicesFileSchema, SCHEMA_VERSION, type DevicesFile } from '@ace/shared';
import type { JsonDocumentStore, StateService } from '../state/types.js';

export interface MemoryDevicesStore extends JsonDocumentStore<DevicesFile> {
  /** Cada documento "escrito", serializado como iría al disco. */
  readonly writes: string[];
  /** Que la próxima escritura falle (disco lleno). */
  failNext(error?: Error): void;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function memoryDevicesStore(
  initial: DevicesFile = { schemaVersion: SCHEMA_VERSION, devices: [] },
): MemoryDevicesStore {
  let current = freeze(structuredClone(DevicesFileSchema.parse(initial)));
  let queue: Promise<unknown> = Promise.resolve();
  let failure: Error | null = null;
  const writes: string[] = [];
  return {
    writes,
    failNext(error = new Error('ENOSPC')) {
      failure = error;
    },
    read: () => current,
    update<R>(mutator: (draft: DevicesFile) => R | Promise<R>): Promise<R> {
      const run = queue.then(async () => {
        const draft = structuredClone(current) as DevicesFile;
        const result = await mutator(draft);
        const valid = DevicesFileSchema.parse(draft);
        if (failure) {
          const error = failure;
          failure = null;
          throw error;
        }
        writes.push(JSON.stringify(valid, null, 2));
        current = freeze(valid);
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** StateService falso: solo `devices()` (lo único que usa auth). */
export function fakeState(store: JsonDocumentStore<DevicesFile>): StateService {
  return new Proxy({} as StateService, {
    get(_target, property) {
      if (property === 'devices') return () => store;
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw new Error(`fakeState.${String(property)} no está en el falso`);
      };
    },
  });
}

/** Azar determinista: códigos y bytes predecibles. */
export function sequenceRandom(codes: readonly number[]): {
  randomInt(max: number): number;
  randomBytes(size: number): Buffer;
} {
  let codeIndex = 0;
  let byteSeed = 1;
  return {
    randomInt(max) {
      const value = codes[codeIndex % codes.length] ?? 0;
      codeIndex += 1;
      return value % max;
    },
    randomBytes(size) {
      const buffer = Buffer.alloc(size);
      for (let index = 0; index < size; index += 1) buffer[index] = (byteSeed * 31 + index) % 256;
      byteSeed += 1;
      return buffer;
    },
  };
}
