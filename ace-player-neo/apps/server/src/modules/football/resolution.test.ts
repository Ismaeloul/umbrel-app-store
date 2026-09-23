/* Resolución de un partido a fuentes (server.js:3655-4335; api.md §4.9;
   B-147 a B-181, B-213, B-214, B-231). Los T-xxx llaman a la exportación
   antigua `resolveFootballChannel(estado, canales, buscador, opciones)`; el
   servicio se prueba aparte con sus dependencias falsas. */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLTV_URL } from './constants.js';
import {
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  aceSearchQueries,
  canalEsGenerico,
  mergeResolutionCandidates,
  resolutionChannels,
  resolutionTier,
  resolveFootballChannel,
  scoreResolutionCandidate,
} from './legacy-exports.js';
import {
  ID_A,
  ID_B,
  ID_C,
  createFootball,
  fixture,
  item,
  makeState,
  semanticTestEmbed,
  withStreams,
} from './test-support.js';

const ID_D = 'd'.repeat(40);
const ID_E = 'e'.repeat(40);
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';

/** `cand` de tests/server.test.js:1075-1078. */
const cand = (id: number, source: string, extra: Record<string, unknown> = {}) => ({
  id: String(id).padStart(40, '0'),
  title: 'Liga de Campeones',
  score: 100,
  source,
  availability: null,
  bitrate: null,
  soloFamilia: false,
  ...extra,
});

function source(id: string, streams: Record<string, unknown>[]) {
  return {
    id,
    name: id,
    url: `https://example.com/${id}.m3u`,
    type: 'm3u',
    streams: streams.map((stream) => item(String(stream.id), String(stream.title), stream)),
    renames: {},
    hidden: [],
    syncedAt: '2026-01-01T00:00:00.000Z',
    lastErrorAt: null,
    lastError: null,
  };
}

describe('T-009 · reune fuentes de todas las capas aunque la biblioteca ya acierte (B-147)', () => {
  it('pregunta al buscador y devuelve las de la lista y la del motor', async () => {
    const state = withStreams([
      { id: ID_A, title: 'DAZN LaLiga 1080p' },
      { id: ID_B, title: 'DAZN LaLiga 720p' },
    ]);
    let consultado = false;
    const result = await resolveFootballChannel(state, ['DAZN LaLiga'], async () => {
      consultado = true;
      return [{ id: ID_C, title: 'DAZN LaLiga', ih: true, availability: 40 }];
    });
    expect(consultado).toBe(true);
    expect(result.status).toBe('found');
    const ids = result.candidates.map((candidate) => candidate.id);
    expect(ids).toEqual(expect.arrayContaining([ID_A, ID_B, ID_C]));
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(result.success).toBe(true);
  });
});

describe('T-010 · resuelve todas las grafias reales de Champions y deja AceStream al final (B-042, B-159)', () => {
  it('todas a 100 y en orden m3u, favoritos, historial y buscador', async () => {
    const state = makeState({
      webSources: [
        source('principal', [{ id: ID_D, title: 'M+ Liga de Campeones 1080p *' }]),
        source('new-era', [{ id: ID_E, title: 'LIGA DE CAMPEONES FHD → NEW ERA' }]),
        source('elcano', [{ id: 'f'.repeat(40), title: 'M. Liga de Campeones -> ELCANO' }]),
      ],
      favorites: [item('1'.repeat(40), 'Liga de Campeones', { type: 'fav' })],
      history: [item('2'.repeat(40), 'Movistar Plus Liga de Campeones', { type: 'recent' })],
    });
    const result = await resolveFootballChannel(state, ['M+ Liga de Campeones'], async () => [
      { id: '3'.repeat(40), title: 'LIGA DE CAMPEONES => NEW ERA', ih: true, availability: 0.82 },
    ]);
    expect(result.status).toBe('found');
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      'm3u',
      'm3u',
      'm3u',
      'favorites',
      'history',
      'acestream',
    ]);
    expect(result.candidates.every((candidate) => candidate.score === 100)).toBe(true);
    expect(result.candidate?.source).toBe('m3u');
  });
});

