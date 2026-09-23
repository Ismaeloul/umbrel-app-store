/* Emparejador de nombres de canal: tests puros portados de la 0.6.59
   (tests/server.test.js). Cada bloque cita su ficha de
   comportamientos-tests.md y la fila B-xxx que cubre. */

import { describe, expect, it } from 'vitest';
import {
  CHANNEL_VARIANT_MAX_SCORE,
  LIBRARY_MIN_SCORE,
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  channelMatchScore,
  esFamiliaDe,
  normalizeChannelKey,
} from '../src/index.js';

/* Umbral de "recomendado" (70): el mismo número que `LIBRARY_MIN_SCORE`. */
const RECOMENDADO = LIBRARY_MIN_SCORE;

describe('T-017 · no confunde canales de la misma familia que solo cambian una palabra (B-150)', () => {
  it.each([
    ['LaLiga TV Hypermotion', 'LaLiga TV'],
    ['LaLiga TV', 'LaLiga TV Hypermotion'],
    ['LaLiga TV', 'LaLiga TV Bar'],
    ['Movistar LaLiga', 'Movistar LaLiga Hypermotion'],
  ])('%s / %s queda topado por debajo de recomendado', (a, b) => {
    const score = channelMatchScore(a, b);
    expect(score).toBeLessThan(RECOMENDADO);
    expect(score).toBeLessThanOrEqual(CHANNEL_VARIANT_MAX_SCORE);
  });

  it('el guardia numérico sigue en pie y lo que sí es el mismo canal se reconoce', () => {
    expect(channelMatchScore('Eurosport 1', 'Eurosport 2')).toBe(0);
    expect(channelMatchScore('GOL Play', 'GOL Play HD')).toBe(100);
    expect(channelMatchScore('M+ LaLiga TV', 'Movistar LaLiga TV')).toBe(100);
    expect(
      channelMatchScore('Movistar Liga de Campeones', 'Movistar Liga Campeones'),
    ).toBeGreaterThanOrEqual(RECOMENDADO);
  });
});

describe('T-045 · pedir un canal a secas ofrece toda su familia numerada (B-153)', () => {
  it.each([
    ['DAZN', 'DAZN 1'],
    ['DAZN', 'DAZN 1 720p *'],
    ['M+ LALIGA', 'M+ LALIGA 2'],
  ])('%s / %s llega a recomendado', (a, b) => {
    expect(channelMatchScore(a, b)).toBeGreaterThanOrEqual(RECOMENDADO);
  });
});

describe('T-046 · la familia se ofrece pero nunca se reproduce a ciegas (B-153, B-156)', () => {
  it('DAZN / DAZN 3 queda entre recomendado y el umbral exacto', () => {
    const puntos = channelMatchScore('DAZN', 'DAZN 3');
    expect(puntos).toBeGreaterThanOrEqual(RECOMENDADO);
    expect(puntos).toBeLessThan(RESOLUTION_EXACT_SCORE);
  });
});

describe('T-047 · dos canales numerados distintos siguen sin confundirse (B-151)', () => {
  it.each([
    ['DAZN 1', 'DAZN 2'],
    ['M+ LALIGA 2', 'M+ LALIGA 3'],
  ])('%s / %s puntúa 0', (a, b) => {
    expect(channelMatchScore(a, b)).toBe(0);
  });
});

describe('T-048 · una palabra de más no es familia: sigue siendo otra competición (B-150)', () => {
  it('LaLiga TV no trae Hypermotion', () => {
    expect(channelMatchScore('LaLiga TV', 'LALIGA TV Hypermotion')).toBeLessThan(RECOMENDADO);
  });
});

describe('T-049 · las coletillas de calidad no rompen la coincidencia exacta (B-152)', () => {
  it.each([
    ['LaLiga TV Bar', 'LaLiga TV Bar HD'],
    ['DAZN 1', 'DAZN 1 720p'],
  ])('%s / %s puntúa 100', (a, b) => {
    expect(channelMatchScore(a, b)).toBe(100);
  });
});

describe('T-059 · las coletillas de calidad no cuentan como número de canal (B-152)', () => {
  it('esFamiliaDe distingue calidad de dial', () => {
    expect(esFamiliaDe('M+ Liga de Campeones', 'M+ Liga de Campeones 1080p')).toBe(false);
    expect(esFamiliaDe('DAZN 1', 'DAZN 1 720p')).toBe(false);
    expect(esFamiliaDe('DAZN', 'DAZN 1')).toBe(true);
    expect(esFamiliaDe('LaLiga TV', 'LALIGA TV Hypermotion')).toBe(false);
  });
});

describe('T-060 · la coletilla del proveedor no forma parte del nombre (B-158)', () => {
  it.each([
    ['LIGA DE CAMPEONES --> ELCANO', 'liga de campeones'],
    ['LIGA DE CAMPEONES FHD --> NEW ERA II', 'liga de campeones'],
    ['LIGA DE CAMPEONES → NEW ERA', 'liga de campeones'],
    ['LIGA DE CAMPEONES => SPORT TV', 'liga de campeones'],
    ['DAZN 1 720p **', 'dazn 1'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeChannelKey(input)).toBe(expected);
  });
});

describe('T-061 · el operador dice por dónde llega, no qué canal es (B-159)', () => {
  it.each([
    'LIGA DE CAMPEONES --> ELCANO',
    'M. Liga de Campeones',
    'Movistar Plus Liga de Campeones',
    'LIGA DE CAMPEONES → SPORT TV',
  ])('M+ Liga de Campeones / %s puntúa 100', (candidate) => {
    expect(channelMatchScore('M+ Liga de Campeones', candidate)).toBe(100);
  });
});

describe('T-062 · quitar la decoración no borra el número de canal (B-160)', () => {
  it('el dial sobrevive a la limpieza y separa el 2 y el 3 del principal', () => {
    expect(normalizeChannelKey('LIGA DE CAMPEONES 2 --> ELCANO')).toBe('liga de campeones 2');
    expect(
      channelMatchScore('M+ Liga de Campeones', 'LIGA DE CAMPEONES 2 --> ELCANO'),
    ).toBeLessThan(RECOMENDADO);
    expect(
      channelMatchScore('M+ Liga de Campeones', 'LIGA DE CAMPEONES 3 --> SPORT TV'),
    ).toBeLessThan(RECOMENDADO);
  });
});

describe('constantes del emparejador (T-084, T-087)', () => {
  it('la IA queda por encima del umbral exacto a propósito', () => {
    expect(RESOLUTION_EXACT_SCORE).toBe(92);
    expect(SEMANTIC_MAX_SCORE).toBe(94);
    expect(SEMANTIC_MAX_SCORE).toBeGreaterThan(RESOLUTION_EXACT_SCORE);
  });

  /* T-017 y T-045 a T-062 comparan con RECOMENDADO y el tope de variante. En
     la 0.6.59 eran 70 y 58 escritos en el test (tests/server.test.js:408-409);
     aquí se fijan para que un cambio de la constante no arrastre en silencio a
     los tests que la usan (verificación del backend, 23-09-2026). */
  it('recomendado = 70 y tope de variante = 58, como en el test original', () => {
    expect(LIBRARY_MIN_SCORE).toBe(70);
    expect(CHANNEL_VARIANT_MAX_SCORE).toBe(58);
  });
});
