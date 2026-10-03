/* Piezas para los tests del reproductor (no es un test: no lo ejecuta Vitest).

   - FakeMedia: el <video> simulado de tests/player-controller.test.js de la
     0.6.59, TAL CUAL (play/pause/seeking síncronos), para portar T-127 a
     T-133 sin cambiar lo que comprueban. Con `rejectOnPause`, además, como
     el navegador: pause() rechaza con AbortError los play() pendientes.
   - FakeVideo: lo mismo más lo que usa el orquestador (buffered, readyState,
     src, volumen…) y un `advance()` para que el cabezal avance.
   - fakeEngines(): un cargador de motores que apunta lo que crea. */

import type { EngineLoader } from './engines/index.ts';
import type { Engine, EngineArgs, EngineKind } from './engines/types.ts';

export function ranges(entries: Array<[number, number]>) {
  return {
    length: entries.length,
    start(index: number) {
      return entries[index]![0];
    },
    end(index: number) {
      return entries[index]![1];
    },
  };
}

export class FakeMedia extends EventTarget {
  paused = true;
  ended = false;
  readyState = 4;
  seeking = false;
  seekable: ReturnType<typeof ranges> | null = ranges([[0, 120]]);
  buffered = ranges([[0, 120]]);
  playCalls = 0;
  pauseCalls = 0;
  playImpl: (() => Promise<void>) | null = null;
  /** Como Chrome: pause() rechaza los play() aún pendientes (AbortError). */
  rejectOnPause = false;
  private pendingPlays: Array<(error: Error) => void> = [];
  _currentTime = 0;

  get currentTime(): number {
    return this._currentTime;
  }
  set currentTime(value: number) {
    this._currentTime = value;
    this.seeking = true;
    this.dispatchEvent(new Event('seeking'));
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    if (this.playImpl) {
      const inner = this.playImpl();
      if (!this.rejectOnPause) return inner;
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const abort = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        this.pendingPlays.push(abort);
        inner.then(
          () => {
            if (settled) return;
            settled = true;
            this.pendingPlays = this.pendingPlays.filter((entry) => entry !== abort);
            resolve();
          },
          (error: unknown) => abort(error as Error),
        );
      });
    }
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
    for (const abort of this.pendingPlays.splice(0))
      abort(Object.assign(new Error('pause() interrumpió play()'), { name: 'AbortError' }));
    this.dispatchEvent(new Event('pause'));
  }

  finishSeek(): void {
    this.seeking = false;
    this.dispatchEvent(new Event('seeked'));
  }
}

export class FakeVideo extends FakeMedia {
  error: unknown = null;
  muted = false;
  volume = 1;
  playbackRate = 1;
  src = '';
  loadCalls = 0;

  constructor() {
    super();
    this.rejectOnPause = true;
    this.buffered = ranges([]);
    this.seekable = ranges([]);
  }

  /** Lo que el navegador tendría cargado. */
  setBuffered(entries: Array<[number, number]>): void {
    this.buffered = ranges(entries);
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  load(): void {
    this.loadCalls += 1;
  }

  /** El cabezal avanza solo (sin `seeking`) y dispara `timeupdate`. */
  advance(seconds: number): void {
    this._currentTime += seconds;
    this.dispatchEvent(new Event('timeupdate'));
  }

  /** El navegador se queda sin datos (con `waiting`, readyState baja a HAVE_CURRENT_DATA). */
  stall(): void {
    this.readyState = 2;
    this.dispatchEvent(new Event('waiting'));
  }
}

export interface FakeEngine extends Engine {
  args: EngineArgs;
  started: boolean;
  destroyed: boolean;
  /** Lo último que pidió `setLiveLatency` (objetivo, máxima y búfer), o null. */
  liveLatency: [number, number, number] | null;
}

export function fakeEngines() {
  const created: FakeEngine[] = [];
  const loader: EngineLoader = async (kind: EngineKind) => (args: EngineArgs) => {
    const engine: FakeEngine = {
      kind,
      preloads: kind === 'mpegts' || kind === 'hls',
      args,
      started: false,
      destroyed: false,
      liveLatency: null,
      start() {
        engine.started = true;
      },
      setLiveLatency(syncS, maxLatencyS, maxBufferS) {
        engine.liveLatency = [syncS, maxLatencyS, maxBufferS];
      },
      destroy() {
        engine.destroyed = true;
      },
      liveSyncPosition: () => null,
      info: () => ({}),
    };
    created.push(engine);
    return engine;
  };
  return {
    created,
    loader,
    last(): FakeEngine {
      const engine = created.at(-1);
      if (!engine) throw new Error('No se ha creado ningún motor');
      return engine;
    },
  };
}
