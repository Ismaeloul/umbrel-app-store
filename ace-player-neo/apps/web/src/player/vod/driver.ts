/* Una película o un episodio en el reproductor (docs/vod.md §12.7 y §12.9).

   El orquestador (runtime.ts) sigue siendo UNO: el mismo <video>, la misma
   máquina de estados, la misma sesión del backend con su latido y su
   «soltar». Con una película, el runtime tiene un `VodDriver` y en sus
   enganches de una línea (`if (this.vod) …`) le deja a él lo que es propio
   de un vídeo con principio y final:

   - la petición: `vodStream` con `start` (la posición en una reconexión, o la
     que pidió la ficha), `audio` y `hevc`; y ANTES de cargar, si el navegador
     decodifica ese vídeo (`MediaSource.isTypeSupported` o, con HLS nativo,
     `canPlayType`): si no, error de códec sin volver a llamar al proveedor;
   - UNA reconexión automática en la posición («Se ha cortado. Seguimos desde
     43:12.»); la segunda vez, el error con «Reintentar»;
   - `vod_busy` con `retryAfterS`: un reintento solo, a los `retryAfterS` s;
   - la línea de tiempo: dónde va, lo cargado, saltos (los ±10 s seguidos se
     juntan en uno a los 300 ms), «Reanudado en 43:12»;
   - el progreso (progress.ts), el final («Terminada»), la tarjeta del
     siguiente episodio con su cuenta atrás y «¿Sigues viendo?» tras 3
     episodios seguidos sin que nadie toque nada;
   - en la demo, un reloj de mentira (no hay vídeo): la barra avanza, salta y
     se pausa igual.

   Nada de directo aquí: ni retención por rebúfer, ni salto de hueco, ni
   DIRECTO, ni puente a AceStream, ni `sourcesOutcome` (runtime.ts los corta
   con `if (this.vod) return`). */

import type { VodGrant } from '@ace/shared';
import type { NotifyOptions } from '../../notices/notify.ts';
import type { VodItem, VodNextUp, VodPlayback } from '../api.ts';
import type { MediaElementLike } from '../runtime.ts';
import { VodProgress, type VodProgressSend } from './progress.ts';
import { VOD_TEXT } from './texts.ts';
import {
  bufferedEndAt,
  clampPosition,
  formatText,
  nextUpAtS,
  VOD_NEXT_UP_COUNTDOWN_MS,
  VOD_RESUMED_NOTICE_MS,
  VOD_SEEK_COALESCE_MS,
  VOD_STILL_WATCHING_AFTER,
  VOD_STILL_WATCHING_TIMEOUT_MS,
} from './timeline.ts';

/** Lo que el driver necesita del orquestador. */
export interface VodHost {
  readonly video: MediaElementLike;
  demo(): boolean;
  /** La persona quiere que suene (y hay imagen). */
  playing(): boolean;
  /** Salto con el controlador (conserva la intención de reproducir). */
  seekMedia(target: number): Promise<unknown>;
  notify(text: string, options?: NotifyOptions): void;
  /** Volver a pintar el estado público (`vod`). */
  publish(): void;
  /** El siguiente episodio (la cuenta de «saltos solos» va con él). */
  playNext(item: VodItem, autoChain: number): void;
  /** «¿Sigues viendo?» sin respuesta: pausa y suelta la sesión. */
  idle(): void;
  /** «Salir» en «¿Sigues viendo?»: detener. */
  leave(): void;
  /** El vídeo de la demo ha llegado al final (no hay `ended` de un <video>). */
  demoEnded(): void;
}

export interface VodStreamQuery {
  client: 'web' | 'ios';
  viewer: string;
  device: string;
  hevc: '0' | '1';
  start?: number;
  audio?: number;
}

export interface VodDriverOptions {
  startS?: number;
  audio?: number;
  /** Episodios seguidos que han saltado solos (para «¿Sigues viendo?»). */
  autoChain?: number;
  send: VodProgressSend;
  now?: () => number;
}

