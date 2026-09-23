/* Apoyo de los tests de fuentes (no lo usa el código de producto): un
   estado en memoria con la misma cola única que el de verdad (una mutación
   detrás de otra, sobre una copia, y se aplica al terminar) y un montaje del
   servicio con el comprobador de guion. */

import type { StateScope, StateV1 } from '@ace/shared';
import { notImplemented } from '../../core/errors.js';
import type { CoreDeps } from '../../core/module.js';
import {
  createTestScanner,
  scriptedTransport,
  type ScriptedOutcome,
} from '../scanner/test-support.js';
import type { StateService } from '../state/types.js';
import { SourcesServiceImpl } from './service.js';

export interface MemoryState extends StateService {
  /** Ámbitos de cada escritura, en orden. */
  readonly writes: StateScope[][];
  /** Hace fallar la próxima escritura (disco lleno). */
  failNextWrite(): void;
}

export function emptyState(overrides: Partial<StateV1> = {}): StateV1 {
  return {
    favorites: [],
    history: [],
    web: [],
    webSyncedAt: null,
    webSources: [],
    activeWebSourceId: 'principal',
    preferences: {} as StateV1['preferences'],
    channelBindings: [],
    sourceReports: [],
    channelFeedback: [],
    sourceStats: { hashes: {}, proveedores: {} },
    nowPlaying: null,
    ...overrides,
  } as StateV1;
}

export function createMemoryState(initial: Partial<StateV1> = {}): MemoryState {
  let current = emptyState(initial);
  let chain: Promise<unknown> = Promise.resolve();
  let failNext = false;
  const writes: StateScope[][] = [];
  const impl: Partial<MemoryState> & Record<string, unknown> = {
    writes,
    failNextWrite: () => {
      failNext = true;
    },
    get: () => current,
    learningCount: () => current.channelFeedback.length,
    flush: async () => {
      await chain.catch(() => {});
    },
    start: async () => {},
    stop: async () => {},
    enqueue<R>(
      mutator: (draft: StateV1) => R | Promise<R>,
      options: { scopes: readonly StateScope[] },
    ) {
      const run = chain
        .catch(() => {})
        .then(async () => {
          const draft = structuredClone(current);
          const result = await mutator(draft);
          if (failNext) {
            failNext = false;
            throw new Error('ENOSPC');
          }
          current = draft;
          writes.push([...options.scopes]);
          return result;
        });
      chain = run;
      return run;
    },
  };
  return new Proxy(impl as MemoryState, {
    get(target, property) {
      if (property in target) return (target as unknown as Record<PropertyKey, unknown>)[property];
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw notImplemented(`state.${String(property)}`);
      };
    },
  });
}

/** El servicio de fuentes con estado en memoria y el comprobador de guion (o apagado). */
export function createTestSources(
  core: CoreDeps,
  options: {
    readonly state?: Partial<StateV1>;
    readonly outcomes?: Record<string, ScriptedOutcome>;
    readonly ids?: () => string;
  } = {},
) {
  const state = createMemoryState(options.state);
  const script = scriptedTransport(options.outcomes);
  const scanner = createTestScanner(core, script.transport);
  let next = 0;
  const sources = new SourcesServiceImpl(
    { ...core, state, scanner },
    options.ids ?? (() => `r${(next++).toString(16).padStart(15, '0')}`),
  );
  return { state, script, scanner, sources };
}
