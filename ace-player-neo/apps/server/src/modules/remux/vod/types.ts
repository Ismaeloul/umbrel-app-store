/* Tipos de la reproducción de Películas y series (docs/vod.md §9.4-§9.7).

   El índice sale de leer el fichero del proveedor por Range (MKV Cues o MP4
   moov) SIN ffmpeg; el plan, de los fotogramas clave del índice; y el
   productor junta los segmentos HLS con lo que saca un ffmpeg por su
   tubería. Aquí no hay nada del proveedor: solo la URL del relé en
   127.0.0.1. */

/** Contenedores con índice en la v1 (§9.4). */
export type VodContainer = 'mkv' | 'mp4';

/** Vídeo de la película: `codecs` es la cadena RFC 6381 (`avc1.640028`, `hvc1.2.4.L120.B0`). */
export interface VodVideoInfo {
  /** `h264`, `hevc` o el códec tal cual (`mpeg4`, `mpeg2video`, `vc1`…): solo los dos primeros se ven. */
  readonly codec: string;
  readonly codecs: string;
  readonly width: number | null;
  readonly height: number | null;
  /** 8, 10… o null si no se sabe (se da por 8). */
  readonly bitDepth: number | null;
  /** H.264: `profile_idc`; HEVC: el perfil efectivo (`parseHvcC`). null si no se sabe. */
  readonly profile: number | null;
  /** 1 = 4:2:0, 2 = 4:2:2, 3 = 4:4:4; null si no se sabe (se da por 4:2:0). */
  readonly chromaFormat: number | null;
}

/** Una pista de audio (`index` es su posición entre las de audio: `-map 0:a:<index>`). */
export interface VodTrack {
  readonly index: number;
  /** `aac`, `ac3`, `eac3`, `dts`, `truehd`, `flac`, `opus`, `mp3`, `vorbis`… */
  readonly codec: string;
  /** Solo AAC-LC se copia; lo demás pasa a AAC estéreo (§9.6). */
  readonly aacLc: boolean;
  readonly channels: number | null;
  /** ISO 639-2 (`spa`) o BCP 47 (`es-419`), o null. */
  readonly lang: string | null;
  readonly name: string | null;
  readonly isDefault: boolean;
}

/** Una pista de subtítulos (se usan después de la v1, §9.10). */
export interface VodSubtitle {
  readonly index: number;
  readonly codec: string;
  /** De texto (subrip, ass, mov_text, webvtt): se pueden pasar a WebVTT. De imagen, no. */
  readonly text: boolean;
  readonly lang: string | null;
  readonly name: string | null;
  readonly isDefault: boolean;
  readonly forced: boolean;
}

/** Índice de fotogramas clave y pistas de un título (§9.4). */
export interface VodIndex {
  readonly container: VodContainer;
  /** Duración de la pista de VÍDEO (no la del contenedor), en segundos. */
  readonly durationS: number;
  /** Tiempos de presentación de los fotogramas clave del vídeo, en segundos, ordenados. */
  readonly keyframes: Float64Array;
  readonly video: VodVideoInfo;
  readonly audio: readonly VodTrack[];
  readonly subtitles: readonly VodSubtitle[];
  readonly sizeBytes: number;
}

/** Lee bytes del fichero por Range. `size` se sabe tras la primera lectura. */
export interface RangeReader {
  /** Bytes `[start, end]` (ambos incluidos). Puede devolver menos si el fichero acaba antes. */
  read(start: number, end: number): Promise<Buffer>;
  /** Tamaño total del fichero, o null si aún no se sabe. */
  size(): number | null;
}
