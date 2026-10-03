import { createEvent, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_SWIPE_MIN,
  dayFromGesture,
  lockAxis,
  railRoomAt,
  useDaySwipe,
  type DaySwipeOptions,
} from './day-swipe.ts';

describe('deslizar entre días: reglas', () => {
  it('el eje se fija a los 10 px con el criterio de Chrome (a 45° justos, scroll)', () => {
    expect(lockAxis(6, 2)).toBeNull();
    expect(lockAxis(-14, 3)).toBe('x');
    expect(lockAxis(3, 14)).toBe('y');
    expect(lockAxis(12, 12)).toBe('y');
    expect(lockAxis(-10, 11)).toBe('y');
    expect(lockAxis(-12, 10)).toBe('x');
  });

  it('dedo a la izquierda = día siguiente; a la derecha = anterior; largo o rápido', () => {
    expect(dayFromGesture({ dx: -DAY_SWIPE_MIN, dy: 5, ms: 600, locked: 'next' })).toBe('next');
    expect(dayFromGesture({ dx: 80, dy: -10, ms: 600, locked: 'prev' })).toBe('prev');
    // Corto y lento: nada. Corto pero rápido: sí.
    expect(dayFromGesture({ dx: -40, dy: 0, ms: 400, locked: 'next' })).toBeNull();
    expect(dayFromGesture({ dx: -40, dy: 0, ms: 60, locked: 'next' })).toBe('next');
    expect(dayFromGesture({ dx: -20, dy: 0, ms: 10, locked: 'next' })).toBeNull();
  });

  it('no cambia de día si el gesto dio la vuelta o acabó en vertical', () => {
    expect(dayFromGesture({ dx: 70, dy: 0, ms: 300, locked: 'next' })).toBeNull();
    expect(dayFromGesture({ dx: -70, dy: 90, ms: 300, locked: 'next' })).toBeNull();
  });

  it('una fila de tarjetas se queda el gesto solo si aún puede ir hacia ese lado', () => {
    const middle = { back: true, forward: true };
    const end = { back: true, forward: false };
    const start = { back: false, forward: true };
    const fits = { back: false, forward: false };
    expect(dayFromGesture({ dx: -90, dy: 0, ms: 300, locked: 'next', room: middle })).toBeNull();
    expect(dayFromGesture({ dx: -90, dy: 0, ms: 300, locked: 'next', room: end })).toBe('next');
    expect(dayFromGesture({ dx: 90, dy: 0, ms: 300, locked: 'prev', room: end })).toBeNull();
    expect(dayFromGesture({ dx: 90, dy: 0, ms: 300, locked: 'prev', room: start })).toBe('prev');
    expect(dayFromGesture({ dx: -90, dy: 0, ms: 300, locked: 'next', room: fits })).toBe('next');
    expect(dayFromGesture({ dx: 90, dy: 0, ms: 300, locked: 'prev', room: fits })).toBe('prev');
  });
});

/** Una fila que se desplaza en horizontal, con medidas falsas (jsdom no maqueta). */
function makeRail(
  root: HTMLElement,
  { width, content, left }: { width: number; content: number; left: number },
) {
  const rail = document.createElement('div');
  rail.style.overflowX = 'auto';
  Object.defineProperty(rail, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: content });
  rail.scrollLeft = left;
  Object.defineProperty(rail, 'scrollLeft', { configurable: true, value: left, writable: true });
  const card = document.createElement('button');
  rail.append(card);
  root.append(rail);
  return { rail, card };
}

describe('railRoomAt', () => {
  it('mira la primera fila desplazable entre el dedo y la lista', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const title = document.createElement('h2');
    root.append(title);
    expect(railRoomAt(title, root)).toBeNull();
    const fits = makeRail(root, { width: 390, content: 390, left: 0 });
    expect(railRoomAt(fits.card, root)).toEqual({ back: false, forward: false });
    const start = makeRail(root, { width: 390, content: 900, left: 0 });
    expect(railRoomAt(start.card, root)).toEqual({ back: false, forward: true });
    const middle = makeRail(root, { width: 390, content: 900, left: 200 });
    expect(railRoomAt(middle.card, root)).toEqual({ back: true, forward: true });
    // Al final (con la holgura del scroll-snap y los subpíxeles).
    const end = makeRail(root, { width: 390, content: 900, left: 509 });
    expect(railRoomAt(end.card, root)).toEqual({ back: true, forward: false });
    root.remove();
  });
});

// ---- El gesto entero, con Touch Events como los manda el navegador -------------------

let options: DaySwipeOptions;