describe('T-011 · con dos canales del mismo partido reproduce el mejor y ofrece los dos (B-157)', () => {
  it('found (no choices) con los dos canales como fuentes', async () => {
    const state = withStreams([
      { id: ID_A, title: 'M+ Liga de Campeones 1080p' },
      { id: ID_B, title: 'LaLiga TV Bar 1080p' },
    ]);
    const result = await resolveFootballChannel(
      state,
      ['M+ Liga de Campeones', 'LaLiga TV Bar'],
      async () => [],
    );
    expect(result.status).toBe('found');
    expect(result.candidate).toBeTruthy();
    expect(result.candidates).toHaveLength(2);
  });
});

describe('T-012 · un canal de otra competicion no entra como fuente del partido (B-161, B-162)', () => {
  it('entra la de Champions por su alias; la de Segunda no', async () => {
    const state = withStreams([
      { id: ID_A, title: 'LIGA DE CAMPEONES --> SPORT TV', alias: 'M+ Liga de Campeones HD' },
      { id: ID_B, title: 'HYPERMOTION --> ELCANO', alias: 'LaLiga TV Hypermotion HD' },
    ]);
    const result = await resolveFootballChannel(state, ['M+ Liga de Campeones'], async () => []);
    const titulos = result.candidates.map((candidate) => candidate.title);
    expect(titulos.some((title) => /CAMPEONES/.test(title))).toBe(true);
    expect(titulos.some((title) => /HYPERMOTION/i.test(title))).toBe(false);
    expect(result.candidates[0]?.alias).toBe('M+ Liga de Campeones HD');
  });
});

describe('T-021 · el resolver usa la IA para rescatar nombres raros y amplia la consulta de AceStream (B-165, B-213)', () => {
  it('rescata "UCL Principal --> ELCANO" y busca también sin operador', async () => {
    const state = withStreams([
      { id: ID_A, title: 'UCL Principal --> ELCANO' },
      { id: ID_B, title: 'HYPERMOTION --> NEW ERA' },
    ]);
    const queries: string[] = [];
    const result = await resolveFootballChannel(
      state,
      ['M+ Liga de Campeones'],
      async (query) => {
        queries.push(query);
        return [];
      },
      {
        programChannels: ['M+ Liga de Campeones', 'M+ LALIGA', 'LaLiga TV Hypermotion'],
        semantic: { enabled: true, embed: semanticTestEmbed, cache: new Map() },
      },
    );
    expect(result.status).toBe('found');
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([ID_A]);
    expect(result.candidates[0]?.semantic).toBe(true);
    expect(queries).toContain('M+ Liga de Campeones');
    expect(queries).toContain('liga de campeones');
    expect(result.ai).toMatchObject({
      enabled: true,
      used: true,
      model: 'embeddinggemma:300m-qat-q4_0',
    });
    expect(result.checked).toEqual(['saved', 'm3u', 'library', 'acestream', 'ai-programming']);
  });

  it('aceSearchQueries: 8 como mucho, sin repetir y de 2 letras o más', () => {
    const muchos = Array.from({ length: 12 }, (_, index) => `Canal ${index + 1}`);
    expect(aceSearchQueries(muchos)).toHaveLength(8);
    expect(aceSearchQueries(muchos, true)).toHaveLength(8);
    expect(aceSearchQueries(['M+ LALIGA', 'Movistar LaLiga', 'x', ''])).toEqual(['M+ LALIGA']);
  });
});

describe('T-022 · si Ollama falla la busqueda clasica sigue funcionando (B-169)', () => {
  it('found con la clásica, `ai.used` falso y el error', async () => {
    const state = withStreams([{ id: ID_A, title: 'M+ Liga de Campeones FHD' }]);
    const result = await resolveFootballChannel(state, ['M+ Liga de Campeones'], async () => [], {
      programChannels: ['M+ Liga de Campeones'],
      semantic: {
        enabled: true,
        embed: async () => {
          throw new Error('ollama_offline');
        },
        cache: new Map(),
      },
    });
    expect(result.status).toBe('found');
    expect(result.candidate?.id).toBe(ID_A);
    expect(result.ai.used).toBe(false);
    expect(result.ai.error).toBe('ollama_offline');
  });
});

describe('T-026 · elige el canal exacto del M3U, pero ya SI consulta tambien el motor (B-147)', () => {
  it('candidato de la lista y buscador consultado', async () => {
    const state = makeState();
    const streams = [item(ID_C, 'DAZN LaLiga 1080p', { category: 'Deportes' })];
    const saved = { ...state, webSources: [{ ...state.webSources[0]!, streams }], web: streams };
    let searched = false;
    const result = await resolveFootballChannel(saved, ['DAZN LaLiga'], async () => {
      searched = true;
      return [];
    });
    expect(result.status).toBe('found');
    expect(result.candidate?.id).toBe(ID_C);
    expect(searched).toBe(true);
    expect(result.candidate?.source).toBe('m3u');
  });
});

