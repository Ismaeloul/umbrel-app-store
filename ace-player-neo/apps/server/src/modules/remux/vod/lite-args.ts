/* Argumentos del ffmpeg de UN segmento ligero (docs/ver-juntos.md §17). Puro.

     ffmpeg -hide_banner -loglevel warning -nostdin
       -threads 2 -f mp4 -i pipe:0
       -copyts -fps_mode passthrough
       -map 0:v:0 -map 0:a:0?
       -vf scale=-2:'min(720,ih)'
       -c:v libx264 -preset veryfast -profile:v high -level:v 4.0 -pix_fmt yuv420p
       -crf 23 -maxrate 2500k -bufsize 5000k -bf 0 -g 9999 -sc_threshold 0
       -threads 2 -filter_threads 1
       -c:a copy
       -metadata ace_session=<sid>
       -movflags +frag_keyframe+delay_moov+default_base_moof+frag_discont
       -f mp4 pipe:1

   - La entrada es `init.mp4` + `index<N>.m4s` del productor por la tubería
     (vod/lite.ts los escribe): NUNCA el relé ni el proveedor. Un segmento de
     la versión original empieza en su fotograma clave y es un GOP (o más) del
     índice, así que el ligero sale con los mismos límites y, con `-copyts` y
     `-fps_mode passthrough`, con los mismos tiempos: la misma lista, el mismo
     `EXTINF`, el mismo reloj de la sala.
   - Sin `expr:gte(t,n_forced*2)` del directo (`liteVideoArgs`): aquí el
     primer fotograma es el IDR y el segmento entero es UN GOP (`-g 9999`,
     sin cortes de escena). Los segmentos de 2 s del directo no pintan nada.
   - `-bf 0` a propósito: sin fotogramas B no hay desfase de composición ni
     `elst` que cambie entre la versión ligera y la original, y la cuenta de
     `tfdt` + desfase − `elst` (fmp4.ts) sale igual sin pensar. Cuesta un 10 %
     de calidad por bit; se mira de nuevo con las medidas del NAS.
   - `-level:v 4.0` fijo: el `CODECS` de la lista maestra (`avc1.640028`) es
     el de verdad también con 720p60, y el init no cambia entre segmentos.
   - El audio se COPIA: ya es el AAC-LC que dejó el productor (copiado o
     convertido una vez), sin otro cebado ni otra `elst`. `0:a:0?`: un título
     sin audio no rompe nada.
   - `-threads 2` en la entrada (decodificar) y en la salida (x264) y un solo
     hilo de filtros: el tope de procesos del contenedor (`pids_limit`) cuenta
     hilos.
   - Altura y caudal, los de la calidad ligera del directo (`LITE_HEIGHT`,
     `LITE_MAXRATE`, remux/args.ts): un solo sitio.

   Con la gráfica del NAS (§17.6, `vaapi`; el ensayo es remux/hwaccel.ts):

     ffmpeg … -init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va
       -hwaccel vaapi -hwaccel_device va -hwaccel_output_format vaapi
       -threads 2 -f mp4 -i pipe:0 -copyts -fps_mode passthrough -map …
       -vf format=nv12|vaapi,hwupload,scale_vaapi=w=-2:h='min(720,ih)':format=nv12
       -c:v h264_vaapi [-low_power 1] -profile:v high -level:v 40
       -rc_mode VBR -b:v 1500k -maxrate 2500k -bufsize 5000k   (o CQP -qp 25)
       -bf 0 -g 9999 -threads 2 -filter_threads 1 -c:a copy …

   Decodifica, escala y codifica la gráfica; lo que no sepa decodificar lo
   decodifica la CPU y `hwupload` lo sube. Lo demás no cambia: los mismos
   tiempos, un GOP por segmento que empieza en IDR (cada trabajo es un ffmpeg
   nuevo), sin B, el audio copiado y la misma salida. Su `avcC` no es el de
   x264 (banderas de restricción 4 y 5): una sesión no mezcla los dos
   (vod/lite.ts) y la lista maestra anuncia el del ensayo. */

import {
  ACE_SESSION_MARK,
  LITE_HEIGHT,
  LITE_MAXRATE,
  VAAPI_LITE_LEVEL,
  VAAPI_LITE_RATE,
  VAAPI_UPLOAD,
  vaapiEncoderArgs,
  vaapiInputArgs,
  vaapiScale,
  type VaapiProfile,
} from '../args.js';
import { VOD_MOVFLAGS } from './args.js';

/** Hilos del decodificador y de x264 en un trabajo ligero. */
export const LITE_THREADS = 2;
/** Nivel H.264 fijo (ver arriba) y su cadena RFC 6381 con perfil High. */
export const LITE_LEVEL = '4.0';
export const LITE_VIDEO_CODECS = 'avc1.640028';
/** El audio que sale del productor siempre es AAC-LC. */
export const LITE_AUDIO_CODECS = 'mp4a.40.2';

export interface VodLiteArgsInput {
  readonly sessionId: string;
  /** La gráfica (null o nada: x264). */
  readonly vaapi?: VaapiProfile | null;
}

export function buildVodLiteArgs(input: VodLiteArgsInput): string[] {
  const hw = input.vaapi;
  if (hw) {
    return [
      ...['-hide_banner', '-loglevel', 'warning', '-nostdin'],
      ...vaapiInputArgs(hw.device),
      ...['-threads', String(LITE_THREADS), '-f', 'mp4', '-i', 'pipe:0'],
      ...['-copyts', '-fps_mode', 'passthrough'],
      ...['-map', '0:v:0', '-map', '0:a:0?'],
      ...['-vf', `${VAAPI_UPLOAD},${vaapiScale(LITE_HEIGHT)}`],
      ...vaapiEncoderArgs(hw, VAAPI_LITE_RATE, { gop: 9999, level: VAAPI_LITE_LEVEL }),
      ...['-threads', String(LITE_THREADS), '-filter_threads', '1'],
      ...['-c:a', 'copy'],
      ...['-metadata', `${ACE_SESSION_MARK}${input.sessionId}`],
      ...['-movflags', VOD_MOVFLAGS, '-f', 'mp4', 'pipe:1'],
    ];
  }
  return [
    ...['-hide_banner', '-loglevel', 'warning', '-nostdin'],
    ...['-threads', String(LITE_THREADS), '-f', 'mp4', '-i', 'pipe:0'],
    ...['-copyts', '-fps_mode', 'passthrough'],
    ...['-map', '0:v:0', '-map', '0:a:0?'],
    ...['-vf', `scale=-2:'min(${LITE_HEIGHT},ih)'`],
    ...['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', LITE_LEVEL],
    ...['-pix_fmt', 'yuv420p', '-crf', '23', '-maxrate', LITE_MAXRATE, '-bufsize', '5000k'],
    ...['-bf', '0', '-g', '9999', '-sc_threshold', '0'],
    ...['-threads', String(LITE_THREADS), '-filter_threads', '1'],
    ...['-c:a', 'copy'],
    ...['-metadata', `${ACE_SESSION_MARK}${input.sessionId}`],
    ...['-movflags', VOD_MOVFLAGS, '-f', 'mp4', 'pipe:1'],
  ];
}
