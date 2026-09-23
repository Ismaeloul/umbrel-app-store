/* Piezas comunes de los tests del módulo `football`: fakes de los servicios
   de los que depende (solo por sus interfaces de types.ts), el embedding
   falso de los tests de la 0.6.59 y los fixtures inventados de fixtures/.
   Nada sale a la red ni usa el reloj real. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanJob, ScanRef, SearchResult, StateV1 } from '@ace/shared';
import { vi } from 'vitest';
import { createTestCore, type TestCore } from '../../../test/helpers/index.js';
import type { Env } from '../../config/index.js';
import { AppError } from '../../core/errors.js';
import type { DirectoriesService } from '../directories/types.js';
import type { EngineService } from '../engine/types.js';
import type { FetchOptions, NetClient } from '../net/types.js';
import type { ScanJobRequest, ScannerService } from '../scanner/types.js';
import type { SearchOptions, SearchService } from '../search/types.js';
import { applyLearnedSourceRules } from '../sources/legacy-exports.js';
import type { SourcesService } from '../sources/types.js';
import type { StateService } from '../state/types.js';
import { FootballServiceImpl } from './service.js';

export const ID_A = 'a'.repeat(40);
export const ID_B = 'b'.repeat(40);
export const ID_C = 'c'.repeat(40);

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Un fixture de fixtures/ como texto. */
export function fixture(name: string): string {
  return readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
}

/** `semanticTestEmbed` de tests/server.test.js:123-129. */
export async function semanticTestEmbed(texts: string[]): Promise<number[][]> {
  return texts.map((text) => {
    if (/campeones|champions|\bucl\b/i.test(text)) return [1, 0, 0];
    if (/hypermotion|laliga|segunda/i.test(text)) return [0, 1, 0];
    return [0, 0, 1];
  });
}

/** Un canal de biblioteca como lo guarda la 0.6.59 (`normalizeItem`). */
export function item(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    type: 'web' as const,
    category: 'TV',
    date: '2026-01-01T00:00:00.000Z',
    fromWebSync: false,
    ih: false,
    ...extra,
  };
}

/** Estado v1 normalizado mínimo (lo que devolvía `seedState()` de los tests antiguos). */
export function makeState(overrides: Record<string, unknown> = {}): StateV1 {
  const streams = [item(ID_A, 'Canal original'), item(ID_C, 'Otro canal')];
  const base = {
    favorites: [{ ...item(ID_A, 'Favorito'), type: 'fav' }],
    history: [{ ...item(ID_B, 'Reciente'), type: 'recent' }],
    web: streams,
    webSyncedAt: '2026-01-01T00:00:00.000Z',
    webSources: [
      {
        id: 'principal',
        name: 'Principal',
        url: 'https://example.com/list.m3u',
        type: 'm3u',
        streams,
        renames: {},
        hidden: [],
        syncedAt: '2026-01-01T00:00:00.000Z',
        lastErrorAt: null,
        lastError: null,
      },
    ],
    activeWebSourceId: 'principal',
    preferences: {
      onboardingComplete: false,
      country: 'Spain',
      leagues: [],
      teams: [],
      nationalities: [],
    },
    channelBindings: [],
    sourceReports: [],
    channelFeedback: [],
    sourceStats: { hashes: {}, proveedores: {} },
    nowPlaying: null,
  };
  return { ...base, ...overrides } as unknown as StateV1;
}

/** Directorio con estos canales (y `web` igual, como `readState`). */
export function withStreams(
  streams: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): StateV1 {
  const full = streams.map((stream) => item(String(stream.id), String(stream.title), stream));
  const state = makeState(overrides);
  const source = { ...(state.webSources[0] as object), id: 'm3u', streams: full };
  return { ...state, webSources: [source], web: full, activeWebSourceId: 'm3u' } as StateV1;
}

/** Estado en memoria con la cola de mutaciones de StateService (solo `get` y `enqueue`). */
export function fakeState(initial: StateV1 = makeState()) {
  let current = structuredClone(initial);
  const enqueue = vi.fn(async (mutator: (draft: StateV1) => unknown) => {
    const draft = structuredClone(current);
    const result = await mutator(draft);
    current = draft;
    return result;
  });
  const service = {
    get: () => current,
    enqueue,
    set: (next: StateV1) => {
      current = structuredClone(next);
    },
  };
  return service as unknown as StateService & {
    readonly enqueue: typeof enqueue;
    set(next: StateV1): void;
  };
}

export type SearchFn = (query: string, options?: SearchOptions) => Promise<Partial<SearchResult>[]>;

/** Buscador falso: `fn` devuelve los resultados de cada consulta (o lanza). */
export function fakeSearch(fn: SearchFn = async () => []) {
  const search = vi.fn(async (query: string, options?: SearchOptions) => ({
    query,
    results: (await fn(query, options)).map((result) => ({
      category: 'Busqueda',
      availability: null,
      bitrate: null,
      ih: true as const,
      ...result,
    })),
  }));
  return { search, parseResults: () => [] } as unknown as SearchService & {
    readonly search: typeof search;
  };
}

