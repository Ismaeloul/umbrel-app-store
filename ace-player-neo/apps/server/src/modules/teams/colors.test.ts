/* Colores de equipo (informe de fase 2, §10.5): normalización de los de la
   API, color dominante de PNG sintéticos y precedencia override → API → imagen → null. */

import { describe, expect, it } from 'vitest';
import {
  chooseColors,
  colorsDistinct,
  dominantColors,
  hue,
  normalizeHex,
  parseApiColors,
} from './colors.js';
import { decodePng } from './png.js';
import { encodePng, solidPng, twoTonePng, type Rgba } from './test-support.js';

const BLUE: Rgba = [0, 82, 159, 255];
const RED: Rgba = [203, 53, 36, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

describe('colores de la API', () => {
  it('normaliza a #rrggbb en minúsculas y descarta lo que no lo es', () => {
    expect(normalizeHex('#CB3524')).toBe('#cb3524');
    expect(normalizeHex('00529F')).toBe('#00529f');
    expect(normalizeHex(' #ffffff ')).toBe('#ffffff');
    expect(normalizeHex('#fff')).toBeNull();
    expect(normalizeHex('rojo')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });

  it('parseApiColors: sin primario válido, null; secundario casi igual, fuera', () => {
    expect(parseApiColors('#ffffff', '#00529F')).toEqual({
      primary: '#ffffff',
      secondary: '#00529f',
    });
    expect(parseApiColors('#CB3524', '#272e61')).toEqual({
      primary: '#cb3524',
      secondary: '#272e61',
    });
    /* El Inter es azul y negro: un color y un gris se distinguen aunque la luminosidad sea parecida. */
    expect(parseApiColors('#010e80', '#000000')).toEqual({
      primary: '#010e80',
      secondary: '#000000',
    });
    expect(parseApiColors('#004d98', '#004d98')).toEqual({ primary: '#004d98', secondary: null });
    expect(parseApiColors('#cb3524', '#d13a2a')).toEqual({ primary: '#cb3524', secondary: null });
    expect(parseApiColors(null, '#000000')).toBeNull();
    expect(parseApiColors('', '')).toBeNull();
  });

  it('colorsDistinct: tono a más de 40° o luminosidad a más de 0,3', () => {
    expect(colorsDistinct('#ff0000', '#0000ff')).toBe(true);
    expect(colorsDistinct('#ff0000', '#ff3300')).toBe(false);
    expect(colorsDistinct('#ffffff', '#000000')).toBe(true);
    expect(colorsDistinct('#808080', '#909090')).toBe(false);
    expect(colorsDistinct('#808080', '#0000ff')).toBe(true);
    expect(hue([128, 128, 128])).toBeNull();
    expect(hue([255, 0, 0])).toBe(0);
    expect(Math.round(hue([0, 0, 255]) ?? -1)).toBe(240);
  });
});

describe('color dominante', () => {
  it('dos colores sobre fondo transparente: el de más área primero y el otro de secundario', () => {
    const image = decodePng(
      encodePng({
        width: 8,
        height: 8,
        colorType: 6,
        sample: (x, y) => (y === 0 || y === 7 ? CLEAR : x < 6 ? BLUE : RED),
      }),
    );
    expect(dominantColors(image)).toEqual({ primary: '#00529f', secondary: '#cb3524' });
  });

  it('escudo blanco sobre transparente sale blanco (sin secundario)', () => {
    const image = decodePng(twoTonePng(8, 8, WHITE, WHITE, 2));
    expect(dominantColors(image)).toEqual({ primary: '#ffffff', secondary: null });
  });

  it('un gris uniforme no inventa secundario; todo transparente, null', () => {
    expect(dominantColors(decodePng(solidPng(4, 4, [128, 128, 128, 255])))).toEqual({
      primary: '#808080',
      secondary: null,
    });
    expect(dominantColors(decodePng(solidPng(4, 4, CLEAR)))).toBeNull();
  });

  it('la saturación pesa: un detalle de color gana a más blanco que él', () => {
    const image = decodePng(
      encodePng({
        width: 10,
        height: 1,
        colorType: 6,
        sample: (x) => (x < 6 ? WHITE : RED),
      }),
    );
    /* 6 blancos (peso 1 cada uno) contra 4 rojos (peso ~2,6): gana el rojo. */
    expect(dominantColors(image)).toEqual({ primary: '#cb3524', secondary: '#ffffff' });
  });

  it('el antialiasing de un borde no cuenta como secundario', () => {
    const image = decodePng(
      encodePng({
        width: 20,
        height: 20,
        colorType: 6,
        sample: (x, y) => (x === 0 && y === 0 ? RED : BLUE),
      }),
    );
    expect(dominantColors(image)).toEqual({ primary: '#00529f', secondary: null });
  });
});

describe('precedencia', () => {
  const image = decodePng(twoTonePng(4, 4, BLUE, RED));

  it('override → API → imagen → null', () => {
    expect(
      chooseColors({
        override: ['#112233', '#ffffff'],
        api: { primary: '#000000', secondary: null },
        image,
      }),
    ).toEqual({ primary: '#112233', secondary: '#ffffff', source: 'override' });
    expect(chooseColors({ override: ['#112233', '#112244'], api: null, image })).toEqual({
      primary: '#112233',
      secondary: null,
      source: 'override',
    });
    expect(chooseColors({ api: { primary: '#000000', secondary: null }, image })).toEqual({
      primary: '#000000',
      secondary: null,
      source: 'thesportsdb',
    });
    expect(chooseColors({ image })).toMatchObject({ source: 'image', primary: expect.any(String) });
    expect(chooseColors({})).toBeNull();
    expect(chooseColors({ image: decodePng(solidPng(2, 2, CLEAR)) })).toBeNull();
  });
});
