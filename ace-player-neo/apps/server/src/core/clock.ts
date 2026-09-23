/* Reloj inyectable (arquitectura §5.1: sin estado global de módulo).

   Todo lo que depende del tiempo en el backend (latidos de 45 s, lápidas de
   60 s, cuarentenas de 30 min, vigilante del motor cada 10 s, cupo de 3
   reinicios por hora…) pasa por un `Clock`. En producción es el reloj real;
   en los tests, `FakeClock`, que solo avanza cuando el test lo pide. Así un
   test de "caduca a los 45 s" dura milisegundos y no depende de la máquina
   (comportamientos-tests §1.4 y §1.9: en la 0.6.59 varios tests dependían
   del reloj real).

   Es compatible con el `EngineClock` del motor falso (test/fake-engine):
   se le puede pasar el mismo FakeClock a los dos. */

/** Asa opaca de un temporizador: solo sirve para cancelarlo con el mismo reloj. */
export type TimerHandle = object;

export interface TimerOptions {
  /**
   * `true` para trabajos de fondo (vigilantes, reaper, sincronizaciones): no
   * mantienen vivo el proceso por sí solos, así el apagado no se queda
   * esperando a un intervalo.
   */
  readonly unref?: boolean;
}

export interface Clock {
  /** Milisegundos desde epoch (lo mismo que `Date.now()`). */
  now(): number;
  /** `new Date(now())`, para no llamar a `new Date()` a pelo en el código. */
  date(): Date;
  setTimeout(fn: () => void, ms: number, options?: TimerOptions): TimerHandle;
  clearTimeout(handle: TimerHandle | null | undefined): void;
  setInterval(fn: () => void, ms: number, options?: TimerOptions): TimerHandle;
  clearInterval(handle: TimerHandle | null | undefined): void;
  /** Espera `ms`; si la señal se aborta, rechaza con su motivo. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('aborted');
}

/* Implementación compartida de `sleep` sobre los temporizadores del reloj. */
function sleepWith(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clock.clearTimeout(handle);
      reject(abortReason(signal as AbortSignal));
    };
    const handle = clock.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type NodeTimer = ReturnType<typeof globalThis.setTimeout>;

/** Reloj real del proceso. */
export function createSystemClock(): Clock {
  const clock: Clock = {
    now: () => Date.now(),
    date: () => new Date(),
    setTimeout(fn, ms, options) {
      const timer = globalThis.setTimeout(fn, ms);
      if (options?.unref) timer.unref();
      return timer as unknown as TimerHandle;
    },
    clearTimeout(handle) {
      if (handle) globalThis.clearTimeout(handle as unknown as NodeTimer);
    },
    setInterval(fn, ms, options) {
      const timer = globalThis.setInterval(fn, ms);
      if (options?.unref) timer.unref();
      return timer as unknown as TimerHandle;
    },
    clearInterval(handle) {
      if (handle) globalThis.clearInterval(handle as unknown as NodeTimer);
    },
    sleep: (ms, signal) => sleepWith(clock, ms, signal),
  };
  return clock;
}

interface FakeTimer {
  readonly handle: TimerHandle;
  at: number;
  readonly seq: number;
  readonly fn: () => void;
  /** Solo en intervalos. */
  readonly every: number | null;
}

/** 2026-01-01T00:00:00Z: una fecha fija para que los tests no dependan del día. */
export const FAKE_CLOCK_EPOCH = Date.UTC(2026, 0, 1);

/**
 * Reloj manual para tests. El tiempo solo avanza con `advance()`,
 * `advanceAsync()` o `set()`, y los temporizadores vencidos se disparan en
 * orden de hora (a igual hora, en el orden en que se programaron). Los que se
 * programan desde un temporizador dentro de la misma ventana también se
 * disparan en esa llamada.
 */
export class FakeClock implements Clock {
  private current: number;
  private seq = 0;
  private readonly timers = new Map<TimerHandle, FakeTimer>();

  constructor(start: number | Date = FAKE_CLOCK_EPOCH) {
    this.current = start instanceof Date ? start.getTime() : start;
  }

  now(): number {
    return this.current;
  }

  date(): Date {
    return new Date(this.current);
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    return this.schedule(fn, ms, null);
  }

  clearTimeout(handle: TimerHandle | null | undefined): void {
    if (handle) this.timers.delete(handle);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    /* Un intervalo de 0 colgaría advance(): como en Node, mínimo 1 ms. */
    return this.schedule(fn, ms, Math.max(1, ms));
  }

  clearInterval(handle: TimerHandle | null | undefined): void {
    if (handle) this.timers.delete(handle);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return sleepWith(this, ms, signal);
  }

  /** Temporizadores pendientes (para comprobar que nada queda colgado). */
  pendingTimers(): number {
    return this.timers.size;
  }

  /** Avanza `ms` disparando en orden todo lo que venza, de forma síncrona. */
  advance(ms: number): void {
    if (!(ms >= 0)) throw new RangeError('FakeClock.advance: ms debe ser >= 0');
    const target = this.current + ms;
    for (let timer = this.nextDue(target); timer; timer = this.nextDue(target)) this.fire(timer);
    this.current = target;
  }

  /**
   * Como `advance`, pero deja correr las promesas pendientes entre un
   * temporizador y el siguiente. Hace falta cuando el código hace `await`
   * dentro de un temporizador y programa otro después (un bucle de sondeo).
   */
  async advanceAsync(ms: number): Promise<void> {
    if (!(ms >= 0)) throw new RangeError('FakeClock.advanceAsync: ms debe ser >= 0');
    const target = this.current + ms;
    await flushMicrotasks();
    for (let timer = this.nextDue(target); timer; timer = this.nextDue(target)) {
      this.fire(timer);
      await flushMicrotasks();
    }
    this.current = target;
    await flushMicrotasks();
  }

  /** Salta a una hora concreta (nunca hacia atrás: el tiempo de los tests es monótono). */
  set(time: number | Date): void {
    const target = time instanceof Date ? time.getTime() : time;
    if (target < this.current) throw new RangeError('FakeClock.set: no se puede volver atrás');
    this.advance(target - this.current);
  }

  private schedule(fn: () => void, ms: number, every: number | null): TimerHandle {
    const handle: TimerHandle = {};
    const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
    this.timers.set(handle, { handle, at: this.current + delay, seq: this.seq++, fn, every });
    return handle;
  }

  private nextDue(limit: number): FakeTimer | null {
    let best: FakeTimer | null = null;
    for (const timer of this.timers.values()) {
      if (timer.at > limit) continue;
      if (!best || timer.at < best.at || (timer.at === best.at && timer.seq < best.seq)) {
        best = timer;
      }
    }
    return best;
  }

  private fire(timer: FakeTimer): void {
    this.current = timer.at;
    if (timer.every === null) this.timers.delete(timer.handle);
    else timer.at += timer.every;
    timer.fn();
  }
}

/* Unas cuantas vueltas del bucle de microtareas: suficiente para que las
   cadenas de `await` cortas de un temporizador terminen antes del siguiente. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
