/* Fiabilidad aprendida (T-063, T-089, T-090, T-091; B-041, B-058 a B-060)
   y contraste con la 0.6.59. */

import { describe, expect, it } from 'vitest';
import { FAKE_CLOCK_EPOCH } from '../../core/clock.js';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import * as legacy from './legacy-exports.js';
import {
  STATS_NEUTRAL,
  anotarResultado,
  desgastar,
  fiabilidadDeCandidato,
  normalizeSourceStats,
  ownEntry,
  proveedorDeSeñal,
  tasaFiable,
  veredictoDelReproductor,
} from './stats.js';

type AnyFn = (...args: unknown[]) => unknown;
const original = loadLegacyServer() as unknown as Record<string, AnyFn>;
const DIA = 86_400_000;

describe('proveedor de una señal (B-041)', () => {
  it('T-063 · se reconoce de que proveedor es cada señal', () => {
    expect(proveedorDeSeñal({ title: 'LIGA DE CAMPEONES --> ELCANO' })).toBe('elcano');
    expect(proveedorDeSeñal({ title: 'LIGA DE CAMPEONES FHD --> NEW ERA II' })).toBe('new era ii');
    expect(proveedorDeSeñal({ title: 'LIGA DE CAMPEONES → SPORT TV' })).toBe('sport tv');
    expect(proveedorDeSeñal({ title: 'M+ Liga de Campeones', listaId: 'principal' })).toBe(
      'principal',
    );
    expect(legacy.proveedorDeSeñal({ title: 'X ==> Beta' })).toBe('beta');
  });

  it('sin coletilla: lista, procedencia u "otros"; contraste con la 0.6.59', () => {
    expect(proveedorDeSeñal({ title: 'X', source: 'm3u' })).toBe('m3u');
    expect(proveedorDeSeñal(null)).toBe('otros');
    const titles = ['A -> b', 'A => C', 'A ⟹ D', 'A --> ', 'sin flecha', 'A->B->C', 'x ➜ Y z'];
    for (const title of titles) {
      expect(proveedorDeSeñal({ title, listaId: 'l1' }), title).toBe(
        original.proveedorDeSeñal?.({ title, listaId: 'l1' }),
      );
    }
  });
});

