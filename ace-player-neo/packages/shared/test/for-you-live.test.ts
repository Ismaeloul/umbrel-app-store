/* "Para ti" (T-101) y la ventana de directo (T-131, T-132), portados de la
   0.6.59. En la 0.6.59, T-101 extraía el código de index.html con
   `new Function`; ahora son funciones puras que reciben las preferencias. */

import { describe, expect, it } from 'vitest';
import {
  footballMatchInScope,
  liveBufferSafety,
  readSeekWindow,
  resolveLiveTarget,
  type ForYouMatch,
  type ForYouPreferences,
  type TimeRangesLike,
} from '../src/index.js';

const soloEspana: ForYouPreferences = { leagues: [], teams: [], nationalities: ['España'] };

/* El mismo constructor que el test original (tests/server.test.js:1751). */
function partido(competition: string, title: string, canal: string): ForYouMatch {
  const [home, away] = title.split(' - ');
  return { competition, title, home: home ?? '', away: away ?? '', channels: [{ name: canal }] };
}

describe('T-101 · Para ti: la selección España no cuela LaLiga Hypermotion (B-138, B-139)', () => {
  it('Primera entra por ser española', () => {
    expect(
      footballMatchInScope(
        partido('La Liga EA Sports', 'Espanyol - Sevilla FC', 'M+ LALIGA'),
        soloEspana,
      ),
    ).toBe(true);
  });
  it('la Copa del Rey entra', () => {
    expect(
      footballMatchInScope(partido('Copa del Rey', 'Alcorcón - Getafe', 'M+ LALIGA'), soloEspana),
    ).toBe(true);
  });
  it('Segunda no entra por la selección', () => {
    expect(
      footballMatchInScope(
        partido('LaLiga Hypermotion', 'Eibar - Granada CF', 'LALIGA TV Hypermotion'),
        soloEspana,
      ),
    ).toBe(false);
  });
  it('ni aunque la agenda la rotule como LaLiga', () => {
    expect(
      footballMatchInScope(
        partido('LaLiga', 'Almería - Cádiz', 'LALIGA TV Hypermotion'),
        soloEspana,
      ),
    ).toBe(false);
  });
  it('la Premier no entra', () => {
    expect(
      footballMatchInScope(partido('Premier League', 'Arsenal - Chelsea', 'DAZN 1'), soloEspana),
    ).toBe(false);
  });
});

/* TimeRanges falso, como `ranges()` de tests/player-controller.test.js. */
function ranges(entries: [number, number][]): TimeRangesLike {
  return {
    length: entries.length,
    start: (index) => entries[index]?.[0] ?? Number.NaN,
    end: (index) => entries[index]?.[1] ?? Number.NaN,
  };
}

describe('T-131 · la ventana de directo usa el rango seekable que contiene la reproducción (B-112)', () => {
  it('elige [50,110] si se reproduce el segundo 72', () => {
    const media = {
      seekable: ranges([
        [0, 20],
        [50, 110],
      ]),
      currentTime: 72,
    };
    expect(readSeekWindow(media)).toEqual({ start: 50, end: 110, duration: 60 });
  });
});

describe('T-132 · el borde directo conserva el búfer de seguridad en vez de vaciarlo (B-086)', () => {
  it('limita el objetivo al borde menos el colchón, y el colchón a duración − 0,5', () => {
    const window = { start: 0, end: 120, duration: 120 };
    expect(resolveLiveTarget(window, 119, 8)).toBe(112);
    expect(resolveLiveTarget(window, 104, 8)).toBe(104);
    expect(resolveLiveTarget({ start: 20, end: 24, duration: 4 }, 24, 8)).toBe(20.5);
  });

  it('el colchón de "Ir al directo" sigue la fórmula de index.html:5030', () => {
    // Equilibrado reconstruye 8 s: con una ventana de 60 s manda el 8.
    expect(liveBufferSafety('balanced', 60)).toBe(8);
    // Con una ventana corta manda el 25 % (y nunca menos de 1,2 s).
    expect(liveBufferSafety('stable', 20)).toBe(5);
    expect(liveBufferSafety('low', 2)).toBe(1.2);
  });
});
