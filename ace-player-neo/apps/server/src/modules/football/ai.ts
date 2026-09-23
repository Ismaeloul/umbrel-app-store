/* IA opcional con Ollama (server.js:641-837, 2666-2717; backend-modulos
   §3.11; B-165 a B-172).

   Los embeddings sirven para reconocer QUÉ canal es un rótulo raro ("UCL
   Principal --> ELCANO" es la Champions); la capa solo SUBE candidatos que el
   emparejado clásico no entendió, nunca rebaja ni elimina sus aciertos. Sin
   Ollama configurado, o si falla, todo sigue igual (B-169).

   Cambio de la v2 (backend-modulos §8.5.24): el LRU de 2400 vectores reserva
   sitio para los canales programados; antes el calentado metía la
   biblioteca detrás y los primeros desalojados eran justo esos canales. */

import {
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  SEMANTIC_MIN_SIMILARITY,
  SEMANTIC_OTHER_CHANNEL_MARGIN,
  channelMatchScore,
  cleanTitle,
  normalizeChannelKey,
  semanticChannelText,
  semanticNumbersCompatible,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Clock } from '../../core/clock.js';
import {
  OLLAMA_EMBED_BATCH,
  OLLAMA_EMBED_CACHE_MAX,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_MAX_RESPONSE_CHARS,
} from './constants.js';

/** Pide los vectores de unos textos (un lote). Lanza `ollama_*` si falla. */
export type EmbedFunction = (texts: string[]) => Promise<unknown>;

/** `cosineSimilarity` (server.js:641-652): -1 si los vectores no valen. */
export function cosineSimilarity(left: unknown, right: unknown): number {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length < 2 ||
    left.length !== right.length
  ) {
    return -1;
  }
  let product = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    product += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  return normLeft > 0 && normRight > 0 ? product / Math.sqrt(normLeft * normRight) : -1;
}

// --- Caché de vectores ---

/** Lo que necesita la IA de una caché de vectores. */
export interface VectorStore {
  has(key: string): boolean;
  get(key: string): unknown;
  /** Guarda como el más reciente y aplica el tope (`rememberSemanticEmbedding`). */
  remember(key: string, vector: unknown): void;
}

function validVector(key: string, vector: unknown): vector is unknown[] {
  return Boolean(key) && Array.isArray(vector) && vector.length >= 2;
}

/**
 * LRU de 2400 vectores con sitio reservado para los canales programados: al
 * pasarse del tope sale el más antiguo que NO sea de la programación; solo si
 * todo lo que queda es programación, el más antiguo de ella.
 */
export class SemanticVectorCache implements VectorStore {
  private readonly entries = new Map<string, unknown[]>();
  private reserved: ReadonlySet<string> = new Set();

  constructor(private readonly max: number = OLLAMA_EMBED_CACHE_MAX) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): unknown[] | undefined {
    return this.entries.get(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  remember(key: string, vector: unknown): void {
    if (!validVector(key, vector)) return;
    this.entries.delete(key);
    this.entries.set(key, vector);
    this.trim();
  }

  /** Claves (texto semántico) de los canales de la agenda vigente. */
  reserve(keys: Iterable<string>): void {
    this.reserved = new Set(keys);
    this.trim();
  }

  private trim(): void {
    while (this.entries.size > this.max) {
      let victim: string | undefined;
      for (const key of this.entries.keys()) {
        if (!this.reserved.has(key)) {
          victim = key;
          break;
        }
      }
      victim ??= this.entries.keys().next().value;
      if (victim === undefined) return;
      this.entries.delete(victim);
    }
  }
}

/** Un `Map` suelto (los tests de la 0.6.59 pasan `new Map()`) con el LRU de siempre (server.js:698-703). */
export function asVectorStore(cache: VectorStore | Map<string, unknown>): VectorStore {
  if (!(cache instanceof Map)) return cache;
  return {
    has: (key) => cache.has(key),
    get: (key) => cache.get(key),
    remember: (key, vector) => {
      if (!validVector(key, vector)) return;
      cache.delete(key);
      cache.set(key, vector);
      while (cache.size > OLLAMA_EMBED_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    },
  };
}

/** Clave de caché de un texto (server.js:710-711, 732-733). */
export function embeddingKey(value: unknown): string {
  return cleanTitle(value, '').slice(0, 120);
}

function embeddingKeys(values: readonly unknown[] | unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map(embeddingKey).filter(Boolean))];
}

export interface EmbeddingOptions {
  readonly cache: VectorStore;
  readonly embed: EmbedFunction;
  readonly batchSize?: number;
}

/**
 * `semanticEmbeddingMap` (server.js:705-718): pide lo que falta en lotes de
 * 24 y devuelve los vectores de todos. Un lote fallido corta y lanza.
 */
