/* Títulos de Películas y series (docs/vod.md §4.4 y §15.1): limpieza
   conservadora, año y distintivos. */

import { describe, expect, it } from 'vitest';
import { cleanVodTitle, detectTags, tagBit, tagsOf } from './titles.js';

const clean = (raw: string, category = '') => {
  const out = cleanVodTitle(raw, category);
  return { title: out.title, year: out.year, tags: tagsOf(out.tags) };
};

describe('cleanVodTitle', () => {
  it('«ES| Oppenheimer (2023) 4K» → «Oppenheimer», 2023, castellano y 4k', () => {
    expect(clean('ES| Oppenheimer (2023) 4K')).toEqual({
      title: 'Oppenheimer',
      year: 2023,
      tags: ['castellano', '4k'],
    });
  });

  it('«|LAT| Dune 4K» → «Dune», latino y 4k', () => {
    expect(clean('|LAT| Dune 4K')).toEqual({ title: 'Dune', year: null, tags: ['latino', '4k'] });
  });

  it('conserva los acentos y quita la etiqueta del final', () => {
    expect(clean('Amélie (2001) VOSE')).toEqual({ title: 'Amélie', year: 2001, tags: ['vose'] });
  });

  it('no toca lo que no es prefijo ni etiqueta', () => {
    expect(clean('Mission: Impossible – Dead Reckoning (2023)')).toEqual({
      title: 'Mission: Impossible – Dead Reckoning',
      year: 2023,
      tags: [],
    });
    expect(clean('Reserva (2018)').title).toBe('Reserva');
    expect(clean('M+ Vamos: la película').title).toBe('M+ Vamos: la película');
    expect(clean('M3GAN').title).toBe('M3GAN');
    expect(clean('Blade Runner 2049')).toEqual({
      title: 'Blade Runner 2049',
      year: null,
      tags: [],
    });
    expect(clean('Multiverso Spider-Man').title).toBe('Multiverso Spider-Man');
  });

  it('títulos no latinos se conservan', () => {
    expect(clean('東京物語').title).toBe('東京物語');
    expect(clean('Паразиты (2019)')).toEqual({ title: 'Паразиты', year: 2019, tags: [] });
  });

  it('corchetes, prefijos de calidad y varias etiquetas seguidas', () => {
    expect(clean('[ES] 4K - Dune: Parte Dos [MULTI] (VOSE)')).toEqual({
      title: 'Dune: Parte Dos',
      year: null,
      tags: ['castellano', 'vose', 'multi', '4k'],
    });
    expect(clean('Dune - 2021').year).toBe(2021);
  });

  it('la categoría también da distintivos («PELIS LATINO», «VOD | 4K»)', () => {
    expect(clean('Coco', 'PELIS LATINO').tags).toEqual(['latino']);
    expect(clean('Coco', 'VOD | 4K').tags).toEqual(['4k']);
    expect(clean('Coco', 'ES | PELÍCULAS').tags).toEqual(['castellano']);
    /* Latino manda sobre castellano. */
    expect(clean('ES| Coco', 'PELIS LATINO').tags).toEqual(['latino']);
  });

  it('títulos que empiezan por mayúsculas y dos puntos NO son prefijos (lista cerrada)', () => {
    for (const title of [
      'CSI: Miami',
      'UP: Una aventura de altura',
      'ET: El extraterrestre',
      'SOS: Rescate',
      'IT: Capítulo 2',
      'DE-LOVELY',
      '[REC] 2',
      'SD Gundam Force',
    ]) {
      expect(clean(title).title, title).toBe(title);
    }
    /* Y se encuentran al buscar: «csi» casa con el título entero. */
    expect(clean('ES| CSI: Miami (2002)')).toEqual({
      title: 'CSI: Miami',
      year: 2002,
      tags: ['castellano'],
    });
  });

  it('los prefijos de la lista sí se van, también encadenados y con «|XX|» de cualquier código', () => {
    expect(clean('EN - The Batman').title).toBe('The Batman');
    expect(clean('VOSE: Parásitos').title).toBe('Parásitos');
    expect(clean('IT - Il padrino').title).toBe('Il padrino');
    expect(clean('|IT| Il padrino').title).toBe('Il padrino');
    expect(clean('|NL| De Tweeling').title).toBe('De Tweeling');
    expect(clean('ES - LAT: Coco')).toEqual({ title: 'Coco', year: null, tags: ['latino'] });
    expect(clean('[LAT] Coco').tags).toEqual(['latino']);
    expect(clean('4K Dune').title).toBe('Dune');
    expect(clean('FHD: Dune').title).toBe('Dune');
  });

  it('prefijos de lengua y calidad encadenados no dejan el separador delante («ES - 4K - Dune»)', () => {
    expect(clean('ES - 4K - Dune')).toEqual({
      title: 'Dune',
      year: null,
      tags: ['castellano', '4k'],
    });
    expect(clean('ES | 4K | Dune').title).toBe('Dune');
    expect(clean('LAT - UHD - Coco')).toEqual({
      title: 'Coco',
      year: null,
      tags: ['latino', '4k'],
    });
    expect(clean('ES: 4K - Dune').title).toBe('Dune');
    expect(clean('[ES] FHD | Dune').title).toBe('Dune');
    expect(clean('ES - 4K-Dune').title).toBe('4K-Dune');
  });

  it('con el guion entre espacios vale cualquier código de país («UK - », «MX - »)', () => {
    expect(clean('UK - The Crown').title).toBe('The Crown');
    expect(clean('MX - Coco')).toEqual({ title: 'Coco', year: null, tags: ['latino'] });
    expect(clean('AR - Batman').title).toBe('Batman');
    expect(clean('NL - De Tweeling').title).toBe('De Tweeling');
    expect(clean('TR - Kış Uykusu').title).toBe('Kış Uykusu');
    expect(clean('AMZ - The Boys').title).toBe('The Boys');
    /* Con dos puntos o barra, solo los de la lista (ahí estaban los falsos positivos). */
    expect(clean('US: Dune').title).toBe('Dune');
    expect(clean('UK| The Crown').title).toBe('The Crown');
    expect(clean('JFK: Caso abierto').title).toBe('JFK: Caso abierto');
    /* Sin espacios alrededor del guion, no: «AC-DC», «X-MEN». */
    expect(clean('AC-DC Live').title).toBe('AC-DC Live');
    expect(clean('X-MEN').title).toBe('X-MEN');
  });

  it('la limpieza nunca deja un título vacío', () => {
    expect(clean('4K').title).toBe('4K');
    expect(clean('ES - ').title).toBe('ES');
    expect(clean('(2020)').title).toBe('(2020)');
  });
});

describe('distintivos', () => {
  it('códigos cortos solo como palabra y en mayúsculas', () => {
    expect(tagsOf(detectTags('PELICULAS ESTRENOS'))).toEqual([]);
    expect(tagsOf(detectTags('Sub-zero'))).toEqual([]);
    expect(tagsOf(detectTags('SUB'))).toEqual(['vose']);
    expect(tagsOf(detectTags('multi audio · UHD'))).toEqual(['multi', '4k']);
    expect(tagsOf(detectTags('es-419'))).toEqual(['latino']);
  });

  it('bits en el orden de los chips', () => {
    expect(tagsOf(tagBit('4k') | tagBit('castellano'))).toEqual(['castellano', '4k']);
  });
});
