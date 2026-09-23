/* Reloj del motor falso.

   Todo lo que en el motor depende del tiempo "de reloj" pasa por aquí: la
   ventana HLS, el contador `downloaded` de las estadísticas, las caducidades
   de sesión, los retrasos de los modos de fallo y el reinicio. Así el soak de
   2 h se simula en segundos con `FakeClock.advance()`.

   Lo único que NO pasa por el reloj es el ritmo al que sale el progresivo por
   el socket: eso lo marca el tiempo real, porque es lo que mide el cliente
   que está leyendo (y porque avanzar 2 h de golpe mandaría gigas). */

export type TimerHandle = unknown;

/* Lo mínimo que el motor necesita de un reloj. Si el reloj que se inyecta
   (por ejemplo, el del arnés del backend) solo tiene `now()`, el motor usa
   los temporizadores globales para programar y el reloj solo para medir. */
export interface EngineClock {
  now(): number;
  setTimeout?(fn: () => void, ms: number): TimerHandle;
  clearTimeout?(handle: TimerHandle): void;
}

export const realClock: EngineClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface FakeTimer {
  id: number;
  at: number;
  seq: number;
  fn: () => void;
}

/* Reloj manual: el tiempo solo avanza con `advance()` o `set()`, y los
   temporizadores vencidos se disparan en orden (a igual hora, en el orden en
   que se programaron). Los que se programan desde un temporizador dentro de
   la misma ventana también se disparan en esa llamada. */
export class FakeClock implements EngineClock {
  private current: number;
  private timers = new Map<number, FakeTimer>();
  private nextId = 1;
  private seq = 0;

  // 22-09-2026 20:00 UTC: una fecha fija para que los tests no dependan del día
  constructor(start: number = Date.UTC(2026, 8, 22, 20, 0, 0)) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    const delay = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    this.timers.set(id, { id, at: this.current + delay, seq: this.seq++, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    if (typeof handle === 'number') this.timers.delete(handle);
  }

  /* Temporizadores pendientes: útil para comprobar que el motor no deja
     nada programado al cerrarse. */
  pendingTimers(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('advance necesita milisegundos >= 0');
    this.runUntil(this.current + ms);
  }

  set(time: number): void {
    if (time < this.current) throw new Error('el reloj falso no va hacia atrás');
    this.runUntil(time);
  }

  private runUntil(target: number): void {
    for (;;) {
      let next: FakeTimer | undefined;
      for (const timer of this.timers.values()) {
        if (timer.at > target) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && timer.seq < next.seq)) {
          next = timer;
        }
      }
      if (!next) break;
      this.timers.delete(next.id);
      this.current = Math.max(this.current, next.at);
      next.fn();
    }
    this.current = target;
  }
}
