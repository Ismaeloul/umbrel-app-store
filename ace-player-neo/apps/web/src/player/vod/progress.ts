/* El progreso de una película o un episodio (docs/vod.md §10.2 y §12.7):
   POST /api/v1/vod/titles/:id/progress.

   - `tick` cada 15 s reproduciendo, si la posición ha cambiado 1 s o más (el
     servidor lo vuelca como mucho una vez por minuto);
   - `pause` al pausar, `seek` 2 s después del último salto, `ended` al acabar
     y `stop` al parar, cambiar de título o cerrar la página;
   - lo que sale al cerrar va con `keepalive` (y con `fetch`, no `sendBeacon`:
     así viaja la cabecera anti-CSRF).

   Nunca molesta: un fallo al guardar no se enseña (la siguiente marca lo
   arregla). Quién manda de verdad la petición lo decide `send` (el runtime la
   carga aparte: features/cine/data.ts, también en la demo). */

import type { VodProgressBody } from '@ace/shared';
import { VOD_PROGRESS_SEEK_DELAY_MS, VOD_PROGRESS_TICK_MS } from './timeline.ts';

export type VodProgressSend = (
  id: string,
  body: VodProgressBody,
  options: { keepalive?: boolean },
) => Promise<void>;

/** Un poco de holgura: el servidor rechaza `posS > durS + 5`. */
function bodyFor(
  event: VodProgressBody['event'],
  posS: number,
  durS: number,
  audio?: string | null,
): VodProgressBody {
  const dur = Math.max(0, Math.round(durS * 10) / 10);
  const pos = Math.min(Math.max(0, Math.round(posS * 10) / 10), dur || Number.POSITIVE_INFINITY);
  return { event, posS: pos, durS: dur, ...(audio !== undefined ? { audio } : {}) };
}

export class VodProgress {
  private lastSentPos = -1;
  private lastTickAt: number;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(
    readonly id: string,
    private readonly send: VodProgressSend,
    private readonly now: () => number = Date.now,
  ) {
    this.lastTickAt = now();
  }

  private post(
    event: VodProgressBody['event'],
    posS: number,
    durS: number,
    options: { keepalive?: boolean; audio?: string | null } = {},
  ): void {
    if (!(durS > 0)) return;
    this.lastSentPos = posS;
    this.lastTickAt = this.now();
    void this.send(this.id, bodyFor(event, posS, durS, options.audio), {
      ...(options.keepalive ? { keepalive: true } : {}),
    }).catch(() => {});
  }

  /** Lo llama el medidor (cada 500 ms): un `tick` cada 15 s mientras suena y la posición cambia. */
  tick(posS: number, durS: number, playing: boolean): void {
    if (this.finished || !playing) return;
    if (this.now() - this.lastTickAt < VOD_PROGRESS_TICK_MS) return;
    if (Math.abs(posS - this.lastSentPos) < 1) {
      this.lastTickAt = this.now();
      return;
    }
    this.post('tick', posS, durS);
  }

  pause(posS: number, durS: number): void {
    if (this.finished) return;
    this.post('pause', posS, durS);
  }

  /** El `seek` sale 2 s después del último salto (varios saltos seguidos = una marca). */
  seek(posS: () => number, durS: number): void {
    if (this.finished) return;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => {
      this.seekTimer = null;
      if (!this.finished) this.post('seek', posS(), durS);
    }, VOD_PROGRESS_SEEK_DELAY_MS);
  }

  /** Cambio de pista de audio: se guarda la lengua para la serie o la película (§10.4). */
  audio(posS: number, durS: number, lang: string | null): void {
    if (this.finished) return;
    this.post('tick', posS, durS, { audio: lang });
  }

  ended(durS: number): void {
    if (this.finished) return;
    this.clearSeek();
    this.post('ended', durS, durS);
    this.finished = true;
  }

  /** Parar, cambiar de título o cerrar la página (la última marca; con `keepalive` al cerrar). */
  stop(posS: number, durS: number, options: { keepalive?: boolean } = {}): void {
    if (this.finished) return;
    this.clearSeek();
    this.post('stop', posS, durS, options);
    this.finished = true;
  }

  /** Vuelve a contar tras «Ver de nuevo». */
  reopen(): void {
    this.finished = false;
    this.lastSentPos = -1;
    this.lastTickAt = this.now();
  }

  private clearSeek(): void {
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
  }

  dispose(): void {
    this.clearSeek();
    this.finished = true;
  }
}
