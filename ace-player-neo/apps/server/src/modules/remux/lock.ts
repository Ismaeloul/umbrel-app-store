/* Cola en serie: cada tarea empieza cuando acaba la anterior (sin carreras
   entre operaciones que tocan lo mismo). Un fallo no rompe la cola. */

export class SerialLock {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  /** Tareas en cola o en curso. */
  get size(): number {
    return this.pending;
  }

  run<T>(task: () => Promise<T> | T): Promise<T> {
    this.pending += 1;
    const next = this.tail.then(task, task);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next.finally(() => {
      this.pending -= 1;
    });
  }

  /** Espera a que no quede nada en cola. */
  async idle(): Promise<void> {
    while (this.pending > 0) await this.tail;
  }
}
