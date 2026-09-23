/* Controlador del <video>: la INTENCIÓN de quien mira (reproducir o no, ir en
   directo o no), las retenciones técnicas (rebuffer) y las órdenes
   serializadas. Es NeoPlayerController de la 0.6.59
   (releases/0.6.59/player-controller.js) portado a TypeScript, con los mismos
   7 tests de aceptación (T-127 a T-133, controller.test.ts) y tres arreglos:

   - P1: el evento nativo `play` (controles del sistema, pantalla de bloqueo,
     ventana PiP) SÍ restaura la intención de reproducir. Antes solo lo hacía
     requestPlay y, tras pausar y reanudar desde el propio vídeo, el
     controlador creía que el usuario quería pausa: el rebuffer no actuaba y
     un parón solo se arreglaba con la reconexión a los 30 s.
   - P18: la pausa «técnica» (la que hace el propio controlador) se reconoce
     por su ORIGEN y no por una ventana de 600 ms. Cada pause() nuestro que va
     a disparar un evento `pause` se apunta y ese evento se consume; el resto
     de pausas son de la persona (o del sistema en su nombre).
   - P2: «quiero ir en directo» (`followingLiveEdge`, la intención) está
     separado de «estoy en el directo», que se MIDE contra el borde. goLive
     solo se ahorra el salto mientras hay una retención (pulsar DIRECTO en
     pleno rebuffer no reinicia el ciclo, T-133); si no, mide el retraso real
     y salta si hace falta. En la 0.6.59 el indicador decía DIRECTO con 40 s
     de retraso acumulado y el botón no hacía nada.

   Las ventanas de directo (readSeekWindow) y el borde útil (resolveLiveTarget)
   vienen de @ace/shared: son las mismas en la web y en iOS. */

import { clamp, readSeekWindow, type TimeRangesLike } from '@ace/shared';
import { LIVE_TOLERANCE_S } from './constants.ts';

/** Lo mínimo de un HTMLMediaElement que usa el controlador (el de verdad o uno falso en los tests). */
export interface MediaLike extends EventTarget {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  currentTime: number;
  readonly seekable: TimeRangesLike | null;
  play(): Promise<void> | void;
  pause(): void;
}

export type ControllerPhase =
  'idle' | 'blocked' | 'seeking' | 'buffering' | 'starting' | 'playing' | 'paused';

export interface ControllerState {
  /** La persona quiere que suene. */
  desiredPlaying: boolean;
  /** La persona quiere ir pegada al directo (intención, no medida). */
  followingLiveEdge: boolean;
  /** Hay un play() nuestro en vuelo. */
  busy: boolean;
  waiting: boolean;
  seeking: boolean;
  /** El navegador bloqueó el autoplay: hace falta un toque. */
  blocked: boolean;
  error: string;
  /** Quién dio la última orden (para depurar y para los avisos). */
  origin: string;
}

export interface ControllerSnapshot extends ControllerState {
  active: boolean;
  demo: boolean;
  actuallyPlaying: boolean;
  phase: ControllerPhase;
  held: boolean;
  holds: string[];
}

export interface CommandResult {
  ok: boolean;
  reason: string;
  error?: unknown;
}

/** Destino del directo: un número o `{ target, behind }` ya medidos. */
export type LiveTargetInfo = number | { target: number | null; behind?: number | null } | null;

export interface ControllerOptions {
  isDemo?: () => boolean;
  /** La sesión sigue siendo la vigente (la app la cambia al zapear). */
  isActive?: (sessionKey: string) => boolean;
  liveTolerance?: number;
  onState?: (snapshot: ControllerSnapshot) => void;
  onAutoplayBlocked?: (error: unknown) => void;
  onError?: (error: unknown) => void;
}

type WaitReason = string;

/** Espera a uno de los eventos del medio (o al plazo, o a que la orden deje de ser la vigente). */
export function waitForMedia(
  media: EventTarget,
  eventNames: readonly string[],
  timeoutMs: number,
  isCurrent?: () => boolean,
): Promise<WaitReason> {
  return new Promise((resolve) => {
    let settled = false;
    const listeners: Array<[string, () => void]> = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (reason: WaitReason) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      for (const [eventName, listener] of listeners) media.removeEventListener(eventName, listener);
      resolve(reason);
    };
    for (const eventName of eventNames) {
      const listener = () => finish(eventName);
      listeners.push([eventName, listener]);
      media.addEventListener(eventName, listener, { once: true });
    }
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    if (typeof isCurrent === 'function' && !isCurrent()) finish('cancelled');
  });
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
}