/** Qué hacer con un error al pedir el vídeo (o con un `stream.closed` con un `vod_*`). */
export type VodErrorPlan =
  { kind: 'busy-retry'; delayMs: number } | { kind: 'fail'; retryable: boolean };

export class VodDriver {
  readonly item: VodItem;
  readonly progress: VodProgress;
  grant: VodGrant | null = null;
  /** Dónde va (o iba) el cabezal; sobrevive a la conexión (para reconectar ahí). */
  positionS: number;
  /** Reconectar o «Reintentar» aquí, en vez de la posición de la ficha. */
  resumeAtS: number | null = null;
  restarts = 0;
  ended = false;
  nextUp: VodNextUp | null = null;
  resumedAtS: number | null = null;
  failure: VodPlayback['failure'] = null;
  autoChain: number;
  private readonly requestedStartS: number | undefined;
  private audioIndex: number | undefined;
  private reconnectUsed = false;
  private busyRetryUsed = false;
  private bufferedEndS = 0;
  private pendingSeek: number | null = null;
  private seekingTo: number | null = null;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private nextUpTimer: ReturnType<typeof setTimeout> | null = null;
  private resumedAnnounced = false;
  private demoAt: number | null = null;
  private readonly now: () => number;
  private disposed = false;

  constructor(
    private readonly host: VodHost,
    item: VodItem,
    options: VodDriverOptions,
  ) {
    this.item = item;
    this.requestedStartS = options.startS;
    this.audioIndex = options.audio;
    this.autoChain = options.autoChain ?? 0;
    this.now = options.now ?? Date.now;
    this.positionS = options.startS ?? 0;
    this.progress = new VodProgress(item.id, options.send, this.now);
  }

  /** Película o episodio: lo que diga la concesión (manda sobre lo que pidió la ficha). */
  get kind(): 'movie' | 'episode' {
    return this.grant?.vod.kind ?? this.item.kind;
  }

  get durationS(): number {
    return this.grant?.vod.durationS ?? 0;
  }

  // ---- Petición y concesión ----------------------------------------------------

  /** Los parámetros de `vodStream` (§9.8): en una reconexión, `start` es donde iba. */
  streamQuery(base: Omit<VodStreamQuery, 'hevc'>, hevc: boolean): VodStreamQuery {
    const start = this.resumeAtS ?? this.requestedStartS;
    return {
      ...base,
      hevc: hevc ? '1' : '0',
      ...(start !== undefined ? { start: Math.max(0, Math.round(start * 10) / 10) } : {}),
      ...(this.audioIndex !== undefined ? { audio: this.audioIndex } : {}),
    };
  }

  /** El tipo MIME que tiene que aceptar el navegador antes de cargar nada (§12.7). */
  static codecType(grant: VodGrant): string {
    return `video/mp4; codecs="${grant.vod.video.codecs},mp4a.40.2"`;
  }

  accept(grant: VodGrant): void {
    this.grant = grant;
    this.failure = null;
    this.busyRetryUsed = false;
    this.ended = false;
    this.audioIndex = grant.vod.audioIndex;
    this.positionS = grant.vod.startS;
    this.bufferedEndS = grant.vod.startS;
    // Solo la primera vez y si salió del progreso guardado (§12.7).
    if (grant.vod.resumed && this.resumeAtS === null && grant.vod.startS > 0)
      this.resumedAtS = grant.vod.startS;
  }

  /** Desde dónde arranca el motor (la lista lleva el título entero; esto es su `startPosition`). */
  startS(): number {
    return this.grant?.vod.startS ?? this.resumeAtS ?? this.requestedStartS ?? 0;
  }

