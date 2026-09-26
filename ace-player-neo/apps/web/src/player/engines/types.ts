/* Contrato común de los motores de vídeo (adaptadores). El orquestador
   (runtime.ts) no sabe si debajo hay mpegts.js, hls.js, el HLS nativo de
   Safari o la señal de la demo: solo arranca, destruye y escucha estos
   avisos. Así cada adaptador se prueba solo con un motor simulado. */

import type { PlaybackMode, PlaybackProfile } from '@ace/shared';

/**
 * hls.js sobre el remux del servidor (docs/multidispositivo.md §4.4): el modo
 * y el seguimiento del directo de la concesión (`latency.liveSync`), en
 * segundos.
 */
export interface RemuxTuning {
  readonly mode: PlaybackMode;
  readonly liveSync: {
    readonly targetS: number;
    readonly maxS: number;
    readonly rate: number;
  } | null;
}

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
}

export interface EngineInfo {
  /** Velocidad de descarga que ve el propio motor, en KB/s. */
  speedKBs?: number | null;
  decodedFrames?: number | null;
  droppedFrames?: number | null;
  /** hls.js: segundos por detrás del final de la lista (`hls.latency`). */
  latencyS?: number;
  /** hls.js: TARGETDURATION de la lista y lo que duran de verdad sus segmentos. */
  segment?: { targetS: number; minS: number | null; maxS: number | null };
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
}

export interface EngineArgs {
  video: HTMLMediaElement;
  /** URL tal cual la da el backend (relativa). Cada adaptador la hace absoluta si le hace falta. */
  url: string;
  profile: PlaybackProfile;
  callbacks: EngineCallbacks;
  /** Para la demo: el canal de muestra que «no responde». */
  demoFails?: boolean;
  /** hls.js sobre el remux del servidor: en segundos (docs/multidispositivo.md §4.4). */
  remux?: RemuxTuning | null;
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