describe('T-028 · explica que no hay resultado cuando fallan biblioteca y buscador (B-148)', () => {
  it('not_found sin motor y las capas consultadas', async () => {
    const result = await resolveFootballChannel(makeState(), ['Amazon Prime Video'], async () => {
      throw new Error('engine_unavailable');
    });
    expect(result.status).toBe('not_found');
    expect(result.engineAvailable).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.checked).toEqual(['saved', 'm3u', 'library', 'acestream']);
    expect(result).not.toHaveProperty('candidate');
    expect(result.ai).toEqual({
      enabled: false,
      used: false,
      model: null,
      catalogSize: 0,
      error: null,
    });
  });

  it('sin buscador en la fachada, el motor cuenta como no disponible', async () => {
    const result = await resolveFootballChannel(makeState(), ['Amazon Prime Video']);
    expect(result.engineAvailable).toBe(false);
  });

  it('sin canales tras limpiar: channel_required', async () => {
    await expect(resolveFootballChannel(makeState(), ['  ', '***'])).rejects.toMatchObject({
      code: 'channel_required',
    });
    await expect(resolveFootballChannel(null, 'DAZN', async () => [])).resolves.toMatchObject({
      status: 'not_found',
      channels: ['DAZN'],
    });
  });
});

describe('T-029 · pide elegir cuando el buscador devuelve varias señales ambiguas (B-156)', () => {
  it('choices con las dos del buscador', async () => {
    const result = await resolveFootballChannel(makeState(), ['DAZN'], async () => [
      { id: ID_A, title: 'DAZN Eventos', ih: true, availability: 30 },
      { id: ID_B, title: 'DAZN Deportes', ih: true, availability: 20 },
    ]);
    expect(result.status).toBe('choices');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.ih === true)).toBe(true);
  });
});

describe('T-056 · si existe el canal exacto, no se ofrecen sus hermanas numeradas (B-154)', () => {
  it('solo queda el principal', () => {
    const biblioteca = [
      { id: '1'.repeat(40), title: 'M+ Liga de Campeones 1080p' },
      { id: '2'.repeat(40), title: 'M+ Liga de Campeones 2 1080p' },
      { id: '3'.repeat(40), title: 'M+ Liga de Campeones 3 1080p' },
    ];
    const candidatos = biblioteca
      .map((entry) => scoreResolutionCandidate(['M+ Liga de Campeones'], entry, 'm3u'))
      .filter((candidate) => candidate.score >= 70);
    const ofrecidas = mergeResolutionCandidates(candidatos);
    expect(ofrecidas).toHaveLength(1);
    expect(ofrecidas[0]?.title).toBe('M+ Liga de Campeones 1080p');
  });
});

describe('T-057 · un dial distinto no sustituye al canal principal aunque este no aparezca (B-154)', () => {
  it('la familia de un canal principal nunca lo sustituye', () => {
    const biblioteca = [
      { id: '2'.repeat(40), title: 'M+ Liga de Campeones 2 1080p' },
      { id: '3'.repeat(40), title: 'M+ Liga de Campeones 3 1080p' },
      { id: '4'.repeat(40), title: 'M+ LALIGA 2 FHD' },
    ];
    const candidatos = biblioteca
      .flatMap((entry) => [
        scoreResolutionCandidate(['M+ Liga de Campeones'], entry, 'm3u'),
        scoreResolutionCandidate(['M+ LALIGA'], entry, 'm3u'),
      ])
      .filter((candidate) => candidate.score >= 70);
    expect(mergeResolutionCandidates(candidatos)).toEqual([]);
  });
});