describe('fiabilidad (B-058 a B-060)', () => {
  it('T-089 · pocos aciertos no valen lo mismo que muchos', () => {
    const tasa = (intentos: number, exitos: number) => tasaFiable({ intentos, exitos }) ?? 0;
    expect(tasa(1, 1)).toBeLessThan(STATS_NEUTRAL);
    expect(tasa(5, 5)).toBeGreaterThan(STATS_NEUTRAL);
    expect(tasa(20, 20)).toBeGreaterThan(tasa(5, 5));
    expect(tasa(5, 1)).toBeLessThan(STATS_NEUTRAL);
    expect(tasaFiable({ intentos: 0, exitos: 0 })).toBeNull();
    expect(legacy.STATS_NEUTRAL).toBe(0.35);
    expect(legacy.tasaFiable(null)).toBeNull();
  });

  it('T-090 · arrancar y morirse enseguida no cuenta como que funciono', () => {
    const ahora = FAKE_CLOCK_EPOCH;
    const arrancada = anotarResultado(null, 'arranco', 0, ahora);
    expect(arrancada.exitos).toBe(1);
    const rapida = anotarResultado(arrancada, 'cayo', 12, ahora);
    expect(rapida.exitos).toBe(0);
    expect(rapida.caidas).toBe(1);
    const larga = anotarResultado(arrancada, 'cayo', 3000, ahora);
    expect(larga.exitos).toBe(1);
    expect(legacy.anotarResultado(null, 'fallo', 0, ahora).intentos).toBe(1);
  });

  it('T-091 · la fama vieja se desgasta', () => {
    const ahora = FAKE_CLOCK_EPOCH;
    const antiguo = { intentos: 10, exitos: 10, caidas: 0, segundos: 0, ultimo: ahora - 28 * DIA };
    const reciente = { intentos: 10, exitos: 10, caidas: 0, segundos: 0, ultimo: ahora };
    const trasFalloAntiguo = anotarResultado(antiguo, 'fallo', 0, ahora);
    const trasFalloReciente = anotarResultado(reciente, 'fallo', 0, ahora);
    expect(tasaFiable(trasFalloAntiguo) ?? 0).toBeLessThan(tasaFiable(trasFalloReciente) ?? 0);
  });

  it('desgaste: nada si es de ahora o del futuro, ni por debajo de 0,999; a los 14 días, la mitad', () => {
    const stat = { intentos: 8, exitos: 4, caidas: 2, segundos: 100, ultimo: 1000 };
    expect(desgastar(stat, 1000)).toBe(stat);
    expect(desgastar(stat, 500)).toBe(stat);
    expect(desgastar(stat, 1001)).toBe(stat);
    expect(desgastar(stat, 1000 + 14 * DIA)).toEqual({
      intentos: 4,
      exitos: 2,
      caidas: 1,
      segundos: 50,
      ultimo: 1000,
    });
    expect(desgastar({ ...stat, ultimo: 0 }, 5 * DIA)).toEqual({ ...stat, ultimo: 0 });
    expect(anotarResultado(stat, 'sigue', 0, 2000)).toEqual({ ...stat, ultimo: 2000 });
  });

  it('del hash, o del proveedor × 0,9, o nada', () => {
    const stats = normalizeSourceStats({
      hashes: { ['a'.repeat(40)]: { intentos: 5, exitos: 5, ultimo: 1 } },
      proveedores: { elcano: { intentos: 5, exitos: 5, ultimo: 1 } },
    });
    const propia = tasaFiable({ intentos: 5, exitos: 5 }) ?? 0;
    expect(fiabilidadDeCandidato({ id: 'a'.repeat(40), title: 'X --> ELCANO' }, stats)).toBe(
      propia,
    );
    expect(fiabilidadDeCandidato({ id: 'b'.repeat(40), title: 'X --> ELCANO' }, stats)).toBeCloseTo(
      propia * 0.9,
    );
    expect(fiabilidadDeCandidato({ id: 'b'.repeat(40), title: 'X --> OTRO' }, stats)).toBeNull();
    expect(
      fiabilidadDeCandidato({ id: 'b'.repeat(40), title: 'X --> constructor' }, stats),
    ).toBeNull();
    expect(fiabilidadDeCandidato(null, null)).toBeNull();
    expect(legacy.fiabilidadDeCandidato({ id: 'a'.repeat(40) }, stats)).toBe(propia);
  });

  it('normalizeSourceStats: tope por valor, fuera los de 0 intentos, 600 claves las más recientes', () => {
    const hashes: Record<string, unknown> = {};
    for (let n = 0; n < 620; n += 1) hashes[`k${n}`] = { intentos: 1, ultimo: n };
    hashes.cero = { intentos: 0, exitos: 5 };
    hashes.raro = { intentos: 'x', exitos: -1, caidas: 1e9, segundos: 1e12 };
    hashes['z'.repeat(130)] = { intentos: 2, ultimo: 10_000 };
    const out = normalizeSourceStats({ hashes, proveedores: '??' });
    expect(Object.keys(out.hashes)).toHaveLength(600);
    expect(out.hashes.k619).toBeDefined();
    expect(out.hashes.k0).toBeUndefined();
    expect(out.hashes.cero).toBeUndefined();
    expect(out.hashes['z'.repeat(120)]).toMatchObject({ intentos: 2 });
    expect(out.proveedores).toEqual({});
    const proto = normalizeSourceStats({ hashes: JSON.parse('{"__proto__":{"intentos":3}}') });
    expect(ownEntry(proto.hashes, '__proto__')).toMatchObject({ intentos: 3 });
    expect(Object.getPrototypeOf(proto.hashes)).toBe(Object.prototype);
    expect(normalizeSourceStats(null)).toEqual({ hashes: {}, proveedores: {} });
    const mix = { hashes: { a: { intentos: 3, exitos: 1, caidas: 2, segundos: 9, ultimo: 5 } } };
    expect(normalizeSourceStats(mix)).toEqual(original.normalizeSourceStats?.(mix));
  });

  it('contraste con la 0.6.59: anotar, tasa y veredicto sobre muchas combinaciones', () => {
    const results = ['arranco', 'fallo', 'cayo', 'sigue', 'otro'];
    const seconds = [0, 12, 59, 60, 3000, -5, Number.NaN];
    const previous = [
      null,
      { intentos: 3, exitos: 2, caidas: 1, segundos: 40, ultimo: FAKE_CLOCK_EPOCH - 3 * DIA },
      { intentos: 1, exitos: 0, caidas: 0, segundos: 0, ultimo: 0 },
    ];
    for (const resultado of results) {
      for (const segundos of seconds) {
        expect(veredictoDelReproductor(resultado, segundos)).toEqual(
          original.veredictoDelReproductor?.(resultado, segundos),
        );
        for (const stat of previous) {
          const mine = anotarResultado(stat, resultado, segundos, FAKE_CLOCK_EPOCH);
          expect(mine).toEqual(
            original.anotarResultado?.(stat, resultado, segundos, FAKE_CLOCK_EPOCH),
          );
          expect(tasaFiable(mine)).toEqual(original.tasaFiable?.(mine));
        }
      }
    }
    expect(legacy.veredictoDelReproductor('cayo', 60)).toEqual({
      state: 'weak',
      reason: 'player_dropped',
    });
  });
});
