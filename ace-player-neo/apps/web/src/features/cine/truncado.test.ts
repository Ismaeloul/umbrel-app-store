/* El aviso de catálogo recortado (`truncated`) de la portada de Pelis y
   series: solo dice «más de 200.000» si de verdad se ha llegado al tope. */

import { describe, expect, it } from 'vitest';
import { truncatedText } from './texts.ts';

const LIMITS = { maxMovies: 200_000, maxSeries: 50_000 };

describe('truncatedText', () => {
  it('con el tope de películas o de series, «más de…»', () => {
    expect(truncatedText({ movies: 200_000, series: 12 }, LIMITS)).toBe(
      'Tu IPTV tiene más de 200.000 películas; se ven las primeras 200.000.',
    );
    expect(truncatedText({ movies: 30_000, series: 50_000 }, LIMITS)).toBe(
      'Tu IPTV tiene más de 50.000 series; se ven las primeras 50.000.',
    );
  });

  it('sin llegar a ningún tope (el modo por categorías se cortó por tiempo), faltan categorías', () => {
    expect(truncatedText({ movies: 30_000, series: 4_000 }, LIMITS)).toBe(
      'Faltan algunas categorías: tu IPTV tardaba demasiado en contestar. Se completarán en las próximas actualizaciones.',
    );
  });
});