export async function semanticEmbeddingMap(
  values: readonly string[],
  options: EmbeddingOptions,
): Promise<Map<string, unknown[]>> {
  const { cache, embed } = options;
  const keys = embeddingKeys(values);
  const missing = keys.filter((key) => !cache.has(key));
  for (let index = 0; index < missing.length; index += OLLAMA_EMBED_BATCH) {
    const batch = missing.slice(index, index + OLLAMA_EMBED_BATCH);
    const vectors = await embed(batch);
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new AppError('ollama_bad_response');
    }
    batch.forEach((key, position) => cache.remember(key, vectors[position]));
  }
  const output = new Map<string, unknown[]>();
  for (const key of keys) {
    const vector = cache.get(key);
    if (Array.isArray(vector)) output.set(key, vector);
  }
  return output;
}

export interface WarmResult {
  total: number;
  requested: number;
  failed: number;
  error: string | null;
}

/**
 * `semanticWarmEmbeddings` (server.js:725-751): calentar el índice no es todo
 * o nada; un lote fallido queda para la próxima vez y el resto sirve ya. T-100.
 */
export async function semanticWarmEmbeddings(
  values: readonly unknown[] | unknown,
  options: EmbeddingOptions,
): Promise<WarmResult> {
  const { cache, embed } = options;
  const batchSize = Math.max(1, Number(options.batchSize) || OLLAMA_EMBED_BATCH);
  const keys = embeddingKeys(values);
  const missing = keys.filter((key) => !cache.has(key));
  let failed = 0;
  let lastError: unknown = null;
  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    try {
      const vectors = await embed(batch);
      if (!Array.isArray(vectors) || vectors.length !== batch.length) {
        throw new AppError('ollama_bad_response');
      }
      batch.forEach((key, position) => cache.remember(key, vectors[position]));
    } catch (error) {
      failed += batch.length;
      lastError = error;
    }
  }
  return {
    total: keys.length,
    requested: missing.length,
    failed,
    error: lastError ? errorMessage(lastError, 'ollama_unavailable') : null,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return message || fallback;
}

interface CatalogEntry {
  name: string;
  key: string;
  text: string;
  requested: boolean;
}

/* `semanticCatalog` (server.js:753-765): los canales pedidos y los de toda la
   programación, uno por clave; `requested` si casa con un pedido a ≥ 92. */
function semanticCatalog(
  requestedChannels: readonly string[],
  programChannels: readonly unknown[] | unknown,
): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>();
  for (const raw of [
    ...requestedChannels,
    ...(Array.isArray(programChannels) ? (programChannels as unknown[]) : []),
  ]) {
    const name = cleanTitle(raw, '');
    const key = normalizeChannelKey(name);
    const text = semanticChannelText(name);
    if (!name || !key || !text) continue;
    const requested = requestedChannels.some(
      (channel) => channelMatchScore(channel, name) >= RESOLUTION_EXACT_SCORE,
    );
    const previous = entries.get(key);
    entries.set(key, { name, key, text, requested: requested || previous?.requested === true });
  }
  return [...entries.values()];
}

/** `semanticScore` (server.js:767-771): 94 desde 0,96, 88 desde 0,90 y 74-76 por debajo. T-084. */
export function semanticScore(similarity: number): number {
  if (similarity >= 0.96) return SEMANTIC_MAX_SCORE;
  if (similarity >= 0.9) return 88;
  return 74 + Math.max(0, Math.round((similarity - SEMANTIC_MIN_SIMILARITY) * 50));
}

/** Lo mínimo que la IA mira de un candidato. */
export interface SemanticCandidate {
  readonly title: string;
  readonly alias?: string | null;
  readonly score: number;
}

export interface SemanticOptions {
  readonly enabled: boolean;
  readonly cache: VectorStore;
  readonly embed: EmbedFunction;
}

export type SemanticFields = {
  score: number;
  matchedChannel: string;
  soloFamilia: boolean;
  semantic: true;
  semanticSimilarity: number;
};

/**
 * `applySemanticCandidateScores` (server.js:778-837): compara cada nombre con
 * TODOS los canales de la programación. Solo promociona si el vecino más
 * cercano es un canal pedido, con 0,86 o más y ventaja clara sobre el mejor
 * no pedido (sin rival, 0,96). La guarda de diales va antes de comparar.
 * T-019, T-021, T-022, T-081, T-082, T-086.
 */
