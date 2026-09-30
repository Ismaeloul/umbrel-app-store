/* Contrato común de los motores de vídeo (adaptadores). El orquestador
   (runtime.ts) no sabe si debajo hay mpegts.js, hls.js, el HLS nativo de
   Safari o la señal de la demo: solo arranca, destruye y escucha estos
   avisos. Así cada adaptador se prueba solo con un motor simulado. */

import type { PlaybackProfile } from '@ace/shared';

export type EngineKind = 'mpegts' | 'hls' | 'native' | 'demo';

export interface EngineCallbacks {
  /**
   * La señal ha llegado (MEDIA_INFO de mpegts.js, MANIFEST_PARSED de hls.js,
   * `loadedmetadata` del nativo): empieza la precarga del colchón.
   */
  onReady(): void;
  /**
   * Fallo que el motor no sabe arreglar solo: hay que reconectar. `reason`
   * es la frase para la persona; `detail`, lo técnico para el registro.
   */
  onFatal(reason: string, detail?: string): void;
  /** Aviso de algo que el motor está arreglando solo (va a la línea de estado). */
  onNotice?(text: string): void;
  /**
   * La lista ha vuelto a empezar debajo del motor (MEDIA-SEQUENCE hacia atrás:
   * un servidor de antes que reinicia el remux sin continuar la numeración).
   * El motor ya ha dejado de cargar; hay que reengancharlo (C3).
   */
  onReset?(reason: string): void;
}

/** Ventana de directo que ve el motor, en tiempo del vídeo (hls.js: la lista de nivel). */
export interface LiveWindow {
  start: number;
  end: number;
  targetDuration: number;
  /** Distancia al borde a partir de la cual hls.js salta solo hacia delante. */
  maxLatency: number;
}

/** Posición en la lista: el segmento (`sn`) y cuánto se llevaba visto de él. */
export interface StreamPosition {
  sn: number;
  offset: number;
}

export interface EngineInfo {
  /** Velocidad de descarga que ve el propio motor, en KB/s. */
  speedKBs?: number | null;
  decodedFrames?: number | null;
  droppedFrames?: number | null;
}

export interface Engine {
  readonly kind: EngineKind;
  /**
   * Si precarga el colchón antes de pedir play(). El nativo no: en iOS el
   * remux ya esperó en el servidor a tener 6 s, y esperar más aquí solo
   * alarga el plazo en el que Safari deja arrancar con sonido.
   */
  readonly preloads: boolean;
  start(): void;
  destroy(): void;
  /** Borde del directo que propone el motor (hls.js `liveSyncPosition`); null si no hay. */
  liveSyncPosition(): number | null;
  info(): EngineInfo;
  /**
   * Solo hls.js: recuperarse de un vídeo que no se puede decodificar SIN
   * reconectar, siguiendo en el segmento de después del roto. false si no
   * sabe o ya gastó su presupuesto (entonces toca `fail()` como siempre).
   */
  recoverInPlace?(): boolean;
  /** Solo hls.js: la ventana de la lista (para el −30 s y los huecos). */
  liveWindow?(): LiveWindow | null;
  /**
   * Solo hls.js: en qué segmento va el cabezal (para seguir ahí con otra
   * instancia, C3). Si acaba por un vídeo que no se puede decodificar, el
   * segmento de después del roto.
   */
  position?(): StreamPosition | null;
  /** Solo hls.js: las recuperaciones en el sitio aún dentro de su ventana (pasan a la siguiente instancia). */
  inPlaceUsed?(): ReadonlyArray<{ at: number; position: number }>;
}

export interface EngineArgs {
  video: HTMLMediaElement;
  /** URL tal cual la da el backend (relativa). Cada adaptador la hace absoluta si le hace falta. */
  url: string;
  profile: PlaybackProfile;
  callbacks: EngineCallbacks;
  /** Para la demo: el canal de muestra que «no responde». */
  demoFails?: boolean;
  /**
   * Solo hls.js, misma sesión del remux: seguir en este segmento en vez de
   * arrancar 5 segmentos por detrás del borde (C3). Si ya no está en la
   * lista, se arranca como siempre.
   */
  startFrom?: StreamPosition | null;
  /** Solo hls.js, misma sesión del remux: las recuperaciones en el sitio que ya gastó la instancia anterior. */
  inPlaceUsed?: ReadonlyArray<{ at: number; position: number }>;
  /** Solo hls.js con IPTV: vigilar que la MEDIA-SEQUENCE no vaya hacia atrás (C3). */
  guardSequence?: boolean;
}

export type EngineFactory = (args: EngineArgs) => Engine;

/** URL absoluta: mpegts.js carga desde un Worker `blob:` que no resuelve rutas relativas (B-069). */
export function absoluteUrl(
  url: string,
  base: string = globalThis.location?.href ?? 'http://localhost/',
): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