describe('T-058 · si NO existe el canal exacto, la familia es lo unico que hay (B-153, B-154)', () => {
  it('pidiendo "DAZN" se ofrecen DAZN 1, 2 y 3', () => {
    const biblioteca = [
      { id: '1'.repeat(40), title: 'DAZN 1 720p' },
      { id: '2'.repeat(40), title: 'DAZN 2 720p' },
      { id: '3'.repeat(40), title: 'DAZN 3 720p' },
    ];
    const candidatos = biblioteca
      .map((entry) => scoreResolutionCandidate(['DAZN'], entry, 'm3u'))
      .filter((candidate) => candidate.score >= 70);
    const ofrecidas = mergeResolutionCandidates(candidatos);
    expect(ofrecidas).toHaveLength(3);
    expect(ofrecidas.every((candidate) => candidate.soloFamilia)).toBe(true);
    expect(ofrecidas.every((candidate) => candidate.familyFallbackAllowed)).toBe(true);
  });
});

describe('T-065 · las listas importadas van por delante del buscador del motor (B-042)', () => {
  it('m3u sin disponibilidad antes que acestream con 1', () => {
    const salida = mergeResolutionCandidates([
      cand(1, 'acestream', { availability: 1 }),
      cand(2, 'm3u'),
    ]);
    expect(salida[0]?.source).toBe('m3u');
    expect(salida[1]?.source).toBe('acestream');
  });
});

describe('T-066 · la prioridad completa es guardada, M3U, favorito, historial y buscador (B-042)', () => {
  it('saved, m3u, m3u, favorites, history, acestream', () => {
    const salida = mergeResolutionCandidates([
      cand(1, 'history'),
      cand(2, 'acestream', { availability: 1 }),
      cand(3, 'favorites'),
      cand(4, 'm3u', { listaId: 'new-era' }),
      cand(5, 'saved'),
      cand(6, 'm3u', { listaId: 'elcano' }),
    ]);
    expect(salida.map((candidate) => candidate.source)).toEqual([
      'saved',
      'm3u',
      'm3u',
      'favorites',
      'history',
      'acestream',
    ]);
  });
});

describe('T-067 · Rebuscar prioriza favorito, directorio y buscador publico (B-214)', () => {
  it('favorites, m3u, acestream; sin vínculos ni historial', async () => {
    const state = makeState({
      channelBindings: [
        { channel: 'M+ Liga de Campeones', id: ID_C, title: 'Vinculo antiguo', ih: false },
      ],
      favorites: [item(ID_A, 'M+ Liga de Campeones', { type: 'fav' })],
      webSources: [source('directorio', [{ id: ID_B, title: 'LIGA DE CAMPEONES --> ELCANO' }])],
      history: [item(ID_D, 'M+ Liga de Campeones', { type: 'recent' })],
    });
    const queries: string[] = [];
    const result = await resolveFootballChannel(
      state,
      ['M+ Liga de Campeones'],
      async (query) => {
        queries.push(query);
        return [
          {
            id: ID_E,
            title: 'MOVISTAR LIGA DE CAMPEONES → PUBLIC ACE',
            ih: true,
            availability: 0.8,
          },
        ];
      },
      { mode: 'research', semantic: { enabled: false } },
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(result.checked).toEqual(['favorites', 'm3u', 'acestream']);
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      'favorites',
      'm3u',
      'acestream',
    ]);
    expect(result.candidate?.source).toBe('favorites');
    expect(result.candidates.some((candidate) => [ID_C, ID_D].includes(candidate.id))).toBe(false);
    expect(result.research).toBe(true);
  });
});

describe('T-068 · la prioridad de Rebuscar conserva Favoritos si un hash tambien esta en el M3U (B-214)', () => {
  it('el mismo hash se queda como favorites', () => {
    const salida = mergeResolutionCandidates(
      [cand(1, 'm3u'), cand(1, 'favorites'), cand(2, 'acestream', { availability: 0.9 })],
      { sourceOrder: ['favorites', 'm3u', 'acestream'] },
    );
    expect(salida.map((candidate) => candidate.source)).toEqual(['favorites', 'acestream']);
  });
});

describe('T-069 · un vinculo confirmado a mano manda sobre todo lo demas (B-042)', () => {
  it('saved primero', () => {
    const salida = mergeResolutionCandidates([
      cand(1, 'm3u'),
      cand(2, 'acestream', { availability: 1 }),
      cand(3, 'saved'),
    ]);
    expect(salida[0]?.source).toBe('saved');
  });
});