export class PlayerController {
  readonly media: MediaLike;
  private readonly options: ControllerOptions;
  private sessionKey = '';
  private command = 0;
  private readonly holds = new Set<string>();
  readonly state: ControllerState = {
    desiredPlaying: false,
    followingLiveEdge: false,
    busy: false,
    waiting: false,
    seeking: false,
    blocked: false,
    error: '',
    origin: 'idle',
  };
  /** P18: eventos `pause` que vamos a provocar nosotros y que no son de la persona. */
  private internalPauses = 0;
  /** P1: hay un play() nuestro en vuelo; su evento `play` no es del sistema. */
  private internalPlay = false;
  private listeners: Array<[string, EventListener]> = [];

  constructor(media: MediaLike, options: ControllerOptions = {}) {
    if (!media) throw new TypeError('PlayerController necesita un elemento de medios');
    this.media = media;
    this.options = options;
    this.bindMediaEvents();
  }

  isDemo(): boolean {
    return Boolean(this.options.isDemo?.());
  }

  isActive(): boolean {
    if (!this.sessionKey) return false;
    return this.options.isActive ? Boolean(this.options.isActive(this.sessionKey)) : true;
  }

  private bindMediaEvents(): void {
    const listen = (name: string, handler: () => void) => {
      const listener: EventListener = () => handler();
      this.media.addEventListener(name, listener);
      this.listeners.push([name, listener]);
    };
    listen('playing', () => {
      this.state.busy = false;
      this.state.waiting = false;
      this.state.blocked = false;
      this.state.error = '';
      this.emit();
    });
    listen('play', () => {
      if (this.internalPlay) {
        this.emit();
        return;
      }
      // P1: play desde los controles del sistema, la pantalla de bloqueo o la
      // ventana PiP. Es la persona pidiendo que suene: la intención vuelve.
      this.state.desiredPlaying = true;
      this.state.blocked = false;
      this.state.error = '';
      this.state.origin = 'native-play';
      // Si hay una retención (rebuffer), el colchón aún no está: se vuelve a
      // pausar (pausa técnica) y la retención lo reanudará sola al llenarse.
      if (this.holds.size && !this.isDemo()) this.pauseMedia();
      this.emit();
    });
    listen('pause', () => {
      if (this.internalPauses > 0) {
        this.internalPauses -= 1;
        this.emit();
        return;
      }
      if (!this.state.busy && !this.state.seeking && !this.holds.size) {
        this.state.desiredPlaying = false;
        this.state.followingLiveEdge = false;
        this.state.origin = 'native-pause';
      }
      this.emit();
    });
    listen('waiting', () => {
      if (this.state.desiredPlaying) this.state.waiting = true;
      this.emit();
    });
    listen('canplay', () => {
      if (!this.media.seeking) this.state.waiting = false;
      this.emit();
    });
    listen('seeking', () => {
      this.state.seeking = true;
      this.emit();
    });
    listen('seeked', () => {
      this.state.seeking = false;
      this.emit();
    });
    listen('ended', () => {
      this.state.desiredPlaying = false;
      this.state.followingLiveEdge = false;
      this.state.busy = false;
      this.state.waiting = false;
      this.emit();
    });
    listen('error', () => {
      this.state.busy = false;
      this.state.waiting = false;
      this.state.error = 'media-error';
      this.emit();
    });
    for (const name of ['durationchange', 'volumechange', 'ratechange']) {
      listen(name, () => this.emit());
    }
  }

  snapshot(): ControllerSnapshot {
    const active = this.isActive();
    const demo = this.isDemo();
    const actuallyPlaying =
      active && (demo ? this.state.desiredPlaying : !this.media.paused && !this.media.ended);
    let phase: ControllerPhase = 'idle';
    if (active) {
      if (this.state.blocked) phase = 'blocked';
      else if (this.state.seeking) phase = 'seeking';
      else if (this.state.desiredPlaying && (this.holds.size || this.state.waiting))
        phase = 'buffering';
      else if (this.state.busy && this.state.desiredPlaying) phase = 'starting';
      else if (actuallyPlaying) phase = 'playing';
      else phase = 'paused';
    }
    return {
      ...this.state,
      active,
      demo,
      actuallyPlaying,
      phase,
      held: this.holds.size > 0,
      holds: [...this.holds],
    };
  }