export async function applySemanticCandidateScores<T extends SemanticCandidate>(
  requestedChannels: readonly string[],
  candidates: readonly T[],
  programChannels: readonly unknown[] | unknown,
  options: SemanticOptions,
): Promise<{
  candidates: (T | (T & { semanticSimilarity: number }) | (T & SemanticFields))[];
  used: boolean;
  error: string | null;
  catalogSize: number;
}> {
  if (!options.enabled || !candidates.length) {
    return { candidates: [...candidates], used: false, error: null, catalogSize: 0 };
  }
  const catalog = semanticCatalog(requestedChannels, programChannels);
  if (!catalog.some((entry) => entry.requested)) {
    return { candidates: [...candidates], used: false, error: null, catalogSize: catalog.length };
  }
  const namesOf = (candidate: T): string[] =>
    [candidate.title, candidate.alias].filter((name): name is string => Boolean(name));
  const texts = [
    ...catalog.map((entry) => entry.text),
    ...candidates.flatMap(namesOf).map(semanticChannelText).filter(Boolean),
  ];
  let vectors: Map<string, unknown[]>;
  try {
    vectors = await semanticEmbeddingMap(texts, options);
  } catch (error) {
    return {
      candidates: [...candidates],
      used: false,
      error: errorMessage(error, 'ollama_unavailable'),
      catalogSize: catalog.length,
    };
  }

  const scored = candidates.map((candidate) => {
    let bestRequested = { similarity: -1, channel: '' };
    let bestOther = -1;
    for (const rawName of namesOf(candidate)) {
      const candidateVector = vectors.get(semanticChannelText(rawName));
      if (!candidateVector) continue;
      for (const entry of catalog) {
        if (!semanticNumbersCompatible(entry.name, rawName)) continue;
        const similarity = cosineSimilarity(vectors.get(entry.text), candidateVector);
        if (entry.requested) {
          if (similarity > bestRequested.similarity) {
            bestRequested = { similarity, channel: entry.name };
          }
        } else if (similarity > bestOther) bestOther = similarity;
      }
    }
    /* Sin ningún otro canal con el que contrastar se exige prácticamente
       identidad en vez de dar el visto bueno por defecto (B-168). */
    const sinRival = bestOther < 0;
    const clearWinner = sinRival
      ? bestRequested.similarity >= 0.96
      : bestRequested.similarity >= 0.96 ||
        bestRequested.similarity - bestOther >= SEMANTIC_OTHER_CHANNEL_MARGIN;
    if (bestRequested.similarity < SEMANTIC_MIN_SIMILARITY || !clearWinner) return candidate;
    const aiScore = semanticScore(bestRequested.similarity);
    const semanticSimilarity = Number(bestRequested.similarity.toFixed(4));
    if (aiScore <= candidate.score) return { ...candidate, semanticSimilarity };
    return {
      ...candidate,
      score: aiScore,
      matchedChannel:
        requestedChannels.find(
          (channel) => channelMatchScore(channel, bestRequested.channel) >= RESOLUTION_EXACT_SCORE,
        ) ||
        requestedChannels[0] ||
        '',
      soloFamilia: false,
      semantic: true as const,
      semanticSimilarity,
    };
  });
  return { candidates: scored, used: true, error: null, catalogSize: catalog.length };
}

/** `semanticLibraryTexts` (server.js:2666-2676): textos semánticos de directorios, favoritos e historial. */
export function semanticLibraryTexts(state: unknown): string[] {
  const value = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
  const items = (list: unknown): Record<string, unknown>[] =>
    Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  const directory = Array.isArray(value.webSources)
    ? items(value.webSources).flatMap((source) => items(source.streams))
    : items(value.web);
  const values: string[] = [];
  for (const item of [...directory, ...items(value.favorites), ...items(value.history)]) {
    values.push(semanticChannelText(item?.title));
    if (item?.alias) values.push(semanticChannelText(item.alias));
  }
  return values.filter(Boolean);
}

// --- Cliente de Ollama (server.js:664-696) ---

export interface OllamaClientOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly clock: Clock;
  readonly fetch: typeof fetch;
}

/**
 * `ollamaEmbedBatch` (server.js:664-696): POST `/api/embed` con plazo
 * `OLLAMA_TIMEOUT_MS`. Lanza `ollama_timeout`, `ollama_unavailable`,
 * `ollama_bad_response` u `ollama_response_too_large`. Ollama es un host
 * interno: no pasa por el cliente anti-SSRF (backend-modulos §5).
 */
export function createOllamaEmbedder(options: OllamaClientOptions): EmbedFunction {
  return async (texts) => {
    const controller = new AbortController();
    const timer = options.clock.setTimeout(() => controller.abort(), options.timeoutMs, {
      unref: true,
    });
    try {
      const response = await options.fetch(`${options.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          input: texts,
          truncate: true,
          keep_alive: OLLAMA_KEEP_ALIVE,
        }),
        signal: controller.signal,
      });
      const body = await response.text();
      if (body.length > OLLAMA_MAX_RESPONSE_CHARS) throw new AppError('ollama_response_too_large');
      if (!response.ok) throw new AppError('ollama_unavailable');
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new AppError('ollama_bad_response');
      }
      const embeddings = (parsed as { embeddings?: unknown } | null)?.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
        throw new AppError('ollama_bad_response');
      }
      return embeddings;
    } catch (error) {
      if (controller.signal.aborted) throw new AppError('ollama_timeout', { cause: error });
      if (error instanceof AppError) throw error;
      throw new AppError('ollama_unavailable', { cause: error });
    } finally {
      options.clock.clearTimeout(timer);
    }
  };
}

/** Sin Ollama configurado: cualquier intento es `ollama_unavailable` (server.js:665). */
export const unavailableEmbedder: EmbedFunction = async () => {
  throw new AppError('ollama_unavailable');
};