describe('T-070 · van todas: las tuyas primero y las del buscador detras (B-039, B-042)', () => {
  it('25 de 25, las 20 de la lista delante', () => {
    const mias = Array.from({ length: 20 }, (_, index) => cand(index + 1, 'm3u'));
    const suyas = Array.from({ length: 5 }, (_, index) =>
      cand(100 + index, 'acestream', { availability: 0.9 }),
    );
    const salida = mergeResolutionCandidates([...mias, ...suyas]);
    expect(salida).toHaveLength(25);
    expect(salida.slice(0, 20).every((candidate) => candidate.source === 'm3u')).toBe(true);
    expect(salida.slice(20).every((candidate) => candidate.source === 'acestream')).toBe(true);
  });
});

describe('T-071 · un vinculo guardado no borra la familia del canal (B-155)', () => {
  it('el vínculo no cuenta como canal exacto', () => {
    const candidatos = [
      { ...cand(1, 'saved'), title: 'DAZN', score: 100, soloFamilia: false },
      { ...cand(2, 'm3u'), title: 'DAZN 1', score: 78, soloFamilia: true },
      { ...cand(3, 'm3u'), title: 'DAZN 2', score: 78, soloFamilia: true },
    ];
    expect(mergeResolutionCandidates(candidatos)).toHaveLength(3);
  });
});

describe('T-085 · un acierto de la IA descarta la familia; uno flojo no (B-171)', () => {
  it('94 suprime la familia; 88 no', () => {
    const base = (id: string, extra: Record<string, unknown>) => ({
      id: id.repeat(40).slice(0, 40),
      title: 'Canal',
      source: 'm3u',
      availability: null,
      bitrate: null,
      soloFamilia: false,
      score: 0,
      ...extra,
    });
    const familia = base('f', { soloFamilia: true, score: 78 });
    const conAcierto = mergeResolutionCandidates([
      base('a', { score: SEMANTIC_MAX_SCORE, semantic: true }),
      familia,
    ]);
    expect(conAcierto.some((candidate) => candidate.soloFamilia)).toBe(false);
    const conFlojo = mergeResolutionCandidates([base('b', { score: 88, semantic: true }), familia]);
    expect(conFlojo.some((candidate) => candidate.soloFamilia)).toBe(true);
  });
});

describe('T-087 · el umbral de canal exacto esta nombrado, no repetido a mano (B-170)', () => {
  it('ningún 92 a pelo en comparaciones del módulo y la constante en todos sus usos', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(here).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    const code = files.map((name) => readFileSync(path.join(here, name), 'utf8')).join('\n');
    expect(code).not.toMatch(/(?:>=|<=|>|<|===|==)\s*92\b/);
    expect(code).not.toMatch(/\b92\s*(?:>=|<=|>|<)/);
    // resolución (vínculos, cabeza, mínimo del vínculo) e IA (catálogo y canal pedido)
    expect(code.split('RESOLUTION_EXACT_SCORE').length - 1).toBeGreaterThanOrEqual(6);
    expect(RESOLUTION_EXACT_SCORE).toBe(92);
    expect(resolutionTier({ score: RESOLUTION_EXACT_SCORE })).toBe(2);
    expect(resolutionTier({ score: 70 })).toBe(1);
    expect(resolutionTier({ score: 69 })).toBe(0);
  });
});

describe('T-095 · un canal pedido es generico si sus palabras caben dentro de otro (B-174)', () => {
  it('"DAZN" es la marca de "DAZN LaLiga"; sin alternativa, no', () => {
    const pedidos = ['DAZN LaLiga', 'DAZN', 'LaLiga TV Bar'];
    expect(canalEsGenerico('DAZN', pedidos)).toBe(true);
    expect(canalEsGenerico('DAZN LaLiga', pedidos)).toBe(false);
    expect(canalEsGenerico('LaLiga TV Bar', pedidos)).toBe(false);
    expect(canalEsGenerico('DAZN', ['DAZN'])).toBe(false);
    expect(canalEsGenerico('DAZN', ['DAZN', 'LaLiga TV Bar'])).toBe(false);
  });
});

describe('T-096 · un vinculo sobre la marca no adelanta al canal concreto (B-174)', () => {
  it('primero el canal donde dan el partido; la marca se aparta, no se tira', () => {
    const pedidos = ['DAZN LaLiga', 'DAZN', 'LaLiga TV Bar'];
    const fuente = (id: number, title: string, matchedChannel: string, from: string) => ({
      id: String(id).repeat(40).slice(0, 40),
      title,
      matchedChannel,
      source: from,
      score: 100,
      availability: null,
      bitrate: null,
      soloFamilia: false,
    });
    const salida = mergeResolutionCandidates(
      [
        fuente(1, 'DAZN 1 720p', 'DAZN', 'saved'),
        fuente(2, 'DAZN LaLiga 720p', 'DAZN LaLiga', 'm3u'),
      ],
      { requestedChannels: pedidos },
    );
    expect(salida[0]?.title).toBe('DAZN LaLiga 720p');
    expect(salida).toHaveLength(2);
  });
});

