/* IA opcional con Ollama (server.js:641-837, 2666-2717; B-165 a B-172).
   Siempre con un embedding falso: nada sale a la red. */

import { describe, expect, it, vi } from 'vitest';
import { FLTV_URL, OLLAMA_EMBED_CACHE_MAX } from './constants.js';
import {
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  applySemanticCandidateScores,
  cosineSimilarity,
  mergeResolutionCandidates,
  semanticChannelText,
  semanticNumbersCompatible,
  semanticScore,
  semanticWarmEmbeddings,
} from './legacy-exports.js';
import {
  SemanticVectorCache,
  asVectorStore,
  createOllamaEmbedder,
  semanticLibraryTexts,
} from './ai.js';
import { FakeClock } from '../../../test/helpers/index.js';
import {
  ID_A,
  ID_B,
  ID_C,
  createFootball,
  fixture,
  item,
  semanticTestEmbed,
} from './test-support.js';

const vector = (angulo: number): number[] => [Math.cos(angulo), Math.sin(angulo)];
const conSimilitud = (valor: number): number[] => vector(Math.acos(Math.min(1, valor)));

/** Candidato con la forma de los tests de la 0.6.59 (tests/server.test.js:442-446). */
function candidate(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, title, alias: null, source: 'm3u', score: 0, soloFamilia: false, ...extra };
}

describe('T-018 · la IA limpia proveedor y calidad pero deja los diales bajo reglas estrictas (B-167)', () => {
  it('texto semántico y guarda de diales', () => {
    expect(semanticChannelText('M+ LIGA DE CAMPEONES 3 FHD --> ELCANO')).toBe('liga campeones');
    expect(
      semanticNumbersCompatible('M+ Liga de Campeones', 'LIGA DE CAMPEONES 3 --> ELCANO'),
    ).toBe(false);
    expect(
      semanticNumbersCompatible('M+ Liga de Campeones 3', 'LIGA DE CAMPEONES 3 --> ELCANO'),
    ).toBe(true);
    expect(
      semanticNumbersCompatible('M+ Liga de Campeones 1', 'LIGA DE CAMPEONES --> ELCANO'),
    ).toBe(true);
  });
});

describe('T-019 · la IA compara una fuente contra toda la programacion y no contra un canal aislado (B-166)', () => {
  it('sube la de Champions, deja la de LaLiga y el dial 3', async () => {
    const result = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [
        candidate(ID_A, 'UCL Principal --> ELCANO'),
        candidate(ID_B, 'M+ LALIGA --> NEW ERA'),
        candidate(ID_C, 'UCL Principal 3 --> SPORT TV', { source: 'acestream' }),
      ],
      ['M+ Liga de Campeones', 'M+ LALIGA', 'LaLiga TV Hypermotion'],
      { enabled: true, embed: semanticTestEmbed, cache: new Map() },
    );
    expect(result.used).toBe(true);
    expect(result.catalogSize).toBe(3);
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(RESOLUTION_EXACT_SCORE);
    expect(result.candidates[0]).toMatchObject({
      semantic: true,
      matchedChannel: 'M+ Liga de Campeones',
      soloFamilia: false,
    });
    expect(result.candidates[1]?.score).toBe(0);
    expect(result.candidates[2]?.score).toBe(0);
  });

  it('apagada, sin candidatos o sin canal pedido en la parrilla, no hace nada', async () => {
    const lista = [candidate(ID_A, 'UCL')];
    expect(await applySemanticCandidateScores(['M+ Liga de Campeones'], lista, [])).toMatchObject({
      used: false,
      catalogSize: 0,
    });
    expect(
      await applySemanticCandidateScores(['X'], [], [], {
        enabled: true,
        embed: semanticTestEmbed,
      }),
    ).toMatchObject({ used: false });
    expect(
      await applySemanticCandidateScores(['***'], lista, ['M+ LALIGA'], {
        enabled: true,
        embed: semanticTestEmbed,
        cache: new Map(),
      }),
    ).toMatchObject({ used: false, catalogSize: 1 });
  });

  it('una promoción que no mejora la puntuación solo anota la similitud', async () => {
    const result = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [candidate(ID_A, 'Champions --> ELCANO', { score: 100, alias: 'UCL' })],
      ['M+ LALIGA'],
      { enabled: true, embed: semanticTestEmbed, cache: new Map() },
    );
    expect(result.candidates[0]).toMatchObject({ score: 100, semanticSimilarity: 1 });
    expect(result.candidates[0]).not.toHaveProperty('semantic');
  });
});