  /**
   * Error al pedir el vídeo. `vod_busy` con `retryAfterS`: un reintento solo
   * (la plaza del proveedor se está soltando). Lo demás de §13 se enseña ya;
   * un corte de red o un 5xx sin código propio, con la reconexión de siempre.
   */
  planError(code: string, retryAfterS: unknown, retryable: boolean): VodErrorPlan {
    if (code === 'vod_busy' && typeof retryAfterS === 'number' && !this.busyRetryUsed) {
      this.busyRetryUsed = true;
      return { kind: 'busy-retry', delayMs: Math.max(1, retryAfterS) * 1000 };
    }
    if (code.startsWith('vod_')) return { kind: 'fail', retryable: false };
    return { kind: 'fail', retryable };
  }

  /**
   * Corte con imagen o al conectar: ¿queda la reconexión automática? La
   * primera, sí (y se apunta dónde iba); la segunda vez, el error.
   */
  takeReconnect(): boolean {
    if (this.reconnectUsed) return false;
    this.reconnectUsed = true;
    this.restarts += 1;
    this.resumeAtS = this.positionS;
    return true;
  }

  /** «Reintentar» del panel: otra vez con su reconexión, en la posición guardada. */
  retry(): void {
    this.reconnectUsed = false;
    this.busyRetryUsed = false;
    this.failure = null;
    if (this.grant || this.positionS > 0) this.resumeAtS = this.positionS;
    this.cancelNextUp();
  }

  fail(code: string, action: 'retry' | 'title' | 'settings'): void {
    this.failure = { code, action };
    this.cancelSeek();
  }

  // ---- Imagen y medidor ----------------------------------------------------------

  /** Primer fotograma: «Reanudado en 43:12» con «Empezar desde el principio» (§12.7). */
  onFirstFrame(): void {
    this.demoAt = this.now();
    if (this.resumedAtS === null || this.resumedAnnounced) return;
    this.resumedAnnounced = true;
    this.host.notify(VOD_TEXT.resumed(this.resumedAtS), {
      kind: 'signal',
      icon: 'play',
      ms: VOD_RESUMED_NOTICE_MS,
      action: { label: VOD_TEXT.fromStart, onAction: () => void this.seekTo(0) },
    });
  }

  /** Cada 500 ms con imagen: posición, lo cargado, el progreso y la tarjeta del final. */
  measure(): void {
    if (this.disposed || !this.grant) return;
    const media = this.host.video;
    const playing = this.host.playing();
    if (this.host.demo()) {
      const now = this.now();
      if (playing && this.demoAt !== null && this.seekingTo === null && !this.ended)
        this.positionS = Math.min(this.durationS, this.positionS + (now - this.demoAt) / 1000);
      this.demoAt = now;
      this.bufferedEndS = Math.min(this.durationS, this.positionS + 30);
      if (this.positionS >= this.durationS && !this.ended) {
        this.host.demoEnded();
        return;
      }
    } else if (this.seekingTo === null && !media.seeking) {
      const t = media.currentTime;
      if (Number.isFinite(t) && t > 0) this.positionS = t;
      this.bufferedEndS = bufferedEndAt(media.buffered, this.positionS);
    }
    this.progress.tick(this.positionS, this.durationS, playing);
    this.checkNextUp();
  }

  snapshot(): VodPlayback | null {
    const grant = this.grant;
    const vod = grant?.vod;
    return {
      id: this.item.id,
      kind: vod?.kind ?? this.item.kind,
      seriesId: vod?.seriesId ?? this.item.seriesId ?? null,
      title: vod?.title ?? this.item.title,
      subtitle: vod ? vod.subtitle : (this.item.subtitle ?? null),
      positionS: this.pendingSeek ?? this.seekingTo ?? this.positionS,
      durationS: this.durationS,
      bufferedEndS: Math.max(this.bufferedEndS, this.positionS),
      audio: vod?.audio ?? [],
      audioIndex: vod?.audioIndex ?? 0,
      next: vod?.next ?? null,
      poster: vod?.poster ?? null,
      format: vod ? formatText(vod) : null,
      restarts: this.restarts,
      ended: this.ended,
      nextUp: this.nextUp,
      resumedAtS: this.resumedAtS,
      seekingTo: this.pendingSeek ?? this.seekingTo,
      failure: this.failure,
    };
  }