  private emit(): void {
    this.options.onState?.(this.snapshot());
  }

  setSession(sessionKey: string): void {
    this.command += 1;
    this.sessionKey = String(sessionKey || '');
    this.holds.clear();
    Object.assign(this.state, {
      desiredPlaying: false,
      followingLiveEdge: Boolean(this.sessionKey),
      busy: false,
      waiting: false,
      seeking: false,
      blocked: false,
      error: '',
      origin: 'session',
    });
    this.emit();
  }

  reset(): void {
    this.command += 1;
    this.sessionKey = '';
    this.holds.clear();
    Object.assign(this.state, {
      desiredPlaying: false,
      followingLiveEdge: false,
      busy: false,
      waiting: false,
      seeking: false,
      blocked: false,
      error: '',
      origin: 'reset',
    });
    this.pauseMedia();
    this.emit();
  }

  /** Pausa técnica: la apunta para que su evento `pause` no se lea como de la persona (P18). */
  pauseMedia(): void {
    if (this.media.paused) return;
    this.internalPauses += 1;
    try {
      this.media.pause();
    } catch {
      this.internalPauses = Math.max(0, this.internalPauses - 1);
    }
  }

  private async playForCommand(command: number, origin: string): Promise<CommandResult> {
    if (
      command !== this.command ||
      !this.state.desiredPlaying ||
      !this.isActive() ||
      this.holds.size
    ) {
      return { ok: false, reason: 'cancelled' };
    }
    if (this.isDemo()) {
      this.state.busy = false;
      this.state.waiting = false;
      this.emit();
      return { ok: true, reason: 'demo' };
    }
    if (!this.media.paused && !this.media.ended) {
      this.state.busy = false;
      this.state.waiting = false;
      this.emit();
      return { ok: true, reason: 'already-playing' };
    }
    this.state.busy = true;
    this.state.waiting = false;
    this.state.origin = origin;
    this.emit();
    try {
      this.internalPlay = true;
      const result = this.media.play();
      if (result && typeof result.then === 'function') await result;
    } catch (error) {
      this.internalPlay = false;
      if (command !== this.command) return { ok: false, reason: 'cancelled' };
      this.state.busy = false;
      if (errorName(error) === 'NotAllowedError') {
        this.state.desiredPlaying = false;
        this.state.blocked = true;
        this.pauseMedia();
        this.options.onAutoplayBlocked?.(error);
      } else if (errorName(error) !== 'AbortError') {
        this.state.error = errorName(error) || 'play-failed';
        this.options.onError?.(error);
      }
      this.emit();
      return { ok: false, reason: this.state.blocked ? 'blocked' : 'failed', error };
    }
    this.internalPlay = false;
    if (
      command !== this.command ||
      !this.state.desiredPlaying ||
      this.holds.size ||
      !this.isActive()
    ) {
      this.pauseMedia();
      return { ok: false, reason: 'superseded' };
    }
    this.state.busy = false;
    this.state.waiting = false;
    this.state.blocked = false;
    this.state.error = '';
    this.emit();
    return { ok: true, reason: 'playing' };
  }

  requestPlay(origin = 'user'): Promise<CommandResult> {
    if (!this.isActive()) return Promise.resolve({ ok: false, reason: 'inactive' });
    this.state.desiredPlaying = true;
    this.state.blocked = false;
    this.state.error = '';
    this.state.origin = origin;
    const command = ++this.command;
    if (this.holds.size) {
      this.state.busy = false;
      this.emit();
      return Promise.resolve({ ok: true, reason: 'held' });
    }
    return this.playForCommand(command, origin);
  }

  requestPause(origin = 'user'): CommandResult {
    this.command += 1;
    this.state.desiredPlaying = false;
    this.state.followingLiveEdge = false;
    this.state.busy = false;
    this.state.waiting = false;
    this.state.seeking = false;
    this.state.blocked = false;
    this.state.origin = origin;
    this.pauseMedia();
    this.emit();
    return { ok: true, reason: 'paused' };
  }

  toggle(origin = 'user'): Promise<CommandResult> {
    const snapshot = this.snapshot();
    if (!snapshot.active) return Promise.resolve({ ok: false, reason: 'inactive' });
    const shouldPause =
      snapshot.desiredPlaying && (snapshot.busy || snapshot.held || snapshot.actuallyPlaying);
    return shouldPause ? Promise.resolve(this.requestPause(origin)) : this.requestPlay(origin);
  }

