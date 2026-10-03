/* La franja y la hoja del programa elegido: el número del canal y la edad. */

import { describe, expect, it } from 'vitest';
import { nameHasNumber, ratingText, ratingTitle } from './Detail.tsx';

describe('franja del programa', () => {
  it('el número no se repite si ya va en el nombre («La 1», canal 1)', () => {
    expect(nameHasNumber('La 1', 1)).toBe(true);
    expect(nameHasNumber('DAZN 1', 12)).toBe(false);
    expect(nameHasNumber('M+ LaLiga TV', 9)).toBe(false);
    expect(nameHasNumber('Canal 112', 11)).toBe(false);
  });

  it('la edad, dicha: «TP» es «Todos los públicos»', () => {
    expect(ratingText('TP')).toBe('Todos los públicos');
    expect(ratingText('12')).toBe('+12');
    expect(ratingText('+18')).toBe('+18');
    expect(ratingText('PG-13')).toBe('PG-13');
    expect(ratingTitle('16')).toBe('No recomendado para menores de 16 años');
  });
});