  // ---- Saltos -----------------------------------------------------------------------

  /** ±10 s: varias pulsaciones seguidas se juntan en un salto a los 300 ms (§12.7). */
  seekBy(delta: number): void {
    if (!this.grant) return;
    const base = this.pendingSeek ?? this.seekingTo ?? this.positionS;
    this.pendingSeek = clampPosition(base + delta, this.durationS);
    this.host.publish();
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => {
      this.seekTimer = null;
      const target = this.pendingSeek;
      this.pendingSeek = null;
      if (target !== null) void this.seekTo(target);
    }, VOD_SEEK_COALESCE_MS);
  }

  /** Salto a un punto (la barra, al soltar; Media Session `seekto`). */
  async seekTo(target: number): Promise<void> {
    if (!this.grant || this.disposed) return;
    const destination = clampPosition(target, this.durationS);
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
    this.pendingSeek = null;
    this.ended = false;
    // Hacia atrás, fuera de la zona del final: la tarjeta se va.
    if (destination < nextUpAtS(this.durationS) - 1) this.cancelNextUp();
    if (this.host.demo()) {
      this.positionS = destination;
      this.demoAt = this.now();
      this.host.publish();
      this.progress.seek(() => this.positionS, this.durationS);
      return;
    }
    this.seekingTo = destination;
    this.host.publish();
    try {
      await this.host.seekMedia(destination);
    } finally {
      if (this.seekingTo === destination) {
        this.seekingTo = null;
        this.positionS = destination;
      }
      this.host.publish();
      this.progress.seek(() => this.positionS, this.durationS);
    }
  }

  private cancelSeek(): void {
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
    this.pendingSeek = null;
    this.seekingTo = null;
  }

  // ---- Final y siguiente episodio ------------------------------------------------------

  private checkNextUp(): void {
    const next = this.grant?.vod.next;
    if (!next || this.kind !== 'episode' || this.ended) return;
    const at = nextUpAtS(this.durationS);
    if (this.positionS < at) {
      if (this.nextUp && this.nextUp.mode !== 'still' && this.positionS < at - 1)
        this.cancelNextUp();
      return;
    }
    if (this.nextUp) return;
    if (this.autoChain >= VOD_STILL_WATCHING_AFTER) {
      this.nextUp = { mode: 'still', endsAt: this.now() + VOD_STILL_WATCHING_TIMEOUT_MS };
      this.armNextUp(VOD_STILL_WATCHING_TIMEOUT_MS, () => this.host.idle());
    } else {
      this.nextUp = { mode: 'countdown', endsAt: this.now() + VOD_NEXT_UP_COUNTDOWN_MS };
      this.armNextUp(VOD_NEXT_UP_COUNTDOWN_MS, () => this.goNext(true));
    }
    this.host.publish();
  }

  private armNextUp(ms: number, fire: () => void): void {
    if (this.nextUpTimer) clearTimeout(this.nextUpTimer);
    this.nextUpTimer = setTimeout(() => {
      this.nextUpTimer = null;
      if (!this.disposed) fire();
    }, ms);
  }

  cancelNextUp(): void {
    if (this.nextUpTimer) clearTimeout(this.nextUpTimer);
    this.nextUpTimer = null;
    if (this.nextUp) {
      this.nextUp = null;
      this.host.publish();
    }
  }

  /** «Ver créditos»: la tarjeta se queda, sin cuenta atrás, hasta el final. */
  watchCredits(): void {
    if (!this.nextUp) return;
    if (this.nextUpTimer) clearTimeout(this.nextUpTimer);
    this.nextUpTimer = null;
    this.nextUp = { mode: 'credits', endsAt: null };
    this.autoChain = 0;
    this.host.publish();
  }

  /** Al siguiente episodio: solo (`auto`) o porque alguien lo ha pedido. */
  goNext(auto: boolean): boolean {
    const next = this.grant?.vod.next;
    if (!next || this.disposed) return false;
    if (this.nextUpTimer) clearTimeout(this.nextUpTimer);
    this.nextUpTimer = null;
    // Un episodio que se deja en los créditos cuenta como visto.
    this.progress.ended(this.durationS);
    this.host.playNext(
      {
        id: next.id,
        kind: 'episode',
        title: this.grant?.vod.title ?? this.item.title,
        subtitle: next.label ? `${next.label} · ${next.title}` : next.title,
        seriesId: this.grant?.vod.seriesId ?? this.item.seriesId ?? null,
      },
      auto ? this.autoChain + 1 : 0,
    );
    return true;
  }

  /** «¿Sigues viendo?» → «Seguir viendo»: al siguiente, con la cuenta a cero. */
  keepWatching(): void {
    this.autoChain = 0;
    if (!this.goNext(false)) this.cancelNextUp();
  }

  /** «Salir». */
  leave(): void {
    this.cancelNextUp();
    this.host.leave();
  }

  /** Alguien ha tocado algo (tecla, toque, Media Session): no es un maratón desatendido. */
  interacted(): void {
    this.autoChain = 0;
  }

  /** El vídeo ha llegado al final. Película: «Terminada»; episodio: el siguiente o la tarjeta. */
  onEnded(): void {
    if (this.ended || !this.grant) return;
    this.ended = true;
    this.positionS = this.durationS;
    this.cancelSeek();
    const next = this.grant.vod.next;
    if (this.kind === 'episode' && next) {
      // Con «Ver créditos» o «¿Sigues viendo?» la tarjeta se queda: decide la persona.
      if (this.nextUp?.mode === 'credits' || this.nextUp?.mode === 'still') {
        this.progress.ended(this.durationS);
        this.host.publish();
        return;
      }
      this.goNext(true);
      return;
    }
    this.progress.ended(this.durationS);
    this.cancelNextUp();
    this.host.publish();
  }

  /** «Ver de nuevo»: desde el principio, con el progreso contando otra vez. */
  replay(): void {
    this.ended = false;
    this.progress.reopen();
    void this.seekTo(0);
  }

  // ---- Final -----------------------------------------------------------------------

  /**
   * La posición que se guarda al salir: si hay un salto a medias (el
   * segmento aún no ha llegado), la de destino, que es la que ve en la
   * barra; si no, «Seguir viendo» volvería a donde estaba antes de saltar.
   */
  private get markS(): number {
    return this.pendingSeek ?? this.seekingTo ?? this.positionS;
  }

  /** Se deja el título: la última marca (`stop`, con `keepalive` al cerrar la página). */
  dispose(options: { keepalive?: boolean; mark?: boolean } = {}): void {
    if (this.disposed) return;
    if (options.mark !== false && this.grant && !this.ended)
      this.progress.stop(this.markS, this.durationS, {
        ...(options.keepalive ? { keepalive: true } : {}),
      });
    this.disposed = true;
    this.progress.dispose();
    this.cancelSeek();
    if (this.nextUpTimer) clearTimeout(this.nextUpTimer);
    this.nextUpTimer = null;
  }

  /**
   * Se cierra la página (o se va a la caché de ida y vuelta): la posición
   * con `keepalive`. Si la página puede volver (`persisted`), sigue contando.
   */
  pageHide(persisted: boolean): void {
    if (this.disposed || !this.grant || this.ended) return;
    this.progress.stop(this.markS, this.durationS, { keepalive: true });
    if (persisted) this.progress.reopen();
  }

  /** La pista de audio elegida (para reabrir con ella). */
  setAudio(index: number): void {
    this.audioIndex = index;
  }
}