/** Comprobador falso: apagado por defecto (`enqueue` → null, como sin ACESTREAM_SCANNER_HOST). */
export function fakeScanner(
  options: {
    readonly enabled?: boolean;
    readonly jobs?: Record<string, Partial<ScanJob>>;
  } = {},
) {
  let seq = 0;
  const enqueue = vi.fn((request: ScanJobRequest): ScanRef | null => {
    if (!options.enabled || !request.candidates.length) return null;
    seq += 1;
    const id = seq.toString(16).padStart(24, '0');
    return {
      id,
      statusUrl: `/api/football/scan?id=${id}`,
      total: request.candidates.length,
      initialCount: Math.min(3, request.candidates.length),
    };
  });
  const job = vi.fn((id: string) => {
    const found = options.jobs?.[id];
    if (!found) throw new AppError('scan_not_found');
    return found as ScanJob;
  });
  return {
    enqueue,
    job,
    isEnabled: () => options.enabled === true,
  } as unknown as ScannerService & {
    readonly enqueue: typeof enqueue;
    readonly job: typeof job;
  };
}

/** Fuentes falsas: las reglas aprendidas de verdad (la función pura de sources) sobre el estado falso. */
export function fakeSources(state: StateService, now: () => number) {
  const applyLearnedRules = vi.fn(
    (channels: readonly string[], candidates: readonly { id: string; score: number }[]) =>
      applyLearnedSourceRules(
        state.get() as Parameters<typeof applyLearnedSourceRules>[0],
        channels,
        candidates,
        now(),
      ),
  );
  return { applyLearnedRules } as unknown as SourcesService & {
    readonly applyLearnedRules: typeof applyLearnedRules;
  };
}

export function fakeDirectories() {
  const refreshStaleInBackground = vi.fn();
  return { refreshStaleInBackground } as unknown as DirectoriesService & {
    readonly refreshStaleInBackground: typeof refreshStaleInBackground;
  };
}

export type NetRoute = (url: string, options: FetchOptions) => string | Promise<string>;

/**
 * Cliente saliente falso: la primera ruta cuyo prefijo casa con la URL
 * responde; sin ruta, `http_404`. Guarda cada URL pedida.
 */
export function fakeNet(routes: Record<string, NetRoute | string> = {}) {
  const calls: { url: string; options: FetchOptions }[] = [];
  const fetchText = vi.fn(async (url: string, options: FetchOptions = {}) => {
    calls.push({ url, options });
    if (options.signal?.aborted) throw new AppError('fetch_timeout');
    const prefix = Object.keys(routes).find((key) => url.startsWith(key));
    if (prefix === undefined) throw new AppError('http_404');
    const route = routes[prefix];
    const body = typeof route === 'function' ? await route(url, options) : String(route);
    return { body, url, status: 200, contentType: null };
  });
  return { fetchText, calls } as unknown as NetClient & {
    readonly fetchText: typeof fetchText;
    readonly calls: typeof calls;
  };
}

export interface FootballHarness {
  readonly core: TestCore;
  readonly football: FootballServiceImpl;
  readonly state: ReturnType<typeof fakeState>;
  readonly search: ReturnType<typeof fakeSearch>;
  readonly scanner: ReturnType<typeof fakeScanner>;
  readonly sources: ReturnType<typeof fakeSources>;
  readonly directories: ReturnType<typeof fakeDirectories>;
  readonly net: ReturnType<typeof fakeNet>;
}

/** El servicio de verdad con todo lo de fuera falso. Por defecto, sin demo (la agenda sale de `net`). */
export function createFootball(
  options: {
    readonly env?: Env;
    readonly state?: StateV1;
    readonly search?: SearchFn;
    readonly scanner?: Parameters<typeof fakeScanner>[0];
    readonly net?: Record<string, NetRoute | string>;
    readonly embed?: (texts: string[]) => Promise<unknown>;
    readonly ollamaFetch?: typeof fetch;
  } = {},
): FootballHarness {
  const core = createTestCore({ env: { FOOTBALL_DEMO_ONLY: 'false', ...options.env } });
  const state = fakeState(options.state);
  const search = fakeSearch(options.search);
  const scanner = fakeScanner(options.scanner);
  const sources = fakeSources(state, () => core.clock.now());
  const directories = fakeDirectories();
  const net = fakeNet(options.net);
  const football = new FootballServiceImpl({
    ...core,
    state,
    net,
    engine: {} as EngineService,
    scanner,
    search,
    sources,
    directories,
    ...(options.embed ? { embed: options.embed } : {}),
    ...(options.ollamaFetch ? { ollamaFetch: options.ollamaFetch } : {}),
  });
  return { core, football, state, search, scanner, sources, directories, net };
}
