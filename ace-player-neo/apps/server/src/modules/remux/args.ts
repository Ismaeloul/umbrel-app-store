/* Argumentos de ffmpeg del remux (arquitectura §5.7; T-125).

   Son los de la 0.6.59 (server.js:261-318) uno a uno, en el mismo orden, con
   dos cambios que pide la v2:
   - la entrada es la `playbackUrl` de la sesión que abrió el backend
     (progresiva o HLS), nunca un `getstream` abierto por ffmpeg por su cuenta
     (server.js:259), que nadie podía parar (P7, P8);
   - `-threads 2` (tope de hilos del codificador de audio) y
     `-metadata ace_session=<id>`, que deja el id de la sesión en la línea de
     órdenes para reconocer los ffmpeg huérfanos en /proc.
   `-hide_banner -loglevel warning -nostdin` ya estaban en la 0.6.59. */

import path from 'node:path';
import { IPTV_FFMPEG_RW_TIMEOUT_US } from '@ace/shared';

export interface RemuxArgsInput {
  /** URL absoluta de la entrada: la `playbackUrl` en el motor principal o la del relé IPTV. */
  readonly url: string;
  /** Carpeta de la sesión (index.m3u8, init.mp4 e index<N>.m4s). */
  readonly dir: string;
  /** Id `s_…` de la sesión del backend. */
  readonly sessionId: string;
  /** De dónde sale la entrada (por defecto, el motor). */
  readonly origin?: 'engine' | 'iptv';
  /** La entrada del relé es HLS (lista) y no TS continuo. */
  readonly isHls?: boolean;
}

/** Marca que lleva cada ffmpeg del remux en su línea de órdenes. */
export const ACE_SESSION_MARK = 'ace_session=';

/**
 * Entrada con origen IPTV (docs/iptv.md §6.3): sin `-reconnect*` (reconecta
 * el relé), `-rw_timeout` en MICROsegundos por encima del peor caso del relé
 * (41 s), solo los protocolos del relé en 127.0.0.1 y, con HLS, empezando 3
 * segmentos antes del final. La URL es la del relé: sin credenciales.
 */
function iptvInputArgs(input: RemuxArgsInput): string[] {
  return [
    '-protocol_whitelist',
    'http,tcp,crypto',
    '-rw_timeout',
    String(IPTV_FFMPEG_RW_TIMEOUT_US),
    ...(input.isHls ? ['-live_start_index', '-3'] : []),
  ];
}

export function buildRemuxArgs(input: RemuxArgsInput): string[] {
  const reconnect =
    input.origin === 'iptv'
      ? iptvInputArgs(input)
      : [
          // server.js:269-271: reconexión sola si el motor corta (B-224)
          '-reconnect',
          '1',
          '-reconnect_streamed',
          '1',
          '-reconnect_at_eof',
          '1',
          '-reconnect_on_network_error',
          '1',
          '-reconnect_delay_max',
          '4',
          '-rw_timeout',
          '20000000',
        ];
  return [
    // server.js:262
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    // server.js:263 (B-220)
    '-fflags',
    '+genpts+discardcorrupt',
    ...reconnect,
    // server.js:272-273
    '-probesize',
    '5000000',
    '-analyzeduration',
    '5000000',
    '-thread_queue_size',
    '512',
    // server.js:274 (la entrada, ahora la de la sesión del backend)
    '-i',
    input.url,
    // server.js:275
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    // server.js:306-307: vídeo copiado con -copyinkf, audio AAC 160k estéreo (B-218, B-219)
    '-c:v',
    'copy',
    '-copyinkf',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ac',
    '2',
    '-af',
    'aresample=async=1000:min_hard_comp=0.100:first_pts=0',
    // Nuevo en la v2 (arquitectura §5.7)
    '-threads',
    '2',
    '-metadata',
    `${ACE_SESSION_MARK}${input.sessionId}`,
    // server.js:313-317: HLS fMP4 de 2 s en ventana de 15 (B-225)
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_list_size',
    '15',
    '-hls_delete_threshold',
    '2',
    '-hls_flags',
    'delete_segments+independent_segments+temp_file+omit_endlist',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    path.join(input.dir, 'index.m3u8'),
  ];
}