describe('T-081 · la IA no promociona a ciegas cuando no hay rival con quien contrastar (B-168)', () => {
  const embed =
    (mapa: Record<string, number[]>) =>
    async (textos: string[]): Promise<number[][]> =>
      textos.map((texto) => mapa[texto] || vector(1.2));

  it('0,84 sin rival no basta; 0,99 sí', async () => {
    const flojo = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [candidate('a'.repeat(40), 'algo parecido', { soloFamilia: true })],
      [],
      {
        enabled: true,
        cache: new Map(),
        embed: embed({ 'liga campeones': vector(0), 'algo parecido': conSimilitud(0.84) }),
      },
    );
    expect(flojo.candidates[0]?.score).toBe(0);
    expect(flojo.candidates[0]).not.toHaveProperty('semantic');

    const identico = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [candidate('b'.repeat(40), 'liga campeones elcano', { soloFamilia: true })],
      [],
      {
        enabled: true,
        cache: new Map(),
        embed: embed({ 'liga campeones': vector(0), 'liga campeones elcano': conSimilitud(0.99) }),
      },
    );
    expect(identico.candidates[0]).toHaveProperty('semantic', true);
  });
});

describe('T-082 · la IA nunca convierte el canal principal en el 2 (B-167)', () => {
  it('aunque la similitud sea 1', async () => {
    const salida = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [candidate('c'.repeat(40), 'LIGA DE CAMPEONES 2', { soloFamilia: true })],
      [],
      { enabled: true, cache: new Map(), embed: async (t: string[]) => t.map(() => vector(0)) },
    );
    expect(salida.candidates[0]?.score).toBe(0);
    expect(salida.candidates[0]).not.toHaveProperty('semantic');
  });
});

describe('T-084 · una promocion de la IA cuenta como canal exacto, y es a proposito (B-170)', () => {
  it('94 ≥ 92; 0,99 da el máximo y 0,91 no llega a exacto', () => {
    expect(SEMANTIC_MAX_SCORE).toBeGreaterThanOrEqual(RESOLUTION_EXACT_SCORE);
    expect(semanticScore(0.99)).toBe(SEMANTIC_MAX_SCORE);
    expect(semanticScore(0.91)).toBeLessThan(RESOLUTION_EXACT_SCORE);
    expect(semanticScore(0.87)).toBe(75);
    expect(semanticScore(0.5)).toBe(74);
  });
});

describe('T-086 · la marca paraguas conserva su familia aunque la IA este activa (B-172)', () => {
  it('ninguna hermana se promociona y la fusión sigue dando 3', async () => {
    const candidatos = ['DAZN 1 720p', 'DAZN 2 720p', 'DAZN 3 720p'].map((title, index) => ({
      id: String(index + 1)
        .repeat(40)
        .slice(0, 40),
      title,
      score: 78,
      source: 'm3u',
      availability: null,
      bitrate: null,
      soloFamilia: true,
    }));
    const salida = await applySemanticCandidateScores(['DAZN'], candidatos, [], {
      enabled: true,
      cache: new Map(),
      embed: async (t: string[]) => t.map(() => vector(0)),
    });
    expect(salida.candidates.every((c) => !('semantic' in c))).toBe(true);
    expect(mergeResolutionCandidates(salida.candidates)).toHaveLength(3);
  });
});

describe('T-100 · calentar el indice de IA tolera un lote fallido (B-165)', () => {
  it('solo se pierde el lote que falló y la siguiente vez se pide lo que falta', async () => {
    const cache = new Map<string, unknown>();
    let llamadas = 0;
    const embed = async (batch: string[]): Promise<number[][]> => {
      llamadas += 1;
      if (llamadas === 1) throw new Error('ollama_timeout');
      return batch.map(() => [1, 0, 0]);
    };
    const resultado = await semanticWarmEmbeddings(['a', 'b', 'c', 'd', 'e'], {
      cache,
      embed,
      batchSize: 2,
    });
    expect(resultado.requested).toBe(5);
    expect(resultado.failed).toBe(2);
    expect(resultado.error).toBe('ollama_timeout');
    expect(cache.size).toBe(3);
    const segunda = await semanticWarmEmbeddings(['a', 'b', 'c', 'd', 'e'], {
      cache,
      embed,
      batchSize: 2,
    });
    expect(segunda.requested).toBe(2);
    expect(segunda.failed).toBe(0);
  });

  it('una respuesta con otra cantidad de vectores cuenta como lote fallido', async () => {
    const result = await semanticWarmEmbeddings(['x', 'y'], {
      cache: new Map(),
      embed: async () => [[1, 0]],
    });
    expect(result).toEqual({ total: 2, requested: 2, failed: 2, error: 'ollama_bad_response' });
    expect(await semanticWarmEmbeddings('no es lista')).toMatchObject({ total: 0, error: null });
  });
});

