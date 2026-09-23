/* Controlador del <video>.

   1. Los 7 tests de aceptación de la 0.6.59 (tests/player-controller.test.js,
      T-127 a T-133) portados a Vitest SIN cambiar lo que comprueban: mismo
      medio simulado, mismos pasos y mismas aserciones. Las ventanas de
      directo salen de @ace/shared (readSeekWindow, resolveLiveTarget).
   2. Los arreglos de la v2 (P1, P2 y P18), cada uno con el caso que fallaba
      en la 0.6.59. */

import { readSeekWindow, resolveLiveTarget } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { PlayerController, type ControllerOptions } from './controller.ts';
import { FakeMedia, ranges } from './testing.ts';

function controllerFor(media: FakeMedia, options: ControllerOptions = {}) {
  let active = 'canal';
  const controller = new PlayerController(media, {
    isActive: (key) => key === active,
    isDemo: () => false,
    ...options,
  });
  controller.setSession(active);
  return {
    controller,
    deactivate: () => {
      active = '';
    },
  };
}

describe('controlador: tests de la 0.6.59 (T-127 a T-133)', () => {
  it('T-127 · una pausa nueva gana a una promesa play anterior', async () => {
    const media = new FakeMedia();
    let resolvePlay: () => void = () => {};
    media.playImpl = () =>
      new Promise<void>((resolve) => {
        resolvePlay = resolve;
      });
    const { controller } = controllerFor(media);

    const pendingPlay = controller.requestPlay('button');
    controller.requestPause('button');
    resolvePlay();
    const result = await pendingPlay;

    expect(result.reason).toBe('superseded');
    expect(media.paused).toBe(true);
    expect(controller.snapshot().desiredPlaying).toBe(false);
  });

  it('T-128 · el salto al directo espera seeked y llama play una sola vez', async () => {
    const media = new FakeMedia();
    media._currentTime = 40;
    const { controller } = controllerFor(media);
    controller.requestPause('button');

    const pending = controller.goLive({ target: 108, behind: 68 });
    expect(media.currentTime).toBe(108);
    expect(media.playCalls).toBe(0);
    expect(controller.snapshot().phase).toBe('seeking');
    expect(controller.snapshot().followingLiveEdge).toBe(true);

    media.finishSeek();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(media.playCalls).toBe(1);
    expect(media.paused).toBe(false);
  });

  it('T-129 · una pausa del usuario durante el rebuffer impide el auto-resume', async () => {
    const media = new FakeMedia();
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');
    expect(media.playCalls).toBe(1);

    await controller.setHold('rebuffer', true);
    expect(controller.snapshot().desiredPlaying).toBe(true);
    expect(controller.snapshot().followingLiveEdge).toBe(true);
    expect(media.paused).toBe(true);

    controller.requestPause('button');
    expect(controller.snapshot().followingLiveEdge).toBe(false);
    await controller.setHold('rebuffer', false, { resume: true });
    expect(media.playCalls).toBe(1);
    expect(media.paused).toBe(true);
    expect(controller.snapshot().phase).toBe('paused');
  });

  it('T-130 · un bloqueo de autoplay se refleja sin fingir que reproduce', async () => {
    const media = new FakeMedia();
    const error = new Error('blocked');
    error.name = 'NotAllowedError';
    media.playImpl = () => Promise.reject(error);
    let blocked = 0;
    const { controller } = controllerFor(media, {
      onAutoplayBlocked: () => {
        blocked += 1;
      },
    });

    const result = await controller.requestPlay('startup');
    expect(result.reason).toBe('blocked');
    expect(blocked).toBe(1);
    expect(controller.snapshot().phase).toBe('blocked');
    expect(controller.snapshot().desiredPlaying).toBe(false);
  });

  it('T-131 · la ventana de directo usa el rango seekable que contiene la reproducción', () => {
    const media = new FakeMedia();
    media.seekable = ranges([
      [0, 20],
      [50, 110],
    ]);
    media._currentTime = 72;
    expect(readSeekWindow(media)).toEqual({ start: 50, end: 110, duration: 60 });
  });

  it('T-132 · el borde directo conserva el búfer de seguridad en vez de vaciarlo', () => {
    const window = { start: 0, end: 120, duration: 120 };
    expect(resolveLiveTarget(window, 119, 8)).toBe(112);
    expect(resolveLiveTarget(window, 104, 8)).toBe(104);
    expect(resolveLiveTarget({ start: 20, end: 24, duration: 4 }, 24, 8)).toBe(20.5);
  });

  it('T-133 · pulsar directo durante el rebuffer no vuelve a saltar', async () => {
    const media = new FakeMedia();
    media._currentTime = 108;
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');
    await controller.setHold('rebuffer', true);

    const before = media.currentTime;
    const result = await controller.goLive({ target: 116, behind: 8 });

    expect(result.reason).toBe('held');
    expect(media.currentTime).toBe(before);
    expect(controller.snapshot().followingLiveEdge).toBe(true);
    expect(controller.snapshot().phase).toBe('buffering');
  });
});

