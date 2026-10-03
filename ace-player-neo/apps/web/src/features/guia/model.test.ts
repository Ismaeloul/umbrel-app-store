/* Lógica pura de la Guía TV: línea de tiempo y días con datos, teselas y
   bloques, tramos de una fila (huecos, relleno, teselas que faltan, programas
   que cruzan dos teselas), búsqueda de lo visible y el teclado. */

import { GUIDE_FLAGS, type IptvGuideProgramme } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  blocksBetween,
  buildSegments,
  buildTimeline,
  dayStart,
  GAP_MIN_MS,
  HOUR,
  MINUTE,
  pagesBetween,
  remainingText,
  rowForNumber,
  scaleFor,
  scopeFromUrl,
  segmentAt,
  segmentLabel,
  stepSegment,
  TILE_MS,
  tilesBetween,
  visibleSegments,
  xOf,
  type TileState,
} from './model.ts';

const NOW = new Date(2026, 9, 3, 18, 50).getTime();
const TODAY = dayStart(NOW);

function prog(start: number, minutes: number, title = 'Programa', flags = 0): IptvGuideProgramme {
  return {
    id: `7.${Math.floor(start / MINUTE)}`,
    start,
    end: start + minutes * MINUTE,
    title,
    flags,
  };
}

describe('línea de tiempo', () => {
  it('una guía que solo cubre hoy enseña solo «Hoy» y acaba donde acaba la guía', () => {
    const timeline = buildTimeline(
      {
        from: TODAY - 24 * HOUR,
        to: TODAY + 80 * HOUR,
        coveredFrom: TODAY - 20 * HOUR,
        // Un programa que acaba de madrugada no hace que salga «Mañana».
        coveredTo: addDays(TODAY, 1) + 2 * HOUR + 10 * MINUTE,
      },
      NOW,
    );
    expect(timeline.start).toBe(TODAY);
    expect(timeline.days.map((day) => day.label)).toEqual(['Hoy']);
    expect(timeline.end).toBe(addDays(TODAY, 1) + 2.5 * HOUR);
    expect(timeline.endsEarly).toBe(true);
  });

  it('con tres días de guía salen Hoy, Mañana y el día de pasado', () => {
    const timeline = buildTimeline(
      { from: TODAY, to: TODAY + 80 * HOUR, coveredFrom: TODAY, coveredTo: addDays(TODAY, 3) },
      NOW,
    );
    expect(timeline.days.map((day) => day.label).slice(0, 2)).toEqual(['Hoy', 'Mañana']);
    expect(timeline.days).toHaveLength(3);
    expect(timeline.end).toBe(addDays(TODAY, 3));
    expect(timeline.endsEarly).toBe(false);
  });

  it('sin programación (o una guía vieja) enseña hoy entero', () => {
    const empty = buildTimeline({ from: null, to: null, coveredFrom: null, coveredTo: null }, NOW);
    expect(empty).toMatchObject({ start: TODAY, end: addDays(TODAY, 1) });
    const old = buildTimeline(
      {
        from: TODAY - 30 * HOUR,
        to: TODAY,
        coveredFrom: TODAY - 30 * HOUR,
        coveredTo: TODAY - HOUR,
      },
      NOW,
    );
    expect(old.end).toBe(addDays(TODAY, 1));
  });

  it('medidas: 200 px cada 30 min en pantallas anchas y 120 en el móvil', () => {
    const timeline = buildTimeline(
      { from: null, to: null, coveredFrom: null, coveredTo: null },
      NOW,
    );
    expect(xOf(TODAY + 30 * MINUTE, timeline, scaleFor('wide'))).toBeCloseTo(200);
    expect(xOf(TODAY + 30 * MINUTE, timeline, scaleFor('mobile'))).toBeCloseTo(120);
    expect(scaleFor('mobile').stripH).toBe(0);
  });
});

describe('teselas, bloques y páginas', () => {
  it('teselas de 6 h alineadas y bloques de 30 filas', () => {
    const tile = Math.floor(NOW / TILE_MS) * TILE_MS;
    expect(tilesBetween(NOW, NOW + 1)).toEqual([tile]);
    expect(tilesBetween(tile, tile + TILE_MS + 1)).toEqual([tile, tile + TILE_MS]);
    expect(blocksBetween(0, 29, 100)).toEqual([0]);
    expect(blocksBetween(25, 35, 100)).toEqual([0, 1]);
    expect(blocksBetween(25, 35, 0)).toEqual([]);
    expect(pagesBetween(150, 260, 4391)).toEqual([0, 1]);
    expect(pagesBetween(0, 10, 0)).toEqual([0]);
  });
});

