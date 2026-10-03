/* Limpieza de lo que dice la guía (docs/iptv.md §20.4): HTML y entidades
   dobles, recortes, relleno, temporada y episodio y año. */

import { describe, expect, it } from 'vitest';
import {
  cleanGuideText,
  isFillerTitle,
  parseEpisode,
  parseYear,
  shortLabel,
  truncateWords,
} from './guide-text.js';

describe('cleanGuideText', () => {
  it('quita etiquetas HTML sueltas, entidades dobles, controles y espacios repetidos', () => {
    expect(cleanGuideText('Primera línea<br>segunda<br/>y <b>tercera</b>', 200)).toBe(
      'Primera línea segunda y tercera',
    );
    expect(cleanGuideText('Tom &amp; Jerry &quot;clásico&quot;', 200)).toBe(
      'Tom & Jerry "clásico"',
    );
    expect(cleanGuideText('  uno\t\tdos\n\ntres\u0007 ', 200)).toBe('uno dos tres');
    expect(cleanGuideText('<p class="x">Párrafo</p>', 200)).toBe('Párrafo');
    /* Un «<» que no es una etiqueta conocida se queda (texto de verdad). */
    expect(cleanGuideText('3 < 5 y 7 > 2', 200)).toBe('3 < 5 y 7 > 2');
    expect(cleanGuideText('', 10)).toBe('');
  });

  it('recorta por una palabra con «…» y nunca pasa del tope + 1', () => {
    const long = 'palabra '.repeat(200);
    const cut = cleanGuideText(long, 100);
    expect(cut.length).toBeLessThanOrEqual(101);
    expect(cut.endsWith('palabra…')).toBe(true);
    expect(truncateWords('corto', 10)).toBe('corto');
    expect(truncateWords('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('relleno', () => {
  it('sin título o «Programación no disponible» y parecidos', () => {
    for (const title of [
      '',
      '  ',
      'Programación no disponible',
      'PROGRAMACION NO DISPONIBLE',
      'Sin información',
      'No information',
      'To Be Announced',
      'TBA',
      '(Sin información)',
      'Cierre de emisión',
    ]) {
      expect(isFillerTitle(title), title).toBe(true);
    }
    for (const title of ['Noticias', 'Información deportiva', 'Sin cobertura (película)']) {
      expect(isFillerTitle(title), title).toBe(false);
    }
  });
});

describe('temporada y episodio', () => {
  it('xmltv_ns empieza en cero, con totales y partes vacías', () => {
    expect(parseEpisode([{ system: 'xmltv_ns', value: '1.0.0/1' }])).toEqual({
      season: 2,
      episode: 1,
      text: null,
    });
    expect(parseEpisode([{ system: 'xmltv_ns', value: '0 . 11/24 . ' }])).toEqual({
      season: 1,
      episode: 12,
      text: null,
    });
    expect(parseEpisode([{ system: 'xmltv_ns', value: '.4.' }])).toEqual({
      season: null,
      episode: 5,
      text: null,
    });
  });

  it('onscreen y texto libre: S02E05, T2 Ep. 5, 2x05, Ep. 12; si no, el texto tal cual', () => {
    const on = (value: string) => parseEpisode([{ system: 'onscreen', value }]);
    expect(on('S02E05')).toEqual({ season: 2, episode: 5, text: null });
    expect(on('T2 Ep. 5')).toEqual({ season: 2, episode: 5, text: null });
    expect(on('Temporada 3 Capítulo 14')).toEqual({ season: 3, episode: 14, text: null });
    expect(on('2x05')).toEqual({ season: 2, episode: 5, text: null });
    expect(on('Ep. 12')).toEqual({ season: null, episode: 12, text: null });
    expect(on('Especial de Navidad')).toEqual({
      season: null,
      episode: null,
      text: 'Especial de Navidad',
    });
    /* xmltv_ns manda sobre onscreen. */
    expect(
      parseEpisode([
        { system: 'onscreen', value: 'S09E09' },
        { system: 'xmltv_ns', value: '0.0.' },
      ]),
    ).toEqual({ season: 1, episode: 1, text: null });
    expect(parseEpisode([{ system: 'dd_progid', value: 'EP012345.0001' }])).toEqual({
      season: null,
      episode: null,
      text: null,
    });
    expect(parseEpisode(undefined)).toEqual({ season: null, episode: null, text: null });
  });
});

describe('año, edad y nota', () => {
  it('año de <date> si es creíble', () => {
    expect(parseYear('2019')).toBe(2019);
    expect(parseYear('20190512')).toBe(2019);
    expect(parseYear('0012')).toBe(null);
    expect(parseYear('mañana')).toBe(null);
    expect(parseYear(undefined)).toBe(null);
  });

  it('edad y nota cortas; lo largo o vacío, null', () => {
    expect(shortLabel('+7')).toBe('+7');
    expect(shortLabel(' 7.5/10 ')).toBe('7.5/10');
    expect(shortLabel('una edad con muchísimo texto que no cabe')).toBe(null);
    expect(shortLabel('')).toBe(null);
  });
});
