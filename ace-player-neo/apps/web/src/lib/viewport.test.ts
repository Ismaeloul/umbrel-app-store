/* El teclado en pantalla y la sala de «Ver juntos» en el móvil (7-11-2026: «el teclado tapa el
   chat y no se puede ver»). La sala es una caja fija del alto de lo que se ve: dentro no se hace
   `scrollIntoView` (Safari movía la página y la caja del chat se quedaba detrás del teclado), y
   con el teclado abierto `<html data-kb>` le dice a la sala que encoja el vídeo. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installViewportWatcher, isKeyboardOpen, keyboardInset, KB_DROP_PX } from './viewport.ts';

/** Un visualViewport de mentira: lo que se ve del alto y cuánto se ha desplazado. */
class FakeViewport extends EventTarget {
  constructor(
    public width: number,
    public height: number,
    public offsetTop = 0,
  ) {
    super();
  }
  resize(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

function fakeWindow(width: number, height: number) {
  const viewport = new FakeViewport(width, height);
  const scrollTo = vi.fn();
  const win = {
    document,
    innerWidth: width,
    innerHeight: height,
    scrollY: 0,
    pageYOffset: 0,
    scrollTo,
    visualViewport: viewport,
    matchMedia: (query: string) => ({ matches: query.includes('coarse') }),
  };
  return { win: win as unknown as Window & typeof win, viewport, scrollTo };
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  /* Las medidas van en el siguiente fotograma: aquí, al momento. */
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('el teclado y lo que se ve', () => {
  it('publica --vvh y --vvtop; con el teclado del iPhone, --kb y `html[data-kb]`', () => {
    const { win, viewport } = fakeWindow(390, 664);
    stop = installViewportWatcher(win);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--vvh')).toBe('664px');
    expect(isKeyboardOpen()).toBe(false);
    /* Sube el teclado: lo que se ve baja a 364 px (Safari no encoge la página). */
    viewport.resize(364);
    expect(root.style.getPropertyValue('--kb')).toBe('300px');
    expect(root.style.getPropertyValue('--vvh')).toBe('364px');
    expect(isKeyboardOpen()).toBe(true);
    viewport.resize(664);
    expect(isKeyboardOpen()).toBe(false);
    expect(root.style.getPropertyValue('--kb')).toBe('0px');
  });

  it('la barra de Safari que aparece y desaparece no es un teclado', () => {
    expect(
      keyboardInset({ innerHeight: 664, visualViewport: new FakeViewport(390, 620) as never }),
    ).toBe(0);
  });

  it('Android (la página encoge con el teclado y --kb se queda en 0): cuenta si baja y se escribe', () => {
    const { win, viewport } = fakeWindow(390, 800);
    stop = installViewportWatcher(win);
    const input = document.createElement('input');
    document.body.append(input);
    /* Baja sin un campo con el foco (la barra del navegador, un giro a medias): no es teclado. */
    win.innerHeight = 800 - KB_DROP_PX - 50;
    viewport.resize(800 - KB_DROP_PX - 50);
    expect(isKeyboardOpen()).toBe(false);
    input.focus();
    viewport.resize(800 - KB_DROP_PX - 50);
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px');
    expect(isKeyboardOpen()).toBe(true);
    win.innerHeight = 800;
    viewport.resize(800);
    expect(isKeyboardOpen()).toBe(false);
  });

  it('dentro de la sala no hace scrollIntoView; fuera, sí (si el teclado tapa el campo)', () => {
    const { win, viewport } = fakeWindow(390, 664);
    stop = installViewportWatcher(win);
    viewport.resize(364);
    const scroll = vi.fn();
    const covered = { bottom: 600, top: 560, left: 0, right: 10, width: 10, height: 40 };
    const field = (inside: string | null) => {
      const input = document.createElement('input');
      input.scrollIntoView = scroll;
      input.getBoundingClientRect = () => covered as DOMRect;
      if (inside) {
        const box = document.createElement('div');
        box.className = inside;
        box.append(input);
        document.body.append(box);
      } else {
        document.body.append(input);
      }
      return input;
    };
    field('juntos').focus();
    vi.advanceTimersByTime(400);
    field('guest--room').focus();
    vi.advanceTimersByTime(400);
    expect(scroll).not.toHaveBeenCalled();
    field(null).focus();
    vi.advanceTimersByTime(400);
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('si el navegador ha movido la sala para enseñar el campo, vuelve arriba (y la página de casa)', () => {
    const { win, viewport, scrollTo } = fakeWindow(390, 664);
    const main = document.createElement('main');
    main.className = 'app-main';
    const room = document.createElement('div');
    room.className = 'juntos';
    main.append(room);
    document.body.append(main);
    stop = installViewportWatcher(win);
    room.scrollTop = 120;
    win.scrollY = 80;
    viewport.resize(364, 80);
    expect(room.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(document.documentElement.style.getPropertyValue('--vvtop')).toBe('80px');
  });

  it('en escritorio (la sala no es una caja fija) no toca el scroll de la página', () => {
    const { win, viewport, scrollTo } = fakeWindow(1440, 900);
    const main = document.createElement('main');
    main.className = 'app-main';
    main.innerHTML = '<div class="juntos"></div>';
    document.body.append(main);
    stop = installViewportWatcher(win);
    win.scrollY = 300;
    viewport.resize(880);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