describe('tramos de una fila', () => {
  const tile = Math.floor(NOW / TILE_MS) * TILE_MS;
  const start = tile;
  const end = tile + 2 * TILE_MS;

  it('programas, «Sin información» en los huecos y en el relleno, y lo que falta cargando', () => {
    const a = prog(tile + HOUR, 60, 'Noticias');
    const b = prog(tile + 2 * HOUR + GAP_MIN_MS - MINUTE, 60, 'Película'); // hueco de 1 min: se ignora
    const filler = prog(tile + 4 * HOUR, 90, '', GUIDE_FLAGS.filler);
    const tiles = new Map<number, TileState>([
      [tile, { status: 'ok', programmes: [a, b, filler] }],
      [tile + TILE_MS, { status: 'loading' }],
    ]);
    const segments = buildSegments(tiles, start, end);
    expect(segments.map((segment) => segment.kind)).toEqual([
      'none',
      'prog',
      'prog',
      'none',
      'loading',
    ]);
    expect(segments[0]).toMatchObject({ start: tile, end: a.start });
    // El relleno y el hueco hasta el final de la tesela son un solo «Sin información».
    expect(segments[3]).toMatchObject({ start: b.end, end: tile + TILE_MS });
  });

  it('un programa que cruza dos teselas sale una vez', () => {
    const long = prog(tile + TILE_MS - HOUR, 120, 'Partido');
    const tiles = new Map<number, TileState>([
      [tile, { status: 'ok', programmes: [long] }],
      [tile + TILE_MS, { status: 'ok', programmes: [long] }],
    ]);
    const segments = buildSegments(tiles, start, end);
    expect(segments.filter((segment) => segment.kind === 'prog')).toHaveLength(1);
    expect(segments.at(-1)).toMatchObject({ kind: 'none', start: long.end, end });
  });

  it('un canal sin guía es una fila entera «Sin información»; una tesela que falla, «error»', () => {
    expect(buildSegments(null, start, end)).toEqual([{ kind: 'none', start, end }]);
    const failed = buildSegments(new Map([[tile, { status: 'error' }]]), start, tile + TILE_MS);
    expect(failed).toEqual([{ kind: 'error', start, end: tile + TILE_MS }]);
  });

  it('lo visible, el tramo de una hora y ←/→', () => {
    const programmes = [0, 1, 2, 3].map((index) => prog(tile + index * HOUR, 60, `P${index}`));
    const segments = buildSegments(
      new Map([[tile, { status: 'ok', programmes }]]),
      start,
      tile + 4 * HOUR,
    );
    expect(visibleSegments(segments, tile + 90 * MINUTE, tile + 150 * MINUTE)).toHaveLength(2);
    const current = segmentAt(segments, tile + 70 * MINUTE);
    expect(current?.kind === 'prog' && current.programme.title).toBe('P1');
    const next = stepSegment(segments, tile + 70 * MINUTE, 1);
    expect(next?.kind === 'prog' && next.programme.title).toBe('P2');
    expect(stepSegment(segments, tile + 10 * MINUTE, -1)).toBeNull();
  });
});

describe('textos y teclado', () => {
  it('etiqueta para el lector de pantalla y lo que queda', () => {
    const live = prog(NOW - 20 * MINUTE, 60, 'Gangs of New York');
    expect(
      segmentLabel({ kind: 'prog', start: live.start, end: live.end, programme: live }, NOW),
    ).toMatch(/^Gangs of New York, de \d\d:\d\d a \d\d:\d\d, en emisión, quedan 40 min$/);
    expect(remainingText(NOW + 65 * MINUTE, NOW)).toBe('Quedan 1 h 5 min');
    expect(remainingText(NOW + 2 * HOUR, NOW)).toBe('Quedan 2 h');
  });

  it('«Favoritos | Todos» en la URL y teclear un número de canal', () => {
    expect(scopeFromUrl('todos')).toBe('all');
    expect(scopeFromUrl('favoritos')).toBe('favorites');
    expect(scopeFromUrl('otra')).toBeNull();
    expect(rowForNumber([1, 9, null, 12], 9)).toBe(1);
    expect(rowForNumber([1, 9, null, 12], 10)).toBe(3);
    expect(rowForNumber([1, 9], 40)).toBeNull();
  });
});