describe('T-097 · si el partido solo se anuncia por la marca, la marca vale (B-175)', () => {
  it('no se aparta nada sin alternativa concreta', () => {
    const fuente = (id: number, title: string) => ({
      id: String(id).repeat(40).slice(0, 40),
      title,
      matchedChannel: 'DAZN',
      source: 'm3u',
      score: 100,
      availability: null,
      bitrate: null,
      soloFamilia: false,
    });
    const salida = mergeResolutionCandidates([fuente(1, 'DAZN 1 720p'), fuente(2, 'DAZN 2 720p')], {
      requestedChannels: ['DAZN'],
    });
    expect(salida).toHaveLength(2);
  });
});

describe('T-098 · las coletillas de calidad no convierten un canal en la marca (B-176)', () => {
  it('HDR, Bar y la calidad no hacen más concreto; la marca de verdad sí es genérica', () => {
    expect(canalEsGenerico('M+ LALIGA', ['M+ LALIGA', 'M+ LALIGA HDR'])).toBe(false);
    expect(canalEsGenerico('DAZN 1', ['DAZN 1', 'DAZN 1 Bar'])).toBe(false);
    expect(canalEsGenerico('LaLiga TV', ['LaLiga TV', 'LaLiga TV Bar'])).toBe(false);
    expect(canalEsGenerico('DAZN', ['DAZN', 'DAZN LaLiga'])).toBe(true);
    expect(canalEsGenerico('DAZN', ['DAZN', 'DAZN 1'])).toBe(true);
  });
});