describe('Piezas de la IA', () => {
  it('cosineSimilarity: -1 si los vectores no valen', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1], [1])).toBe(-1);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(-1);
    expect(cosineSimilarity([1, 'x'], [1, 0])).toBe(-1);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(-1);
    expect(cosineSimilarity(null, [1, 0])).toBe(-1);
  });

  it('un lote fallido en la resolución deja la IA sin usar y explica por qué', async () => {
    const result = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [candidate(ID_A, 'UCL')],
      [],
      { enabled: true, cache: new Map(), embed: async () => [[1, 0]] },
    );
    expect(result).toMatchObject({ used: false, error: 'ollama_bad_response', catalogSize: 1 });
    const sinMensaje = await applySemanticCandidateScores(
      ['M+ Liga de Campeones'],
      [candidate(ID_A, 'UCL')],
      [],
      {
        enabled: true,
        cache: new Map(),
        embed: async () => {
          throw new Error('');
        },
      },
    );
    expect(sinMensaje.error).toBe('ollama_unavailable');
  });

  it('LRU: el Map suelto desaloja el más antiguo al pasar de 2400', () => {
    const map = new Map<string, unknown>();
    const store = asVectorStore(map);
    for (let index = 0; index <= OLLAMA_EMBED_CACHE_MAX; index += 1)
      store.remember(`k${index}`, [1, 0]);
    expect(map.size).toBe(OLLAMA_EMBED_CACHE_MAX);
    expect(map.has('k0')).toBe(false);
    store.remember('', [1, 0]);
    store.remember('corto', [1]);
    expect(store.has('corto')).toBe(false);
    expect(store.get('k1')).toEqual([1, 0]);
  });

  it('LRU con reserva: los canales programados no salen antes que la biblioteca (§8.5.24)', () => {
    const cache = new SemanticVectorCache(3);
    cache.remember('liga campeones', [1, 0]);
    cache.remember('laliga', [0, 1]);
    cache.reserve(['liga campeones', 'laliga']);
    cache.remember('biblioteca 1', [1, 1]);
    cache.remember('biblioteca 2', [1, 1]);
    expect(cache.keys()).toEqual(['liga campeones', 'laliga', 'biblioteca 2']);
    // si todo es programación, sale el más antiguo de ella
    cache.reserve(['liga campeones', 'laliga', 'biblioteca 2', 'nuevo']);
    cache.remember('nuevo', [1, 1]);
    expect(cache.size).toBe(3);
    expect(cache.has('liga campeones')).toBe(false);
    cache.remember('', [1, 0]);
    expect(cache.get('nada')).toBeUndefined();
  });

  it('semanticLibraryTexts: directorios (o `web`), favoritos, historial y alias', () => {
    expect(
      semanticLibraryTexts({
        webSources: [{ streams: [item(ID_A, 'M+ Liga de Campeones', { alias: 'UCL HD' })] }],
        favorites: [item(ID_B, 'DAZN 1')],
        history: [item(ID_C, '')],
      }),
    ).toEqual(['liga campeones', 'ucl', 'dazn']);
    expect(semanticLibraryTexts({ web: [item(ID_A, 'GOL Play')] })).toEqual(['gol play']);
    expect(semanticLibraryTexts(null)).toEqual([]);
  });
});

