import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GUARD_MARGIN_MS,
  installViewTransitionGuard,
  pickViewMotion,
  remainingTransitionMs,
  resetViewMotion,
  viewMotion,
  type GuardDocument,
} from './viewTransitionGuard.ts';

describe('cómo se anima el cambio de vista', () => {
  afterEach(() => resetViewMotion());

  it('Chrome, Edge y Firefox con la API: View Transitions por vista', () => {
    expect(pickViewMotion({ viewTransitions: true, vendor: 'Google Inc.' })).toBe('vt');
    expect(pickViewMotion({ viewTransitions: true, vendor: '' })).toBe('vt');
  });

  it('WebKit (Safari y cualquier navegador de iOS): fundido CSS', () => {
    expect(pickViewMotion({ viewTransitions: true, vendor: 'Apple Computer, Inc.' })).toBe('css');
  });

  it('sin la API: fundido CSS (antes, el cambio era de golpe)', () => {
    expect(pickViewMotion({ viewTransitions: false, vendor: 'Google Inc.' })).toBe('css');
  });

  it('viewMotion lee el navegador una vez (jsdom no tiene la API)', () => {
    expect(viewMotion()).toBe('css');
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Google Inc.');
    (document as { startViewTransition?: unknown }).startViewTransition = () => null;
    try {
      // En caché: no cambia mientras vive la página.
      expect(viewMotion()).toBe('css');
      resetViewMotion();
      expect(viewMotion()).toBe('vt');
    } finally {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
      vendor.mockRestore();
    }
  });
});

/** Animación falsa con lo que la guardia lee. */
function animation(pseudoElement: string | null, endTime: number, currentTime = 0): Animation {
  return {
    currentTime,
    effect: { pseudoElement, getComputedTiming: () => ({ endTime }) },
  } as unknown as Animation;
}

describe('remainingTransitionMs', () => {
  it('lo que falta de la animación finita más larga', () => {
    expect(remainingTransitionMs([])).toBe(0);
    expect(
      remainingTransitionMs([
        animation('::view-transition-old(a)', 340, 100),
        animation('::view-transition-group(a)', 520, 20),
      ]),
    ).toBe(500);
    // Las infinitas no cuentan.
    expect(remainingTransitionMs([animation('::view-transition-new(a)', Infinity)])).toBe(0);
  });
});

/** Transición falsa: ready/finished se resuelven a mano. */
function fakeTransition() {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveFinished!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finished = new Promise<void>((resolve) => (resolveFinished = resolve));
  const transition = {
    ready,
    finished,
    skipTransition: vi.fn(() => resolveFinished()),
  };
  return { transition, resolveReady, rejectReady, resolveFinished };
}

function fakeDocument(animations: Animation[] = []) {
  const listeners = new Set<() => void>();
  let created: ReturnType<typeof fakeTransition> | null = null;
  const start = vi.fn(() => {
    created = fakeTransition();
    return created.transition;
  });
  const doc = {
    startViewTransition: start,
    documentElement: { getAnimations: () => animations },
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  return {
    doc: doc as unknown as GuardDocument,
    start,
    last: () => created!,
    fireVisibility: (state: DocumentVisibilityState) => {
      doc.visibilityState = state;
      listeners.forEach((fn) => fn());
    },
    listeners,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installViewTransitionGuard', () => {
  it('salta la transición que sigue viva pasado el final de sus animaciones más el margen', async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const onSkip = vi.fn();
    const fake = fakeDocument([animation('::view-transition-old(_t_1_)', 340)]);
    installViewTransitionGuard(fake.doc, {
      onSkip,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    const update = () => {};
    fake.doc.startViewTransition!({ update, types: ['adelante'] });
    // Pasa la llamada tal cual al navegador.
    expect(fake.start).toHaveBeenCalledWith({ update, types: ['adelante'] });
    const { transition, resolveReady } = fake.last();
    // Antes de arrancar no hay nada que vigilar (saltarla haría fallar a React).
    expect(timers).toHaveLength(0);
    resolveReady();
    await flush();
    expect(timers).toEqual([{ fn: expect.any(Function), ms: 340 + GUARD_MARGIN_MS }]);
    timers[0]!.fn();
    expect(transition.skipTransition).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith('animacion');
  });

  it('no toca la transición que acaba a su hora', async () => {
    const cleared: unknown[] = [];
    const timers: Array<() => void> = [];
    const fake = fakeDocument([animation('::view-transition-new(_t_2_)', 340)]);
    installViewTransitionGuard(fake.doc, {
      setTimer: (fn) => timers.push(fn),
      clearTimer: (id) => cleared.push(id),
    });
    fake.doc.startViewTransition!(() => {});
    const { transition, resolveReady, resolveFinished } = fake.last();
    resolveReady();
    await flush();
    resolveFinished();
    await flush();
    expect(cleared).toHaveLength(1);
    // Aunque el temporizador llegara a saltar después, ya no hace nada.
    timers[0]!();
    expect(transition.skipTransition).not.toHaveBeenCalled();
  });

  it('una transición que no llega a arrancar (saltada o abortada) no deja temporizadores', async () => {
    const setTimer = vi.fn();
    const fake = fakeDocument();
    installViewTransitionGuard(fake.doc, { setTimer, clearTimer: () => {} });
    fake.doc.startViewTransition!(() => {});
    const { rejectReady, resolveFinished } = fake.last();
    rejectReady(new Error('Skipped'));
    resolveFinished();
    await flush();
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('al volver a primer plano salta la transición que siga a medias', async () => {
    const onSkip = vi.fn();
    const fake = fakeDocument([animation('::view-transition-old(_t_1_)', 340)]);
    installViewTransitionGuard(fake.doc, { onSkip, setTimer: () => 0, clearTimer: () => {} });
    fake.doc.startViewTransition!(() => {});
    const { transition, resolveReady } = fake.last();
    resolveReady();
    await flush();
    fake.fireVisibility('hidden');
    expect(transition.skipTransition).not.toHaveBeenCalled();
    fake.fireVisibility('visible');
    expect(transition.skipTransition).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith('visibilidad');
    // Una vez: no se salta dos veces.
    fake.fireVisibility('visible');
    expect(transition.skipTransition).toHaveBeenCalledTimes(1);
  });

  it('se quita dejando el documento como estaba; sin la API no hace nada', () => {
    const fake = fakeDocument();
    const original = fake.doc.startViewTransition;
    const uninstall = installViewTransitionGuard(fake.doc);
    expect(fake.doc.startViewTransition).not.toBe(original);
    expect(fake.listeners.size).toBe(1);
    uninstall();
    expect(fake.doc.startViewTransition).toBe(original);
    expect(fake.listeners.size).toBe(0);

    const without = fakeDocument();
    delete (without.doc as { startViewTransition?: unknown }).startViewTransition;
    installViewTransitionGuard(without.doc)();
    expect(without.doc.startViewTransition).toBeUndefined();
    expect(without.listeners.size).toBe(0);
  });
});
