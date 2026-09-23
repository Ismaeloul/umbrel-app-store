/* Orden y reparto de las señales (T-050 a T-055, T-064, T-092, T-093;
   B-035 a B-043, B-057, B-061) y contraste de mergeResolutionCandidates con
   la 0.6.59 sobre listas generadas. */

import { describe, expect, it } from 'vitest';
import { FAKE_CLOCK_EPOCH } from '../../core/clock.js';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import {
  canalEsGenerico,
  mergeResolutionCandidates,
  repartirEntreProveedores,
  resolutionTier,
  type RankableCandidate,
} from './ranking.js';
import { anotarResultado, normalizeSourceStats, proveedorDeSeñal } from './stats.js';

type AnyFn = (...args: unknown[]) => unknown;
const original = loadLegacyServer() as unknown as Record<string, AnyFn>;

const señal = (id: string, extra: Partial<RankableCandidate> = {}): RankableCandidate => ({
  id,
  title: 'DAZN 1',
  score: 100,
  source: 'm3u',
  availability: null,
  bitrate: null,
  ...extra,
});

const señalDe = (
  id: number,
  title: string,
  extra: Partial<RankableCandidate> = {},
): RankableCandidate => ({
  id: String(id).repeat(40).slice(0, 40),
  title,
  score: 100,
  source: 'm3u',
  availability: null,
  bitrate: null,
  soloFamilia: false,
  ...extra,
});

describe('señales muertas y vivas (B-035 a B-039)', () => {
  it('T-050 · una señal que el motor da por muerta no se ofrece', () => {
    const salida = mergeResolutionCandidates([
      señal('a'.repeat(40), { source: 'acestream', availability: 0 }),
      señal('b'.repeat(40), { source: 'acestream', availability: 0.9 }),
    ]);
    expect(salida).toHaveLength(1);
    expect(salida[0]?.id).toBe('b'.repeat(40));
  });

  it('T-051 · entre dos de la MISMA procedencia, primero la que esta viva', () => {
    const salida = mergeResolutionCandidates([
      señal('a'.repeat(40), { score: 100, source: 'acestream', availability: 0.2 }),
      señal('b'.repeat(40), { score: 100, source: 'acestream', availability: 0.8 }),
    ]);
    expect(salida[0]?.id).toBe('b'.repeat(40));
    expect(salida).toHaveLength(2);
  });

  it('T-052 · estar disponible no cuela un canal que no es', () => {
    const salida = mergeResolutionCandidates([
      señal('a'.repeat(40), { score: 100, availability: null }),
      señal('b'.repeat(40), { score: 72, source: 'acestream', availability: 1 }),
    ]);
    expect(salida[0]?.id).toBe('a'.repeat(40));
  });

  it('T-053 · un hash que llega por dos vias conserva su disponibilidad', () => {
    const salida = mergeResolutionCandidates([
      señal('c'.repeat(40), { source: 'm3u', availability: null }),
      señal('c'.repeat(40), { source: 'acestream', availability: 0.6, bitrate: 3500 }),
    ]);
    expect(salida).toHaveLength(1);
    expect(salida[0]?.source).toBe('m3u');
    expect(salida[0]?.availability).toBe(0.6);
    expect(salida[0]?.bitrate).toBe(3500);
  });

  it('T-054 · un hash de tus listas llega al segundo motor aunque el buscador diga cero', () => {
    const salida = mergeResolutionCandidates([
      señal('d'.repeat(40), { source: 'm3u', availability: null }),
      señal('d'.repeat(40), { source: 'acestream', availability: 0 }),
    ]);
    expect(salida).toHaveLength(1);
    expect(salida[0]?.source).toBe('m3u');
    expect(salida[0]?.availability).toBe(0);
  });

  it('T-055 · se ofrecen TODAS las señales, sin tope', () => {
    const muchas = Array.from({ length: 40 }, (_, i) =>
      señal(String(i).padStart(40, '0'), { availability: 1 - i / 100 }),
    );
    expect(mergeResolutionCandidates(muchas)).toHaveLength(40);
  });
});

describe('reparto entre proveedores (B-040)', () => {
  it('T-064 · la lista se reparte entre proveedores en vez de copar uno', () => {
    const entrada = [
      { title: 'C --> alfa' },
      { title: 'C --> alfa' },
      { title: 'C --> alfa' },
      { title: 'C --> beta' },
      { title: 'C --> beta' },
      { title: 'C --> gamma' },
    ];
    const salida = repartirEntreProveedores(entrada).map((c) => proveedorDeSeñal(c));
    expect(salida.slice(0, 3)).toEqual(['alfa', 'beta', 'gamma']);
    expect(salida).toHaveLength(6);
  });
});

