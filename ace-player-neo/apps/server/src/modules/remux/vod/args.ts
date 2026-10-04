/* Argumentos de UNA ejecución de ffmpeg del VOD (docs/vod.md §9.6). Puro.

   Reinicio en el segmento N, que empieza en el fotograma clave K:

     ffmpeg -hide_banner -loglevel warning -nostdin
       -protocol_whitelist http,tcp -rw_timeout 55000000
       -reconnect 1 -reconnect_on_network_error 1 -reconnect_delay_max 1
       [N>0: -noaccurate_seek -ss <K+0.200>]
       -probesize 5000000 -analyzeduration 5000000
       -i http://127.0.0.1:<relé>/r/<ticket>/vod.<ext>
       -map 0:v:0 -map 0:a:<A>
       -c:v copy [HEVC: -tag:v hvc1]
       [AAC-LC: -c:a copy | si no: -c:a aac -b:a 160k -ac 2 -af aresample=…]
       [solo si se pasa el audio a AAC: -threads 2]
       -copyts -metadata ace_session=<sid>
       -movflags +frag_keyframe+delay_moov+default_base_moof+frag_discont
       -f mp4 pipe:1

   - `-ss K` justo en un fotograma clave cae en el ANTERIOR; `K+0,2` con
     `-noaccurate_seek` cae justo en K (6.1, 8.1.2 y 9.0.2, con y sin B).
   - `+delay_moov+frag_discont` con `-copyts` da tiempos absolutos (el mismo
     `tfdt` desde cualquier punto de reinicio).
   - NUNCA `first_pts=0` (T11): 3,8·10¹⁴ s de marca de tiempo y 622 MB.
   - Fichero aparte del remux del directo (`remux/args.ts`, zona del
     diagnóstico): no se comparte nada.
   - Solo la URL del relé: ni el host ni las credenciales del proveedor
     llegan nunca a la línea de órdenes (se ve en /proc/<pid>/cmdline).
   - `-threads 2` solo con el audio transcodificado (P12): copiándolo todo
     ffmpeg apenas trabaja. */

import { VOD_FFMPEG_RW_TIMEOUT_US, VOD_PLAY } from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import { ACE_SESSION_MARK } from '../args.js';
import { isRelayUrl } from './reader.js';
import type { VodTrack } from './types.js';

export const VOD_MOVFLAGS = '+frag_keyframe+delay_moov+default_base_moof+frag_discont';

export interface VodArgsInput {
  /** `http://127.0.0.1:<p>/r/<ticket>/vod.<ext>` (nunca la del proveedor). */
  readonly inputUrl: string;
  readonly sessionId: string;
  /** Segmento en el que empieza esta ejecución. */
  readonly segment: number;
  /** Tiempo del fotograma clave que abre ese segmento. */
  readonly keyframeS: number;
  /** Pista de audio (null: sin audio). */
  readonly audio: VodTrack | null;
  readonly hevc: boolean;
}

export function buildVodArgs(input: VodArgsInput): string[] {
  if (!isRelayUrl(input.inputUrl)) {
    throw new AppError('internal_error', { detail: 'ffmpeg VOD fuera del relé' });
  }
  const seek =
    input.segment > 0 && input.keyframeS > 0
      ? ['-noaccurate_seek', '-ss', (input.keyframeS + VOD_PLAY.ssNudgeS).toFixed(3)]
      : [];
  const copyAudio = input.audio?.codec === 'aac' && input.audio.aacLc;
  const audio = !input.audio
    ? ['-an']
    : copyAudio
      ? ['-map', `0:a:${input.audio.index}`, '-c:a', 'copy']
      : [
          ...['-map', `0:a:${input.audio.index}`],
          ...['-c:a', 'aac', '-b:a', '160k', '-ac', '2'],
          ...['-af', 'aresample=async=1000:min_hard_comp=0.100', '-threads', '2'],
        ];
  return [
    ...['-hide_banner', '-loglevel', 'warning', '-nostdin'],
    ...['-protocol_whitelist', 'http,tcp', '-rw_timeout', String(VOD_FFMPEG_RW_TIMEOUT_US)],
    /* Auditoría 0.9.0: si una petición al relé se corta (la de los Cues, sobre todo), ffmpeg la
       repite en vez de dar el índice por perdido y leer la película de corrido desde el principio. */
    ...['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '1'],
    ...seek,
    ...['-probesize', '5000000', '-analyzeduration', '5000000'],
    ...['-i', input.inputUrl],
    ...['-map', '0:v:0', '-c:v', 'copy'],
    ...(input.hevc ? ['-tag:v', 'hvc1'] : []),
    ...audio,
    '-copyts',
    ...['-metadata', `${ACE_SESSION_MARK}${input.sessionId}`],
    ...['-movflags', VOD_MOVFLAGS, '-f', 'mp4', 'pipe:1'],
  ];
}