  setHold(
    reason: string,
    active: boolean,
    options: { resume?: boolean } = {},
  ): Promise<CommandResult> {
    const key = String(reason || 'buffer');
    const resume = options.resume !== false;
    if (active) {
      this.holds.add(key);
      this.state.waiting = this.state.desiredPlaying;
      this.state.busy = false;
      if (!this.isDemo() && !this.media.paused) this.pauseMedia();
      this.emit();
      return Promise.resolve({ ok: true, reason: 'held' });
    }
    this.holds.delete(key);
    if (!this.holds.size) this.state.waiting = false;
    this.emit();
    if (resume && !this.holds.size && this.state.desiredPlaying)
      return this.requestPlay(`resume-${key}`);
    return Promise.resolve({ ok: true, reason: 'released' });
  }

  hasHold(reason: string): boolean {
    return this.holds.has(reason);
  }

  async seekTo(
    target: number,
    options: {
      playAfter?: boolean;
      origin?: string;
      followLive?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<CommandResult> {
    if (!this.isActive() || this.isDemo() || !Number.isFinite(target)) {
      return { ok: false, reason: 'unavailable' };
    }
    const window = readSeekWindow(this.media);
    const destination = window ? clamp(target, window.start, window.end) : Math.max(0, target);
    const preservePlaying =
      options.playAfter !== undefined ? Boolean(options.playAfter) : this.state.desiredPlaying;
    this.state.desiredPlaying = preservePlaying;
    this.state.followingLiveEdge = options.origin === 'live' || options.followLive === true;
    this.state.seeking = true;
    this.state.busy = preservePlaying;
    this.state.waiting = false;
    this.state.origin = options.origin || 'timeline';
    const command = ++this.command;
    this.emit();
    try {
      this.media.currentTime = destination;
    } catch (error) {
      this.state.seeking = false;
      this.state.busy = false;
      this.state.error = 'seek-failed';
      this.emit();
      return { ok: false, reason: 'seek-failed', error };
    }
    if (Math.abs((Number(this.media.currentTime) || 0) - destination) > 0.2 || this.media.seeking) {
      await waitForMedia(
        this.media,
        ['seeked', 'canplay'],
        options.timeoutMs || 1800,
        () => command === this.command,
      );
    }
    if (command !== this.command) return { ok: false, reason: 'cancelled' };
    this.state.seeking = false;
    this.state.busy = false;
    this.emit();
    if (preservePlaying) return this.playForCommand(command, options.origin || 'timeline');
    this.pauseMedia();
    return { ok: true, reason: 'seeked-paused' };
  }

  /**
   * Ir al directo. `targetInfo` es el borde útil ya medido (resolveLiveTarget)
   * o una función que lo mide en el momento.
   */
  async goLive(targetInfo: LiveTargetInfo | (() => LiveTargetInfo)): Promise<CommandResult> {
    if (!this.isActive()) return { ok: false, reason: 'inactive' };
    const alreadyFollowing = this.state.followingLiveEdge;
    this.state.desiredPlaying = true;
    this.state.followingLiveEdge = true;
    this.state.blocked = false;
    this.state.origin = 'live';
    if (this.isDemo()) return this.requestPlay('live');
    /* Pulsar de nuevo mientras el búfer técnico se recompone no debe lanzar
       otro seek y reiniciar el mismo ciclo (T-133). Fuera de una retención
       ya NO basta con «seguíamos el directo»: se mide (P2). */
    if (alreadyFollowing && this.holds.size) return this.requestPlay('live-following');
    const resolved = typeof targetInfo === 'function' ? targetInfo() : targetInfo;
    const target =
      typeof resolved === 'number'
        ? resolved
        : resolved && typeof resolved.target === 'number'
          ? resolved.target
          : Number.NaN;
    if (!Number.isFinite(target)) return this.requestPlay('live-no-target');
    const behind =
      resolved && typeof resolved === 'object' && typeof resolved.behind === 'number'
        ? resolved.behind
        : Math.max(0, target - (Number(this.media.currentTime) || 0));
    if (behind <= (this.options.liveTolerance || LIVE_TOLERANCE_S))
      return this.requestPlay('live-already');
    return this.seekTo(target, { playAfter: true, origin: 'live', timeoutMs: 2200 });
  }

  destroy(): void {
    this.reset();
    for (const [name, handler] of this.listeners) this.media.removeEventListener(name, handler);
    this.listeners = [];
  }
}