describe('Cliente de Ollama (server.js:664-696)', () => {
  const texts = ['liga campeones', 'laliga'];

  function client(response: () => Promise<Response> | Response, clock = new FakeClock()) {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response());
    const embed = createOllamaEmbedder({
      baseUrl: 'http://ollama.test:11434',
      model: 'embeddinggemma:300m-qat-q4_0',
      timeoutMs: 6500,
      clock,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    return { embed, fetch, clock };
  }

  it('POST /api/embed con modelo, textos, truncate y keep_alive', async () => {
    const { embed, fetch } = client(
      () =>
        new Response(
          JSON.stringify({
            embeddings: [
              [1, 0],
              [0, 1],
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await embed(texts)).toEqual([
      [1, 0],
      [0, 1],
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://ollama.test:11434/api/embed');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'embeddinggemma:300m-qat-q4_0',
      input: texts,
      truncate: true,
      keep_alive: '2m',
    });
  });

  it.each([
    ['500', () => new Response('{}', { status: 500 }), 'ollama_unavailable'],
    ['no JSON', () => new Response('<html>', { status: 200 }), 'ollama_bad_response'],
    ['otra cantidad', () => new Response('{"embeddings":[[1,0]]}'), 'ollama_bad_response'],
    ['sin embeddings', () => new Response('null'), 'ollama_bad_response'],
    [
      'demasiado grande',
      () => new Response('x'.repeat(24 * 1024 * 1024 + 1)),
      'ollama_response_too_large',
    ],
    [
      'red caída',
      () => {
        throw new TypeError('fetch failed');
      },
      'ollama_unavailable',
    ],
  ])('%s → %s', async (_caso, response, code) => {
    const { embed } = client(response);
    await expect(embed(texts)).rejects.toMatchObject({ code });
  });

  it('plazo OLLAMA_TIMEOUT_MS con el reloj inyectado: ollama_timeout', async () => {
    const clock = new FakeClock();
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const embed = createOllamaEmbedder({
      baseUrl: 'http://ollama.test:11434',
      model: 'm',
      timeoutMs: 6500,
      clock,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const pending = embed(texts);
    clock.advance(6500);
    await expect(pending).rejects.toMatchObject({ code: 'ollama_timeout' });
    expect(clock.pendingTimers()).toBe(0);
  });
});

describe('Calentado de la programación en el servicio (server.js:2699-2716)', () => {
  const OLLAMA = { OLLAMA_BASE_URL: 'http://ollama.test:11434' };

  it('con Ollama, cada agenda nueva calienta canales y biblioteca una vez por firma', async () => {
    const embed = vi.fn(semanticTestEmbed);
    const { football } = createFootball({
      env: OLLAMA,
      embed,
      net: { [FLTV_URL]: fixture('futbolenlatv.html') },
    });
    expect(football.healthInfo().aiEnabled).toBe(true);
    await football.schedule();
    await football.idle();
    expect(embed).toHaveBeenCalledTimes(1);
    const pedidos = embed.mock.calls[0]![0];
    expect(pedidos).toEqual(
      expect.arrayContaining(['liga campeones', 'dazn laliga', 'laliga hdr', 'original']),
    );
    // misma firma: no se vuelve a pedir nada
    const demo = createFootball({ env: { ...OLLAMA, FOOTBALL_DEMO_ONLY: 'true' }, embed });
    await demo.football.schedule();
    await demo.football.idle();
    await demo.football.schedule();
    await demo.football.idle();
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('un índice parcial o un embed que revienta no rompen la agenda y se reintenta', async () => {
    const embed = vi
      .fn<(texts: string[]) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('ollama_timeout'))
      .mockImplementation(semanticTestEmbed);
    const { football } = createFootball({
      env: { ...OLLAMA, FOOTBALL_DEMO_ONLY: 'true' },
      embed,
    });
    await football.schedule();
    await football.idle();
    await football.schedule();
    await football.idle();
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('sin Ollama no se calienta nada ni se llama a embed', async () => {
    const embed = vi.fn(semanticTestEmbed);
    const { football } = createFootball({ env: { FOOTBALL_DEMO_ONLY: 'true' }, embed });
    await football.schedule();
    await football.idle();
    expect(embed).not.toHaveBeenCalled();
  });

  it('el embebedor por defecto usa `ollamaFetch` con la URL de la configuración', async () => {
    const ollamaFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            embeddings: [
              [1, 0],
              [0, 1],
              [1, 1],
              [0, 0.5],
              [0.5, 0],
              [1, 2],
              [2, 1],
              [3, 1],
              [1, 3],
              [2, 2],
            ],
          }),
        ),
    );
    const { football } = createFootball({
      env: { ...OLLAMA, FOOTBALL_DEMO_ONLY: 'true' },
      ollamaFetch: ollamaFetch as unknown as typeof fetch,
    });
    await football.schedule();
    await football.idle();
    expect(ollamaFetch).toHaveBeenCalled();
    expect(String((ollamaFetch.mock.calls[0] as unknown[])[0])).toBe(
      'http://ollama.test:11434/api/embed',
    );
  });
});