describe('controlador: arreglos de la v2', () => {
  it('P1 · un play desde los controles del sistema devuelve la intención de reproducir', async () => {
    const media = new FakeMedia();
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');

    // Pausa y play desde el propio vídeo (pantalla de bloqueo, ventana PiP…).
    media.pause();
    expect(controller.snapshot().desiredPlaying).toBe(false);
    void media.play();
    expect(controller.snapshot().desiredPlaying).toBe(true);
    expect(controller.state.origin).toBe('native-play');

    // Con la intención de vuelta, el rebuffer sí reanuda solo al llenarse
    // (en la 0.6.59 se quedaba en pausa hasta la reconexión de los 30 s).
    await controller.setHold('rebuffer', true);
    const calls = media.playCalls;
    await controller.setHold('rebuffer', false, { resume: true });
    expect(media.playCalls).toBe(calls + 1);
    expect(controller.snapshot().phase).toBe('playing');
  });

  it('P1 · un play nativo en pleno rebuffer no arranca con el colchón vacío', async () => {
    const media = new FakeMedia();
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');
    await controller.setHold('rebuffer', true);
    void media.play();
    // Vuelve a quedar en pausa técnica; la retención lo reanudará al llenarse.
    expect(media.paused).toBe(true);
    expect(controller.snapshot().desiredPlaying).toBe(true);
    expect(controller.snapshot().phase).toBe('buffering');
  });

  it('P18 · la pausa técnica se reconoce por su origen, no por una ventana de 600 ms', async () => {
    const media = new FakeMedia();
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');

    // Pausa del propio controlador: no cambia la intención.
    controller.pauseMedia();
    expect(controller.snapshot().desiredPlaying).toBe(true);

    // Justo después (bastante menos de 600 ms), la persona reanuda y pausa
    // desde el vídeo: esa pausa SÍ es suya (la 0.6.59 la ignoraba).
    void media.play();
    media.pause();
    expect(controller.snapshot().desiredPlaying).toBe(false);
    expect(controller.state.origin).toBe('native-pause');
  });

  it('P2 · con retraso acumulado, DIRECTO salta aunque la intención ya fuera ir en directo', async () => {
    const media = new FakeMedia();
    media._currentTime = 40;
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');
    expect(controller.snapshot().followingLiveEdge).toBe(true);

    const pending = controller.goLive({ target: 108, behind: 68 });
    expect(media.currentTime).toBe(108);
    media.finishSeek();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(controller.snapshot().followingLiveEdge).toBe(true);
  });

  it('P2 · en el borde (≤ 1,25 s) no salta', async () => {
    const media = new FakeMedia();
    media._currentTime = 111;
    const { controller } = controllerFor(media);
    await controller.requestPlay('startup');
    const result = await controller.goLive({ target: 112, behind: 1 });
    expect(result.reason).toBe('already-playing');
    expect(media.currentTime).toBe(111);
  });

  it('una sesión que ya no es la vigente no acepta órdenes', async () => {
    const media = new FakeMedia();
    const { controller, deactivate } = controllerFor(media);
    deactivate();
    expect((await controller.requestPlay('button')).reason).toBe('inactive');
    expect(controller.snapshot().phase).toBe('idle');
  });

  it('en la demo reproduce sin medio y el directo no salta', async () => {
    const media = new FakeMedia();
    const { controller } = controllerFor(media, { isDemo: () => true });
    expect((await controller.requestPlay('startup')).reason).toBe('demo');
    expect(controller.snapshot().actuallyPlaying).toBe(true);
    expect(media.playCalls).toBe(0);
    expect((await controller.goLive({ target: 100, behind: 50 })).reason).toBe('demo');
  });
});