describe('fiabilidad aprendida en el orden (B-057, B-061)', () => {
  it('T-092 · lo aprendido de un proveedor sirve para hashes nunca probados', () => {
    const ahora = FAKE_CLOCK_EPOCH;
    const stats = normalizeSourceStats(null);
    for (let i = 0; i < 8; i += 1) {
      stats.proveedores['new era'] = anotarResultado(
        stats.proveedores['new era'],
        'fallo',
        0,
        ahora,
      );
      stats.proveedores.elcano = anotarResultado(stats.proveedores.elcano, 'arranco', 0, ahora);
    }
    const lista = [
      señalDe(1, 'LIGA DE CAMPEONES --> NEW ERA'),
      señalDe(2, 'LIGA DE CAMPEONES --> ELCANO'),
      señalDe(3, 'LIGA DE CAMPEONES --> SPORT TV'),
    ];
    const sinAprender = mergeResolutionCandidates(lista, {}).map((c) => c.title);
    const aprendido = mergeResolutionCandidates(lista, { sourceStats: stats }).map((c) => c.title);
    expect(aprendido[0]).toMatch(/ELCANO/);
    expect(aprendido[2]).toMatch(/NEW ERA/);
    expect(aprendido[1]).toMatch(/SPORT TV/);
    expect(sinAprender).not.toEqual(aprendido);
  });

  it('T-093 · lo aprendido ordena, pero NUNCA decide que canal es', () => {
    const ahora = FAKE_CLOCK_EPOCH;
    const stats = normalizeSourceStats(null);
    const id = '2'.repeat(40);
    for (let i = 0; i < 20; i += 1) {
      stats.hashes[id] = anotarResultado(stats.hashes[id], 'arranco', 0, ahora);
    }
    const salida = mergeResolutionCandidates(
      [
        señalDe(1, 'El canal exacto', { score: 100 }),
        señalDe(2, 'Solo se le parece', { score: 74 }),
      ],
      { sourceStats: stats },
    );
    expect(salida[0]?.title).toBe('El canal exacto');
  });
});

describe('marca, familia y procedencia (B-042, B-043)', () => {
  it('niveles de nombre y marca genérica', () => {
    expect([100, 92, 91, 70, 69].map((score) => resolutionTier({ score }))).toEqual([
      2, 2, 1, 1, 0,
    ]);
    const pedidos = ['DAZN LaLiga', 'DAZN', 'LaLiga TV Bar'];
    expect(canalEsGenerico('DAZN', pedidos)).toBe(true);
    expect(canalEsGenerico('DAZN LaLiga', pedidos)).toBe(false);
    expect(canalEsGenerico('M+ LALIGA', ['M+ LALIGA', 'M+ LALIGA HDR'])).toBe(false);
    expect(canalEsGenerico('', pedidos)).toBe(false);
    expect(canalEsGenerico('DAZN', null)).toBe(false);
  });

  it('orden de procedencia propio, familia sin exacto y la marca detrás', () => {
    const custom = mergeResolutionCandidates(
      [
        señalDe(1, 'A', { source: 'm3u' }),
        señalDe(2, 'B', { source: 'favorites' }),
        señalDe(1, 'A', { source: 'favorites' }),
      ],
      { sourceOrder: ['favorites', 'favorites', '', 'm3u'] },
    );
    expect(custom.map((c) => [c.id.slice(0, 1), c.source])).toEqual([
      ['1', 'favorites'],
      ['2', 'favorites'],
    ]);
    const familia = mergeResolutionCandidates([
      señalDe(3, 'DAZN 1', {
        soloFamilia: true,
        familyFallbackAllowed: true,
        matchedChannel: 'DAZN',
      }),
      señalDe(4, 'DAZN 2', {
        soloFamilia: true,
        familyFallbackAllowed: false,
        matchedChannel: 'DAZN',
      }),
    ]);
    expect(familia.map((c) => c.title)).toEqual(['DAZN 1']);
    const marca = mergeResolutionCandidates(
      [
        señalDe(5, 'DAZN', { matchedChannel: 'DAZN', source: 'saved' }),
        señalDe(6, 'DAZN LaLiga', { matchedChannel: 'DAZN LaLiga' }),
      ],
      { requestedChannels: ['DAZN LaLiga', 'DAZN'] },
    );
    expect(marca.map((c) => c.title)).toEqual(['DAZN LaLiga', 'DAZN']);
  });

  it('contraste con la 0.6.59 sobre 400 listas generadas', () => {
    let state = 99;
    const next = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
    const stats = normalizeSourceStats({
      hashes: { ['1'.repeat(40)]: { intentos: 9, exitos: 9, ultimo: 1 } },
      proveedores: {
        elcano: { intentos: 8, exitos: 8, ultimo: 1 },
        'new era': { intentos: 8, exitos: 0, ultimo: 1 },
      },
    });
    for (let round = 0; round < 400; round += 1) {
      const list = Array.from({ length: 1 + Math.floor(next() * 12) }, () => ({
        id: String(Math.floor(next() * 6)).repeat(40),
        title: `${pick(['DAZN', 'DAZN LaLiga', 'M+ Liga', 'Liga de Campeones'])} --> ${pick(['ELCANO', 'NEW ERA', 'SPORT TV'])}`,
        score: pick([100, 98, 92, 80, 74, 70, 58]),
        source: pick(['saved', 'm3u', 'favorites', 'history', 'acestream']),
        availability: pick([null, 0, 0.3, 0.9, 1]),
        bitrate: pick([null, 3500]),
        soloFamilia: pick([false, false, true]),
        familyFallbackAllowed: pick([true, false, undefined]),
        matchedChannel: pick(['DAZN', 'DAZN LaLiga', 'M+ Liga']),
        listaId: pick([null, 'principal']),
      }));
      const options = {
        sourceStats: pick([null, stats]),
        requestedChannels: pick([[], ['DAZN LaLiga', 'DAZN'], ['M+ Liga']]),
        ...(next() < 0.3 ? { sourceOrder: ['favorites', 'm3u', 'acestream'] } : {}),
      };
      expect(mergeResolutionCandidates(list, options)).toEqual(
        original.mergeResolutionCandidates?.(list, options),
      );
    }
  });
});