function Harness({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDaySwipe(ref, options);
  return (
    <div ref={ref} data-testid="lista">
      <h2>LaLiga</h2>
      {children}
    </div>
  );
}

let time = 1000;
function touch(target: Element, x: number, y: number, id = 1) {
  return { identifier: id, target, clientX: x, clientY: y };
}
/** jsdom pone `timeStamp` al crear el evento: aquí se fija el del gesto (para la velocidad). */
function fireAt(
  kind: 'touchStart' | 'touchEnd',
  target: Element,
  init: Record<string, unknown>,
  at: number,
) {
  const event = createEvent[kind](target, init);
  Object.defineProperty(event, 'timeStamp', { value: at });
  fireEvent(target, event);
}
function drag(
  target: Element,
  from: [number, number],
  to: [number, number],
  { steps = 6, ms = 240 }: { steps?: number; ms?: number } = {},
) {
  const start = touch(target, ...from);
  fireAt('touchStart', target, { touches: [start], changedTouches: [start] }, time);
  for (let i = 1; i <= steps; i += 1) {
    const point = touch(
      target,
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    );
    fireEvent.touchMove(target, { touches: [point], changedTouches: [point] });
  }
  const end = touch(target, ...to);
  fireAt('touchEnd', target, { touches: [], changedTouches: [end] }, time + ms);
  time += 10_000;
}

describe('useDaySwipe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup(extra?: React.ReactNode) {
    const onSwipe = vi.fn();
    const onMove = vi.fn();
    const onCancel = vi.fn();
    options = { enabled: true, onSwipe, onMove, onCancel };
    const view = render(<Harness>{extra}</Harness>);
    return { ...view, onSwipe, onMove, onCancel, list: view.getByTestId('lista') };
  }

  it('sobre el título de la liga: dedo a la izquierda = día siguiente; a la derecha = anterior', () => {
    const { list, onSwipe, onMove } = setup();
    expect(list.style.touchAction).toBe('pan-y');
    const title = list.querySelector('h2')!;
    drag(title, [300, 400], [180, 410]);
    expect(onSwipe).toHaveBeenLastCalledWith('next');
    expect(onMove).toHaveBeenCalled();
    drag(title, [100, 400], [230, 395]);
    expect(onSwipe).toHaveBeenLastCalledWith('prev');
    expect(onSwipe).toHaveBeenCalledTimes(2);
  });

  it('el scroll vertical (o en diagonal) nunca cambia de día ni mueve la lista', () => {
    const { list, onSwipe, onMove } = setup();
    const title = list.querySelector('h2')!;
    drag(title, [200, 500], [205, 300]);
    drag(title, [300, 500], [220, 420]);
    // Empieza en vertical y luego tuerce: sigue siendo scroll.
    const begin = touch(title, 200, 500);
    fireEvent.touchStart(title, { touches: [begin], changedTouches: [begin] });
    const down = touch(title, 202, 480);
    fireEvent.touchMove(title, { touches: [down], changedTouches: [down] });
    const side = touch(title, 60, 478);
    fireEvent.touchMove(title, { touches: [side], changedTouches: [side] });
    fireEvent.touchEnd(title, { touches: [], changedTouches: [side] });
    expect(onSwipe).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('una fila que puede seguir hacia ese lado se queda el gesto; en su final, cambia de día', () => {
    const { list, onSwipe } = setup();
    const middle = makeRail(list, { width: 390, content: 1000, left: 300 });
    drag(middle.card, [300, 400], [150, 400]);
    drag(middle.card, [100, 400], [250, 400]);
    expect(onSwipe).not.toHaveBeenCalled();
    const end = makeRail(list, { width: 390, content: 1000, left: 610 });
    drag(end.card, [300, 400], [150, 400]);
    expect(onSwipe).toHaveBeenLastCalledWith('next');
    // Hacia atrás esa misma fila todavía se desplaza: es suya.
    drag(end.card, [100, 400], [250, 400]);
    expect(onSwipe).toHaveBeenCalledTimes(1);
    // Una fila que cabe entera no se queda nada.
    const fits = makeRail(list, { width: 390, content: 390, left: 0 });
    drag(fits.card, [100, 400], [250, 400]);
    expect(onSwipe).toHaveBeenLastCalledWith('prev');
  });

  it('si la página se desplaza durante el gesto (Safari en diagonal), no cambia de día', () => {
    const { list, onSwipe, onCancel } = setup();
    const title = list.querySelector('h2')!;
    const begin = touch(title, 300, 400);
    fireEvent.touchStart(title, { touches: [begin], changedTouches: [begin] });
    const side = touch(title, 270, 392);
    fireEvent.touchMove(title, { touches: [side], changedTouches: [side] });
    window.scrollY = 30;
    const more = touch(title, 180, 370);
    fireEvent.touchMove(title, { touches: [more], changedTouches: [more] });
    fireEvent.touchEnd(title, { touches: [], changedTouches: [more] });
    window.scrollY = 0;
    expect(onSwipe).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('corto y lento vuelve a su sitio (onCancel); dos dedos lo anulan', () => {
    const { list, onSwipe, onCancel } = setup();
    const title = list.querySelector('h2')!;
    drag(title, [300, 400], [262, 400], { ms: 900 });
    expect(onSwipe).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    const a = touch(title, 300, 400, 1);
    fireEvent.touchStart(title, { touches: [a], changedTouches: [a] });
    const moved = touch(title, 240, 400, 1);
    fireEvent.touchMove(title, { touches: [moved], changedTouches: [moved] });
    const b = touch(title, 100, 300, 2);
    fireEvent.touchStart(title, { touches: [moved, b], changedTouches: [b] });
    const far = touch(title, 100, 400, 1);
    fireEvent.touchEnd(title, { touches: [b], changedTouches: [far] });
    expect(onSwipe).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('apagado (escritorio) no escucha ni toca touch-action', () => {
    const onSwipe = vi.fn();
    options = { enabled: false, onSwipe };
    const view = render(<Harness />);
    const list = view.getByTestId('lista');
    expect(list.style.touchAction).toBe('');
    drag(list.querySelector('h2')!, [300, 400], [100, 400]);
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
