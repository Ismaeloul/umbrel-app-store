/* Controlador del <video>.

   1. Los 7 tests de aceptación de la 0.6.59 (tests/player-controller.test.js,
      T-127 a T-133) portados a Vitest SIN cambiar lo que comprueban: mismo
      medio simulado, mismos pasos y mismas aserciones. Las ventanas de
      directo salen de @ace/shared (readSeekWindow, resolveLiveTarget).
   2. Los arreglos de la v2 (P1, P2 y P18), cada uno con el caso que fallaba
      en la 0.6.59.
   3. C2 de la IPTV 0.8.2 (docs/diagnostico-iptv-0.8.2.md, P4b): la promesa de
      play() vieja que dejaba el vídeo en pausa para siempre (caso E7 del
      laboratorio), con el medio simulado TAL CUAL y con el que, como Chrome,
      rechaza en pause() los play() pendientes. */

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

describe('controlador: C2 (promesas de play() viejas, P4b)', () => {
  /** Como Chrome: play() pone paused=false y la promesa se cumple con la imagen. */
  function lateMedia(rejectOnPause: boolean) {
    const media = new FakeMedia();
    media.rejectOnPause = rejectOnPause;
    const pending: Array<() => void> = [];
    media.playImpl = () => new Promise<void>((resolve) => pending.push(resolve));
    return { media, pending };
  }

  for (const rejectOnPause of [false, true]) {
    it(`E7 · retener y soltar con un play() aún pendiente acaba SONANDO (pause() ${
      rejectOnPause ? 'rechaza' : 'no rechaza'
    } lo pendiente)`, async () => {
      const { media, pending } = lateMedia(rejectOnPause);
      const { controller } = controllerFor(media);
      const first = controller.requestPlay('startup');
      await controller.setHold('rebuffer', true);
      const second = controller.setHold('rebuffer', false);
      for (const resolve of pending.splice(0)) resolve();
      await Promise.all([first, second]);
      // Una tormenta de retener/soltar tampoco lo deja parado.
      for (let i = 0; i < 3; i += 1) {
        const again = controller.requestPlay('storm');
        await controller.setHold('rebuffer', true);
        const release = controller.setHold('rebuffer', false);
        for (const resolve of pending.splice(0)) resolve();
        await Promise.all([again, release]);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      const snapshot = controller.snapshot();
      expect(media.paused).toBe(false);
      expect(snapshot.desiredPlaying).toBe(true);
      expect(snapshot.holds).toEqual([]);
      expect(snapshot.phase).toBe('playing');
    });
  }

  it('con cualquiera de los dos medios, la pausa de la persona sigue ganando a un play() viejo (T-127)', async () => {
    for (const rejectOnPause of [false, true]) {
      const { media, pending } = lateMedia(rejectOnPause);
      const { controller } = controllerFor(media);
      const first = controller.requestPlay('button');
      controller.requestPause('button');
      for (const resolve of pending.splice(0)) resolve();
      expect((await first).ok).toBe(false);
      expect(media.paused).toBe(true);
      expect(controller.snapshot().desiredPlaying).toBe(false);
    }
  });

  it('play() abortado por una pausa técnica ya pasada: se reintenta UNA vez en la siguiente tarea', async () => {
    const media = new FakeMedia();
    media.rejectOnPause = true;
    let calls = 0;
    const pending: Array<() => void> = [];
    media.playImpl = () => {
      calls += 1;
      return calls === 1
        ? new Promise<void>((resolve) => pending.push(resolve))
        : Promise.resolve();
    };
    const { controller } = controllerFor(media);
    const result = controller.requestPlay('startup');
    // Pausa técnica (la de un cambio de motor): no es de la persona ni una retención.
    controller.pauseMedia();
    expect((await result).ok).toBe(true);
    expect(media.playCalls).toBe(2);
    expect(media.paused).toBe(false);
  });

  it('un bloqueo de autoplay nunca se reintenta solo', async () => {
    const media = new FakeMedia();
    media.rejectOnPause = true;
    media.playImpl = () =>
      Promise.reject(Object.assign(new Error('bloqueado'), { name: 'NotAllowedError' }));
    const { controller } = controllerFor(media);
    expect((await controller.requestPlay('startup')).reason).toBe('blocked');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(media.playCalls).toBe(1);
  });
});