describe('T-099 · un vinculo sobre la marca no decide el canal cuando otro anunciado tiene señal exacta (B-177, B-178)', () => {
  const estado = makeState({
    favorites: [],
    history: [],
    webSources: [
      source('principal', [
        { id: ID_B, title: 'M+ LALIGA --> ELCANO' },
        { id: ID_C, title: 'DAZN 1 --> ELCANO' },
      ]),
    ],
    channelBindings: [
      {
        channel: 'DAZN',
        channelKey: 'dazn',
        id: ID_A,
        title: 'DAZN 1 720p',
        ih: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  const sinBuscador = async () => [];
  const off = { semantic: { enabled: false } };

  it('M+ LALIGA arranca y el vínculo de la marca se aparta sin tirarse', async () => {
    const laliga = await resolveFootballChannel(
      estado,
      ['M+ LALIGA', 'M+ LALIGA HDR', 'DAZN', 'DAZN App Gratis'],
      sinBuscador,
      off,
    );
    expect(laliga.status).toBe('found');
    expect(laliga.candidate?.id).toBe(ID_B);
    expect(laliga.candidates[0]?.id).toBe(ID_B);
    expect(laliga.candidates.some((candidate) => candidate.id === ID_A)).toBe(true);
  });

  it('solo por la marca, el vínculo sigue mandando', async () => {
    const soloMarca = await resolveFootballChannel(
      estado,
      ['DAZN', 'LaLiga TV M3'],
      sinBuscador,
      off,
    );
    expect(soloMarca.candidate?.id).toBe(ID_A);
    expect(soloMarca.candidate?.source).toBe('saved');
  });

  it('si el canal del vínculo está anunciado tal cual, también', async () => {
    const anunciado = await resolveFootballChannel(estado, ['DAZN 1', 'DAZN'], sinBuscador, off);
    expect(anunciado.candidates[0]?.matchedChannel).toBe('DAZN 1');
  });
});

describe('T-113 · los rotulos de calidad no gastan el tope de canales por partido (B-179)', () => {
  it('la variante se fusiona quedándose el rótulo más corto; 12 se quedan en 8', () => {
    expect(
      resolutionChannels([
        'M+ LALIGA HDR',
        'M+ LALIGA',
        'DAZN',
        'DAZN App Gratis',
        'LaLiga TV Bar',
        'Gol Play',
      ]),
    ).toEqual(['M+ LALIGA', 'DAZN', 'DAZN App Gratis', 'LaLiga TV Bar', 'Gol Play']);
    expect(resolutionChannels(Array.from({ length: 12 }, (_, i) => `Canal ${i + 1}`))).toHaveLength(
      8,
    );
    expect(resolutionChannels('M+ LALIGA')).toEqual(['M+ LALIGA']);
    expect(resolutionChannels(['M+ LALIGA', 'M+ LALIGA HDR'])).toEqual(['M+ LALIGA']);
  });
});

describe('T-114 · lo aprendido se aplica una sola vez y respeta la cuarentena (B-181)', () => {
  it('un vínculo guardado en cuarentena no aparece', async () => {
    const state = makeState({
      channelBindings: [
        {
          channel: 'DAZN',
          channelKey: 'dazn',
          id: ID_A,
          title: 'DAZN 1 720p',
          ih: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      sourceReports: [
        {
          reportId: 'r1',
          id: ID_A,
          title: 'DAZN 1 720p',
          ih: false,
          source: '',
          channel: 'DAZN',
          channelKey: 'dazn',
          matchId: '',
          reason: 'not_starting',
          state: 'failed',
          checkReason: '',
          reportCount: 1,
          reportedAt: '2026-01-01T00:00:00.000Z',
          lastCheckedAt: null,
          quarantineUntil: FAR_FUTURE,
        },
      ],
    });
    const result = await resolveFootballChannel(state, ['DAZN'], async () => [], {
      semantic: { enabled: false },
    });
    expect(result.candidates.some((candidate) => candidate.id === ID_A)).toBe(false);
  });

  it('una sola llamada a las reglas por resolución, y lo confirmado sube a 98 y pasa el corte', async () => {
    const { football, sources } = createFootball({
      state: withStreams([{ id: ID_A, title: 'DAZN Eventos' }], {
        channelFeedback: [
          {
            id: ID_A,
            title: 'DAZN Eventos',
            channel: 'DAZN',
            channelKey: 'dazn',
            verdict: 'correct',
            reason: 'wrong_channel',
            corrections: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    });
    const result = await football.resolve({ channel: 'DAZN' });
    expect(sources.applyLearnedRules).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('found');
    expect(result.candidate).toMatchObject({ id: ID_A, score: 98, learned: 'correct' });
  });
});

describe('Resolución del servicio (api.md §4.9; B-180, B-193, B-213, B-231; arquitectura §5.10)', () => {
  const partido = (football: Awaited<ReturnType<typeof createFootball>>['football']) =>
    football.schedule().then((schedule) => schedule.days[0]!.matches[1]!); // Madrid-City

  it('busca con `via: auto` (el comprobador si hay reproducción) y la señal del cliente', async () => {
    const { football, search } = createFootball({
      search: async () => [{ id: ID_C, title: 'M+ Liga de Campeones' }],
    });
    const controller = new AbortController();
    const result = await football.resolve(
      { channel: ['M+ Liga de Campeones'] },
      { signal: controller.signal },
    );
    expect(search.search).toHaveBeenCalledWith('M+ Liga de Campeones', {
      via: 'auto',
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: 'found', research: false, preheat: null, scan: null });
  });

  it('refresca las listas en segundo plano y aguanta que eso falle', async () => {
    const { football, directories } = createFootball();
    directories.refreshStaleInBackground.mockImplementationOnce(() => {
      throw new Error('not_implemented');
    });
    await football.resolve({ channel: 'Canal original' });
    await football.resolve({ channel: 'Canal original' });
    expect(directories.refreshStaleInBackground).toHaveBeenCalledTimes(2);
  });

  it('con `match` de la agenda usa sus canales y no los del cliente (B-231)', async () => {
    const { football, search } = createFootball({
      net: { [FLTV_URL]: fixture('futbolenlatv.html') },
    });
    const match = await partido(football);
    const result = await football.resolve({ match: match.id, channel: 'Otro canal' });
    expect(result.channels).toEqual(['M+ Liga de Campeones', 'Movistar Plus+']);
    expect(result.program).toMatchObject({
      id: match.id,
      competition: 'Champions League',
      channels: ['M+ Liga de Campeones', 'Movistar Plus+'],
      start: match.start,
    });
    expect(search.search).not.toHaveBeenCalledWith('Otro canal', expect.anything());
    expect(football.programChannels(match.id)).toEqual(['M+ Liga de Campeones', 'Movistar Plus+']);
  });

  it('un id viejo que ya no está en la agenda cae a los canales de la URL', async () => {
    const { football } = createFootball({ net: { [FLTV_URL]: fixture('futbolenlatv.html') } });
    await football.schedule();
    const result = await football.resolve({ match: 'fltv-2026-01-01-3', channel: 'Otro canal' });
    expect(result.channels).toEqual(['Otro canal']);
    expect(result.program).toBeNull();
  });

  it('lanza el comprobador con los candidatos, la clave de cliente y el partido', async () => {
    const { football, scanner } = createFootball({
      scanner: { enabled: true },
      net: { [FLTV_URL]: fixture('futbolenlatv.html') },
      state: withStreams([
        { id: ID_A, title: 'M+ Liga de Campeones' },
        { id: ID_B, title: 'LIGA DE CAMPEONES --> ELCANO', ih: true },
      ]),
    });
    const match = await partido(football);
    const result = await football.resolve({ match: match.id, client: 'tele-salón!' });
    expect(scanner.enqueue).toHaveBeenCalledWith({
      kind: 'interactive',
      candidates: [
        { id: ID_A, ih: false, title: 'M+ Liga de Campeones' },
        { id: ID_B, ih: true, title: 'LIGA DE CAMPEONES --> ELCANO' },
      ],
      clientKey: 'tele-saln',
      matchId: match.id,
      force: false,
      priority: true,
    });
    expect(result.scan).toMatchObject({
      statusUrl: `/api/football/scan?id=${result.scan?.id}`,
      total: 2,
    });
  });

  it('Rebuscar: forzado, `research` y la fuente actual al final si no estaba', async () => {
    const { football, scanner } = createFootball({
      scanner: { enabled: true },
      state: withStreams([{ id: ID_A, title: 'M+ Liga de Campeones' }], {
        favorites: [],
        history: [],
      }),
    });
    await football.resolve({
      channel: 'M+ Liga de Campeones',
      research: '1',
      current: `acestream://${ID_E}`,
      current_ih: '1',
    });
    expect(scanner.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'research',
        force: true,
        candidates: [
          { id: ID_A, ih: false, title: 'M+ Liga de Campeones' },
          { id: ID_E, ih: true },
        ],
      }),
    );
    // la actual ya estaba: no se repite; v1 usa `currentIh`
    await football.resolve({
      channel: 'M+ Liga de Campeones',
      research: '1',
      current: ID_A,
      currentIh: '1',
    });
    expect(scanner.enqueue.mock.lastCall?.[0].candidates).toHaveLength(1);
    // sin research, `current` no cuenta
    await football.resolve({ channel: 'M+ Liga de Campeones', current: ID_E });
    expect(scanner.enqueue.mock.lastCall?.[0].candidates).toHaveLength(1);
  });

  it('sin candidatos no se crea trabajo; si el comprobador revienta, `scan: null`', async () => {
    const { football, scanner } = createFootball({ scanner: { enabled: true } });
    expect((await football.resolve({ channel: 'Amazon Prime Video' })).scan).toBeNull();
    expect(scanner.enqueue).not.toHaveBeenCalled();
    scanner.enqueue.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect((await football.resolve({ channel: 'Canal original' })).scan).toBeNull();
  });

  it('sin canales: channel_required', async () => {
    const { football } = createFootball();
    await expect(football.resolve({})).rejects.toMatchObject({ code: 'channel_required' });
    await expect(football.resolve({ channel: [] })).rejects.toMatchObject({
      code: 'channel_required',
    });
  });

  it('con Ollama la resolución usa la IA con la parrilla de la agenda', async () => {
    const { football } = createFootball({
      env: { OLLAMA_BASE_URL: 'http://ollama.test:11434' },
      embed: semanticTestEmbed,
      net: { [FLTV_URL]: fixture('futbolenlatv.html') },
      state: withStreams([{ id: ID_A, title: 'UCL Principal --> ELCANO' }]),
    });
    const match = await partido(football);
    await football.idle();
    const result = await football.resolve({ match: match.id });
    // "Movistar Plus+" no tiene texto semántico (todo es operador): 4 canales en el catálogo
    expect(result.ai).toMatchObject({ enabled: true, used: true, catalogSize: 4 });
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([ID_A]);
    expect(result.checked).toContain('ai-programming');
  });
});
